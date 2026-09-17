import { randomUUID } from 'node:crypto';
import { open, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import {
  EDITOR_MAX_BYTES,
  IPC_EVENTS,
  PREVIEW_MAX_BYTES,
  PREVIEW_TEXT_BYTES,
  type EditorDocument,
  type EditorSaveResult,
  type FilePreview,
  type SessionInfo,
} from '@vela-ftp/shared';
import { logger } from 'vela-kit/logger';
import type { SessionManager } from '../sessions/SessionManager';
import { TransferRequestError, type TransferHost } from '../transfer/TransferHost';
import { buildPreview, decodeText, encodeText, imageMimeType, isProbablyBinary } from './fileContent';
import { createTempDir, removeTempDir } from './tempFiles';

/** El fichero no es texto y no se puede abrir en el editor. */
export class BinaryFileError extends Error {
  constructor(readonly fileName: string) {
    super(`${fileName} no es un fichero de texto`);
    this.name = 'BinaryFileError';
  }
}

function tooLarge(name: string, size: number, maxBytes: number): TransferRequestError {
  return new TransferRequestError({ code: 'TOO_LARGE', message: `${name} ocupa ${size} bytes`, details: { size, maxBytes } });
}

function basename(remotePath: string): string {
  return remotePath.slice(remotePath.lastIndexOf('/') + 1) || remotePath;
}

interface OpenDocument {
  payload: EditorDocument;
  sessionId: string;
  siteId: string;
  remotePath: string;
  tempDir: string;
  /** Tamaño y fecha del remoto la última vez que lo leímos o escribimos. */
  expected: { size: number; modifiedAt: number | null };
  bom: boolean;
  window: BrowserWindow;
  dirty: boolean;
  discard: boolean;
}

export interface EditorManagerDeps {
  transfer: TransferHost;
  sessions: SessionManager;
  openWindow: (query: Record<string, string>, title: string) => BrowserWindow;
}

/** Ficheros remotos abiertos en ventanas de edición o de diff, y vistas previas. */
export class EditorManager {
  private readonly docs = new Map<string, OpenDocument>();

  constructor(private readonly deps: EditorManagerDeps) {}

  private session(sessionId: string): SessionInfo {
    const info = this.deps.sessions.get(sessionId);
    if (!info) throw new TransferRequestError({ code: 'NOT_CONNECTED', message: 'La sesión no está abierta' });
    return info;
  }

  /** Si ya hay una ventana para lo mismo, la trae al frente. */
  private focusExisting(match: (doc: OpenDocument) => boolean): boolean {
    for (const doc of this.docs.values()) {
      if (!match(doc) || doc.window.isDestroyed()) continue;
      if (doc.window.isMinimized()) doc.window.restore();
      doc.window.focus();
      return true;
    }
    return false;
  }

  private async fetchText(sessionId: string, remotePath: string, dir: string): Promise<{ text: string; bom: boolean; size: number; modifiedAt: number | null }> {
    const localCopy = path.join(dir, basename(remotePath));
    const entry = await this.deps.transfer.request('file.fetch', { sessionId, path: remotePath, localPath: localCopy, maxBytes: EDITOR_MAX_BYTES });
    const buffer = await readFile(localCopy);
    if (isProbablyBinary(buffer)) throw new BinaryFileError(entry.name);
    return { ...decodeText(buffer), size: entry.size, modifiedAt: entry.modifiedAt };
  }

  async openRemote(sessionId: string, remotePath: string): Promise<void> {
    const session = this.session(sessionId);
    if (this.focusExisting((d) => d.payload.mode === 'edit' && d.siteId === session.siteId && d.remotePath === remotePath)) return;

    const tempDir = await createTempDir('edit');
    try {
      const file = await this.fetchText(sessionId, remotePath, tempDir);
      const id = randomUUID();
      const name = basename(remotePath);
      this.register({
        payload: { id, mode: 'edit', name, remotePath, siteName: session.siteName, content: file.text },
        sessionId,
        siteId: session.siteId,
        remotePath,
        tempDir,
        expected: { size: file.size, modifiedAt: file.modifiedAt },
        bom: file.bom,
        window: this.deps.openWindow({ view: 'editor', id }, `${name} — ${session.siteName}`),
        dirty: false,
        discard: false,
      });
    } catch (err) {
      await removeTempDir(tempDir);
      throw err;
    }
  }

  async openDiff(sessionId: string, remotePath: string, localPath: string): Promise<void> {
    const session = this.session(sessionId);
    const same = (d: OpenDocument) => d.payload.mode === 'diff' && d.siteId === session.siteId && d.remotePath === remotePath && d.payload.localPath === localPath;
    if (this.focusExisting(same)) return;

    const info = await stat(localPath);
    const name = basename(remotePath);
    if (info.size > EDITOR_MAX_BYTES) throw tooLarge(path.basename(localPath), info.size, EDITOR_MAX_BYTES);
    const localBuffer = await readFile(localPath);
    if (isProbablyBinary(localBuffer)) throw new BinaryFileError(path.basename(localPath));

    const tempDir = await createTempDir('diff');
    try {
      const remote = await this.fetchText(sessionId, remotePath, tempDir);
      const id = randomUUID();
      this.register({
        payload: {
          id,
          mode: 'diff',
          name,
          remotePath,
          localPath,
          siteName: session.siteName,
          original: remote.text,
          modified: decodeText(localBuffer).text,
        },
        sessionId,
        siteId: session.siteId,
        remotePath,
        tempDir,
        expected: { size: remote.size, modifiedAt: remote.modifiedAt },
        bom: remote.bom,
        window: this.deps.openWindow({ view: 'editor', id }, `${name}: ${session.siteName} ↔ local`),
        dirty: false,
        discard: false,
      });
    } catch (err) {
      await removeTempDir(tempDir);
      throw err;
    }
  }

  private register(doc: OpenDocument): void {
    const id = doc.payload.id;
    this.docs.set(id, doc);
    doc.window.on('close', (event) => {
      if (!doc.dirty || doc.discard) return;
      // La ventana decide con su propio diálogo: guardar, descartar o seguir.
      event.preventDefault();
      doc.window.webContents.send(IPC_EVENTS.EDITOR_CLOSE_REQUESTED, null);
    });
    doc.window.on('closed', () => {
      this.docs.delete(id);
      void removeTempDir(doc.tempDir);
    });
  }

  /** Solo la ventana del documento puede leerlo o guardarlo. */
  private owned(id: string, senderId: number): OpenDocument {
    const doc = this.docs.get(id);
    if (!doc || doc.window.isDestroyed() || doc.window.webContents.id !== senderId) {
      throw new TransferRequestError({ code: 'NOT_FOUND', message: 'Documento no encontrado' });
    }
    return doc;
  }

  load(id: string, senderId: number): EditorDocument {
    return this.owned(id, senderId).payload;
  }

  setDirty(id: string, dirty: boolean, senderId: number): void {
    this.owned(id, senderId).dirty = dirty;
  }

  close(id: string, senderId: number): void {
    const doc = this.owned(id, senderId);
    doc.discard = true;
    doc.window.close();
  }

  /**
   * Sesión con la que guardar: la del documento, otra abierta del mismo sitio
   * (el usuario desconectó y volvió a conectar) o, si no hay, una temporal.
   */
  private async withSession<T>(doc: OpenDocument, fn: (sessionId: string) => Promise<T>): Promise<T> {
    if (this.deps.sessions.get(doc.sessionId)) return fn(doc.sessionId);
    const reopened = this.deps.sessions.findBySite(doc.siteId);
    if (reopened) {
      doc.sessionId = reopened.sessionId;
      return fn(reopened.sessionId);
    }
    const temporary = await this.deps.sessions.open(doc.siteId);
    try {
      return await fn(temporary.sessionId);
    } finally {
      await this.deps.sessions.close(temporary.sessionId).catch(() => undefined);
    }
  }

  async save(id: string, content: string, force: boolean, senderId: number): Promise<EditorSaveResult> {
    const doc = this.owned(id, senderId);
    if (doc.payload.mode !== 'edit') throw new TransferRequestError({ code: 'PROTOCOL', message: 'Un diff no se guarda' });
    const bytes = encodeText(content, doc.bom);
    if (bytes.length > EDITOR_MAX_BYTES) throw tooLarge(doc.payload.name, bytes.length, EDITOR_MAX_BYTES);

    const localCopy = path.join(doc.tempDir, basename(doc.remotePath));
    await writeFile(localCopy, bytes);
    const entry = await this.withSession(doc, (sessionId) =>
      this.deps.transfer.request('file.store', { sessionId, localPath: localCopy, path: doc.remotePath, expected: force ? null : doc.expected }),
    );
    // Sin stat tras subir, la próxima comprobación se hace contra lo que acabamos de escribir.
    doc.expected = entry ? { size: entry.size, modifiedAt: entry.modifiedAt } : { size: bytes.length, modifiedAt: null };
    doc.dirty = false;
    doc.payload = { ...doc.payload, content };
    logger.info(`[editor] guardado ${doc.remotePath} (${bytes.length} bytes)`);
    return { savedAt: Date.now(), size: bytes.length };
  }

  async previewRemote(sessionId: string, remotePath: string): Promise<FilePreview> {
    this.session(sessionId);
    const tempDir = await createTempDir('preview');
    try {
      const localCopy = path.join(tempDir, basename(remotePath));
      const entry = await this.deps.transfer.request('file.fetch', { sessionId, path: remotePath, localPath: localCopy, maxBytes: PREVIEW_MAX_BYTES });
      return buildPreview(entry.name, await readFile(localCopy), entry.size);
    } finally {
      await removeTempDir(tempDir);
    }
  }

  async previewLocal(localPath: string): Promise<FilePreview> {
    const info = await stat(localPath);
    const name = path.basename(localPath);
    const isImage = imageMimeType(name) !== null;
    if (isImage && info.size > PREVIEW_MAX_BYTES) throw tooLarge(name, info.size, PREVIEW_MAX_BYTES);
    // Del texto basta con el principio: no se lee un log de varios GB entero.
    const length = isImage ? info.size : Math.min(info.size, PREVIEW_TEXT_BYTES + 4);
    const handle = await open(localPath, 'r');
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, 0);
      return buildPreview(name, buffer.subarray(0, bytesRead), info.size);
    } finally {
      await handle.close();
    }
  }
}

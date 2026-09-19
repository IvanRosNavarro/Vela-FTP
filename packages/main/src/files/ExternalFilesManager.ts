import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import type { ExternalFileEvent, SessionInfo, TransferMethod, TransferParams, TransferResults } from '@vela-ftp/shared';
import { logger } from 'vela-kit/logger';
import { TransferRequestError } from '../transfer/TransferHost';

/** Tope para abrir fuera: un programa externo aguanta más que el editor integrado. */
export const EXTERNAL_MAX_BYTES = 512 * 1024 * 1024;

export interface ExternalFilesDeps {
  transfer: { request<M extends TransferMethod>(method: M, params: TransferParams<M>): Promise<TransferResults[M]> };
  sessions: {
    get(sessionId: string): SessionInfo | undefined;
    findBySite(siteId: string): SessionInfo | undefined;
    open(siteId: string): Promise<SessionInfo>;
    close(sessionId: string): Promise<void>;
  };
  /** Abre el fichero con el programa del sistema; devuelve un mensaje si falla. */
  openPath: (localPath: string) => Promise<string>;
  createTempDir: () => Promise<string>;
  /** `upload` sube solo al guardar; `ask` pregunta antes. */
  saveMode: () => 'upload' | 'ask';
  /** Avisa a la ventana que abrió el fichero. */
  notify: (ownerId: number, event: ExternalFileEvent) => void;
  /** Tiempo que el fichero debe quedarse quieto tras guardar antes de subirlo. */
  stabilityMs?: number;
}

interface ExternalFile {
  id: string;
  ownerId: number;
  sessionId: string;
  siteId: string;
  siteName: string;
  remotePath: string;
  localPath: string;
  /** Tamaño y fecha del remoto la última vez que lo bajamos o subimos. */
  expected: { size: number; modifiedAt: number | null };
  watcher: FSWatcher | null;
  /** Hay cambios locales sin subir. */
  dirty: boolean;
  uploading: Promise<void>;
}

function basename(remotePath: string): string {
  return remotePath.slice(remotePath.lastIndexOf('/') + 1) || remotePath;
}

/**
 * Ficheros remotos abiertos con el programa predeterminado del sistema, como el
 * «Ver/Editar» de FileZilla: se bajan a una carpeta temporal y, si son para
 * editar, cada guardado se sube (o se pregunta, según el ajuste).
 */
export class ExternalFilesManager {
  private readonly files = new Map<string, ExternalFile>();

  constructor(private readonly deps: ExternalFilesDeps) {}

  async open(ownerId: number, sessionId: string, remotePath: string, mode: 'edit' | 'view'): Promise<void> {
    const session = this.deps.sessions.get(sessionId);
    if (!session) throw new TransferRequestError({ code: 'NOT_CONNECTED', message: 'La sesión no está abierta' });

    // Ya abierto para editar: si tiene cambios sin subir no se pisan con una copia nueva.
    const existing = [...this.files.values()].find((f) => f.siteId === session.siteId && f.remotePath === remotePath);
    if (existing?.dirty) {
      await this.launch(existing.localPath);
      return;
    }

    const dir = existing ? path.dirname(existing.localPath) : await this.deps.createTempDir();
    const localPath = existing?.localPath ?? path.join(dir, basename(remotePath));
    const entry = await this.deps.transfer.request('file.fetch', { sessionId, path: remotePath, localPath, maxBytes: EXTERNAL_MAX_BYTES });

    if (existing) {
      existing.expected = { size: entry.size, modifiedAt: entry.modifiedAt };
      existing.sessionId = sessionId;
      existing.ownerId = ownerId;
    } else if (mode === 'edit') {
      const file: ExternalFile = {
        id: randomUUID(),
        ownerId,
        sessionId,
        siteId: session.siteId,
        siteName: session.siteName,
        remotePath,
        localPath,
        expected: { size: entry.size, modifiedAt: entry.modifiedAt },
        watcher: null,
        dirty: false,
        uploading: Promise.resolve(),
      };
      file.watcher = await this.watchFile(file);
      this.files.set(file.id, file);
    }
    await this.launch(localPath);
  }

  /**
   * Baja estos remotos a un temporal para poder arrastrarlos fuera de la
   * ventana (el arrastre nativo del SO solo puede empezar con ficheros que ya
   * existan en disco). Un `null` por cada uno que no se haya podido bajar.
   */
  async prepareForDrag(sessionId: string, items: { path: string; name: string }[]): Promise<({ path: string; name: string } | null)[]> {
    const session = this.deps.sessions.get(sessionId);
    if (!session) throw new TransferRequestError({ code: 'NOT_CONNECTED', message: 'La sesión no está abierta' });
    const dir = await this.deps.createTempDir();
    const results: ({ path: string; name: string } | null)[] = [];
    for (const item of items) {
      const localPath = path.join(dir, item.name);
      try {
        await this.deps.transfer.request('file.fetch', { sessionId, path: item.path, localPath, maxBytes: EXTERNAL_MAX_BYTES });
        results.push({ path: localPath, name: item.name });
      } catch (err) {
        logger.warn(`[external] no se pudo preparar ${item.path} para arrastrar`, err);
        results.push(null);
      }
    }
    return results;
  }

  private async launch(localPath: string): Promise<void> {
    const error = await this.deps.openPath(localPath);
    if (error) throw new Error(`No hay ningún programa para abrir ${path.basename(localPath)}: ${error}`);
  }

  private async watchFile(file: ExternalFile): Promise<FSWatcher> {
    const watcher = watch(file.localPath, {
      ignoreInitial: true,
      // Los editores guardan en varios pasos: se espera a que el fichero se quede quieto.
      awaitWriteFinish: { stabilityThreshold: this.deps.stabilityMs ?? 500, pollInterval: 100 },
    });
    watcher.on('change', () => this.onSaved(file));
    // Algunos editores guardan borrando y creando el fichero de nuevo.
    watcher.on('add', () => this.onSaved(file));
    await new Promise<void>((resolve) => watcher.once('ready', () => resolve()));
    return watcher;
  }

  private onSaved(file: ExternalFile): void {
    file.dirty = true;
    if (this.deps.saveMode() === 'ask') {
      this.deps.notify(file.ownerId, { kind: 'changed', id: file.id, name: basename(file.remotePath), siteName: file.siteName });
      return;
    }
    void this.upload(file.id, false);
  }

  /** Sube la copia local. Sin `force`, falla si alguien cambió el remoto desde que lo abrimos. */
  upload(id: string, force: boolean): Promise<void> {
    const file = this.files.get(id);
    if (!file) return Promise.resolve();
    // En serie: dos guardados seguidos no deben subir a la vez.
    file.uploading = file.uploading.then(() => this.doUpload(file, force));
    return file.uploading;
  }

  private async doUpload(file: ExternalFile, force: boolean): Promise<void> {
    const name = basename(file.remotePath);
    try {
      const entry = await this.withSession(file, (sessionId) =>
        this.deps.transfer.request('file.store', {
          sessionId,
          localPath: file.localPath,
          path: file.remotePath,
          expected: force ? null : file.expected,
        }),
      );
      if (entry) file.expected = { size: entry.size, modifiedAt: entry.modifiedAt };
      file.dirty = false;
      logger.info(`[external] subido ${file.remotePath}`);
      this.deps.notify(file.ownerId, { kind: 'uploaded', id: file.id, name, siteName: file.siteName });
    } catch (err) {
      if (err instanceof TransferRequestError && err.info.code === 'REMOTE_CHANGED') {
        this.deps.notify(file.ownerId, { kind: 'conflict', id: file.id, name, siteName: file.siteName });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`[external] no se pudo subir ${file.remotePath}`, err);
      this.deps.notify(file.ownerId, { kind: 'error', id: file.id, name, siteName: file.siteName, message });
    }
  }

  /** La sesión del fichero, otra del mismo sitio o una temporal si ya no hay ninguna. */
  private async withSession<T>(file: ExternalFile, fn: (sessionId: string) => Promise<T>): Promise<T> {
    if (this.deps.sessions.get(file.sessionId)) return fn(file.sessionId);
    const reopened = this.deps.sessions.findBySite(file.siteId);
    if (reopened) {
      file.sessionId = reopened.sessionId;
      return fn(reopened.sessionId);
    }
    const temporary = await this.deps.sessions.open(file.siteId);
    try {
      return await fn(temporary.sessionId);
    } finally {
      await this.deps.sessions.close(temporary.sessionId).catch(() => undefined);
    }
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.files.values()].map((f) => f.watcher?.close()));
    this.files.clear();
  }

  /** Para los tests: espera a que acaben las subidas en curso. */
  async idle(): Promise<void> {
    await Promise.all([...this.files.values()].map((f) => f.uploading));
  }
}

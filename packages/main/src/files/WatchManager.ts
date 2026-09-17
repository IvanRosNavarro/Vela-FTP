import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import { v7 as uuidv7 } from 'uuid';
import type { SessionInfo, TransferJob, TransferMethod, TransferParams, TransferResults, WatchInfo } from '@vela-ftp/shared';
import { logger } from 'vela-kit/logger';
import { TransferRequestError } from '../transfer/TransferHost';

/** Temporales de editores y ficheros del sistema que no deben acabar en el servidor. */
const IGNORED_NAME = /(?:^\.git$|^\.svn$|^\.DS_Store$|^Thumbs\.db$|^desktop\.ini$|~$|\.sw[px]$|\.tmp$|^\.#)/i;

export interface WatchManagerDeps {
  transfer: { request<M extends TransferMethod>(method: M, params: TransferParams<M>): Promise<TransferResults[M]> };
  sessions: { get(sessionId: string): SessionInfo | undefined; findBySite(siteId: string): SessionInfo | undefined };
  onChange: (watches: WatchInfo[]) => void;
  /** Espera antes de subir, para agrupar ráfagas de cambios (guardar varios ficheros, git checkout…). */
  debounceMs?: number;
  /** Tiempo que un fichero debe quedarse quieto antes de subirlo. */
  stabilityMs?: number;
}

interface ActiveWatch {
  info: WatchInfo;
  sessionId: string;
  watcher: FSWatcher;
  pending: Map<string, 'file' | 'dir'>;
  timer: ReturnType<typeof setTimeout> | null;
  flushing: Promise<void>;
}

export class WatchManager {
  private readonly watches = new Map<string, ActiveWatch>();

  constructor(private readonly deps: WatchManagerDeps) {}

  list(): WatchInfo[] {
    return [...this.watches.values()].map((w) => w.info);
  }

  private changed(): void {
    this.deps.onChange(this.list());
  }

  async start(sessionId: string, localDir: string, remoteDir: string): Promise<WatchInfo> {
    const session = this.deps.sessions.get(sessionId);
    if (!session) throw new TransferRequestError({ code: 'NOT_CONNECTED', message: 'La sesión no está abierta' });
    if (!(await stat(localDir)).isDirectory()) throw new TransferRequestError({ code: 'PROTOCOL', message: `No es una carpeta: ${localDir}` });

    const existing = [...this.watches.values()].find((w) => w.info.siteId === session.siteId && w.info.localDir === localDir && w.info.remoteDir === remoteDir);
    if (existing) return existing.info;

    const watcher = watch(localDir, {
      ignoreInitial: true,
      ignored: (p) => IGNORED_NAME.test(path.basename(p)),
      awaitWriteFinish: { stabilityThreshold: this.deps.stabilityMs ?? 400, pollInterval: 100 },
    });
    const active: ActiveWatch = {
      info: { id: randomUUID(), siteId: session.siteId, siteName: session.siteName, localDir, remoteDir, uploads: 0, lastUploadAt: null, error: null },
      sessionId,
      watcher,
      pending: new Map(),
      timer: null,
      flushing: Promise.resolve(),
    };
    watcher.on('add', (p) => this.schedule(active, p, 'file'));
    watcher.on('change', (p) => this.schedule(active, p, 'file'));
    watcher.on('addDir', (p) => this.schedule(active, p, 'dir'));
    watcher.on('error', (err) => this.setError(active, err instanceof Error ? err.message : String(err)));
    await new Promise<void>((resolve) => watcher.once('ready', () => resolve()));

    this.watches.set(active.info.id, active);
    logger.info(`[watch] ${localDir} → ${session.siteName}:${remoteDir}`);
    this.changed();
    return active.info;
  }

  async stop(id: string): Promise<void> {
    const active = this.watches.get(id);
    if (!active) return;
    this.watches.delete(id);
    if (active.timer) clearTimeout(active.timer);
    await active.watcher.close();
    this.changed();
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.watches.keys()].map((id) => this.stop(id)));
  }

  /** Espera a que termine lo que haya en curso (para los tests). */
  async idle(): Promise<void> {
    for (const active of this.watches.values()) {
      if (active.timer) {
        clearTimeout(active.timer);
        active.timer = null;
        active.flushing = active.flushing.then(() => this.flush(active));
      }
      await active.flushing;
    }
  }

  private schedule(active: ActiveWatch, localPath: string, kind: 'file' | 'dir'): void {
    if (localPath === active.info.localDir) return;
    active.pending.set(localPath, kind);
    if (active.timer) clearTimeout(active.timer);
    active.timer = setTimeout(() => {
      active.timer = null;
      active.flushing = active.flushing.then(() => this.flush(active));
    }, this.deps.debounceMs ?? 300);
  }

  private setError(active: ActiveWatch, error: string | null): void {
    if (active.info.error === error) return;
    active.info = { ...active.info, error };
    this.changed();
  }

  private remotePathFor(active: ActiveWatch, localPath: string): string {
    const parts = path.relative(active.info.localDir, localPath).split(path.sep);
    return path.posix.join(active.info.remoteDir, ...parts);
  }

  private async flush(active: ActiveWatch): Promise<void> {
    if (!this.watches.has(active.info.id) || active.pending.size === 0) return;
    // Si el usuario desconectó y volvió a conectar, la sesión nueva del mismo sitio sirve.
    const session = this.deps.sessions.get(active.sessionId) ?? this.deps.sessions.findBySite(active.info.siteId);
    if (!session) {
      this.setError(active, `Sin conexión con ${active.info.siteName}: los cambios se subirán al reconectar y volver a modificar`);
      return;
    }
    active.sessionId = session.sessionId;

    const batch = [...active.pending];
    active.pending.clear();
    const dirs = batch.filter(([, kind]) => kind === 'dir').map(([p]) => p).sort((a, b) => a.length - b.length);
    const files = batch.filter(([, kind]) => kind === 'file').map(([p]) => p);

    try {
      for (const dir of dirs) {
        await this.deps.transfer.request('fs.mkdir', { sessionId: session.sessionId, path: this.remotePathFor(active, dir) }).catch((err: unknown) => {
          // Ya existía: es lo normal al vigilar una carpeta que ya estaba subida.
          const code = err instanceof TransferRequestError ? err.info.code : null;
          if (code !== 'ALREADY_EXISTS' && code !== 'PERMISSION_DENIED' && code !== 'PROTOCOL') throw err;
        });
      }
      if (files.length > 0) {
        const jobs: TransferJob[] = files.map((localPath) => ({
          id: uuidv7(),
          sessionId: session.sessionId,
          direction: 'upload',
          localPath,
          remotePath: this.remotePathFor(active, localPath),
          isDirectory: false,
          conflictPolicy: 'overwrite',
          parentId: null,
        }));
        await this.deps.transfer.request('queue.enqueue', { jobs });
        active.info = { ...active.info, uploads: active.info.uploads + files.length, lastUploadAt: Date.now() };
      }
      active.info = { ...active.info, error: null };
      this.changed();
    } catch (err) {
      // Lo que no se pudo encolar se reintenta con el siguiente cambio.
      for (const [p, kind] of batch) if (!active.pending.has(p)) active.pending.set(p, kind);
      this.setError(active, err instanceof Error ? err.message : String(err));
    }
  }
}

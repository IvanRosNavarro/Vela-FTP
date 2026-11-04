import type { RemoteEntry } from '@vela-ftp/shared';
import { toFailure } from './errors';
import { basenameRemote, parentRemote, type RemoteFs } from './fs/RemoteFs';

const TTL_MS = 120_000;

interface CachedDir {
  entries: Map<string, RemoteEntry>;
  at: number;
}

/**
 * Listados de carpetas remotas que usa la cola para saber si un destino existe.
 * En FTP, `stat` lista la carpeta padre entera: sin esto, cada fichero de una
 * carpeta grande pedía otra vez el listado completo. Solo se usa en FTP; en
 * SFTP `stat` es una operación propia y sigue los enlaces.
 */
export class RemoteDirCache {
  private readonly dirs = new Map<string, CachedDir>();
  private readonly pending = new Map<string, Promise<Map<string, RemoteEntry>>>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs = TTL_MS,
  ) {}

  static applies(fs: RemoteFs): boolean {
    return fs.protocol !== 'sftp';
  }

  /** Guarda un listado ya hecho (al expandir una carpeta o al crearla vacía). */
  seed(sessionId: string, dir: string, entries: RemoteEntry[]): void {
    this.dirs.set(key(sessionId, dir), { entries: new Map(entries.map((e) => [e.name, e])), at: this.now() });
  }

  /** Lo que hay en `path`, listando su carpeta como mucho una vez mientras dure la caché. */
  async stat(sessionId: string, fs: RemoteFs, path: string): Promise<RemoteEntry | null> {
    if (!RemoteDirCache.applies(fs) || path === '/') return fs.stat(path);
    const entries = await this.listing(sessionId, fs, parentRemote(path));
    return entries.get(basenameRemote(path)) ?? null;
  }

  /** Apunta un fichero recién subido para que el siguiente vistazo lo vea. */
  put(sessionId: string, entry: RemoteEntry): void {
    this.dirs.get(key(sessionId, parentRemote(entry.path)))?.entries.set(entry.name, entry);
  }

  dropSession(sessionId: string): void {
    const prefix = `${sessionId}\0`;
    for (const k of [...this.dirs.keys()]) if (k.startsWith(prefix)) this.dirs.delete(k);
  }

  private async listing(sessionId: string, fs: RemoteFs, dir: string): Promise<Map<string, RemoteEntry>> {
    const k = key(sessionId, dir);
    const cached = this.dirs.get(k);
    if (cached && this.now() - cached.at < this.ttlMs) return cached.entries;
    let request = this.pending.get(k);
    if (!request) {
      request = fs
        .list(dir)
        .catch((err: unknown) => {
          // Una carpeta que no existe no tiene nada dentro.
          if (toFailure(err).code === 'NOT_FOUND') return [];
          throw err;
        })
        .then((list) => {
          this.seed(sessionId, dir, list);
          return this.dirs.get(k)!.entries;
        })
        .finally(() => this.pending.delete(k));
      this.pending.set(k, request);
    }
    return request;
  }
}

function key(sessionId: string, dir: string): string {
  return `${sessionId}\0${dir}`;
}

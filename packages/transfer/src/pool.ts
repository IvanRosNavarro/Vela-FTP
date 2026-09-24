import type { ConnectionConfig, LogLevel, TransferErrorCode } from '@vela-ftp/shared';
import { TransferFailure, toFailure } from './errors';
import type { RemoteFs, RemoteFsFactory } from './fs/RemoteFs';

/** Errores que indican que la conexión ya no sirve. */
const BROKEN_CONNECTION: ReadonlySet<TransferErrorCode> = new Set(['CONNECTION_FAILED', 'TIMEOUT', 'NOT_CONNECTED', 'CANCELLED']);

export function isBrokenConnection(err: unknown): boolean {
  return BROKEN_CONNECTION.has(toFailure(err).code);
}

export interface SessionPoolOptions {
  sessionId: string;
  config: ConnectionConfig;
  maxTransferConnections: number;
  factory: RemoteFsFactory;
  log: (sessionId: string, level: LogLevel, message: string) => void;
  onBrowseLost: (sessionId: string, error: TransferFailure) => void;
}

/**
 * Conexiones de una sesión: una de navegación (exclusiva, operaciones en serie)
 * y hasta N de transferencia. Como FileZilla, navegar no espera a que acabe una
 * transferencia.
 */
export class SessionPool {
  private browse: RemoteFs | null = null;
  private browseChain: Promise<unknown> = Promise.resolve();
  private readonly idle: RemoteFs[] = [];
  private busy = 0;
  private readonly waiters: Array<{ resolve: (fs: RemoteFs) => void; reject: (err: unknown) => void }> = [];
  private closed = false;
  private connectionCounter = 0;

  constructor(private readonly options: SessionPoolOptions) {}

  get sessionId(): string {
    return this.options.sessionId;
  }

  /** Configuración con la que se abrió la sesión (la terminal abre su propia conexión con ella). */
  get config(): ConnectionConfig {
    return this.options.config;
  }

  get maxTransferConnections(): number {
    return this.options.maxTransferConnections;
  }

  private async create(label: string): Promise<RemoteFs> {
    const n = ++this.connectionCounter;
    const fs = this.options.factory(this.options.config, (level, message) =>
      this.options.log(this.options.sessionId, level, `[${label}#${n}] ${message}`),
    );
    await fs.connect();
    return fs;
  }

  /** Abre la conexión de navegación y devuelve el directorio inicial. */
  async open(): Promise<string> {
    const fs = await this.create('nav');
    this.attachBrowse(fs);
    return fs.home();
  }

  private attachBrowse(fs: RemoteFs): void {
    this.browse = fs;
    fs.onLost((error) => {
      if (this.browse !== fs || this.closed) return;
      this.browse = null;
      this.options.onBrowseLost(this.options.sessionId, new TransferFailure('CONNECTION_FAILED', error.message));
    });
  }

  /**
   * Ejecuta `fn` en la conexión de navegación, en serie con las demás. Si la
   * conexión estaba caída se reconecta; `retry` repite una vez tras reconectar
   * (solo para operaciones idempotentes como listar).
   */
  withBrowse<T>(fn: (fs: RemoteFs) => Promise<T>, retry = false): Promise<T> {
    const run = async (): Promise<T> => {
      if (this.closed) throw new TransferFailure('NOT_CONNECTED', 'Sesión cerrada');
      if (!this.browse || this.browse.closed) this.attachBrowse(await this.create('nav'));
      try {
        return await fn(this.browse!);
      } catch (err) {
        if (!retry || !isBrokenConnection(err) || this.closed) throw err;
        this.browse?.close();
        this.attachBrowse(await this.create('nav'));
        return fn(this.browse!);
      }
    };
    const result = this.browseChain.then(run, run);
    this.browseChain = result.catch(() => undefined);
    return result;
  }

  /** Conexión de transferencia exclusiva; devolver siempre con `release`. */
  async acquire(): Promise<RemoteFs> {
    if (this.closed) throw new TransferFailure('NOT_CONNECTED', 'Sesión cerrada');
    while (this.idle.length > 0) {
      const fs = this.idle.pop()!;
      if (!fs.closed) {
        this.busy++;
        return fs;
      }
    }
    if (this.busy < this.options.maxTransferConnections) {
      this.busy++;
      try {
        return await this.create('trf');
      } catch (err) {
        this.busy--;
        this.wakeNext();
        throw err;
      }
    }
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  /** `broken` = la conexión dio un error de red o se canceló a medias: se descarta. */
  release(fs: RemoteFs, broken: boolean): void {
    if (broken || fs.closed || this.closed) {
      fs.close();
      this.busy--;
      this.wakeNext();
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve(fs);
      return;
    }
    this.busy--;
    this.idle.push(fs);
  }

  private wakeNext(): void {
    const waiter = this.waiters.shift();
    if (!waiter) return;
    this.acquire().then(waiter.resolve, waiter.reject);
  }

  close(): void {
    this.closed = true;
    this.browse?.close();
    this.browse = null;
    for (const fs of this.idle.splice(0)) fs.close();
    for (const waiter of this.waiters.splice(0)) {
      waiter.reject(new TransferFailure('NOT_CONNECTED', 'Sesión cerrada'));
    }
  }
}

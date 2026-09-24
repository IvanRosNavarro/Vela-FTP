import {
  TRANSFER_REQUEST_SCHEMAS,
  type ConnectionConfig,
  type LogLevel,
  type MainToTransferMessage,
  type TransferEventName,
  type TransferEvents,
  type TransferMethod,
  type TransferResults,
  type TransferToMainMessage,
} from '@vela-ftp/shared';
import type { z } from 'zod';
import { TransferFailure, toFailure } from './errors';
import { FtpFs } from './fs/FtpFs';
import type { RemoteFs, RemoteFsFactory } from './fs/RemoteFs';
import { SftpFs } from './fs/SftpFs';
import { SshTerminal, type TerminalPort } from './terminal/SshTerminal';
import { SessionPool, isBrokenConnection } from './pool';
import { TransferQueue } from './queue';

export const defaultFactory: RemoteFsFactory = (config: ConnectionConfig, log) =>
  config.protocol === 'sftp' ? new SftpFs(config, log) : new FtpFs(config, log);

type Params<M extends TransferMethod> = z.output<(typeof TRANSFER_REQUEST_SCHEMAS)[M]>;
/** `ports`: MessagePorts adjuntos al mensaje (solo los usa `terminal.open`). */
type Handlers = { [M in TransferMethod]: (params: Params<M>, ports: TerminalPort[]) => Promise<TransferResults[M]> };

export interface EngineOptions {
  send: (message: TransferToMainMessage) => void;
  factory?: RemoteFsFactory;
  retryDelayMs?: (attempt: number) => number;
}

/** Motor de transferencias: sesiones, cola y despacho de mensajes de main. */
export class TransferEngine {
  private readonly pools = new Map<string, SessionPool>();
  private readonly terminals = new Map<string, SshTerminal>();
  private terminalCounter = 0;
  readonly queue: TransferQueue;
  private readonly factory: RemoteFsFactory;
  private readonly handlers: Handlers;

  constructor(private readonly options: EngineOptions) {
    this.factory = options.factory ?? defaultFactory;
    this.queue = new TransferQueue({
      getPool: (id) => this.pools.get(id),
      onUpdate: (jobs, removedIds) => this.emit('queue.updated', { jobs, removedIds }),
      onConflict: (info) => this.emit('queue.conflict', info),
      ...(options.retryDelayMs ? { retryDelayMs: options.retryDelayMs } : {}),
    });

    const pool = (sessionId: string): SessionPool => {
      const p = this.pools.get(sessionId);
      if (!p) throw new TransferFailure('NOT_CONNECTED', 'La sesión no está abierta');
      return p;
    };

    /** Operación suelta en una conexión de transferencia, sin bloquear la navegación. */
    const withTransfer = async <T>(sessionId: string, fn: (fs: RemoteFs) => Promise<T>): Promise<T> => {
      const p = pool(sessionId);
      const fs = await p.acquire();
      let broken = false;
      try {
        return await fn(fs);
      } catch (err) {
        broken = isBrokenConnection(err) || toFailure(err).code === 'LOCAL_IO';
        throw err;
      } finally {
        p.release(fs, broken);
      }
    };
    const noProgress = () => ({ offset: 0, onProgress: () => undefined, signal: new AbortController().signal });

    this.handlers = {
      'session.open': async ({ sessionId, config, maxTransferConnections }) => {
        this.pools.get(sessionId)?.close();
        const p = new SessionPool({
          sessionId,
          config,
          maxTransferConnections,
          factory: this.factory,
          log: (id, level, message) => this.emit('log', { sessionId: id, level, message, at: Date.now() }),
          onBrowseLost: (id, error) => this.emit('session.lost', { sessionId: id, error: error.info }),
        });
        try {
          const homePath = await p.open();
          this.pools.set(sessionId, p);
          return { homePath };
        } catch (err) {
          p.close();
          throw err;
        }
      },
      'session.close': async ({ sessionId }) => {
        this.queue.interruptSession(sessionId);
        this.closeTerminals(sessionId);
        this.pools.get(sessionId)?.close();
        this.pools.delete(sessionId);
        return null;
      },
      'fs.list': ({ sessionId, path }) => pool(sessionId).withBrowse((fs) => fs.list(path), true),
      'fs.stat': async ({ sessionId, path }) => {
        const entry = await pool(sessionId).withBrowse((fs) => fs.stat(path), true);
        if (!entry) throw new TransferFailure('NOT_FOUND', `No existe: ${path}`);
        return entry;
      },
      'fs.mkdir': async ({ sessionId, path }) => {
        await pool(sessionId).withBrowse((fs) => fs.mkdir(path));
        return null;
      },
      'fs.rename': async ({ sessionId, from, to }) => {
        await pool(sessionId).withBrowse((fs) => fs.rename(from, to));
        return null;
      },
      'fs.delete': async ({ sessionId, path, isDirectory }) => {
        await pool(sessionId).withBrowse((fs) => (isDirectory ? fs.deleteDir(path) : fs.deleteFile(path)));
        return null;
      },
      'fs.chmod': async ({ sessionId, path, mode }) => {
        await pool(sessionId).withBrowse((fs) => fs.chmod(path, mode));
        return null;
      },
      'fs.realpath': ({ sessionId, path }) => pool(sessionId).withBrowse((fs) => fs.realpath(path), true),
      'file.fetch': ({ sessionId, path, localPath, maxBytes }) =>
        withTransfer(sessionId, async (fs) => {
          const entry = await fs.stat(path);
          if (!entry) throw new TransferFailure('NOT_FOUND', `No existe: ${path}`);
          if (entry.type === 'dir') throw new TransferFailure('PROTOCOL', `Es una carpeta: ${path}`);
          if (entry.size > maxBytes) throw new TransferFailure('TOO_LARGE', `${path} ocupa ${entry.size} bytes`, { size: entry.size, maxBytes });
          await fs.download(path, localPath, noProgress());
          return entry;
        }),
      'file.store': ({ sessionId, localPath, path, expected }) =>
        withTransfer(sessionId, async (fs) => {
          if (expected) {
            const current = await fs.stat(path);
            // Borrado en el servidor también cuenta como cambio.
            if (!current || current.size !== expected.size || current.modifiedAt !== expected.modifiedAt) {
              throw new TransferFailure('REMOTE_CHANGED', `${path} cambió en el servidor`, {
                size: current?.size ?? null,
                modifiedAt: current?.modifiedAt ?? null,
              });
            }
          }
          await fs.upload(localPath, path, noProgress());
          return fs.stat(path);
        }),
      'terminal.open': async ({ terminalId, sessionId, cols, rows }, ports) => {
        const port = ports[0];
        if (!port) throw new TransferFailure('PROTOCOL', 'terminal.open necesita un MessagePort');
        let config: ConnectionConfig;
        try {
          config = pool(sessionId).config;
          if (config.protocol !== 'sftp') throw new TransferFailure('PROTOCOL', 'La terminal solo está disponible en sitios SFTP');
        } catch (err) {
          port.close();
          throw err;
        }
        const n = ++this.terminalCounter;
        const log = (level: LogLevel, message: string) =>
          this.emit('log', { sessionId, level, message: `[term#${n}] ${message}`, at: Date.now() });
        const terminal = new SshTerminal(terminalId, sessionId, port, log, (t) => {
          if (this.terminals.get(t.id) === t) this.terminals.delete(t.id);
        });
        this.terminals.set(terminalId, terminal);
        try {
          await terminal.open(config, cols, rows);
        } catch (err) {
          terminal.close();
          throw err;
        }
        return null;
      },
      'queue.enqueue': async ({ jobs }) => {
        this.queue.enqueue(jobs);
        return null;
      },
      'queue.cancel': async ({ jobIds }) => {
        this.queue.cancel(jobIds);
        return null;
      },
      'queue.retry': async ({ jobIds }) => {
        this.queue.retry(jobIds);
        return null;
      },
      'queue.remove': async ({ jobIds }) => {
        this.queue.remove(jobIds);
        return null;
      },
      'queue.resolveConflict': async ({ jobId, decision, applyToAll }) => {
        this.queue.resolveConflict(jobId, decision, applyToAll);
        return null;
      },
    };
  }

  private emit<E extends TransferEventName>(name: E, payload: TransferEvents[E]): void {
    this.options.send({ kind: 'event', name, payload });
  }

  private closeTerminals(sessionId: string): void {
    for (const terminal of [...this.terminals.values()]) {
      if (terminal.sessionId === sessionId) terminal.close();
    }
  }

  /** Ejecuta una petición ya validada. Público para los tests. */
  async call<M extends TransferMethod>(method: M, params: unknown, ports: TerminalPort[] = []): Promise<TransferResults[M]> {
    const schema = TRANSFER_REQUEST_SCHEMAS[method];
    if (!schema) throw new TransferFailure('PROTOCOL', `Método desconocido: ${String(method)}`);
    const parsed = schema.safeParse(params);
    if (!parsed.success) throw new TransferFailure('PROTOCOL', `Parámetros no válidos para ${method}: ${parsed.error.message}`);
    const handler = this.handlers[method] as (p: unknown, ports: TerminalPort[]) => Promise<TransferResults[M]>;
    return handler(parsed.data, ports);
  }

  /** Punto de entrada de los mensajes de main. Nunca lanza. */
  async handle(message: unknown, ports: TerminalPort[] = []): Promise<void> {
    const msg = message as Partial<MainToTransferMessage>;
    if (msg?.kind !== 'request' || typeof msg.id !== 'number' || typeof msg.method !== 'string') {
      for (const port of ports) port.close();
      return;
    }
    try {
      const data = await this.call(msg.method as TransferMethod, msg.params, ports);
      this.options.send({ kind: 'response', id: msg.id, ok: true, data });
    } catch (err) {
      this.options.send({ kind: 'response', id: msg.id, ok: false, error: toFailure(err).info });
    }
  }

  dispose(): void {
    this.queue.dispose();
    for (const terminal of [...this.terminals.values()]) terminal.close();
    for (const p of this.pools.values()) p.close();
    this.pools.clear();
  }
}

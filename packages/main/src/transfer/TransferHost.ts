import { EventEmitter } from 'node:events';
import path from 'node:path';
import { utilityProcess, type UtilityProcess } from 'electron';
import type {
  TransferError,
  TransferEventName,
  TransferEvents,
  TransferMethod,
  TransferParams,
  TransferResults,
  TransferToMainMessage,
} from '@vela-ftp/shared';
import { logger } from 'vela-kit/logger';

/** Error de una petición al motor, con el código tipado del motor. */
export class TransferRequestError extends Error {
  constructor(readonly info: TransferError) {
    super(info.message);
    this.name = 'TransferRequestError';
  }
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: TransferRequestError) => void;
  method: TransferMethod;
}

const MAX_RESTARTS_PER_MINUTE = 5;

/**
 * Lanza y supervisa el utilityProcess de transferencias. Si muere, rechaza las
 * peticiones pendientes, avisa con `restarted` y lo vuelve a lanzar.
 */
export class TransferHost {
  private child: UtilityProcess | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly events = new EventEmitter();
  private readonly restarts: number[] = [];
  private stopping = false;

  constructor(private readonly entry: string = path.join(__dirname, '../../transfer/dist/index.js')) {
    this.events.setMaxListeners(50);
  }

  start(): void {
    this.stopping = false;
    const child = utilityProcess.fork(this.entry, [], { serviceName: 'Vela FTP — transferencias', stdio: 'pipe' });
    this.child = child;
    child.stdout?.on('data', (chunk: Buffer) => logger.debug(`[transfer] ${chunk.toString().trimEnd()}`));
    child.stderr?.on('data', (chunk: Buffer) => logger.warn(`[transfer] ${chunk.toString().trimEnd()}`));
    child.on('message', (message: TransferToMainMessage) => this.onMessage(message));
    child.on('exit', (code) => this.onExit(child, code));
    logger.info('[transfer] motor lanzado');
  }

  private onMessage(message: TransferToMainMessage): void {
    if (message?.kind === 'response') {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.ok) pending.resolve(message.data);
      else pending.reject(new TransferRequestError(message.error));
      return;
    }
    if (message?.kind === 'event') {
      this.events.emit(message.name, message.payload);
    }
  }

  private onExit(child: UtilityProcess, code: number): void {
    if (this.child !== child) return;
    this.child = null;
    for (const [id, pending] of this.pending) {
      pending.reject(new TransferRequestError({ code: 'INTERNAL', message: `El motor de transferencias se detuvo (${pending.method})` }));
      this.pending.delete(id);
    }
    if (this.stopping) return;

    logger.error(`[transfer] el motor terminó inesperadamente (código ${code})`);
    const now = Date.now();
    while (this.restarts.length > 0 && now - this.restarts[0]! > 60_000) this.restarts.shift();
    if (this.restarts.length >= MAX_RESTARTS_PER_MINUTE) {
      logger.error('[transfer] demasiados reinicios en un minuto; no se relanza');
      this.events.emit('host.failed');
      return;
    }
    this.restarts.push(now);
    this.start();
    this.events.emit('host.restarted');
  }

  request<M extends TransferMethod>(method: M, params: TransferParams<M>): Promise<TransferResults[M]> {
    const child = this.child;
    if (!child) {
      return Promise.reject(new TransferRequestError({ code: 'INTERNAL', message: 'El motor de transferencias no está en marcha' }));
    }
    const id = this.nextId++;
    return new Promise<TransferResults[M]>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, method });
      child.postMessage({ kind: 'request', id, method, params });
    });
  }

  on<E extends TransferEventName>(event: E, listener: (payload: TransferEvents[E]) => void): () => void;
  on(event: 'host.restarted' | 'host.failed', listener: () => void): () => void;
  on(event: string, listener: (payload: never) => void): () => void {
    const wrapped = (payload: unknown) => listener(payload as never);
    this.events.on(event, wrapped);
    return () => this.events.off(event, wrapped);
  }

  stop(): void {
    this.stopping = true;
    this.child?.kill();
    this.child = null;
  }
}

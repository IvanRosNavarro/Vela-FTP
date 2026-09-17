import { IPC_EVENTS, type JobSnapshot, type ProtocolLogLine } from '@vela-ftp/shared';
import { logger } from 'vela-kit/logger';
import { broadcast } from '../ipc/handle';
import type { TransferHost } from './TransferHost';

const LOG_FLUSH_MS = 100;
const MAX_LOG_BATCH = 500;

/**
 * Copia en main del estado de la cola (para ventanas nuevas y persistencia) y
 * reenvío de eventos del motor a las ventanas. Los logs se agrupan para no
 * mandar un IPC por línea.
 */
export class QueueMirror {
  private readonly jobs = new Map<string, JobSnapshot>();
  private logBuffer: ProtocolLogLine[] = [];
  private logTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<(jobs: JobSnapshot[], removedIds: string[]) => void>();

  constructor(transfer: TransferHost) {
    transfer.on('queue.updated', ({ jobs, removedIds }) => {
      for (const job of jobs) this.jobs.set(job.id, job);
      for (const id of removedIds) this.jobs.delete(id);
      for (const listener of this.listeners) listener(jobs, removedIds);
      broadcast(IPC_EVENTS.QUEUE_UPDATED, { jobs, removedIds });
    });
    transfer.on('queue.conflict', (info) => broadcast(IPC_EVENTS.QUEUE_CONFLICT, info));
    transfer.on('session.lost', (payload) => broadcast(IPC_EVENTS.SESSION_LOST, payload));
    transfer.on('log', (line) => this.pushLog(line));
    transfer.on('host.restarted', () => {
      // Lo que estuviera en marcha murió con el motor.
      const interrupted: JobSnapshot[] = [];
      for (const job of this.jobs.values()) {
        if (['queued', 'running', 'conflict'].includes(job.status)) {
          const next = { ...job, status: 'interrupted' as const, speed: 0 };
          this.jobs.set(job.id, next);
          interrupted.push(next);
        }
      }
      if (interrupted.length > 0) broadcast(IPC_EVENTS.QUEUE_UPDATED, { jobs: interrupted, removedIds: [] });
      broadcast(IPC_EVENTS.TRANSFER_RESTARTED, null);
    });
  }

  snapshot(): JobSnapshot[] {
    return [...this.jobs.values()];
  }

  get(id: string): JobSnapshot | undefined {
    return this.jobs.get(id);
  }

  onChange(listener: (jobs: JobSnapshot[], removedIds: string[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private pushLog(line: ProtocolLogLine): void {
    if (line.level === 'error') logger.warn(`[protocolo ${line.sessionId}] ${line.message}`);
    this.logBuffer.push(line);
    if (this.logBuffer.length >= MAX_LOG_BATCH) {
      this.flushLog();
      return;
    }
    this.logTimer ??= setTimeout(() => this.flushLog(), LOG_FLUSH_MS);
  }

  private flushLog(): void {
    if (this.logTimer) clearTimeout(this.logTimer);
    this.logTimer = null;
    if (this.logBuffer.length === 0) return;
    const batch = this.logBuffer;
    this.logBuffer = [];
    broadcast(IPC_EVENTS.PROTOCOL_LOG, batch);
  }
}

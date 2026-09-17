import { IPC_EVENTS, type JobSnapshot, type ProtocolLogLine } from '@vela-ftp/shared';
import { logger } from 'vela-kit/logger';
import { broadcast } from '../ipc/handle';
import type { TransferJobsRepository } from '../storage/repositories/TransferJobsRepository';
import type { TransferHost } from './TransferHost';

const LOG_FLUSH_MS = 100;
const MAX_LOG_BATCH = 500;
const PERSIST_DELAY_MS = 1000;

/** Estados que merece la pena recuperar tras reiniciar la app. */
const PERSISTED = new Set<JobSnapshot['status']>(['queued', 'running', 'conflict', 'failed', 'interrupted']);

export interface QueueMirrorDeps {
  transfer: TransferHost;
  repo: TransferJobsRepository;
  /** Sitio de una sesión abierta, para poder reconectar al recuperar. */
  siteIdForSession: (sessionId: string) => string | null;
}

/**
 * Copia en main del estado de la cola: la sirve a ventanas nuevas, la guarda
 * en SQLite para recuperarla al reabrir y reenvía los eventos del motor. Los
 * logs se agrupan para no mandar un IPC por línea.
 */
export class QueueMirror {
  private readonly jobs = new Map<string, JobSnapshot>();
  private logBuffer: ProtocolLogLine[] = [];
  private logTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly dirty = new Set<string>();
  private readonly deleted = new Set<string>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  /** Sitio de cada trabajo, fijado al verlo por primera vez (la sesión puede cerrarse después). */
  private readonly siteOfJob = new Map<string, string>();

  constructor(private readonly deps: QueueMirrorDeps) {
    const { transfer } = deps;
    for (const job of deps.repo.loadInterrupted()) {
      this.jobs.set(job.id, job);
    }

    transfer.on('queue.updated', ({ jobs, removedIds }) => {
      for (const job of jobs) {
        this.jobs.set(job.id, job);
        this.track(job);
      }
      for (const id of removedIds) {
        this.jobs.delete(id);
        this.markDeleted(id);
      }
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
          this.track(next);
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

  /** Quita trabajos que el motor no conoce (recuperados de otra ejecución). */
  removeRestored(ids: string[]): void {
    const removed = ids.filter((id) => this.jobs.get(id)?.sessionId.startsWith('restored:'));
    for (const id of removed) {
      this.jobs.delete(id);
      this.markDeleted(id);
    }
    if (removed.length > 0) broadcast(IPC_EVENTS.QUEUE_UPDATED, { jobs: [], removedIds: removed });
  }

  private track(job: JobSnapshot): void {
    if (!this.siteOfJob.has(job.id)) {
      const siteId = this.deps.siteIdForSession(job.sessionId);
      if (siteId) this.siteOfJob.set(job.id, siteId);
    }
    // Una carpeta interrumpida a medias se vuelve a expandir al reanudar; las ya
    // expandidas (done) no se guardan porque se recuperan sus ficheros.
    if (PERSISTED.has(job.status)) {
      this.dirty.add(job.id);
      this.deleted.delete(job.id);
    } else {
      this.markDeleted(job.id);
    }
    this.schedulePersist();
  }

  private markDeleted(id: string): void {
    this.dirty.delete(id);
    this.deleted.add(id);
    this.schedulePersist();
  }

  private schedulePersist(): void {
    this.persistTimer ??= setTimeout(() => this.persist(), PERSIST_DELAY_MS);
  }

  /** Escribe los cambios pendientes. Llamar también al cerrar la app. */
  persist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    try {
      const toSave = [...this.dirty]
        .map((id) => ({ job: this.jobs.get(id), siteId: this.siteOfJob.get(id) }))
        .filter((x): x is { job: JobSnapshot; siteId: string } => !!x.job && !!x.siteId);
      this.deps.repo.save(toSave);
      this.deps.repo.delete([...this.deleted]);
    } catch (err) {
      logger.error('[queue] no se pudo guardar la cola', err);
    }
    this.dirty.clear();
    this.deleted.clear();
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

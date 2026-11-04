import { IPC_EVENTS, type IpcEventName, type JobSnapshot, type MainEventPayloads, type ProtocolLogLine } from '@vela-ftp/shared';
import { logger } from 'vela-kit/logger';
import { RESTORED_PREFIX, type TransferJobsRepository } from '../storage/repositories/TransferJobsRepository';
import type { TransferHost } from './TransferHost';

const LOG_FLUSH_MS = 100;
const MAX_LOG_BATCH = 500;
const PERSIST_DELAY_MS = 1000;

/** Estados que merece la pena recuperar tras reiniciar la app. */
const PERSISTED = new Set<JobSnapshot['status']>(['queued', 'running', 'conflict', 'failed', 'interrupted']);
const ACTIVE = new Set<JobSnapshot['status']>(['queued', 'running', 'conflict']);

export interface QueueMirrorDeps {
  transfer: Pick<TransferHost, 'on'>;
  repo: Pick<TransferJobsRepository, 'loadInterrupted' | 'save' | 'delete'>;
  /** Sitio de una sesión abierta, para poder reconectar al recuperar. */
  siteIdForSession: (sessionId: string) => string | null;
  /** Ventana que abrió una sesión. */
  windowForSession: (sessionId: string) => number | null;
  sendTo: <E extends IpcEventName>(windowId: number, event: E, payload: MainEventPayloads[E]) => void;
  broadcast: <E extends IpcEventName>(event: E, payload: MainEventPayloads[E]) => void;
}

/**
 * Copia en main del estado de la cola: la sirve a cada ventana, la guarda en
 * SQLite para recuperarla al reabrir y reenvía los eventos del motor. Cada
 * ventana ve solo los trabajos, conflictos y registro de sus propias sesiones.
 * Los logs se agrupan para no mandar un IPC por línea.
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
  /** Ventana de cada trabajo, fijada igual que el sitio. */
  private readonly windowOfJob = new Map<string, number>();
  /** Última ventana conocida de cada sesión: los eventos llegan aún después de cerrarla. */
  private readonly windowOfSession = new Map<string, number>();
  /** Ventanas que muestran la cola, en orden de llegada. */
  private readonly queueWindows = new Set<number>();

  constructor(private readonly deps: QueueMirrorDeps) {
    const { transfer } = deps;
    for (const job of deps.repo.loadInterrupted()) {
      this.jobs.set(job.id, job);
    }

    transfer.on('queue.updated', ({ jobs, removedIds }) => {
      const byWindow = new Map<number, { jobs: JobSnapshot[]; removedIds: string[] }>();
      const bucket = (windowId: number) => {
        let b = byWindow.get(windowId);
        if (!b) byWindow.set(windowId, (b = { jobs: [], removedIds: [] }));
        return b;
      };
      for (const job of jobs) {
        this.jobs.set(job.id, job);
        this.track(job);
        const windowId = this.windowOfJob.get(job.id);
        if (windowId !== undefined) bucket(windowId).jobs.push(job);
      }
      for (const id of removedIds) {
        const windowId = this.windowOfJob.get(id);
        if (windowId !== undefined) bucket(windowId).removedIds.push(id);
        this.forgetJob(id);
      }
      for (const [windowId, payload] of byWindow) deps.sendTo(windowId, IPC_EVENTS.QUEUE_UPDATED, payload);
    });
    transfer.on('queue.conflict', (info) => {
      const windowId = this.windowOfJob.get(info.jobId);
      if (windowId !== undefined) deps.sendTo(windowId, IPC_EVENTS.QUEUE_CONFLICT, info);
    });
    transfer.on('session.lost', (payload) => {
      const windowId = this.windowFor(payload.sessionId);
      if (windowId !== null) deps.sendTo(windowId, IPC_EVENTS.SESSION_LOST, payload);
    });
    transfer.on('log', (line) => this.pushLog(line));
    transfer.on('host.restarted', () => {
      // Lo que estuviera en marcha murió con el motor.
      const byWindow = new Map<number, JobSnapshot[]>();
      for (const job of this.jobs.values()) {
        if (!ACTIVE.has(job.status)) continue;
        const next = { ...job, status: 'interrupted' as const, speed: 0 };
        this.jobs.set(job.id, next);
        this.track(next);
        const windowId = this.windowOfJob.get(job.id);
        if (windowId !== undefined) pushTo(byWindow, windowId, next);
      }
      for (const [windowId, interrupted] of byWindow) {
        deps.sendTo(windowId, IPC_EVENTS.QUEUE_UPDATED, { jobs: interrupted, removedIds: [] });
      }
      deps.broadcast(IPC_EVENTS.TRANSFER_RESTARTED, null);
    });
  }

  /**
   * Trabajos de una ventana. Los recuperados de otra ejecución aún no tienen
   * ventana: se los queda la primera que pida la cola.
   */
  snapshot(windowId: number): JobSnapshot[] {
    this.queueWindows.add(windowId);
    for (const job of this.jobs.values()) {
      if (isRestored(job) && !this.windowOfJob.has(job.id)) this.windowOfJob.set(job.id, windowId);
    }
    return [...this.jobs.values()].filter((job) => this.windowOfJob.get(job.id) === windowId);
  }

  /** Trabajos en marcha en todas las ventanas (instalar una actualización los corta todos). */
  activeCount(): number {
    let n = 0;
    for (const job of this.jobs.values()) if (ACTIVE.has(job.status)) n++;
    return n;
  }

  get(id: string): JobSnapshot | undefined {
    return this.jobs.get(id);
  }

  /** ¿El trabajo es de esta ventana? */
  belongsTo(id: string, windowId: number): boolean {
    return this.windowOfJob.get(id) === windowId;
  }

  /** Quita trabajos que el motor no conoce (recuperados de otra ejecución). */
  removeRestored(ids: string[]): void {
    const byWindow = new Map<number, string[]>();
    for (const id of ids) {
      const job = this.jobs.get(id);
      if (!job || !isRestored(job)) continue;
      const windowId = this.windowOfJob.get(id);
      if (windowId !== undefined) pushTo(byWindow, windowId, id);
      this.forgetJob(id);
    }
    for (const [windowId, removedIds] of byWindow) {
      this.deps.sendTo(windowId, IPC_EVENTS.QUEUE_UPDATED, { jobs: [], removedIds });
    }
  }

  /**
   * Una ventana se cierra. Sus trabajos recuperados pasan a otra ventana para
   * poder reanudarlos; los de sus sesiones se interrumpen al cerrarlas y se
   * recuperan en la próxima ejecución.
   */
  forgetWindow(windowId: number): void {
    this.queueWindows.delete(windowId);
    for (const [sessionId, id] of this.windowOfSession) if (id === windowId) this.windowOfSession.delete(sessionId);
    const heir = this.queueWindows.values().next().value;
    const inherited: JobSnapshot[] = [];
    for (const [jobId, id] of [...this.windowOfJob]) {
      if (id !== windowId) continue;
      const job = this.jobs.get(jobId);
      if (job && isRestored(job) && heir !== undefined) {
        this.windowOfJob.set(jobId, heir);
        inherited.push(job);
      } else {
        this.windowOfJob.delete(jobId);
      }
    }
    if (heir !== undefined && inherited.length > 0) {
      this.deps.sendTo(heir, IPC_EVENTS.QUEUE_UPDATED, { jobs: inherited, removedIds: [] });
    }
  }

  private windowFor(sessionId: string): number | null {
    const windowId = this.deps.windowForSession(sessionId);
    if (windowId !== null) {
      this.windowOfSession.set(sessionId, windowId);
      return windowId;
    }
    return this.windowOfSession.get(sessionId) ?? null;
  }

  private track(job: JobSnapshot): void {
    if (!this.siteOfJob.has(job.id)) {
      const siteId = this.deps.siteIdForSession(job.sessionId);
      if (siteId) this.siteOfJob.set(job.id, siteId);
    }
    if (!this.windowOfJob.has(job.id)) {
      const windowId = this.windowFor(job.sessionId);
      if (windowId !== null) this.windowOfJob.set(job.id, windowId);
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

  private forgetJob(id: string): void {
    this.jobs.delete(id);
    this.windowOfJob.delete(id);
    this.markDeleted(id);
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
    const byWindow = new Map<number, ProtocolLogLine[]>();
    for (const line of this.logBuffer) {
      const windowId = this.windowFor(line.sessionId);
      if (windowId === null) continue;
      pushTo(byWindow, windowId, line);
    }
    this.logBuffer = [];
    for (const [windowId, lines] of byWindow) this.deps.sendTo(windowId, IPC_EVENTS.PROTOCOL_LOG, lines);
  }
}

function isRestored(job: JobSnapshot): boolean {
  return job.sessionId.startsWith(RESTORED_PREFIX);
}

function pushTo<T>(map: Map<number, T[]>, key: number, item: T): void {
  const list = map.get(key);
  if (list) list.push(item);
  else map.set(key, [item]);
}

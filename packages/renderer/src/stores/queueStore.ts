import { create } from 'zustand';
import type { ConflictInfo, JobSnapshot, ProtocolLogLine } from '@vela-ftp/shared';

const MAX_LOG_LINES = 5000;

interface QueueState {
  /**
   * Se actualiza en el sitio: copiar un objeto de decenas de miles de trabajos
   * en cada aviso del motor (10 por segundo) bloqueaba la interfaz. Quien lo
   * pinte debe suscribirse también a `version`.
   */
  jobs: ReadonlyMap<string, JobSnapshot>;
  /** Sube con cada cambio de `jobs`. */
  version: number;
  /** Orden de llegada. */
  order: string[];
  log: ProtocolLogLine[];
  /** Conflictos a la espera de decisión, en orden de llegada. */
  conflicts: ConflictInfo[];
  applyUpdate(jobs: JobSnapshot[], removedIds: string[]): void;
  replaceAll(jobs: JobSnapshot[]): void;
  appendLog(lines: ProtocolLogLine[]): void;
  clearLog(): void;
  addConflict(info: ConflictInfo): void;
  dropConflict(jobId: string): void;
  clearConflicts(): void;
}

export const useQueueStore = create<QueueState>((set) => ({
  jobs: new Map(),
  version: 0,
  order: [],
  log: [],
  conflicts: [],
  addConflict: (info) => set((s) => ({ conflicts: [...s.conflicts.filter((c) => c.jobId !== info.jobId), info] })),
  dropConflict: (jobId) => set((s) => ({ conflicts: s.conflicts.filter((c) => c.jobId !== jobId) })),
  clearConflicts: () => set({ conflicts: [] }),
  applyUpdate(updates, removedIds) {
    set((s) => {
      const jobs = s.jobs as Map<string, JobSnapshot>;
      let order = s.order;
      const added: string[] = [];
      for (const job of updates) {
        if (!jobs.has(job.id)) added.push(job.id);
        jobs.set(job.id, job);
      }
      if (added.length > 0) order = order.concat(added);
      if (removedIds.length > 0) {
        const removed = new Set(removedIds);
        for (const id of removedIds) jobs.delete(id);
        order = order.filter((id) => !removed.has(id));
      }
      return { order, version: s.version + 1 };
    });
  },
  replaceAll(list) {
    set((s) => ({ jobs: new Map(list.map((j) => [j.id, j])), order: list.map((j) => j.id), version: s.version + 1 }));
  },
  appendLog(lines) {
    set((s) => {
      const log = s.log.concat(lines);
      return { log: log.length > MAX_LOG_LINES ? log.slice(log.length - MAX_LOG_LINES) : log };
    });
  },
  clearLog: () => set({ log: [] }),
}));

export const ACTIVE_STATUSES = new Set(['queued', 'running', 'conflict']);
export const FAILED_STATUSES = new Set(['failed', 'interrupted', 'cancelled']);

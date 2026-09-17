import { create } from 'zustand';
import type { ConflictInfo, JobSnapshot, ProtocolLogLine } from '@vela-ftp/shared';

const MAX_LOG_LINES = 5000;

interface QueueState {
  jobs: Record<string, JobSnapshot>;
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
}

export const useQueueStore = create<QueueState>((set) => ({
  jobs: {},
  order: [],
  log: [],
  conflicts: [],
  addConflict: (info) => set((s) => ({ conflicts: [...s.conflicts.filter((c) => c.jobId !== info.jobId), info] })),
  dropConflict: (jobId) => set((s) => ({ conflicts: s.conflicts.filter((c) => c.jobId !== jobId) })),
  applyUpdate(updates, removedIds) {
    set((s) => {
      const jobs = { ...s.jobs };
      let order = s.order;
      const added: string[] = [];
      for (const job of updates) {
        if (!jobs[job.id]) added.push(job.id);
        jobs[job.id] = job;
      }
      if (added.length > 0) order = [...order, ...added];
      if (removedIds.length > 0) {
        const removed = new Set(removedIds);
        for (const id of removedIds) delete jobs[id];
        order = order.filter((id) => !removed.has(id));
      }
      return { jobs, order };
    });
  },
  replaceAll(list) {
    set({ jobs: Object.fromEntries(list.map((j) => [j.id, j])), order: list.map((j) => j.id) });
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

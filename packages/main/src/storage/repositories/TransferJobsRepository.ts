import type { DatabaseSync } from 'node:sqlite';
import type { ConflictPolicy, JobSnapshot, TransferErrorCode } from '@vela-ftp/shared';
import { transaction } from 'vela-kit/storage';

export const RESTORED_PREFIX = 'restored:';

/** Sesión ficticia de un trabajo recuperado de una ejecución anterior. */
export function restoredSessionId(siteId: string): string {
  return `${RESTORED_PREFIX}${siteId}`;
}

export function siteIdOfRestored(sessionId: string): string | null {
  return sessionId.startsWith(RESTORED_PREFIX) ? sessionId.slice(RESTORED_PREFIX.length) : null;
}

interface Row {
  id: string;
  site_id: string;
  direction: JobSnapshot['direction'];
  local_path: string;
  remote_path: string;
  is_directory: number;
  conflict_policy: ConflictPolicy;
  size: number | null;
  transferred: number;
  error_code: TransferErrorCode | null;
  error_message: string | null;
  created_at: number;
  updated_at: number;
}

export class TransferJobsRepository {
  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => number = Date.now,
  ) {}

  save(jobs: Array<{ job: JobSnapshot; siteId: string }>): void {
    if (jobs.length === 0) return;
    const stmt = this.db.prepare(
      `INSERT INTO transfer_jobs (id, site_id, direction, local_path, remote_path, is_directory, conflict_policy, status,
         size, transferred, error_code, error_message, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET local_path = excluded.local_path, remote_path = excluded.remote_path,
         status = excluded.status, size = excluded.size, transferred = excluded.transferred,
         error_code = excluded.error_code, error_message = excluded.error_message, updated_at = excluded.updated_at`,
    );
    const now = this.now();
    transaction(this.db, () => {
      for (const { job, siteId } of jobs) {
        stmt.run(
          job.id,
          siteId,
          job.direction,
          job.localPath,
          job.remotePath,
          job.isDirectory ? 1 : 0,
          job.conflictPolicy,
          job.status,
          job.size,
          job.transferred,
          job.error?.code ?? null,
          job.error?.message ?? null,
          job.startedAt ?? now,
          now,
        );
      }
    });
  }

  delete(ids: string[]): void {
    if (ids.length === 0) return;
    const stmt = this.db.prepare('DELETE FROM transfer_jobs WHERE id = ?');
    transaction(this.db, () => {
      for (const id of ids) stmt.run(id);
    });
  }

  /** Todo lo guardado vuelve como interrumpido: la ejecución que lo llevaba ya no existe. */
  loadInterrupted(): JobSnapshot[] {
    const rows = this.db.prepare('SELECT * FROM transfer_jobs ORDER BY created_at, id').all() as unknown as Row[];
    return rows.map((r) => ({
      id: r.id,
      sessionId: restoredSessionId(r.site_id),
      direction: r.direction,
      localPath: r.local_path,
      remotePath: r.remote_path,
      isDirectory: r.is_directory === 1,
      conflictPolicy: r.conflict_policy,
      parentId: null,
      status: 'interrupted',
      size: r.size,
      transferred: r.transferred,
      speed: 0,
      attempts: 0,
      error: r.error_code ? { code: r.error_code, message: r.error_message ?? '' } : null,
      startedAt: r.created_at,
      finishedAt: r.updated_at,
    }));
  }
}

import { mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  RETRYABLE_ERRORS,
  type ConflictDecision,
  type ConflictInfo,
  type ConflictPolicy,
  type JobSnapshot,
  type TransferJob,
} from '@vela-ftp/shared';
import { TransferFailure, localFailure, toFailure } from './errors';
import { basenameRemote, joinRemote, parentRemote, type RemoteFs } from './fs/RemoteFs';
import { isBrokenConnection, type SessionPool } from './pool';

export const MAX_ATTEMPTS = 3;
const FLUSH_INTERVAL_MS = 100;

interface FileInfo {
  size: number;
  modifiedAt: number | null;
}

interface JobState {
  snap: JobSnapshot;
  controller: AbortController | null;
  /** Decisión tomada por el usuario tras un conflicto. */
  decision: ConflictDecision | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  /** Para calcular la velocidad entre avisos. */
  lastSampleBytes: number;
  lastSampleAt: number;
}

export interface QueueDeps {
  getPool(sessionId: string): SessionPool | undefined;
  onUpdate(jobs: JobSnapshot[], removedIds: string[]): void;
  onConflict(info: ConflictInfo): void;
  retryDelayMs?: (attempt: number) => number;
  now?: () => number;
}

const FINISHED = new Set(['done', 'skipped', 'failed', 'cancelled', 'interrupted']);

/** `foto.jpg` → `foto (1).jpg`, `foto (2).jpg`… */
export function numberedName(name: string, n: number): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
}

async function localInfo(file: string): Promise<(FileInfo & { isDirectory: boolean }) | null> {
  try {
    const s = await stat(file);
    return { size: s.size, modifiedAt: s.mtimeMs, isDirectory: s.isDirectory() };
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') return null;
    throw localFailure(err, file);
  }
}

export class TransferQueue {
  private readonly jobs = new Map<string, JobState>();
  private readonly dirty = new Set<string>();
  private readonly removed = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  /** "Aplicar a todos" en el diálogo de conflicto. */
  private conflictOverride: ConflictDecision | null = null;
  private readonly now: () => number;

  constructor(private readonly deps: QueueDeps) {
    this.now = deps.now ?? Date.now;
  }

  snapshot(): JobSnapshot[] {
    return [...this.jobs.values()].map((s) => ({ ...s.snap }));
  }

  enqueue(jobs: TransferJob[]): void {
    for (const job of jobs) {
      if (this.jobs.has(job.id)) continue;
      this.jobs.set(job.id, {
        snap: {
          ...job,
          status: 'queued',
          size: null,
          transferred: 0,
          speed: 0,
          attempts: 0,
          error: null,
          startedAt: null,
          finishedAt: null,
        },
        controller: null,
        decision: null,
        retryTimer: null,
        lastSampleBytes: 0,
        lastSampleAt: 0,
      });
      this.touch(job.id);
    }
    this.pump();
  }

  cancel(ids: string[]): void {
    for (const id of ids) {
      const state = this.jobs.get(id);
      if (!state || FINISHED.has(state.snap.status)) continue;
      if (state.retryTimer) clearTimeout(state.retryTimer);
      state.retryTimer = null;
      if (state.snap.status === 'running' && state.controller) {
        // run() pasa el estado a cancelled cuando el adaptador aborta.
        state.controller.abort();
      } else {
        this.finish(state, 'cancelled');
      }
    }
    this.pump();
  }

  retry(ids: string[]): void {
    for (const id of ids) {
      const state = this.jobs.get(id);
      if (!state || !['failed', 'cancelled', 'interrupted', 'skipped'].includes(state.snap.status)) continue;
      state.snap.status = 'queued';
      state.snap.error = null;
      state.snap.attempts = 0;
      state.snap.finishedAt = null;
      state.decision = null;
      this.touch(id);
    }
    this.pump();
  }

  /** Quita trabajos terminados (o los cancela primero si siguen vivos). */
  remove(ids: string[]): void {
    this.cancel(ids.filter((id) => this.jobs.get(id)?.snap.status !== 'running'));
    for (const id of ids) {
      const state = this.jobs.get(id);
      if (!state || state.snap.status === 'running') continue;
      this.jobs.delete(id);
      this.dirty.delete(id);
      this.removed.add(id);
    }
    this.scheduleFlush();
  }

  resolveConflict(id: string, decision: ConflictDecision, applyToAll: boolean): void {
    const state = this.jobs.get(id);
    if (applyToAll) {
      this.conflictOverride = decision;
      for (const other of this.jobs.values()) {
        if (other.snap.status === 'conflict') this.requeueWithDecision(other, decision);
      }
    }
    if (state?.snap.status === 'conflict') this.requeueWithDecision(state, decision);
    this.pump();
  }

  private requeueWithDecision(state: JobState, decision: ConflictDecision): void {
    state.decision = decision;
    state.snap.status = 'queued';
    this.touch(state.snap.id);
  }

  /** La sesión se cerró: lo pendiente queda interrumpido y se puede reintentar. */
  interruptSession(sessionId: string): void {
    for (const state of this.jobs.values()) {
      if (state.snap.sessionId !== sessionId || FINISHED.has(state.snap.status)) continue;
      if (state.retryTimer) clearTimeout(state.retryTimer);
      state.controller?.abort();
      this.finish(state, 'interrupted');
    }
  }

  private runningFor(sessionId: string): number {
    let n = 0;
    for (const s of this.jobs.values()) if (s.snap.sessionId === sessionId && s.snap.status === 'running') n++;
    return n;
  }

  private pump(): void {
    for (const state of this.jobs.values()) {
      if (state.snap.status !== 'queued' || state.retryTimer) continue;
      const pool = this.deps.getPool(state.snap.sessionId);
      if (!pool) {
        this.fail(state, new TransferFailure('NOT_CONNECTED', 'La sesión no está abierta'));
        continue;
      }
      if (this.runningFor(state.snap.sessionId) >= pool.maxTransferConnections) continue;
      state.snap.status = 'running';
      state.snap.attempts++;
      state.snap.startedAt ??= this.now();
      state.controller = new AbortController();
      this.touch(state.snap.id);
      void this.run(state, pool);
    }
  }

  private async run(state: JobState, pool: SessionPool): Promise<void> {
    let fs: RemoteFs | null = null;
    let broken = false;
    try {
      fs = await pool.acquire();
      if (state.snap.isDirectory) {
        await this.expand(state, fs);
      } else if (state.snap.direction === 'download') {
        await this.download(state, fs);
      } else {
        await this.upload(state, fs);
      }
    } catch (err) {
      const failure = toFailure(err);
      broken = isBrokenConnection(failure);
      if (state.controller?.signal.aborted && state.snap.status === 'running') {
        this.finish(state, 'cancelled');
      } else if (state.snap.status === 'running') {
        this.fail(state, failure);
      }
    } finally {
      if (fs) pool.release(fs, broken);
      state.controller = null;
      this.pump();
    }
  }

  private fail(state: JobState, failure: TransferFailure): void {
    state.snap.error = failure.info;
    if (RETRYABLE_ERRORS.has(failure.code) && state.snap.attempts < MAX_ATTEMPTS) {
      state.snap.status = 'queued';
      const delay = this.deps.retryDelayMs?.(state.snap.attempts) ?? 1000 * 2 ** (state.snap.attempts - 1);
      state.retryTimer = setTimeout(() => {
        state.retryTimer = null;
        this.pump();
      }, delay);
      this.touch(state.snap.id);
      return;
    }
    this.finish(state, 'failed');
  }

  private finish(state: JobState, status: JobSnapshot['status']): void {
    state.snap.status = status;
    state.snap.speed = 0;
    state.snap.finishedAt = this.now();
    if (status === 'done' && state.snap.size !== null) state.snap.transferred = state.snap.size;
    this.touch(state.snap.id);
  }

  /** Decide qué hacer si el destino ya existe. null = preguntar al usuario. */
  private decide(state: JobState): ConflictDecision | null {
    if (state.decision) return state.decision;
    const policy: ConflictPolicy = state.snap.conflictPolicy;
    if (policy !== 'ask') return policy;
    return this.conflictOverride;
  }

  /**
   * Resuelve la política frente a un destino existente. Devuelve el offset
   * desde el que transferir, o null si el trabajo ya quedó resuelto (saltado o
   * a la espera del usuario).
   */
  private async applyPolicy(
    state: JobState,
    source: FileInfo,
    target: FileInfo | null,
    renameTarget: () => Promise<void>,
  ): Promise<number | null> {
    if (!target) return 0;
    const decision = this.decide(state);
    if (decision === null) {
      state.snap.status = 'conflict';
      this.touch(state.snap.id);
      this.deps.onConflict({
        jobId: state.snap.id,
        direction: state.snap.direction,
        localPath: state.snap.localPath,
        remotePath: state.snap.remotePath,
        source,
        target,
      });
      return null;
    }
    switch (decision) {
      case 'skip':
        this.finish(state, 'skipped');
        return null;
      case 'overwrite':
        return 0;
      case 'overwrite-if-newer':
        if (source.modifiedAt !== null && target.modifiedAt !== null && source.modifiedAt <= target.modifiedAt) {
          this.finish(state, 'skipped');
          return null;
        }
        return 0;
      case 'resume':
        if (target.size === source.size) {
          this.finish(state, 'done');
          return null;
        }
        return target.size < source.size ? target.size : 0;
      case 'rename':
        await renameTarget();
        this.touch(state.snap.id);
        return 0;
    }
  }

  private progressSink(state: JobState) {
    return (delta: number) => {
      state.snap.transferred += delta;
      this.touch(state.snap.id);
    };
  }

  private async download(state: JobState, fs: RemoteFs): Promise<void> {
    const { snap } = state;
    const remote = await fs.stat(snap.remotePath);
    if (!remote) throw new TransferFailure('NOT_FOUND', `No existe en el servidor: ${snap.remotePath}`);
    snap.size = remote.size;
    try {
      await mkdir(path.dirname(snap.localPath), { recursive: true });
    } catch (err) {
      throw localFailure(err, path.dirname(snap.localPath));
    }
    const local = await localInfo(snap.localPath);
    const offset = await this.applyPolicy(state, remote, local, async () => {
      const dir = path.dirname(snap.localPath);
      const name = path.basename(snap.localPath);
      for (let n = 1; ; n++) {
        const candidate = path.join(dir, numberedName(name, n));
        if (!(await localInfo(candidate))) {
          snap.localPath = candidate;
          return;
        }
      }
    });
    if (offset === null) return;
    snap.transferred = offset;
    await fs.download(snap.remotePath, snap.localPath, {
      offset,
      onProgress: this.progressSink(state),
      signal: state.controller!.signal,
    });
    this.finish(state, 'done');
  }

  private async upload(state: JobState, fs: RemoteFs): Promise<void> {
    const { snap } = state;
    const local = await localInfo(snap.localPath);
    if (!local) throw new TransferFailure('NOT_FOUND', `No existe el fichero local: ${snap.localPath}`, { local: true });
    snap.size = local.size;
    const remote = await fs.stat(snap.remotePath);
    const offset = await this.applyPolicy(state, local, remote, async () => {
      const dir = parentRemote(snap.remotePath);
      const name = basenameRemote(snap.remotePath);
      for (let n = 1; ; n++) {
        const candidate = joinRemote(dir, numberedName(name, n));
        if (!(await fs.stat(candidate))) {
          snap.remotePath = candidate;
          return;
        }
      }
    });
    if (offset === null) return;
    snap.transferred = offset;
    await fs.upload(snap.localPath, snap.remotePath, {
      offset,
      onProgress: this.progressSink(state),
      signal: state.controller!.signal,
    });
    this.finish(state, 'done');
  }

  /** Recorre la carpeta, crea las carpetas de destino y encola un trabajo por fichero. */
  private async expand(state: JobState, fs: RemoteFs): Promise<void> {
    const { snap } = state;
    const children: TransferJob[] = [];
    const signal = state.controller!.signal;
    const child = (localPath: string, remotePath: string): TransferJob => ({
      id: `${snap.id}/${children.length}`,
      sessionId: snap.sessionId,
      direction: snap.direction,
      localPath,
      remotePath,
      isDirectory: false,
      conflictPolicy: snap.conflictPolicy,
      parentId: snap.id,
    });

    if (snap.direction === 'download') {
      const walk = async (remoteDir: string, localDir: string): Promise<void> => {
        if (signal.aborted) throw new TransferFailure('CANCELLED', 'Cancelado');
        try {
          await mkdir(localDir, { recursive: true });
        } catch (err) {
          throw localFailure(err, localDir);
        }
        for (const entry of await fs.list(remoteDir)) {
          const localPath = path.join(localDir, entry.name);
          if (entry.type === 'dir') await walk(entry.path, localPath);
          else children.push(child(localPath, entry.path));
        }
      };
      await walk(snap.remotePath, snap.localPath);
    } else {
      const walk = async (localDir: string, remoteDir: string): Promise<void> => {
        if (signal.aborted) throw new TransferFailure('CANCELLED', 'Cancelado');
        const existing = await fs.stat(remoteDir);
        if (!existing) await fs.mkdir(remoteDir);
        let entries;
        try {
          entries = await readdir(localDir, { withFileTypes: true });
        } catch (err) {
          throw localFailure(err, localDir);
        }
        for (const entry of entries) {
          const localPath = path.join(localDir, entry.name);
          const remotePath = joinRemote(remoteDir, entry.name);
          if (entry.isDirectory()) await walk(localPath, remotePath);
          else if (entry.isFile()) children.push(child(localPath, remotePath));
        }
      };
      await walk(snap.localPath, snap.remotePath);
    }

    snap.size = children.length;
    this.finish(state, 'done');
    if (children.length > 0) this.enqueue(children);
  }

  private touch(id: string): void {
    this.dirty.add(id);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => this.flush(), FLUSH_INTERVAL_MS);
  }

  /** Envía los cambios acumulados. Público para los tests. */
  flush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    const now = this.now();
    const jobs: JobSnapshot[] = [];
    for (const id of this.dirty) {
      const state = this.jobs.get(id);
      if (!state) continue;
      if (state.snap.status === 'running') {
        const elapsed = now - state.lastSampleAt;
        if (state.lastSampleAt > 0 && elapsed > 0) {
          const instant = ((state.snap.transferred - state.lastSampleBytes) * 1000) / elapsed;
          state.snap.speed = state.snap.speed === 0 ? instant : state.snap.speed * 0.7 + instant * 0.3;
        }
        state.lastSampleAt = now;
        state.lastSampleBytes = state.snap.transferred;
      }
      jobs.push({ ...state.snap });
    }
    const removedIds = [...this.removed];
    this.dirty.clear();
    this.removed.clear();
    if (jobs.length > 0 || removedIds.length > 0) this.deps.onUpdate(jobs, removedIds);
  }

  dispose(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    for (const state of this.jobs.values()) {
      if (state.retryTimer) clearTimeout(state.retryTimer);
      state.controller?.abort();
    }
  }
}

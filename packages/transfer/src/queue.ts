import { mkdir, readdir, stat, utimes } from 'node:fs/promises';
import path from 'node:path';
import {
  RETRYABLE_ERRORS,
  type ConflictDecision,
  type ConflictInfo,
  type ConflictPolicy,
  type JobSnapshot,
  type RemoteEntry,
  type TransferJob,
} from '@vela-ftp/shared';
import { RemoteDirCache } from './dirCache';
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
  /**
   * Índices de los pendientes y los activos, al día en `touch`. Los terminados
   * siguen en `jobs`: recorrerlos todos en cada `pump` colgaba el motor con
   * decenas de miles de trabajos.
   */
  private readonly queuedBySession = new Map<string, Set<string>>();
  private readonly runningBySession = new Map<string, Set<string>>();
  private readonly dirty = new Set<string>();
  private readonly removed = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  /** "Aplicar a todos" en el diálogo de conflicto, para toda la cola. */
  private conflictOverride: ConflictDecision | null = null;
  /** "Aplicar a todos" limitado a unas sesiones (las de una ventana). */
  private readonly sessionOverrides = new Map<string, ConflictDecision>();
  private readonly now: () => number;
  private readonly dirCache: RemoteDirCache;

  constructor(private readonly deps: QueueDeps) {
    this.now = deps.now ?? Date.now;
    this.dirCache = new RemoteDirCache(() => this.now());
  }

  snapshot(): JobSnapshot[] {
    return [...this.jobs.values()].map((s) => ({ ...s.snap }));
  }

  enqueue(jobs: TransferJob[]): void {
    // Lo que pide el usuario mira el servidor de nuevo; los hijos de una carpeta, no.
    for (const sessionId of new Set(jobs.filter((j) => j.parentId === null).map((j) => j.sessionId))) {
      this.dirCache.dropSession(sessionId);
    }
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
    const sessions = new Set<string>();
    for (const id of ids) {
      const state = this.jobs.get(id);
      if (!state || !['failed', 'cancelled', 'interrupted', 'skipped'].includes(state.snap.status)) continue;
      sessions.add(state.snap.sessionId);
      state.snap.status = 'queued';
      state.snap.error = null;
      state.snap.attempts = 0;
      state.snap.finishedAt = null;
      state.decision = null;
      this.touch(id);
    }
    for (const sessionId of sessions) this.dirCache.dropSession(sessionId);
    this.pump();
  }

  /** Quita trabajos terminados (o los cancela primero si siguen vivos). */
  remove(ids: string[]): void {
    this.cancel(ids.filter((id) => this.jobs.get(id)?.snap.status !== 'running'));
    for (const id of ids) {
      const state = this.jobs.get(id);
      if (!state || state.snap.status === 'running') continue;
      this.index(id, state.snap.sessionId, null);
      this.jobs.delete(id);
      this.dirty.delete(id);
      this.removed.add(id);
    }
    this.scheduleFlush();
  }

  resolveConflict(id: string, decision: ConflictDecision, applyToAll: boolean, sessionIds?: string[]): void {
    const state = this.jobs.get(id);
    if (applyToAll) {
      const scope = sessionIds ? new Set(sessionIds) : null;
      if (scope && state) scope.add(state.snap.sessionId);
      if (scope) for (const sessionId of scope) this.sessionOverrides.set(sessionId, decision);
      else this.conflictOverride = decision;
      for (const other of this.jobs.values()) {
        if (other.snap.status !== 'conflict') continue;
        if (!scope || scope.has(other.snap.sessionId)) this.requeueWithDecision(other, decision);
      }
    }
    if (state?.snap.status === 'conflict') this.requeueWithDecision(state, decision);
    this.pump();
  }

  private requeueWithDecision(state: JobState, decision: ConflictDecision): void {
    state.decision = decision;
    // Saltar no necesita volver a mirar el destino: se resuelve aquí mismo, sin
    // que cada trabajo vuelva a pasar por la cola y por una conexión.
    if (decision === 'skip') {
      this.finish(state, 'skipped');
      return;
    }
    state.snap.status = 'queued';
    this.touch(state.snap.id);
  }

  /** La sesión se cerró: lo pendiente queda interrumpido y se puede reintentar. */
  interruptSession(sessionId: string): void {
    this.sessionOverrides.delete(sessionId);
    this.dirCache.dropSession(sessionId);
    for (const state of this.jobs.values()) {
      if (state.snap.sessionId !== sessionId || FINISHED.has(state.snap.status)) continue;
      if (state.retryTimer) clearTimeout(state.retryTimer);
      state.controller?.abort();
      this.finish(state, 'interrupted');
    }
  }

  private pump(): void {
    // Por sesión y solo hasta llenar sus conexiones: con decenas de miles de
    // trabajos, recorrer la cola entera en cada vuelta colgaba el motor.
    for (const [sessionId, queued] of [...this.queuedBySession]) {
      const pool = this.deps.getPool(sessionId);
      if (!pool) {
        for (const id of [...queued]) {
          const state = this.jobs.get(id);
          if (state && !state.retryTimer) this.fail(state, new TransferFailure('NOT_CONNECTED', 'La sesión no está abierta'));
        }
        continue;
      }
      let free = pool.maxTransferConnections - (this.runningBySession.get(sessionId)?.size ?? 0);
      if (free <= 0) continue;
      const start: JobState[] = [];
      for (const id of queued) {
        const state = this.jobs.get(id);
        if (!state || state.retryTimer) continue;
        start.push(state);
        if (--free === 0) break;
      }
      for (const state of start) {
        state.snap.status = 'running';
        state.snap.attempts++;
        state.snap.startedAt ??= this.now();
        state.controller = new AbortController();
        this.touch(state.snap.id);
        void this.run(state, pool);
      }
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
    return this.sessionOverrides.get(state.snap.sessionId) ?? this.conflictOverride;
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
    const remote = await this.dirCache.stat(snap.sessionId, fs, snap.remotePath);
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
    // Conservar la fecha del origen: sin ella, comparar carpetas por fecha no sirve.
    if (remote.modifiedAt !== null) {
      const when = new Date(remote.modifiedAt);
      await utimes(snap.localPath, when, when).catch(() => undefined);
    }
    this.finish(state, 'done');
  }

  private async upload(state: JobState, fs: RemoteFs): Promise<void> {
    const { snap } = state;
    const local = await localInfo(snap.localPath);
    if (!local) throw new TransferFailure('NOT_FOUND', `No existe el fichero local: ${snap.localPath}`, { local: true });
    snap.size = local.size;
    const remote = await this.dirCache.stat(snap.sessionId, fs, snap.remotePath);
    const offset = await this.applyPolicy(state, local, remote, async () => {
      const dir = parentRemote(snap.remotePath);
      const name = basenameRemote(snap.remotePath);
      for (let n = 1; ; n++) {
        const candidate = joinRemote(dir, numberedName(name, n));
        if (!(await this.dirCache.stat(snap.sessionId, fs, candidate))) {
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
    // Best-effort: muchos servidores FTP no admiten MFMT. Solo una conexión caída es un fallo.
    if (local.modifiedAt !== null) {
      await fs.setModifiedTime(snap.remotePath, local.modifiedAt).catch((err: unknown) => {
        if (isBrokenConnection(err)) throw err;
      });
    }
    this.dirCache.put(snap.sessionId, remoteFile(snap.remotePath, local.size, local.modifiedAt));
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
        const entries = await fs.list(remoteDir);
        // Las descargas de estos ficheros consultan el listado sin volver a pedirlo.
        this.dirCache.seed(snap.sessionId, remoteDir, entries);
        for (const entry of entries) {
          const localPath = path.join(localDir, entry.name);
          if (entry.type === 'dir') await walk(entry.path, localPath);
          else children.push(child(localPath, entry.path));
        }
      };
      await walk(snap.remotePath, snap.localPath);
    } else {
      const walk = async (localDir: string, remoteDir: string): Promise<void> => {
        if (signal.aborted) throw new TransferFailure('CANCELLED', 'Cancelado');
        // Leer primero la carpeta local: si no existe, no se crea nada en el servidor.
        let entries;
        try {
          entries = await readdir(localDir, { withFileTypes: true });
        } catch (err) {
          throw localFailure(err, localDir);
        }
        const existing = await this.dirCache.stat(snap.sessionId, fs, remoteDir);
        if (!existing) {
          await fs.mkdir(remoteDir);
          this.dirCache.put(snap.sessionId, { ...remoteFile(remoteDir, 0, null), type: 'dir' });
          // Recién creada: está vacía, no hace falta listarla para cada fichero.
          this.dirCache.seed(snap.sessionId, remoteDir, []);
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
    const snap = this.jobs.get(id)?.snap;
    if (snap) this.index(id, snap.sessionId, snap.status);
    this.dirty.add(id);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => this.flush(), FLUSH_INTERVAL_MS);
  }

  /** Pone al día los índices de pendientes y activos; `null` lo saca de ambos. */
  private index(id: string, session: string, status: JobSnapshot['status'] | null): void {
    const update = (map: Map<string, Set<string>>, inIt: boolean) => {
      let set = map.get(session);
      if (inIt) {
        if (!set) map.set(session, (set = new Set()));
        set.add(id);
      } else if (set) {
        set.delete(id);
        if (set.size === 0) map.delete(session);
      }
    };
    update(this.queuedBySession, status === 'queued');
    update(this.runningBySession, status === 'running');
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

function remoteFile(remotePath: string, size: number, modifiedAt: number | null): RemoteEntry {
  return { name: basenameRemote(remotePath), path: remotePath, type: 'file', size, modifiedAt, mode: null, owner: null, group: null, target: null };
}

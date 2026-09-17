import { mkdir, mkdtemp, readFile, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ConflictInfo, JobSnapshot, TransferJob, TransferToMainMessage } from '@vela-ftp/shared';
import { TransferEngine } from './engine';
import { TransferFailure } from './errors';
import type { RemoteFs } from './fs/RemoteFs';
import { numberedName } from './queue';
import { removeDir, startFtpServer, type TestFtpServer } from './test/ftpServer';

const USER = 'vela';
const PASS = 's3cret';

let root: string;
let local: string;
let srv: TestFtpServer;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'vela-engine-srv-'));
  local = await mkdtemp(path.join(tmpdir(), 'vela-engine-local-'));
  srv = await startFtpServer(root, USER, PASS);
});

afterAll(async () => {
  await srv.close();
  await removeDir(root);
  await removeDir(local);
});

interface Harness {
  engine: TransferEngine;
  jobs: Map<string, JobSnapshot>;
  conflicts: ConflictInfo[];
  waitFor: (predicate: () => boolean, ms?: number) => Promise<void>;
}

let h: Harness;

beforeEach(async () => {
  const jobs = new Map<string, JobSnapshot>();
  const conflicts: ConflictInfo[] = [];
  const engine = new TransferEngine({
    retryDelayMs: () => 10,
    send: (msg: TransferToMainMessage) => {
      if (msg.kind !== 'event') return;
      if (msg.name === 'queue.updated') {
        const p = msg.payload as { jobs: JobSnapshot[]; removedIds: string[] };
        for (const j of p.jobs) jobs.set(j.id, j);
        for (const id of p.removedIds) jobs.delete(id);
      }
      if (msg.name === 'queue.conflict') conflicts.push(msg.payload as ConflictInfo);
    },
  });
  const waitFor = async (predicate: () => boolean, ms = 8000) => {
    const start = Date.now();
    // Volcar antes de mirar: si no, se leería el estado de antes de la acción.
    engine.queue.flush();
    while (!predicate()) {
      if (Date.now() - start > ms) throw new Error('timeout esperando la cola');
      await new Promise((r) => setTimeout(r, 20));
      engine.queue.flush();
    }
  };
  h = { engine, jobs, conflicts, waitFor };
  await engine.call('session.open', {
    sessionId: 's1',
    maxTransferConnections: 2,
    config: { protocol: 'ftp', host: '127.0.0.1', port: srv.port, username: USER, auth: 'password', password: PASS, trustedFingerprints: [] },
  });
});

afterEach(() => h.engine.dispose());

let counter = 0;
function job(partial: Partial<TransferJob> & Pick<TransferJob, 'direction' | 'localPath' | 'remotePath'>): TransferJob {
  return { id: `j${++counter}`, sessionId: 's1', isDirectory: false, conflictPolicy: 'overwrite', parentId: null, ...partial };
}

const finished = (id: string) => () => ['done', 'skipped', 'failed', 'cancelled'].includes(h.jobs.get(id)?.status ?? '');

describe('TransferEngine', () => {
  it('rechaza peticiones mal formadas y sesiones cerradas', async () => {
    await expect(h.engine.call('fs.list', { sessionId: 's1', path: 'relativa' })).rejects.toMatchObject({ code: 'PROTOCOL' });
    await expect(h.engine.call('fs.list', { sessionId: 'otra', path: '/' })).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
  });

  it('navega y opera por la conexión de navegación en serie', async () => {
    await Promise.all([h.engine.call('fs.mkdir', { sessionId: 's1', path: '/nav' }), h.engine.call('fs.list', { sessionId: 's1', path: '/' })]);
    const list = await h.engine.call('fs.list', { sessionId: 's1', path: '/' });
    expect(list.some((e) => e.name === 'nav')).toBe(true);
    await h.engine.call('fs.delete', { sessionId: 's1', path: '/nav', isDirectory: true });
  });

  it('sube y baja carpetas completas', async () => {
    const tree = path.join(local, 'tree');
    await mkdir(path.join(tree, 'a', 'b'), { recursive: true });
    await writeFile(path.join(tree, 'raiz.txt'), 'r');
    await writeFile(path.join(tree, 'a', 'b', 'hoja.txt'), 'hoja');

    const up = job({ direction: 'upload', localPath: tree, remotePath: '/tree', isDirectory: true });
    h.engine.queue.enqueue([up]);
    await h.waitFor(() => [...h.jobs.values()].filter((j) => j.parentId === up.id).length === 2 && [...h.jobs.values()].every((j) => j.status === 'done'));
    expect(await readFile(path.join(root, 'tree', 'a', 'b', 'hoja.txt'), 'utf8')).toBe('hoja');

    const down = job({ direction: 'download', localPath: path.join(local, 'tree-copia'), remotePath: '/tree', isDirectory: true });
    h.engine.queue.enqueue([down]);
    await h.waitFor(() => [...h.jobs.values()].filter((j) => j.parentId === down.id).length === 2 && [...h.jobs.values()].every((j) => j.status === 'done'));
    expect(await readFile(path.join(local, 'tree-copia', 'raiz.txt'), 'utf8')).toBe('r');
  });

  it('una carpeta local inexistente no deja rastro en el servidor', async () => {
    const ghost = job({ direction: 'upload', localPath: path.join(local, 'no-existe'), remotePath: '/fantasma', isDirectory: true });
    h.engine.queue.enqueue([ghost]);
    await h.waitFor(finished(ghost.id));
    expect(h.jobs.get(ghost.id)).toMatchObject({ status: 'failed', error: { code: 'NOT_FOUND' } });
    expect(await h.engine.call('fs.list', { sessionId: 's1', path: '/' }).then((l) => l.some((e) => e.name === 'fantasma'))).toBe(false);
  });

  it('aplica las políticas de conflicto', async () => {
    await writeFile(path.join(root, 'c.txt'), 'remoto nuevo');
    const target = path.join(local, 'c.txt');

    await writeFile(target, 'local');
    const skip = job({ direction: 'download', localPath: target, remotePath: '/c.txt', conflictPolicy: 'skip' });
    h.engine.queue.enqueue([skip]);
    await h.waitFor(finished(skip.id));
    expect(h.jobs.get(skip.id)?.status).toBe('skipped');
    expect(await readFile(target, 'utf8')).toBe('local');

    const rename = job({ direction: 'download', localPath: target, remotePath: '/c.txt', conflictPolicy: 'rename' });
    h.engine.queue.enqueue([rename]);
    await h.waitFor(finished(rename.id));
    expect(h.jobs.get(rename.id)?.localPath).toBe(path.join(local, numberedName('c.txt', 1)));

    // El local es más nuevo que el remoto: overwrite-if-newer no toca nada.
    const future = new Date(Date.now() + 3_600_000);
    await utimes(target, future, future);
    const newer = job({ direction: 'download', localPath: target, remotePath: '/c.txt', conflictPolicy: 'overwrite-if-newer' });
    h.engine.queue.enqueue([newer]);
    await h.waitFor(finished(newer.id));
    expect(h.jobs.get(newer.id)?.status).toBe('skipped');

    await writeFile(target, 'remo');
    const resume = job({ direction: 'download', localPath: target, remotePath: '/c.txt', conflictPolicy: 'resume' });
    h.engine.queue.enqueue([resume]);
    await h.waitFor(finished(resume.id));
    expect(await readFile(target, 'utf8')).toBe('remoto nuevo');
  });

  it('pregunta en los conflictos y aplica la respuesta a todos', async () => {
    await writeFile(path.join(root, 'ask1.txt'), 'uno');
    await writeFile(path.join(root, 'ask2.txt'), 'dos');
    await writeFile(path.join(local, 'ask1.txt'), 'x');
    await writeFile(path.join(local, 'ask2.txt'), 'y');
    const j1 = job({ direction: 'download', localPath: path.join(local, 'ask1.txt'), remotePath: '/ask1.txt', conflictPolicy: 'ask' });
    const j2 = job({ direction: 'download', localPath: path.join(local, 'ask2.txt'), remotePath: '/ask2.txt', conflictPolicy: 'ask' });
    h.engine.queue.enqueue([j1, j2]);
    await h.waitFor(() => h.jobs.get(j1.id)?.status === 'conflict' && h.jobs.get(j2.id)?.status === 'conflict');
    expect(h.conflicts.map((c) => c.jobId).sort()).toEqual([j1.id, j2.id].sort());

    await h.engine.call('queue.resolveConflict', { jobId: j1.id, decision: 'overwrite', applyToAll: true });
    await h.waitFor(() => finished(j1.id)() && finished(j2.id)());
    expect(await readFile(path.join(local, 'ask2.txt'), 'utf8')).toBe('dos');
  });

  it('falla sin reintentar si el origen no existe y permite reintentar a mano', async () => {
    const missing = job({ direction: 'download', localPath: path.join(local, 'm.txt'), remotePath: '/missing.txt' });
    h.engine.queue.enqueue([missing]);
    await h.waitFor(finished(missing.id));
    expect(h.jobs.get(missing.id)).toMatchObject({ status: 'failed', attempts: 1, error: { code: 'NOT_FOUND' } });

    await writeFile(path.join(root, 'missing.txt'), 'ya está');
    await h.engine.call('queue.retry', { jobIds: [missing.id] });
    await h.waitFor(finished(missing.id));
    expect(h.jobs.get(missing.id)?.status).toBe('done');
    expect((await stat(path.join(local, 'm.txt'))).size).toBe(Buffer.byteLength('ya está'));
  });

  it('cancela y quita trabajos', async () => {
    // Adaptador falso: la subida no acaba hasta que se aborta, así la prueba no
    // depende de la velocidad del disco.
    const events: JobSnapshot[] = [];
    const slow = new TransferEngine({
      send: (msg) => {
        if (msg.kind === 'event' && msg.name === 'queue.updated') events.push(...(msg.payload as { jobs: JobSnapshot[] }).jobs);
      },
      factory: (): RemoteFs => ({
        protocol: 'ftp',
        closed: false,
        connect: async () => undefined,
        home: async () => '/',
        list: async () => [],
        stat: async () => null,
        mkdir: async () => undefined,
        rename: async () => undefined,
        deleteFile: async () => undefined,
        deleteDir: async () => undefined,
        chmod: async () => undefined,
        realpath: async (p) => p,
        download: async () => undefined,
        upload: (_l, _r, opts) =>
          new Promise((_resolve, reject) => {
            opts.onProgress(1);
            opts.signal.addEventListener('abort', () => reject(new TransferFailure('CANCELLED', 'Cancelado')));
          }),
        onLost: () => undefined,
        close: () => undefined,
      }),
    });
    const last = (id: string) => [...events].reverse().find((e) => e.id === id);
    try {
      await slow.call('session.open', {
        sessionId: 's1',
        maxTransferConnections: 1,
        config: { protocol: 'ftp', host: 'x', port: 21, username: 'u', auth: 'anonymous', trustedFingerprints: [] },
      });
      await writeFile(path.join(local, 'lento.bin'), 'contenido');
      const big = job({ direction: 'upload', localPath: path.join(local, 'lento.bin'), remotePath: '/lento.bin' });
      const next = job({ direction: 'upload', localPath: path.join(local, 'lento.bin'), remotePath: '/lento2.bin' });
      slow.queue.enqueue([big, next]);
      const until = async (predicate: () => boolean) => {
        for (let i = 0; i < 200 && !predicate(); i++) {
          slow.queue.flush();
          await new Promise((r) => setTimeout(r, 10));
        }
        slow.queue.flush();
      };
      await until(() => (last(big.id)?.transferred ?? 0) > 0);
      expect(last(next.id)?.status).toBe('queued');

      await slow.call('queue.cancel', { jobIds: [big.id] });
      await until(() => last(big.id)?.status === 'cancelled' && last(next.id)?.status === 'running');
      expect(last(big.id)?.status).toBe('cancelled');
      expect(last(next.id)?.status).toBe('running');

      await slow.call('queue.remove', { jobIds: [big.id] });
      expect(slow.queue.snapshot().some((j) => j.id === big.id)).toBe(false);
    } finally {
      slow.dispose();
    }
  });

  it('cerrar la sesión deja lo pendiente como interrumpido', async () => {
    await writeFile(path.join(local, 'i.txt'), 'i');
    h.engine.queue.enqueue([job({ id: 'int', direction: 'upload', localPath: path.join(local, 'i.txt'), remotePath: '/i.txt', conflictPolicy: 'ask' })]);
    await writeFile(path.join(root, 'i.txt'), 'existe');
    await h.waitFor(() => h.jobs.get('int')?.status === 'conflict');
    await h.engine.call('session.close', { sessionId: 's1' });
    await h.waitFor(() => h.jobs.get('int')?.status === 'interrupted');
  });
});

describe('numberedName', () => {
  it('numera antes de la extensión', () => {
    expect(numberedName('foto.jpg', 2)).toBe('foto (2).jpg');
    expect(numberedName('README', 1)).toBe('README (1)');
    expect(numberedName('.env', 1)).toBe('.env (1)');
  });
});

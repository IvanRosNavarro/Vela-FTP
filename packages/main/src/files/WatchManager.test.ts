import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionInfo, TransferJob, WatchInfo } from '@vela-ftp/shared';
import { TransferRequestError } from '../transfer/TransferHost';
import { WatchManager } from './WatchManager';

const session: SessionInfo = {
  sessionId: 's1',
  siteId: 'site-1',
  siteName: 'Docker',
  protocol: 'sftp',
  host: 'localhost',
  startPath: '/',
  localStartPath: null,
};

let dir: string;
let manager: WatchManager;
let requests: Array<{ method: string; params: unknown }>;
let open: Map<string, SessionInfo>;
let lastList: WatchInfo[];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Espera a que chokidar vea los cambios y el gestor los procese. */
async function settle(predicate: () => boolean): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 8000) throw new Error('timeout');
    await sleep(50);
    await manager.idle();
  }
}

const enqueued = () => requests.filter((r) => r.method === 'queue.enqueue').flatMap((r) => (r.params as { jobs: TransferJob[] }).jobs);

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vela-watch-'));
  requests = [];
  open = new Map([['s1', session]]);
  lastList = [];
  manager = new WatchManager({
    transfer: {
      request: async (method, params) => {
        requests.push({ method, params });
        if (method === 'fs.mkdir' && (params as { path: string }).path.endsWith('/existente')) {
          throw new TransferRequestError({ code: 'ALREADY_EXISTS', message: 'existe' });
        }
        return null as never;
      },
    },
    sessions: { get: (id) => open.get(id), findBySite: (siteId) => [...open.values()].find((s) => s.siteId === siteId) },
    onChange: (list) => (lastList = list),
    debounceMs: 50,
    stabilityMs: 100,
  });
});

afterEach(async () => {
  await manager.stopAll();
  await rm(dir, { recursive: true, force: true });
});

describe('WatchManager', () => {
  it('sube lo que se crea o cambia, crea carpetas antes que sus ficheros e ignora temporales', async () => {
    const info = await manager.start('s1', dir, '/var/www');
    expect(lastList).toHaveLength(1);

    await writeFile(path.join(dir, 'index.html'), '<h1>hola</h1>');
    await writeFile(path.join(dir, 'index.html.swp'), 'temporal');
    await mkdir(path.join(dir, 'css'));
    await writeFile(path.join(dir, 'css', 'app.css'), 'body{}');
    await settle(() => enqueued().length >= 2);

    const remotePaths = enqueued().map((j) => j.remotePath).sort();
    expect(remotePaths).toEqual(['/var/www/css/app.css', '/var/www/index.html']);
    expect(enqueued().every((j) => j.direction === 'upload' && j.conflictPolicy === 'overwrite' && j.sessionId === 's1')).toBe(true);
    const mkdirIndex = requests.findIndex((r) => r.method === 'fs.mkdir' && (r.params as { path: string }).path === '/var/www/css');
    const cssUpload = requests.findIndex((r) => r.method === 'queue.enqueue' && (r.params as { jobs: TransferJob[] }).jobs.some((j) => j.remotePath.endsWith('app.css')));
    expect(mkdirIndex).toBeGreaterThanOrEqual(0);
    expect(mkdirIndex).toBeLessThan(cssUpload);
    expect(lastList[0]).toMatchObject({ id: info.id, uploads: 2, error: null });
  });

  it('una carpeta que ya existe en el servidor no es un error', async () => {
    await manager.start('s1', dir, '/web');
    await mkdir(path.join(dir, 'existente'));
    await writeFile(path.join(dir, 'existente', 'a.txt'), 'a');
    await settle(() => enqueued().length >= 1);
    expect(lastList[0]?.error).toBeNull();
  });

  it('sin sesión avisa y usa la nueva sesión del mismo sitio al reconectar', async () => {
    await manager.start('s1', dir, '/web');
    open.clear();
    await writeFile(path.join(dir, 'uno.txt'), '1');
    await settle(() => lastList[0]?.error !== null && lastList[0]?.error !== undefined);
    expect(enqueued()).toHaveLength(0);

    open.set('s2', { ...session, sessionId: 's2' });
    await writeFile(path.join(dir, 'dos.txt'), '2');
    await settle(() => enqueued().length >= 2);
    expect(enqueued().every((j) => j.sessionId === 's2')).toBe(true);
    expect(lastList[0]?.error).toBeNull();
  });

  it('no duplica la misma vigilancia y deja de subir al pararla', async () => {
    const first = await manager.start('s1', dir, '/web');
    const again = await manager.start('s1', dir, '/web');
    expect(again.id).toBe(first.id);
    await manager.stop(first.id);
    expect(lastList).toHaveLength(0);
    await writeFile(path.join(dir, 'tarde.txt'), 'x');
    await sleep(600);
    expect(enqueued()).toHaveLength(0);
  });
});

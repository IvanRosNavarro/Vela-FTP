import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ExternalFileEvent, RemoteEntry, SessionInfo } from '@vela-ftp/shared';
import { TransferRequestError } from '../transfer/TransferHost';
import { ExternalFilesManager } from './ExternalFilesManager';

const session: SessionInfo = { sessionId: 's1', siteId: 'site', siteName: 'Mi servidor', protocol: 'sftp', host: 'h', startPath: '/', localStartPath: null };

let root: string;
let remote: { content: string; modifiedAt: number };
let stored: string[];
let opened: string[];
let events: ExternalFileEvent[];
let mode: 'upload' | 'ask';
let manager: ExternalFilesManager;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const entry = (): RemoteEntry => ({
  name: 'index.php',
  path: '/www/index.php',
  type: 'file',
  size: Buffer.byteLength(remote.content),
  modifiedAt: remote.modifiedAt,
  mode: 0o644,
  owner: null,
  group: null,
  target: null,
});

async function until(predicate: () => boolean): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 8000) throw new Error('timeout');
    await sleep(50);
    await manager.idle();
  }
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'vela-external-'));
  remote = { content: '<?php echo 1;', modifiedAt: 1000 };
  stored = [];
  opened = [];
  events = [];
  mode = 'upload';
  let dirs = 0;
  manager = new ExternalFilesManager({
    transfer: {
      request: async (method, params) => {
        if (method === 'file.fetch') {
          const { localPath } = params as { localPath: string };
          await writeFile(localPath, remote.content);
          return entry() as never;
        }
        if (method === 'file.store') {
          const { localPath, expected } = params as { localPath: string; expected: { size: number; modifiedAt: number | null } | null };
          if (expected && (expected.modifiedAt !== remote.modifiedAt || expected.size !== Buffer.byteLength(remote.content))) {
            throw new TransferRequestError({ code: 'REMOTE_CHANGED', message: 'cambió' });
          }
          remote = { content: await readFile(localPath, 'utf8'), modifiedAt: remote.modifiedAt + 1 };
          stored.push(remote.content);
          return entry() as never;
        }
        return null as never;
      },
    },
    sessions: { get: (id) => (id === 's1' ? session : undefined), findBySite: () => session, open: async () => session, close: async () => undefined },
    openPath: async (p) => {
      opened.push(p);
      return '';
    },
    createTempDir: async () => {
      const dir = path.join(root, String(++dirs));
      await (await import('node:fs/promises')).mkdir(dir, { recursive: true });
      return dir;
    },
    saveMode: () => mode,
    notify: (_owner, event) => events.push(event),
    stabilityMs: 100,
  });
});

afterEach(async () => {
  await manager.stopAll();
  await rm(root, { recursive: true, force: true });
});

describe('ExternalFilesManager', () => {
  it('abre con el programa del sistema y sube cada guardado', async () => {
    await manager.open(1, 's1', '/www/index.php', 'edit');
    expect(opened).toHaveLength(1);
    expect(path.basename(opened[0]!)).toBe('index.php');

    await writeFile(opened[0]!, '<?php echo 2;');
    await until(() => stored.length === 1);
    expect(stored[0]).toBe('<?php echo 2;');
    expect(events.at(-1)).toMatchObject({ kind: 'uploaded', name: 'index.php', siteName: 'Mi servidor' });
  });

  it('en modo preguntar no sube hasta que se confirma', async () => {
    mode = 'ask';
    await manager.open(1, 's1', '/www/index.php', 'edit');
    await writeFile(opened[0]!, '<?php echo 3;');
    await until(() => events.some((e) => e.kind === 'changed'));
    expect(stored).toHaveLength(0);

    const id = events.find((e) => e.kind === 'changed')!.id;
    await manager.upload(id, false);
    expect(stored).toEqual(['<?php echo 3;']);
  });

  it('avisa si el remoto cambió y solo lo pisa si se fuerza', async () => {
    await manager.open(1, 's1', '/www/index.php', 'edit');
    remote = { content: 'cambio ajeno', modifiedAt: 5000 };
    await writeFile(opened[0]!, 'lo mío');
    await until(() => events.some((e) => e.kind === 'conflict'));
    expect(remote.content).toBe('cambio ajeno');

    const id = events.find((e) => e.kind === 'conflict')!.id;
    await manager.upload(id, true);
    expect(remote.content).toBe('lo mío');
  });

  it('para ver no vigila: guardar no sube nada', async () => {
    await manager.open(1, 's1', '/www/index.php', 'view');
    await writeFile(opened[0]!, 'tocado');
    await sleep(600);
    expect(stored).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it('volver a abrir con cambios sin subir no los pisa con una copia nueva', async () => {
    mode = 'ask';
    await manager.open(1, 's1', '/www/index.php', 'edit');
    await writeFile(opened[0]!, 'sin subir');
    await until(() => events.some((e) => e.kind === 'changed'));

    await manager.open(1, 's1', '/www/index.php', 'edit');
    expect(opened).toHaveLength(2);
    expect(opened[1]).toBe(opened[0]);
    expect(await readFile(opened[1]!, 'utf8')).toBe('sin subir');
  });
});

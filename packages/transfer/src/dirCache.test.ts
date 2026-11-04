import { describe, expect, it, vi } from 'vitest';
import type { RemoteEntry } from '@vela-ftp/shared';
import { RemoteDirCache } from './dirCache';
import { TransferFailure } from './errors';
import type { RemoteFs } from './fs/RemoteFs';

const entry = (path: string, size = 1): RemoteEntry => ({
  name: path.slice(path.lastIndexOf('/') + 1),
  path,
  type: 'file',
  size,
  modifiedAt: null,
  mode: null,
  owner: null,
  group: null,
  target: null,
});

function fakeFs(protocol: RemoteFs['protocol'], listing: Record<string, RemoteEntry[]>) {
  const list = vi.fn(async (dir: string) => {
    if (!listing[dir]) throw new TransferFailure('NOT_FOUND', dir);
    return listing[dir];
  });
  const stat = vi.fn(async () => null);
  return { fs: { protocol, list, stat } as unknown as RemoteFs, list, stat };
}

describe('RemoteDirCache', () => {
  it('lista cada carpeta una sola vez, también con consultas a la vez', async () => {
    const cache = new RemoteDirCache();
    const { fs, list } = fakeFs('ftp', { '/d': [entry('/d/a.txt', 5)] });
    const results = await Promise.all(['/d/a.txt', '/d/b.txt', '/d/a.txt'].map((p) => cache.stat('s', fs, p)));
    expect(results.map((r) => r?.size ?? null)).toEqual([5, null, 5]);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('una carpeta que no existe cuenta como vacía', async () => {
    const cache = new RemoteDirCache();
    const { fs } = fakeFs('ftp', {});
    expect(await cache.stat('s', fs, '/nada/x.txt')).toBeNull();
  });

  it('usa lo sembrado y lo subido, y caduca', async () => {
    let now = 0;
    const cache = new RemoteDirCache(() => now, 1000);
    const { fs, list } = fakeFs('ftp', { '/d': [] });
    cache.seed('s', '/d', []);
    expect(await cache.stat('s', fs, '/d/n.txt')).toBeNull();
    cache.put('s', entry('/d/n.txt', 9));
    expect((await cache.stat('s', fs, '/d/n.txt'))?.size).toBe(9);
    expect(list).not.toHaveBeenCalled();

    now = 2000;
    expect(await cache.stat('s', fs, '/d/n.txt')).toBeNull();
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('cada sesión tiene lo suyo y se puede vaciar', async () => {
    const cache = new RemoteDirCache();
    const { fs, list } = fakeFs('ftp', { '/d': [] });
    cache.seed('s1', '/d', [entry('/d/a.txt')]);
    expect(await cache.stat('s2', fs, '/d/a.txt')).toBeNull();
    cache.dropSession('s1');
    expect(await cache.stat('s1', fs, '/d/a.txt')).toBeNull();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('en SFTP pregunta directamente al servidor', async () => {
    const cache = new RemoteDirCache();
    const { fs, list, stat } = fakeFs('sftp', { '/d': [] });
    await cache.stat('s', fs, '/d/a.txt');
    expect(stat).toHaveBeenCalledOnce();
    expect(list).not.toHaveBeenCalled();
  });
});

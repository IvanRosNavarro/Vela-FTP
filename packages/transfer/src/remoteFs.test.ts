import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConnectionConfig } from '@vela-ftp/shared';
import { TransferFailure } from './errors';
import { FtpFs } from './fs/FtpFs';
import type { RemoteFs } from './fs/RemoteFs';
import { SftpFs } from './fs/SftpFs';
import { removeDir, startFtpServer } from './test/ftpServer';
import { startSftpServer } from './test/sftpServer';

const USER = 'vela';
const PASS = 's3cret';
const noop = () => undefined;

function options(offset = 0, onProgress: (n: number) => void = noop) {
  return { offset, onProgress, signal: new AbortController().signal };
}

type Setup = { root: string; local: string; config: ConnectionConfig; make: (c: ConnectionConfig) => RemoteFs; close: () => Promise<void> };

const ftpSetup = (mlsd: boolean) => async (): Promise<Setup> => {
  const root = await mkdtemp(path.join(tmpdir(), 'vela-ftp-srv-'));
  const local = await mkdtemp(path.join(tmpdir(), 'vela-ftp-local-'));
  const srv = await startFtpServer(root, USER, PASS, { mlsd });
  return {
    root,
    local,
    config: { protocol: 'ftp', host: '127.0.0.1', port: srv.port, username: USER, auth: 'password', password: PASS, trustedFingerprints: [], timeoutMs: 5000 },
    make: (c) => new FtpFs(c, noop),
    close: async () => {
      await srv.close();
      await removeDir(root);
      await removeDir(local);
    },
  };
};

const variants: Array<[string, () => Promise<Setup>]> = [
  ['FTP (MLSD)', ftpSetup(true)],
  ['FTP (solo LIST)', ftpSetup(false)],
  [
    'SFTP',
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), 'vela-sftp-srv-'));
      const local = await mkdtemp(path.join(tmpdir(), 'vela-sftp-local-'));
      const srv = await startSftpServer(root, USER, PASS);
      return {
        root,
        local,
        config: {
          protocol: 'sftp',
          host: '127.0.0.1',
          port: srv.port,
          username: USER,
          auth: 'password',
          password: PASS,
          trustedFingerprints: [srv.fingerprint],
          timeoutMs: 5000,
        },
        make: (c) => new SftpFs(c, noop),
        close: async () => {
          await srv.close();
          await removeDir(root);
          await removeDir(local);
        },
      };
    },
  ],
];

describe.each(variants)('%s', (_name, setupFn) => {
  let s: Setup;
  let fs: RemoteFs;

  beforeAll(async () => {
    s = await setupFn();
    fs = s.make(s.config);
    await fs.connect();
  });

  afterAll(async () => {
    fs?.close();
    await s?.close();
  });

  it('lista, crea carpetas, sube, baja, renombra y borra', async () => {
    expect(await fs.home()).toBe('/');
    await fs.mkdir('/docs');
    const src = path.join(s.local, 'hola.txt');
    await writeFile(src, 'hola mundo');

    let progress = 0;
    await fs.upload(src, '/docs/hola.txt', options(0, (n) => (progress += n)));
    expect(progress).toBe(10);

    const entries = await fs.list('/docs');
    expect(entries.map((e) => [e.name, e.type, e.size, e.path])).toEqual([['hola.txt', 'file', 10, '/docs/hola.txt']]);
    expect((await fs.list('/')).find((e) => e.name === 'docs')?.type).toBe('dir');

    const dst = path.join(s.local, 'bajado.txt');
    await fs.download('/docs/hola.txt', dst, options());
    expect(await readFile(dst, 'utf8')).toBe('hola mundo');

    await fs.rename('/docs/hola.txt', '/docs/adios.txt');
    expect((await fs.stat('/docs/adios.txt'))?.size).toBe(10);
    expect(await fs.stat('/docs/hola.txt')).toBeNull();

    await fs.chmod('/docs/adios.txt', 0o600);
    await fs.deleteFile('/docs/adios.txt');
    expect(await fs.list('/docs')).toEqual([]);
  });

  it('reanuda subidas y descargas desde un offset', async () => {
    const full = path.join(s.local, 'full.bin');
    await writeFile(full, 'ABCDEFGHIJ');
    await writeFile(path.join(s.root, 'partial-up.bin'), 'ABCD');
    await fs.upload(full, '/partial-up.bin', options(4));
    expect(await readFile(path.join(s.root, 'partial-up.bin'), 'utf8')).toBe('ABCDEFGHIJ');

    await writeFile(path.join(s.root, 'remote.bin'), '0123456789');
    const partial = path.join(s.local, 'partial-down.bin');
    await writeFile(partial, '0123');
    await fs.download('/remote.bin', partial, options(4));
    expect(await readFile(partial, 'utf8')).toBe('0123456789');
  });

  it('borra carpetas con contenido', async () => {
    await fs.mkdir('/arbol');
    await fs.mkdir('/arbol/sub');
    await writeFile(path.join(s.root, 'arbol', 'sub', 'a.txt'), 'a');
    await fs.deleteDir('/arbol');
    expect(await fs.stat('/arbol')).toBeNull();
  });

  it('da errores tipados', async () => {
    await expect(fs.download('/no-existe.txt', path.join(s.local, 'x'), options())).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const bad = s.make({ ...s.config, password: 'mala' });
    const err = await bad.connect().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransferFailure);
    expect((err as TransferFailure).code).toBe('AUTH_FAILED');
    const refused = s.make({ ...s.config, port: 1 });
    await expect(refused.connect()).rejects.toMatchObject({ code: 'CONNECTION_FAILED' });
  });

  it('cancela una transferencia en curso', async () => {
    const big = path.join(s.local, 'big.bin');
    await writeFile(big, Buffer.alloc(8 * 1024 * 1024, 7));
    const conn = s.make(s.config);
    await conn.connect();
    const controller = new AbortController();
    const promise = conn.upload(big, '/big.bin', {
      offset: 0,
      onProgress: () => controller.abort(),
      signal: controller.signal,
    });
    await expect(promise).rejects.toMatchObject({ code: 'CANCELLED' });
    conn.close();
  });
});

describe('SFTP: clave de host', () => {
  it('distingue clave desconocida de clave cambiada', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'vela-hostkey-'));
    const srv = await startSftpServer(root, USER, PASS);
    const base: ConnectionConfig = {
      protocol: 'sftp',
      host: '127.0.0.1',
      port: srv.port,
      username: USER,
      auth: 'password',
      password: PASS,
      trustedFingerprints: [],
      timeoutMs: 5000,
    };
    try {
      const unknown = await new SftpFs(base, noop).connect().catch((e: TransferFailure) => e);
      expect(unknown).toMatchObject({ code: 'HOST_KEY_UNKNOWN' });
      expect((unknown as TransferFailure).info.details?.['fingerprint']).toBe(srv.fingerprint);

      const mismatch = await new SftpFs({ ...base, trustedFingerprints: ['SHA256:otraClave'] }, noop).connect().catch((e: TransferFailure) => e);
      expect(mismatch).toMatchObject({ code: 'HOST_KEY_MISMATCH' });
    } finally {
      await srv.close();
      await removeDir(root);
    }
  });
});

import { mkdir, mkdtemp, readFile, readdir, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { archiveFormatOf, archiveStem, type ArchiveProgress, type ConnectionConfig, type TransferToMainMessage } from '@vela-ftp/shared';
import { entryTarget, type ArchiveContext } from './archive/common';
import { extractLocal } from './archive/local';
import { hasToolCommand, serverCompressCommand, serverExtractCommand, serverFailure, shQuote } from './archive/serverCommands';
import { extractTar, parsePax } from './archive/tar';
import { createZip } from './archive/zip';
import { TransferEngine } from './engine';
import { removeDir, startFtpServer } from './test/ftpServer';
import { startSftpServer, type TestSftpServer } from './test/sftpServer';

const USER = 'vela';
const PASS = 's3cret';

function ctx(signal = new AbortController().signal): ArchiveContext & { phases: string[] } {
  const phases: string[] = [];
  return { signal, phases, progress: (phase) => void (phases.at(-1) !== phase && phases.push(phase)) };
}

// ── Un tar escrito a mano, para poder meter lo que un tar normal no deja ─────
function tarHeader(name: string, size: number, type: string, extra: { prefix?: string; ustar?: boolean; mtime?: number } = {}): Buffer {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, 'utf8');
  h.write('0000644\0', 100);
  h.write('0000000\0', 108);
  h.write('0000000\0', 116);
  h.write(size.toString(8).padStart(11, '0') + '\0', 124);
  h.write((extra.mtime ?? 1_600_000_000).toString(8).padStart(11, '0') + '\0', 136);
  h.write(type, 156);
  if (extra.ustar !== false) {
    h.write('ustar\0', 257, 'latin1');
    h.write('00', 263);
  }
  if (extra.prefix) h.write(extra.prefix, 345, 155, 'utf8');
  h.fill(0x20, 148, 156);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'latin1');
  return h;
}

function tarEntry(name: string, content: string | Buffer, type = '0', extra?: Parameters<typeof tarHeader>[3]): Buffer {
  const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const pad = Buffer.alloc((512 - (data.length % 512)) % 512);
  return Buffer.concat([tarHeader(name, data.length, type, extra), data, pad]);
}

function paxRecord(key: string, value: string): string {
  const body = ` ${key}=${value}\n`;
  // La longitud cuenta bytes, incluida la suya.
  const size = (len: number) => Buffer.byteLength(`${len}${body}`);
  let length = size(1);
  while (size(length) !== length) length = size(length);
  return `${length}${body}`;
}

const tarEnd = () => Buffer.alloc(1024);

let work: string;
beforeAll(async () => {
  work = await mkdtemp(path.join(tmpdir(), 'vela-archive-'));
});
afterAll(async () => removeDir(work));

let n = 0;
const fresh = async () => {
  const dir = path.join(work, `t${++n}`);
  await mkdir(dir, { recursive: true });
  return dir;
};

describe('formatos', () => {
  it('reconoce la extensión y quita la del archivo', () => {
    expect(archiveFormatOf('web.ZIP')).toBe('zip');
    expect(archiveFormatOf('web.tar.gz')).toBe('tar.gz');
    expect(archiveFormatOf('web.tgz')).toBe('tar.gz');
    expect(archiveFormatOf('dump.sql.gz')).toBe('gz');
    expect(archiveFormatOf('copia.tar')).toBe('tar');
    expect(archiveFormatOf('.zip')).toBeNull();
    expect(archiveFormatOf('notas.txt')).toBeNull();
    expect(archiveStem('web.tar.gz')).toBe('web');
    expect(archiveStem('dump.sql.gz')).toBe('dump.sql');
    expect(archiveStem('notas.txt')).toBe('notas.txt');
  });
});

describe('entryTarget', () => {
  const root = path.resolve('/raiz');
  it('no deja salir de la carpeta de destino', () => {
    expect(entryTarget(root, '../fuera.txt')).toBeNull();
    expect(entryTarget(root, 'a/../../fuera.txt')).toBeNull();
    expect(entryTarget(root, 'a\\..\\..\\fuera.txt')).toBeNull();
    expect(entryTarget(root, '')).toBeNull();
    expect(entryTarget(root, './')).toBeNull();
  });
  it('las rutas absolutas quedan dentro, como en tar', () => {
    expect(entryTarget(root, '/etc/passwd')).toBe(path.join(root, 'etc', 'passwd'));
  });
  it('en Windows retoca los nombres que no se pueden crear', () => {
    expect(entryTarget(root, 'a:b?.txt', true)).toBe(path.join(root, 'a_b_.txt'));
    expect(entryTarget(root, 'dir./con.txt', true)).toBe(path.join(root, 'dir', '_con.txt'));
    expect(entryTarget(root, 'C:/x.txt', true)).toBe(path.join(root, 'C_', 'x.txt'));
  });
});

describe('tar', () => {
  it('lee registros pax', () => {
    expect(parsePax(Buffer.from(paxRecord('path', 'ñandú/largo.txt') + paxRecord('mtime', '1600000000.5')))).toEqual({
      path: 'ñandú/largo.txt',
      mtime: '1600000000.5',
    });
  });

  it('extrae ficheros y carpetas, nombres largos GNU, pax y prefijo ustar; salta enlaces y rutas peligrosas', async () => {
    const root = await fresh();
    const longName = `${'d'.repeat(120)}/fichero.txt`;
    const pax = paxRecord('path', 'pax/ñ.txt');
    const archive = Buffer.concat([
      tarEntry('carpeta/', '', '5'),
      tarEntry('carpeta/hola.txt', 'hola', '0', { mtime: 1_500_000_000 }),
      tarEntry('././@LongLink', `${longName}\0`, 'L', { ustar: false }),
      tarEntry('cortado', 'largo', '0', { ustar: false }),
      tarEntry('PaxHeader', pax, 'x'),
      tarEntry('ignorado', 'pax', '0'),
      tarEntry('nombre.txt', 'prefijo', '0', { prefix: 'pre/fijo' }),
      tarEntry('../fuera.txt', 'mal', '0'),
      tarEntry('enlace', '', '2'),
      tarEnd(),
    ]);
    const stats = await extractTar(Readable.from([archive]), root, { conflict: 'overwrite', ctx: ctx() });
    expect(stats).toEqual({ files: 4, skipped: 2 });
    expect(await readFile(path.join(root, 'carpeta', 'hola.txt'), 'utf8')).toBe('hola');
    expect((await stat(path.join(root, 'carpeta', 'hola.txt'))).mtimeMs).toBe(1_500_000_000_000);
    expect(await readFile(path.join(root, ...longName.split('/')), 'utf8')).toBe('largo');
    expect(await readFile(path.join(root, 'pax', 'ñ.txt'), 'utf8')).toBe('pax');
    expect(await readFile(path.join(root, 'pre', 'fijo', 'nombre.txt'), 'utf8')).toBe('prefijo');
    await expect(stat(path.join(root, '..', 'fuera.txt'))).rejects.toThrow();
    expect(await readdir(root)).not.toContain('enlace');
  });

  it('con «omitir» no toca lo que ya existe', async () => {
    const root = await fresh();
    await writeFile(path.join(root, 'a.txt'), 'mío');
    const archive = Buffer.concat([tarEntry('a.txt', 'del tar'), tarEntry('b.txt', 'nuevo'), tarEnd()]);
    const stats = await extractTar(Readable.from([archive]), root, { conflict: 'skip', ctx: ctx() });
    expect(stats).toEqual({ files: 1, skipped: 1 });
    expect(await readFile(path.join(root, 'a.txt'), 'utf8')).toBe('mío');
    expect(await readFile(path.join(root, 'b.txt'), 'utf8')).toBe('nuevo');
  });

  it('da un error claro si no es un tar o está cortado', async () => {
    const root = await fresh();
    await expect(extractTar(Readable.from([Buffer.alloc(512, 7)]), root, { conflict: 'overwrite', ctx: ctx() })).rejects.toMatchObject({ code: 'PROTOCOL' });
    const cut = tarEntry('a.txt', 'x'.repeat(2000)).subarray(0, 1000);
    await expect(extractTar(Readable.from([cut]), root, { conflict: 'overwrite', ctx: ctx() })).rejects.toMatchObject({ code: 'PROTOCOL' });
    await expect(stat(path.join(root, 'a.txt'))).rejects.toThrow();
  });
});

describe('extractLocal y createZip', () => {
  it('comprime una carpeta y la vuelve a extraer igual, con fechas', async () => {
    const dir = await fresh();
    const src = path.join(dir, 'web');
    await mkdir(path.join(src, 'css', 'vacía'), { recursive: true });
    await writeFile(path.join(src, 'index.html'), '<h1>hola</h1>');
    await writeFile(path.join(src, 'css', 'app.css'), 'body{}'.repeat(5000));
    await writeFile(path.join(dir, 'suelto.txt'), 'suelto');
    await utimes(path.join(src, 'index.html'), 1_600_000_000, 1_600_000_000);

    const zipPath = path.join(dir, 'web.zip');
    const c = ctx();
    const made = await createZip(
      [
        { path: src, name: 'web' },
        { path: path.join(dir, 'suelto.txt'), name: 'suelto.txt' },
      ],
      zipPath,
      c,
    );
    expect(made).toEqual({ files: 3, skipped: 0 });
    expect(c.phases).toEqual(['compress']);
    await expect(createZip([{ path: src, name: 'web' }], zipPath, ctx())).rejects.toMatchObject({ code: 'ALREADY_EXISTS' });

    const out = path.join(dir, 'out');
    const stats = await extractLocal(zipPath, 'zip', out, { conflict: 'overwrite', ctx: ctx() });
    expect(stats).toEqual({ files: 3, skipped: 0 });
    expect(await readFile(path.join(out, 'web', 'index.html'), 'utf8')).toBe('<h1>hola</h1>');
    expect(await readFile(path.join(out, 'web', 'css', 'app.css'), 'utf8')).toBe('body{}'.repeat(5000));
    expect((await stat(path.join(out, 'web', 'css', 'vacía'))).isDirectory()).toBe(true);
    expect(await readFile(path.join(out, 'suelto.txt'), 'utf8')).toBe('suelto');
    // Los ZIP guardan la hora con 2 s de resolución si no hay marca extendida.
    expect(Math.abs((await stat(path.join(out, 'web', 'index.html'))).mtimeMs - 1_600_000_000_000)).toBeLessThanOrEqual(2000);

    await writeFile(path.join(out, 'suelto.txt'), 'cambiado');
    const again = await extractLocal(zipPath, 'zip', out, { conflict: 'skip', ctx: ctx() });
    expect(again).toEqual({ files: 0, skipped: 3 });
    expect(await readFile(path.join(out, 'suelto.txt'), 'utf8')).toBe('cambiado');
  });

  it('no mete el propio ZIP dentro de sí mismo', async () => {
    const dir = await fresh();
    await writeFile(path.join(dir, 'a.txt'), 'a');
    const made = await createZip([{ path: dir, name: 'todo' }], path.join(dir, 'todo.zip'), ctx());
    expect(made.files).toBe(1);
  });

  it('extrae .tar.gz, .tgz y .gz', async () => {
    const dir = await fresh();
    const tar = Buffer.concat([tarEntry('x/y.txt', 'comprimido'), tarEnd()]);
    await writeFile(path.join(dir, 'a.tar.gz'), gzipSync(tar));
    await writeFile(path.join(dir, 'dump.sql.gz'), gzipSync(Buffer.from('SELECT 1;')));
    await writeFile(path.join(dir, 'roto.gz'), Buffer.from('no es gzip'));

    expect(await extractLocal(path.join(dir, 'a.tar.gz'), 'tar.gz', path.join(dir, 'o1'), { conflict: 'overwrite', ctx: ctx() })).toEqual({ files: 1, skipped: 0 });
    expect(await readFile(path.join(dir, 'o1', 'x', 'y.txt'), 'utf8')).toBe('comprimido');
    expect(await extractLocal(path.join(dir, 'dump.sql.gz'), 'gz', path.join(dir, 'o2'), { conflict: 'overwrite', ctx: ctx() })).toEqual({ files: 1, skipped: 0 });
    expect(await readFile(path.join(dir, 'o2', 'dump.sql'), 'utf8')).toBe('SELECT 1;');
    await expect(extractLocal(path.join(dir, 'roto.gz'), 'gz', path.join(dir, 'o3'), { conflict: 'overwrite', ctx: ctx() })).rejects.toMatchObject({ code: 'PROTOCOL' });
    expect(await readdir(path.join(dir, 'o3'))).toEqual([]);
  });

  it('un ZIP que no lo es da error del archivo, no del disco', async () => {
    const dir = await fresh();
    await writeFile(path.join(dir, 'falso.zip'), 'texto');
    await expect(extractLocal(path.join(dir, 'falso.zip'), 'zip', path.join(dir, 'o'), { conflict: 'overwrite', ctx: ctx() })).rejects.toMatchObject({ code: 'PROTOCOL' });
  });

  it('se cancela', async () => {
    const dir = await fresh();
    await writeFile(path.join(dir, 'grande.bin'), Buffer.alloc(4 * 1024 * 1024, 1));
    const controller = new AbortController();
    const c: ArchiveContext = { signal: controller.signal, progress: () => controller.abort() };
    await expect(createZip([{ path: path.join(dir, 'grande.bin'), name: 'grande.bin' }], path.join(dir, 'g.zip'), c)).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(await readdir(dir)).toEqual(['grande.bin']);
  });
});

describe('órdenes del servidor', () => {
  it('entrecomilla las rutas y nunca mete comillas simples en el script', () => {
    expect(shQuote("it's")).toBe(`'it'\\''s'`);
    expect(hasToolCommand('unzip')).toBe(`sh -c 'command -v "$0" >/dev/null 2>&1' 'unzip'`);
    expect(serverExtractCommand('zip', "/w/o'k.zip", '/w/o', 'skip')).toBe(`sh -c 'mkdir -p "$1" && unzip -q -n "$0" -d "$1"' '/w/o'\\''k.zip' '/w/o'`);
    expect(serverExtractCommand('tar.gz', '/a.tgz', '/d', 'overwrite')).toBe(`sh -c 'mkdir -p "$1" && tar -xzo -f "$0" -C "$1"' '/a.tgz' '/d'`);
    expect(serverExtractCommand('tar', '/a.tar', '/d', 'skip')).toContain('tar -xko -f');
    expect(serverExtractCommand('gz', '/db/dump.sql.gz', '/db', 'skip')).toBe(
      `sh -c 'mkdir -p "$1" && { [ -e "$2" ] || gzip -dc "$0" > "$2"; }' '/db/dump.sql.gz' '/db' '/db/dump.sql'`,
    );
    expect(serverCompressCommand('/w', '/w/x.zip', ['-raro', 'b c'])).toBe(`sh -c 'cd "$0" && t="$1" && shift && zip -q -r "$t" "$@"' '/w' '/w/x.zip' './-raro' './b c'`);
  });

  it('distingue fallos de avisos', () => {
    expect(serverFailure('unzip', 'overwrite', { code: 1, stdout: '', stderr: 'warning' })).toBeNull();
    expect(serverFailure('unzip', 'overwrite', { code: 9, stdout: '', stderr: 'unzip: cannot find zipfile\n' })).toBe('unzip: cannot find zipfile');
    expect(
      serverFailure('tar', 'skip', { code: 2, stdout: '', stderr: 'tar: a.txt: Cannot open: File exists\ntar: Exiting with failure status due to previous errors\n' }),
    ).toBeNull();
    expect(serverFailure('tar', 'skip', { code: 2, stdout: '', stderr: 'tar: No space left on device\n' })).toBe('tar: No space left on device');
    expect(serverFailure('zip', 'overwrite', { code: 12, stdout: '', stderr: '' })).toBe('zip terminó con el código 12');
  });
});

// ── Motor contra los servidores de prueba ────────────────────────────────────

type Server = { root: string; config: ConnectionConfig; sftp: TestSftpServer | null; close: () => Promise<void> };

const servers: Array<[string, () => Promise<Server>]> = [
  [
    'FTP',
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), 'vela-archive-ftp-'));
      const srv = await startFtpServer(root, USER, PASS);
      return {
        root,
        sftp: null,
        config: { protocol: 'ftp', host: '127.0.0.1', port: srv.port, username: USER, auth: 'password', password: PASS, trustedFingerprints: [] },
        close: async () => {
          await srv.close();
          await removeDir(root);
        },
      };
    },
  ],
  [
    'SFTP',
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), 'vela-archive-sftp-'));
      const srv = await startSftpServer(root, USER, PASS);
      return {
        root,
        sftp: srv,
        config: { protocol: 'sftp', host: '127.0.0.1', port: srv.port, username: USER, auth: 'password', password: PASS, trustedFingerprints: [srv.fingerprint] },
        close: async () => {
          await srv.close();
          await removeDir(root);
        },
      };
    },
  ],
];

describe.each(servers)('motor: %s', (_name, setup) => {
  let server: Server;
  let engine: TransferEngine;
  let progress: ArchiveProgress[];
  let local: string;
  let op = 0;

  beforeAll(async () => {
    server = await setup();
  });
  afterAll(async () => server.close());

  beforeEach(async () => {
    progress = [];
    local = await fresh();
    engine = new TransferEngine({
      send: (msg: TransferToMainMessage) => {
        if (msg.kind === 'event' && msg.name === 'archive.progress') progress.push(msg.payload as ArchiveProgress);
      },
    });
    await engine.call('session.open', { sessionId: 's1', maxTransferConnections: 2, config: server.config });
  });
  afterEach(() => engine.dispose());

  const workDir = async () => {
    const dir = path.join(local, `work${++op}`);
    await mkdir(dir);
    return dir;
  };

  it('comprime en el servidor bajando y subiendo, y lo extrae igual', async () => {
    await mkdir(path.join(server.root, 'web', 'img'), { recursive: true });
    await writeFile(path.join(server.root, 'web', 'index.html'), 'inicio');
    await writeFile(path.join(server.root, 'web', 'img', 'logo.svg'), '<svg/>');
    await writeFile(path.join(server.root, 'leeme.txt'), 'léeme');

    const compressed = await engine.call('archive.compress', {
      opId: `c${op}`,
      sources: { kind: 'remote', sessionId: 's1', paths: ['/web', '/leeme.txt'] },
      target: { kind: 'remote', sessionId: 's1', path: '/web.zip' },
      workDir: await workDir(),
    });
    expect(compressed).toEqual({ files: 3, skipped: 0, onServer: false });
    expect(progress.map((p) => p.phase)).toEqual(expect.arrayContaining(['download', 'compress', 'upload']));

    await expect(
      engine.call('archive.compress', {
        opId: `c${op}b`,
        sources: { kind: 'remote', sessionId: 's1', paths: ['/leeme.txt'] },
        target: { kind: 'remote', sessionId: 's1', path: '/web.zip' },
        workDir: await workDir(),
      }),
    ).rejects.toMatchObject({ code: 'ALREADY_EXISTS' });

    const extracted = await engine.call('archive.extract', {
      opId: `e${op}`,
      source: { kind: 'remote', sessionId: 's1', path: '/web.zip' },
      targetDir: { kind: 'remote', sessionId: 's1', path: '/copia/dentro' },
      conflict: 'overwrite',
      workDir: await workDir(),
    });
    expect(extracted).toEqual({ files: 3, skipped: 0, onServer: false });
    expect(await readFile(path.join(server.root, 'copia', 'dentro', 'web', 'img', 'logo.svg'), 'utf8')).toBe('<svg/>');
    expect(await readFile(path.join(server.root, 'copia', 'dentro', 'leeme.txt'), 'utf8')).toBe('léeme');

    await writeFile(path.join(server.root, 'copia', 'dentro', 'leeme.txt'), 'tocado');
    const skipped = await engine.call('archive.extract', {
      opId: `e${op}b`,
      source: { kind: 'remote', sessionId: 's1', path: '/web.zip' },
      targetDir: { kind: 'remote', sessionId: 's1', path: '/copia/dentro' },
      conflict: 'skip',
      workDir: await workDir(),
    });
    expect(skipped).toEqual({ files: 0, skipped: 3, onServer: false });
    expect(await readFile(path.join(server.root, 'copia', 'dentro', 'leeme.txt'), 'utf8')).toBe('tocado');
    if (server.sftp) expect(server.sftp.execs.some((c) => c.includes('command -v'))).toBe(true);
  });

  it('entre lados: un ZIP del servidor se extrae en local y uno local se extrae en el servidor', async () => {
    await writeFile(path.join(local, 'a.txt'), 'A');
    const zipLocal = path.join(local, 'a.zip');
    await createZip([{ path: path.join(local, 'a.txt'), name: 'a.txt' }], zipLocal, ctx());

    expect(
      await engine.call('archive.extract', {
        opId: `x${op}`,
        source: { kind: 'local', path: zipLocal },
        targetDir: { kind: 'remote', sessionId: 's1', path: '/desde-local' },
        conflict: 'overwrite',
        workDir: await workDir(),
      }),
    ).toEqual({ files: 1, skipped: 0, onServer: false });
    expect(await readFile(path.join(server.root, 'desde-local', 'a.txt'), 'utf8')).toBe('A');

    await engine.call('archive.compress', {
      opId: `y${op}`,
      sources: { kind: 'remote', sessionId: 's1', paths: ['/desde-local/a.txt'] },
      target: { kind: 'local', path: path.join(local, 'bajado.zip') },
      workDir: await workDir(),
    });
    expect(
      await engine.call('archive.extract', {
        opId: `z${op}`,
        source: { kind: 'local', path: path.join(local, 'bajado.zip') },
        targetDir: { kind: 'local', path: path.join(local, 'fuera') },
        conflict: 'overwrite',
        workDir: await workDir(),
      }),
    ).toEqual({ files: 1, skipped: 0, onServer: false });
    expect(await readFile(path.join(local, 'fuera', 'a.txt'), 'utf8')).toBe('A');
  });
});

describe('motor: SFTP con herramientas en el servidor', () => {
  let srv: TestSftpServer;
  let root: string;
  let engine: TransferEngine;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'vela-archive-ssh-'));
    srv = await startSftpServer(root, USER, PASS);
    engine = new TransferEngine({ send: () => undefined });
    await engine.call('session.open', {
      sessionId: 's1',
      maxTransferConnections: 1,
      config: { protocol: 'sftp', host: '127.0.0.1', port: srv.port, username: USER, auth: 'password', password: PASS, trustedFingerprints: [srv.fingerprint] },
    });
  });
  afterAll(async () => {
    engine.dispose();
    await srv.close();
    await removeDir(root);
  });

  it('extrae y comprime con órdenes del servidor sin bajar nada', async () => {
    srv.fakeTools = ['unzip', 'zip'];
    srv.fakeExit = 0;
    const workDir = await fresh();
    const extracted = await engine.call('archive.extract', {
      opId: 'ssh1',
      source: { kind: 'remote', sessionId: 's1', path: '/no-hace-falta-que-exista.zip' },
      targetDir: { kind: 'remote', sessionId: 's1', path: '/dest' },
      conflict: 'skip',
      workDir,
    });
    expect(extracted).toEqual({ files: null, skipped: null, onServer: true });
    expect(srv.execs).toContain(serverExtractCommand('zip', '/no-hace-falta-que-exista.zip', '/dest', 'skip'));
    expect(await readdir(workDir)).toEqual([]);

    const compressed = await engine.call('archive.compress', {
      opId: 'ssh2',
      sources: { kind: 'remote', sessionId: 's1', paths: ['/a', '/b'] },
      target: { kind: 'remote', sessionId: 's1', path: '/ab.zip' },
      workDir,
    });
    expect(compressed.onServer).toBe(true);
    expect(srv.execs).toContain(serverCompressCommand('/', '/ab.zip', ['a', 'b']));
  });

  it('si la orden falla, da el error del servidor', async () => {
    srv.fakeTools = ['tar'];
    srv.fakeExit = 2;
    srv.fakeStderr = 'tar: Error is not recoverable: exiting now\n';
    await expect(
      engine.call('archive.extract', {
        opId: 'ssh3',
        source: { kind: 'remote', sessionId: 's1', path: '/x.tar.gz' },
        targetDir: { kind: 'remote', sessionId: 's1', path: '/' },
        conflict: 'overwrite',
        workDir: await fresh(),
      }),
    ).rejects.toMatchObject({ code: 'PROTOCOL', message: expect.stringContaining('exiting now') });
  });
});

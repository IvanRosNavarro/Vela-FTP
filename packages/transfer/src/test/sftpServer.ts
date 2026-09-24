// Servidor SFTP para tests sobre un directorio local, con el Server de ssh2.
// No usar fuera de los tests.
import { closeSync, fstatSync, mkdirSync, openSync, readSync, readdirSync, renameSync, rmdirSync, statSync, unlinkSync, writeSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { Server, utils, type Attributes } from 'ssh2';
import { hostKeyFingerprint } from '../fs/SftpFs';

const { STATUS_CODE, flagsToString } = utils.sftp;

export interface TestSftpServer {
  port: number;
  /** Permisos fijados por el cliente, por ruta local. */
  modes: Map<string, number>;
  /** Huella SHA256 de la clave de host del servidor. */
  fingerprint: string;
  /** Tamaños de pty pedidos (al abrir y en cada `window-change`). */
  ptySizes: Array<{ cols: number; rows: number; term?: string }>;
  close(): Promise<void>;
}

/** Permisos fijados por SETSTAT/FSETSTAT: en Windows el sistema de ficheros no los guarda. */
type Modes = Map<string, number>;

function attrsOf(file: string, modes: Modes): Attributes {
  const s = statSync(file);
  const permissions = modes.get(file) ?? s.mode & 0o7777;
  return {
    mode: (s.mode & ~0o7777) | permissions,
    uid: 0,
    gid: 0,
    size: s.size,
    atime: Math.floor(s.atimeMs / 1000),
    mtime: Math.floor(s.mtimeMs / 1000),
  };
}

function statusFor(err: unknown): number {
  const code = (err as { code?: string }).code;
  if (code === 'ENOENT') return STATUS_CODE.NO_SUCH_FILE;
  if (code === 'EACCES' || code === 'EPERM') return STATUS_CODE.PERMISSION_DENIED;
  return STATUS_CODE.FAILURE;
}

export async function startSftpServer(root: string, user: string, pass: string): Promise<TestSftpServer> {
  const keys = utils.generateKeyPairSync('ed25519');
  const parsed = utils.parseKey(keys.public);
  if (parsed instanceof Error) throw parsed;
  const { fingerprint } = hostKeyFingerprint((Array.isArray(parsed) ? parsed[0]! : parsed).getPublicSSH());

  const local = (remotePath: string) => path.join(root, ...path.posix.resolve('/', remotePath).split('/').filter(Boolean));
  const clients = new Set<{ end(): void }>();
  const modes: Modes = new Map();
  const ptySizes: TestSftpServer['ptySizes'] = [];

  const server = new Server({ hostKeys: [keys.private] }, (client) => {
    clients.add(client);
    client.on('close', () => clients.delete(client));
    client.on('error', () => undefined);
    client.on('authentication', (ctx) => {
      if (ctx.method === 'password' && ctx.username === user && ctx.password === pass) ctx.accept();
      else ctx.reject(['password']);
    });
    client.on('ready', () => {
      client.on('session', (acceptSession) => {
        const session = acceptSession();
        // Shell de juguete: saluda, devuelve lo que recibe y termina con `exit`.
        session.on('pty', (accept, _reject, info) => {
          // ssh2 da el TERM pedido aunque sus tipos no lo declaren.
          ptySizes.push({ cols: info.cols, rows: info.rows, term: (info as { term?: string }).term });
          accept?.();
        });
        session.on('window-change', (accept, _reject, info) => {
          ptySizes.push({ cols: info.cols, rows: info.rows });
          accept?.();
        });
        session.on('shell', (accept) => {
          const channel = accept();
          channel.write('bienvenido\r\n$ ');
          let line = '';
          channel.on('data', (chunk: Buffer) => {
            line += chunk.toString('utf8');
            let nl: number;
            while ((nl = line.search(/[\r\n]/)) >= 0) {
              const command = line.slice(0, nl);
              line = line.slice(nl + 1);
              if (command === 'exit') {
                channel.exit(3);
                channel.end();
                return;
              }
              if (command) channel.write(`eco:${command}\r\n$ `);
            }
          });
        });
        session.on('sftp', (acceptSftp) => {
          const sftp = acceptSftp();
          const handles = new Map<number, { fd?: number; path?: string; dir?: string; listed?: boolean }>();
          let nextHandle = 1;
          const newHandle = (value: { fd?: number; path?: string; dir?: string }) => {
            const id = nextHandle++;
            handles.set(id, value);
            const buf = Buffer.alloc(4);
            buf.writeUInt32BE(id);
            return buf;
          };
          const getHandle = (buf: Buffer) => handles.get(buf.readUInt32BE(0));
          const guard = (reqid: number, fn: () => void) => {
            try {
              fn();
            } catch (err) {
              sftp.status(reqid, statusFor(err));
            }
          };

          sftp.on('REALPATH', (reqid, p) => {
            const resolved = path.posix.resolve('/', p);
            sftp.name(reqid, [{ filename: resolved, longname: resolved, attrs: {} as Attributes }]);
          });
          sftp.on('STAT', (reqid, p) => guard(reqid, () => sftp.attrs(reqid, attrsOf(local(p), modes))));
          sftp.on('LSTAT', (reqid, p) => guard(reqid, () => sftp.attrs(reqid, attrsOf(local(p), modes))));
          sftp.on('READLINK', (reqid) => sftp.status(reqid, STATUS_CODE.OP_UNSUPPORTED));
          sftp.on('OPENDIR', (reqid, p) =>
            guard(reqid, () => {
              if (!statSync(local(p)).isDirectory()) throw Object.assign(new Error('no dir'), { code: 'ENOTDIR' });
              sftp.handle(reqid, newHandle({ dir: local(p) }));
            }),
          );
          sftp.on('READDIR', (reqid, h) => {
            const state = getHandle(h);
            if (!state?.dir) return sftp.status(reqid, STATUS_CODE.FAILURE);
            if (state.listed) return sftp.status(reqid, STATUS_CODE.EOF);
            state.listed = true;
            guard(reqid, () => {
              const names = readdirSync(state.dir!).map((name) => {
                const attrs = attrsOf(path.join(state.dir!, name), modes);
                return { filename: name, longname: `-rw-r--r-- 1 owner group ${attrs.size} Jan 1 00:00 ${name}`, attrs };
              });
              sftp.name(reqid, names);
            });
          });
          sftp.on('OPEN', (reqid, filename, flags) =>
            guard(reqid, () => {
              sftp.handle(reqid, newHandle({ fd: openSync(local(filename), flagsToString(flags) ?? 'r'), path: local(filename) }));
            }),
          );
          sftp.on('READ', (reqid, h, offset, length) =>
            guard(reqid, () => {
              const state = getHandle(h);
              if (state?.fd === undefined) return sftp.status(reqid, STATUS_CODE.FAILURE);
              const buf = Buffer.alloc(length);
              const read = readSync(state.fd, buf, 0, length, offset);
              if (read === 0) return sftp.status(reqid, STATUS_CODE.EOF);
              sftp.data(reqid, buf.subarray(0, read));
            }),
          );
          sftp.on('WRITE', (reqid, h, offset, data) =>
            guard(reqid, () => {
              const state = getHandle(h);
              if (state?.fd === undefined) return sftp.status(reqid, STATUS_CODE.FAILURE);
              writeSync(state.fd, data, 0, data.length, offset);
              sftp.status(reqid, STATUS_CODE.OK);
            }),
          );
          sftp.on('FSTAT', (reqid, h) =>
            guard(reqid, () => {
              const state = getHandle(h);
              if (state?.fd === undefined) return sftp.status(reqid, STATUS_CODE.FAILURE);
              const s = fstatSync(state.fd);
              sftp.attrs(reqid, { mode: s.mode, uid: 0, gid: 0, size: s.size, atime: 0, mtime: Math.floor(s.mtimeMs / 1000) });
            }),
          );
          sftp.on('FSETSTAT', (reqid, h, attrs) => {
            const state = getHandle(h);
            if (state?.path && attrs.mode !== undefined) modes.set(state.path, attrs.mode & 0o7777);
            sftp.status(reqid, STATUS_CODE.OK);
          });
          sftp.on('SETSTAT', (reqid, p, attrs) =>
            guard(reqid, () => {
              statSync(local(p));
              if (attrs.mode !== undefined) modes.set(local(p), attrs.mode & 0o7777);
              sftp.status(reqid, STATUS_CODE.OK);
            }),
          );
          sftp.on('CLOSE', (reqid, h) => {
            const id = h.readUInt32BE(0);
            const state = handles.get(id);
            if (state?.fd !== undefined) closeSync(state.fd);
            handles.delete(id);
            sftp.status(reqid, STATUS_CODE.OK);
          });
          sftp.on('MKDIR', (reqid, p) => guard(reqid, () => (mkdirSync(local(p)), sftp.status(reqid, STATUS_CODE.OK))));
          sftp.on('RMDIR', (reqid, p) => guard(reqid, () => (rmdirSync(local(p)), sftp.status(reqid, STATUS_CODE.OK))));
          sftp.on('REMOVE', (reqid, p) => guard(reqid, () => (unlinkSync(local(p)), modes.delete(local(p)), sftp.status(reqid, STATUS_CODE.OK))));
          sftp.on('RENAME', (reqid, from, to) =>
            guard(reqid, () => (renameSync(local(from), local(to)), sftp.status(reqid, STATUS_CODE.OK))),
          );
        });
      });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    modes,
    fingerprint,
    ptySizes,
    close: () =>
      new Promise<void>((resolve) => {
        for (const c of clients) c.end();
        server.close(() => resolve());
      }),
  };
}

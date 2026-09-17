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
  /** Huella SHA256 de la clave de host del servidor. */
  fingerprint: string;
  close(): Promise<void>;
}

function attrsOf(file: string): Attributes {
  const s = statSync(file);
  return {
    mode: s.mode,
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
        session.on('sftp', (acceptSftp) => {
          const sftp = acceptSftp();
          const handles = new Map<number, { fd?: number; dir?: string; listed?: boolean }>();
          let nextHandle = 1;
          const newHandle = (value: { fd?: number; dir?: string }) => {
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
          sftp.on('STAT', (reqid, p) => guard(reqid, () => sftp.attrs(reqid, attrsOf(local(p)))));
          sftp.on('LSTAT', (reqid, p) => guard(reqid, () => sftp.attrs(reqid, attrsOf(local(p)))));
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
                const attrs = attrsOf(path.join(state.dir!, name));
                return { filename: name, longname: `-rw-r--r-- 1 owner group ${attrs.size} Jan 1 00:00 ${name}`, attrs };
              });
              sftp.name(reqid, names);
            });
          });
          sftp.on('OPEN', (reqid, filename, flags) =>
            guard(reqid, () => {
              sftp.handle(reqid, newHandle({ fd: openSync(local(filename), flagsToString(flags) ?? 'r') }));
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
          sftp.on('FSETSTAT', (reqid) => sftp.status(reqid, STATUS_CODE.OK));
          sftp.on('SETSTAT', (reqid, p) => guard(reqid, () => (statSync(local(p)), sftp.status(reqid, STATUS_CODE.OK))));
          sftp.on('CLOSE', (reqid, h) => {
            const id = h.readUInt32BE(0);
            const state = handles.get(id);
            if (state?.fd !== undefined) closeSync(state.fd);
            handles.delete(id);
            sftp.status(reqid, STATUS_CODE.OK);
          });
          sftp.on('MKDIR', (reqid, p) => guard(reqid, () => (mkdirSync(local(p)), sftp.status(reqid, STATUS_CODE.OK))));
          sftp.on('RMDIR', (reqid, p) => guard(reqid, () => (rmdirSync(local(p)), sftp.status(reqid, STATUS_CODE.OK))));
          sftp.on('REMOVE', (reqid, p) => guard(reqid, () => (unlinkSync(local(p)), sftp.status(reqid, STATUS_CODE.OK))));
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
    fingerprint,
    close: () =>
      new Promise<void>((resolve) => {
        for (const c of clients) c.end();
        server.close(() => resolve());
      }),
  };
}

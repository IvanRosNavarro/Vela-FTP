// Servidor FTP mínimo para tests: lo justo que usa basic-ftp (EPSV/PASV, MLSD,
// RETR/STOR/APPE con REST, SIZE, MDTM, MFMT, MKD/RMD/DELE, RNFR/RNTO, SITE CHMOD).
// Sin TLS. No usar fuera de los tests.
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, rmdir, stat, unlink, utimes } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

export interface TestFtpServer {
  port: number;
  /** Modos fijados con SITE CHMOD, por ruta remota. */
  modes: Map<string, number>;
  close(): Promise<void>;
}

function mdtm(date: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}`;
}

function unixPermissions(mode: number): string {
  const bits = 'rwxrwxrwx';
  return [...bits].map((ch, i) => (mode & (1 << (8 - i)) ? ch : '-')).join('');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function lsDate(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${MONTHS[date.getUTCMonth()]} ${p(date.getUTCDate())} ${date.getUTCFullYear()}`;
}

export interface TestFtpServerOptions {
  /** Anunciar MLST y responder a MLSD (por defecto sí). Sin él, solo LIST. */
  mlsd?: boolean;
}

export async function startFtpServer(root: string, user: string, pass: string, options: TestFtpServerOptions = {}): Promise<TestFtpServer> {
  const mlsd = options.mlsd ?? true;
  const modes = new Map<string, number>();
  const sockets = new Set<net.Socket>();

  const server = net.createServer((control) => {
    sockets.add(control);
    control.on('close', () => sockets.delete(control));
    control.on('error', () => undefined);
    control.setEncoding('utf8');

    let authed = false;
    let pendingUser = '';
    let cwd = '/';
    let restOffset = 0;
    let renameFrom: string | null = null;
    let dataServer: net.Server | null = null;
    let dataSocket: Promise<net.Socket> | null = null;
    let buffer = '';

    const reply = (line: string): void => {
      control.write(`${line}\r\n`);
    };

    const remote = (p: string | undefined): string => {
      const joined = path.posix.resolve(cwd, p && p.length > 0 ? p : '.');
      return joined;
    };
    const local = (remotePath: string): string => path.join(root, ...remotePath.split('/').filter(Boolean));

    const openPassive = (): Promise<number> =>
      new Promise((resolve) => {
        dataServer?.close();
        let accept: (s: net.Socket) => void = () => undefined;
        dataSocket = new Promise((r) => (accept = r));
        dataServer = net.createServer((s) => {
          sockets.add(s);
          s.on('close', () => sockets.delete(s));
          s.on('error', () => undefined);
          accept(s);
        });
        dataServer.listen(0, '127.0.0.1', () => resolve((dataServer!.address() as net.AddressInfo).port));
      });

    const takeData = async (): Promise<net.Socket> => {
      if (!dataSocket) throw new Error('no PASV');
      const s = await dataSocket;
      dataSocket = null;
      dataServer?.close();
      dataServer = null;
      return s;
    };

    const handle = async (line: string): Promise<void> => {
      const space = line.indexOf(' ');
      const cmd = (space === -1 ? line : line.slice(0, space)).toUpperCase();
      const arg = space === -1 ? '' : line.slice(space + 1);

      if (cmd === 'USER') {
        pendingUser = arg;
        return reply('331 Password required');
      }
      if (cmd === 'PASS') {
        if (pendingUser === user && arg === pass) {
          authed = true;
          return reply('230 Logged in');
        }
        return reply('530 Login incorrect');
      }
      if (cmd === 'QUIT') {
        reply('221 Bye');
        control.end();
        return;
      }
      if (!authed && !['FEAT', 'SYST', 'OPTS', 'NOOP'].includes(cmd)) return reply('530 Not logged in');

      try {
        switch (cmd) {
          case 'SYST':
            return reply('215 UNIX Type: L8');
          case 'FEAT':
            // basic-ftp usa MLSD solo si el servidor anuncia MLST.
            control.write(`211-Features:\r\n${mlsd ? ' MLST type*;size*;modify*;UNIX.mode*;\r\n' : ''} SIZE\r\n MDTM\r\n MFMT\r\n REST STREAM\r\n EPSV\r\n UTF8\r\n211 End\r\n`);
            return;
          case 'OPTS':
          case 'TYPE':
          case 'STRU':
          case 'NOOP':
            return reply('200 OK');
          case 'PWD':
            return reply(`257 "${cwd}"`);
          case 'CWD': {
            const target = remote(arg);
            const s = await stat(local(target));
            if (!s.isDirectory()) return reply('550 Not a directory');
            cwd = target;
            return reply('250 OK');
          }
          case 'CDUP':
            cwd = path.posix.dirname(cwd);
            return reply('250 OK');
          case 'EPSV':
            return reply(`229 Entering Extended Passive Mode (|||${await openPassive()}|)`);
          case 'PASV': {
            const port = await openPassive();
            return reply(`227 Entering Passive Mode (127,0,0,1,${port >> 8},${port & 255})`);
          }
          case 'MLSD':
          case 'LIST': {
            if (cmd === 'MLSD' && !mlsd) return reply('502 Not implemented');
            // `LIST -a /ruta`: las opciones al estilo ls se ignoran.
            const dir = remote(arg.replace(/^(-\S+\s*)+/, ''));
            const entries = await readdir(local(dir), { withFileTypes: true });
            const lines: string[] = [];
            for (const e of entries) {
              const s = await stat(path.join(local(dir), e.name));
              const mode = modes.get(path.posix.join(dir, e.name)) ?? (e.isDirectory() ? 0o755 : 0o644);
              if (cmd === 'MLSD') {
                lines.push(
                  `type=${e.isDirectory() ? 'dir' : 'file'};size=${s.size};modify=${mdtm(s.mtime)};UNIX.mode=0${mode.toString(8)}; ${e.name}`,
                );
              } else {
                lines.push(`${e.isDirectory() ? 'd' : '-'}${unixPermissions(mode)} 1 owner group ${s.size} ${lsDate(s.mtime)} ${e.name}`);
              }
            }
            reply('150 Opening data connection');
            const data = await takeData();
            data.end(lines.map((l) => `${l}\r\n`).join(''));
            data.once('close', () => reply('226 Transfer complete'));
            return;
          }
          case 'SIZE':
            return reply(`213 ${(await stat(local(remote(arg)))).size}`);
          case 'MDTM':
            return reply(`213 ${mdtm((await stat(local(remote(arg)))).mtime)}`);
          case 'MFMT': {
            const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s+(.+)$/.exec(arg);
            if (!m) return reply('501 Syntax error');
            const when = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!));
            await utimes(local(remote(m[7]!)), when, when);
            return reply(`213 Modify=${m.slice(1, 7).join('')}; ${m[7]}`);
          }
          case 'REST':
            restOffset = Number(arg);
            return reply(`350 Restarting at ${restOffset}`);
          case 'RETR': {
            const file = local(remote(arg));
            await stat(file);
            reply('150 Opening data connection');
            const data = await takeData();
            const start = restOffset;
            restOffset = 0;
            const rs = createReadStream(file, { start });
            rs.pipe(data);
            data.once('close', () => reply('226 Transfer complete'));
            return;
          }
          case 'STOR':
          case 'APPE': {
            const file = local(remote(arg));
            reply('150 Ok to send data');
            const data = await takeData();
            const start = restOffset;
            restOffset = 0;
            const ws =
              cmd === 'APPE'
                ? createWriteStream(file, { flags: 'a' })
                : createWriteStream(file, start > 0 ? { flags: 'r+', start } : { flags: 'w' });
            data.pipe(ws);
            ws.once('finish', () => reply('226 Transfer complete'));
            return;
          }
          case 'DELE':
            await unlink(local(remote(arg)));
            return reply('250 Deleted');
          case 'RMD':
            await rmdir(local(remote(arg)));
            return reply('250 Removed');
          case 'MKD': {
            const target = remote(arg);
            await mkdir(local(target));
            return reply(`257 "${target}" created`);
          }
          case 'RNFR':
            await stat(local(remote(arg)));
            renameFrom = remote(arg);
            return reply('350 Ready for RNTO');
          case 'RNTO':
            if (!renameFrom) return reply('503 RNFR first');
            await rename(local(renameFrom), local(remote(arg)));
            renameFrom = null;
            return reply('250 Renamed');
          case 'SITE': {
            const m = /^CHMOD\s+([0-7]+)\s+(.+)$/i.exec(arg);
            if (!m) return reply('502 Not implemented');
            const target = remote(m[2]);
            await stat(local(target));
            modes.set(target, parseInt(m[1]!, 8));
            return reply('200 Mode changed');
          }
          default:
            return reply('502 Not implemented');
        }
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === 'ENOENT') return reply('550 No such file or directory');
        if (code === 'EEXIST') return reply('550 File exists');
        if (code === 'ENOTEMPTY') return reply('550 Directory not empty');
        return reply(`451 ${(err as Error).message}`);
      }
    };

    let chain = Promise.resolve();
    control.on('data', (chunk: string) => {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        chain = chain.then(() => handle(line));
      }
    });
    control.on('close', () => dataServer?.close());
    reply('220 Vela test FTP');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as net.AddressInfo).port,
    modes,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

/** Borra el directorio de pruebas sin fallar si ya no existe. */
export async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

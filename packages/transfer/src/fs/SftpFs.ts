import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Client, type ConnectConfig, type FileEntryWithStats, type SFTPWrapper, type Stats } from 'ssh2';
import type { ConnectionConfig, RemoteEntry } from '@vela-ftp/shared';
import { TransferFailure, localFailure, toFailure } from '../errors';
import { basenameRemote, joinRemote, type LogSink, type RemoteFs, type StreamOptions } from './RemoteFs';

const DEFAULT_TIMEOUT = 30_000;

// Códigos de estado SFTP (draft-ietf-secsh-filexfer-02).
const SSH_FX_NO_SUCH_FILE = 2;
const SSH_FX_PERMISSION_DENIED = 3;
const SSH_FX_FAILURE = 4;

const S_IFMT = 0o170000;
const S_IFDIR = 0o040000;
const S_IFREG = 0o100000;
const S_IFLNK = 0o120000;

/** Huella de clave de host al estilo OpenSSH (`SHA256:…`), con el tipo de clave. */
export function hostKeyFingerprint(key: Buffer): { fingerprint: string; keyType: string } {
  const digest = createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
  const typeLength = key.length >= 4 ? key.readUInt32BE(0) : 0;
  const keyType = typeLength > 0 && typeLength < key.length ? key.subarray(4, 4 + typeLength).toString('ascii') : 'desconocido';
  return { fingerprint: `SHA256:${digest}`, keyType };
}

function mapSftpError(err: unknown): TransferFailure {
  if (err instanceof TransferFailure) return err;
  const e = err as { code?: unknown; level?: string; message?: string };
  if (e && typeof e.code === 'number') {
    if (e.code === SSH_FX_NO_SUCH_FILE) return new TransferFailure('NOT_FOUND', e.message ?? 'No existe');
    if (e.code === SSH_FX_PERMISSION_DENIED) return new TransferFailure('PERMISSION_DENIED', e.message ?? 'Permiso denegado');
    if (e.code === SSH_FX_FAILURE) return new TransferFailure('PROTOCOL', e.message ?? 'Fallo del servidor SFTP');
  }
  if (e?.level === 'client-authentication') {
    return new TransferFailure('AUTH_FAILED', 'Autenticación rechazada por el servidor');
  }
  if (e?.level === 'client-timeout') return new TransferFailure('TIMEOUT', e.message ?? 'Tiempo de espera agotado');
  if (e?.message && /No SFTP|Not connected|closed/i.test(e.message)) {
    return new TransferFailure('NOT_CONNECTED', e.message);
  }
  return toFailure(err);
}

function typeFromMode(mode: number): RemoteEntry['type'] {
  switch (mode & S_IFMT) {
    case S_IFDIR:
      return 'dir';
    case S_IFREG:
      return 'file';
    case S_IFLNK:
      return 'symlink';
    default:
      return 'unknown';
  }
}

function entryFromStats(path: string, stats: Stats, owner: string | null = null, group: string | null = null): RemoteEntry {
  return {
    name: basenameRemote(path) || '/',
    path,
    type: typeFromMode(stats.mode),
    size: stats.size,
    modifiedAt: stats.mtime ? stats.mtime * 1000 : null,
    mode: stats.mode & 0o7777,
    owner,
    group,
    target: null,
  };
}

/** `drwxr-xr-x 2 owner group …`: usuario y grupo legibles si el servidor los da. */
function ownerGroup(longname: string): [string | null, string | null] {
  const parts = longname.trim().split(/\s+/);
  return parts.length >= 4 ? [parts[2] ?? null, parts[3] ?? null] : [null, null];
}

function promisify<T>(fn: (cb: (err: Error | null | undefined, value: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    fn((err, value) => (err ? reject(err) : resolve(value)));
  });
}

export class SftpFs implements RemoteFs {
  readonly protocol = 'sftp' as const;
  private conn: Client | null = null;
  private sftp: SFTPWrapper | null = null;
  private isClosed = true;
  private closing = false;
  private lostListener: ((error: Error) => void) | null = null;

  constructor(
    private readonly config: ConnectionConfig,
    private readonly log: LogSink,
  ) {}

  get closed(): boolean {
    return this.isClosed;
  }

  private get s(): SFTPWrapper {
    if (!this.sftp || this.isClosed) throw new TransferFailure('NOT_CONNECTED', 'La conexión SFTP está cerrada');
    return this.sftp;
  }

  async connect(): Promise<void> {
    const { host, port, username, auth } = this.config;
    const conn = new Client();
    this.conn = conn;
    let hostKeyFailure: TransferFailure | null = null;

    const options: ConnectConfig = {
      host,
      port,
      username,
      readyTimeout: this.config.timeoutMs ?? DEFAULT_TIMEOUT,
      keepaliveInterval: 15_000,
      keepaliveCountMax: 3,
      tryKeyboard: auth === 'password',
      hostVerifier: (key: Buffer) => {
        const { fingerprint, keyType } = hostKeyFingerprint(key);
        const trusted = this.config.trustedFingerprints.filter((f) => f.startsWith('SHA256:'));
        if (trusted.includes(fingerprint)) return true;
        hostKeyFailure =
          trusted.length === 0
            ? new TransferFailure('HOST_KEY_UNKNOWN', `Clave de host desconocida (${keyType})`, { fingerprint, keyType })
            : new TransferFailure('HOST_KEY_MISMATCH', 'La clave de host ha cambiado desde la última conexión', {
                fingerprint,
                keyType,
                expected: trusted.join(', '),
              });
        this.log('error', hostKeyFailure.message);
        return false;
      },
    };
    if (auth === 'password') options.password = this.config.password ?? '';
    if (auth === 'key') {
      options.privateKey = this.config.privateKey ?? '';
      if (this.config.passphrase) options.passphrase = this.config.passphrase;
    }
    if (auth === 'agent') {
      const agent = process.platform === 'win32' ? 'pageant' : process.env['SSH_AUTH_SOCK'];
      if (!agent) throw new TransferFailure('AUTH_FAILED', 'No hay agente SSH disponible (SSH_AUTH_SOCK)');
      options.agent = agent;
    }

    conn.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish) => {
      finish(prompts.map(() => this.config.password ?? ''));
    });
    conn.on('banner', (message) => this.log('response', message.trimEnd()));

    this.log('info', `Conectando a ${host}:${port}…`);
    try {
      await new Promise<void>((resolve, reject) => {
        conn.once('ready', resolve);
        conn.once('error', reject);
        try {
          conn.connect(options);
        } catch (err) {
          // ssh2 lanza en síncrono si no puede leer la clave privada.
          reject(new TransferFailure('AUTH_FAILED', `Clave privada no válida o passphrase incorrecta: ${(err as Error).message}`));
        }
      });
      this.log('info', 'Autenticado');
      this.sftp = await promisify<SFTPWrapper>((cb) => conn.sftp(cb));
    } catch (err) {
      conn.end();
      throw hostKeyFailure ?? mapSftpError(err);
    }

    this.isClosed = false;
    conn.on('error', (err) => this.log('error', err.message));
    conn.on('close', () => {
      const wasOpen = !this.isClosed;
      this.isClosed = true;
      if (wasOpen && !this.closing) this.lostListener?.(new Error('Conexión SFTP cerrada'));
    });
  }

  async home(): Promise<string> {
    return this.realpath('.');
  }

  async list(path: string): Promise<RemoteEntry[]> {
    const sftp = this.s;
    this.log('command', `READDIR ${path}`);
    try {
      const items = await promisify<FileEntryWithStats[]>((cb) => sftp.readdir(path, cb));
      const entries = items
        .filter((i) => i.filename !== '.' && i.filename !== '..')
        .map((i) => {
          const [owner, group] = ownerGroup(i.longname);
          return { ...entryFromStats(joinRemote(path, i.filename), i.attrs, owner, group), name: i.filename };
        });
      // Los enlaces se resuelven para saber si se puede entrar en ellos.
      await Promise.all(
        entries
          .filter((e) => e.type === 'symlink')
          .map(async (e) => {
            try {
              e.target = await promisify<string>((cb) => sftp.readlink(e.path, cb));
              const stats = await promisify<Stats>((cb) => sftp.stat(e.path, cb));
              if (typeFromMode(stats.mode) === 'dir') e.type = 'dir';
            } catch {
              // enlace roto: se queda como symlink
            }
          }),
      );
      this.log('response', `${entries.length} entradas`);
      return entries;
    } catch (err) {
      throw mapSftpError(err);
    }
  }

  async stat(path: string): Promise<RemoteEntry | null> {
    const sftp = this.s;
    try {
      const stats = await promisify<Stats>((cb) => sftp.stat(path, cb));
      return entryFromStats(path, stats);
    } catch (err) {
      const failure = mapSftpError(err);
      if (failure.code === 'NOT_FOUND') return null;
      throw failure;
    }
  }

  private async run(command: string, op: (sftp: SFTPWrapper, cb: (err: Error | null | undefined) => void) => void): Promise<void> {
    const sftp = this.s;
    this.log('command', command);
    try {
      await promisify<void>((cb) => op(sftp, (err) => cb(err, undefined)));
    } catch (err) {
      throw mapSftpError(err);
    }
  }

  mkdir(path: string): Promise<void> {
    return this.run(`MKDIR ${path}`, (s, cb) => s.mkdir(path, cb));
  }

  rename(from: string, to: string): Promise<void> {
    return this.run(`RENAME ${from} ${to}`, (s, cb) => s.rename(from, to, cb));
  }

  deleteFile(path: string): Promise<void> {
    return this.run(`REMOVE ${path}`, (s, cb) => s.unlink(path, cb));
  }

  async deleteDir(path: string): Promise<void> {
    for (const entry of await this.list(path)) {
      if (entry.type === 'dir' && entry.target === null) await this.deleteDir(entry.path);
      else await this.deleteFile(entry.path);
    }
    await this.run(`RMDIR ${path}`, (s, cb) => s.rmdir(path, cb));
  }

  chmod(path: string, mode: number): Promise<void> {
    return this.run(`CHMOD ${mode.toString(8)} ${path}`, (s, cb) => s.chmod(path, mode, cb));
  }

  async realpath(path: string): Promise<string> {
    const sftp = this.s;
    try {
      return await promisify<string>((cb) => sftp.realpath(path, cb));
    } catch (err) {
      throw mapSftpError(err);
    }
  }

  private counter(options: StreamOptions): Transform {
    return new Transform({
      transform(chunk: Buffer, _enc, cb) {
        options.onProgress(chunk.length);
        cb(null, chunk);
      },
    });
  }

  async download(remotePath: string, localPath: string, options: StreamOptions): Promise<void> {
    const sftp = this.s;
    this.log('command', `GET ${remotePath}${options.offset ? ` desde ${options.offset}` : ''}`);
    let target;
    try {
      target = createWriteStream(localPath, { flags: options.offset > 0 ? 'r+' : 'w', start: options.offset });
    } catch (err) {
      throw localFailure(err, localPath);
    }
    await this.pipe(options, sftp.createReadStream(remotePath, { start: options.offset }), target, localPath, 'remote');
  }

  async upload(localPath: string, remotePath: string, options: StreamOptions): Promise<void> {
    const sftp = this.s;
    this.log('command', `PUT ${remotePath}${options.offset ? ` desde ${options.offset}` : ''}`);
    await this.pipe(
      options,
      createReadStream(localPath, { start: options.offset }),
      sftp.createWriteStream(remotePath, { flags: options.offset > 0 ? 'r+' : 'w', start: options.offset }),
      localPath,
      'local',
    );
  }

  private async pipe(
    options: StreamOptions,
    source: NodeJS.ReadableStream,
    target: NodeJS.WritableStream,
    localPath: string,
    sourceSide: 'local' | 'remote',
  ): Promise<void> {
    try {
      await pipeline(source, this.counter(options), target, { signal: options.signal });
    } catch (err) {
      if (options.signal.aborted) throw new TransferFailure('CANCELLED', 'Cancelado');
      const code = (err as { code?: unknown }).code;
      // Los errores de fs de Node llevan código string (ENOENT…); los de SFTP, numérico.
      if (typeof code === 'string' && code.startsWith('E') && (sourceSide === 'local' || (err as { path?: string }).path === localPath)) {
        throw localFailure(err, localPath);
      }
      throw mapSftpError(err);
    }
  }

  onLost(listener: (error: Error) => void): void {
    this.lostListener = listener;
  }

  close(): void {
    this.closing = true;
    this.isClosed = true;
    this.conn?.end();
  }
}

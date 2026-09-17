import { createReadStream } from 'node:fs';
import { isIP } from 'node:net';
import type { TLSSocket } from 'node:tls';
import { Client, FileType, FTPError, type FileInfo } from 'basic-ftp';
import type { ConnectionConfig, RemoteEntry } from '@vela-ftp/shared';
import { TransferFailure, isLocalFsError, localFailure, toFailure } from '../errors';
import { basenameRemote, joinRemote, parentRemote, redact, type LogSink, type RemoteFs, type StreamOptions } from './RemoteFs';

const DEFAULT_TIMEOUT = 30_000;

/** Huella con el formato con el que se guarda la confianza en un certificado. */
export function certFingerprintId(fingerprint256: string): string {
  return `tls:${fingerprint256.toUpperCase()}`;
}

function mapFtpError(err: unknown): TransferFailure {
  if (err instanceof TransferFailure) return err;
  if (err instanceof FTPError) {
    const { code, message } = err;
    if (code === 530) return new TransferFailure('AUTH_FAILED', message);
    if (code === 550 || code === 450) {
      return /denied|permission|not allowed|forbidden/i.test(message)
        ? new TransferFailure('PERMISSION_DENIED', message)
        : new TransferFailure('NOT_FOUND', message);
    }
    if (code === 553 || code === 532) return new TransferFailure('PERMISSION_DENIED', message);
    if (code === 421 || code === 425 || code === 426) return new TransferFailure('CONNECTION_FAILED', message);
    return new TransferFailure('PROTOCOL', message);
  }
  if (err instanceof Error && /User closed client|Client is closed/i.test(err.message)) {
    return new TransferFailure('NOT_CONNECTED', err.message);
  }
  return toFailure(err);
}

function modeOf(info: FileInfo): number | null {
  const p = info.permissions;
  return p ? p.user * 0o100 + p.group * 0o10 + p.world : null;
}

function typeOf(info: FileInfo): RemoteEntry['type'] {
  switch (info.type) {
    case FileType.File:
      return 'file';
    case FileType.Directory:
      return 'dir';
    case FileType.SymbolicLink:
      return 'symlink';
    default:
      return 'unknown';
  }
}

export class FtpFs implements RemoteFs {
  readonly protocol;
  private client: Client | null = null;
  private lostListener: ((error: Error) => void) | null = null;
  private closing = false;

  constructor(
    private readonly config: ConnectionConfig,
    private readonly log: LogSink,
  ) {
    this.protocol = config.protocol;
  }

  get closed(): boolean {
    return !this.client || this.client.closed;
  }

  private get c(): Client {
    if (!this.client || this.client.closed) {
      throw new TransferFailure('NOT_CONNECTED', 'La conexión FTP está cerrada');
    }
    return this.client;
  }

  async connect(): Promise<void> {
    const { host, port, protocol } = this.config;
    const client = new Client(this.config.timeoutMs ?? DEFAULT_TIMEOUT);
    this.client = client;
    client.ftp.verbose = true;
    client.ftp.log = (message: string) => {
      const line = redact(message);
      if (line.startsWith('> ')) this.log('command', line.slice(2));
      else if (line.startsWith('< ')) this.log('response', line.slice(2).trimEnd());
      else this.log('info', line);
    };

    // rejectUnauthorized false para poder enseñar el certificado al usuario;
    // se decide antes de enviar las credenciales (ver verifyCertificate).
    const tlsOptions = {
      rejectUnauthorized: false,
      ...(isIP(host) ? {} : { servername: host }),
    };

    try {
      if (protocol === 'ftps-implicit') {
        await client.connectImplicitTLS(host, port, tlsOptions);
        this.verifyCertificate();
      } else {
        await client.connect(host, port);
        if (protocol === 'ftps') {
          await client.useTLS(tlsOptions);
          this.verifyCertificate();
        }
      }
      const anonymous = this.config.auth === 'anonymous';
      await client.login(anonymous ? 'anonymous' : this.config.username, anonymous ? 'guest' : (this.config.password ?? ''));
      await client.useDefaultSettings();
    } catch (err) {
      client.close();
      throw mapFtpError(err);
    }

    client.ftp.socket.once('close', () => {
      if (this.closing) return;
      this.lostListener?.(new Error('Conexión FTP cerrada por el servidor'));
    });
  }

  private verifyCertificate(): void {
    const socket = this.c.ftp.socket as TLSSocket;
    if (socket.authorized) return;
    const cert = socket.getPeerCertificate();
    const fingerprint = cert?.fingerprint256 ?? '';
    if (fingerprint && this.config.trustedFingerprints.includes(certFingerprintId(fingerprint))) {
      this.log('info', 'Certificado no verificado por una CA, aceptado previamente por el usuario');
      return;
    }
    const reason = socket.authorizationError instanceof Error ? socket.authorizationError.message : String(socket.authorizationError ?? '');
    throw new TransferFailure('CERT_UNTRUSTED', `Certificado TLS no válido: ${reason}`, {
      fingerprint: certFingerprintId(fingerprint),
      subject: cert?.subject?.CN ?? null,
      issuer: cert?.issuer?.CN ?? null,
      validFrom: cert?.valid_from ?? null,
      validTo: cert?.valid_to ?? null,
      reason,
    });
  }

  async home(): Promise<string> {
    try {
      return await this.c.pwd();
    } catch (err) {
      throw mapFtpError(err);
    }
  }

  async list(path: string): Promise<RemoteEntry[]> {
    try {
      const items = await this.c.list(path);
      return items
        .filter((i) => i.name !== '.' && i.name !== '..')
        .map((i) => ({
          name: i.name,
          path: joinRemote(path, i.name),
          type: typeOf(i),
          size: i.size,
          modifiedAt: i.modifiedAt ? i.modifiedAt.getTime() : null,
          mode: modeOf(i),
          owner: i.user || null,
          group: i.group || null,
          target: i.link || null,
        }));
    } catch (err) {
      throw mapFtpError(err);
    }
  }

  async stat(path: string): Promise<RemoteEntry | null> {
    if (path === '/') {
      return { name: '/', path: '/', type: 'dir', size: 0, modifiedAt: null, mode: null, owner: null, group: null, target: null };
    }
    try {
      const entries = await this.list(parentRemote(path));
      return entries.find((e) => e.name === basenameRemote(path)) ?? null;
    } catch (err) {
      const failure = mapFtpError(err);
      if (failure.code === 'NOT_FOUND') return null;
      throw failure;
    }
  }

  async mkdir(path: string): Promise<void> {
    try {
      await this.c.send(`MKD ${await this.c.protectWhitespace(path)}`);
    } catch (err) {
      throw mapFtpError(err);
    }
  }

  async rename(from: string, to: string): Promise<void> {
    try {
      await this.c.rename(from, to);
    } catch (err) {
      throw mapFtpError(err);
    }
  }

  async deleteFile(path: string): Promise<void> {
    try {
      await this.c.remove(path);
    } catch (err) {
      throw mapFtpError(err);
    }
  }

  async deleteDir(path: string): Promise<void> {
    try {
      await this.c.removeDir(path);
    } catch (err) {
      throw mapFtpError(err);
    }
  }

  async chmod(path: string, mode: number): Promise<void> {
    try {
      await this.c.send(`SITE CHMOD ${mode.toString(8)} ${await this.c.protectWhitespace(path)}`);
    } catch (err) {
      throw mapFtpError(err);
    }
  }

  async realpath(path: string): Promise<string> {
    try {
      await this.c.cd(path);
      return await this.c.pwd();
    } catch (err) {
      throw mapFtpError(err);
    }
  }

  async download(remotePath: string, localPath: string, options: StreamOptions): Promise<void> {
    await this.withProgress(options, localPath, () => this.c.downloadTo(localPath, remotePath, options.offset));
  }

  async upload(localPath: string, remotePath: string, options: StreamOptions): Promise<void> {
    await this.withProgress(options, localPath, () =>
      options.offset > 0
        ? this.c.appendFrom(createReadStream(localPath, { start: options.offset }), remotePath)
        : this.c.uploadFrom(localPath, remotePath),
    );
  }

  /**
   * FTP no sabe abortar una transferencia a medias: cancelar cierra la
   * conexión, y el pool la descarta. Lo mismo tras un error de disco local: la
   * conexión de datos queda en un estado incierto y no se reutiliza.
   */
  private async withProgress(options: StreamOptions, localPath: string, run: () => Promise<unknown>): Promise<void> {
    const client = this.c;
    if (options.signal.aborted) throw new TransferFailure('CANCELLED', 'Cancelado');
    let last = 0;
    client.trackProgress((info) => {
      const delta = info.bytes - last;
      last = info.bytes;
      if (delta > 0) options.onProgress(delta);
    });
    const onAbort = () => this.close();
    options.signal.addEventListener('abort', onAbort, { once: true });
    try {
      await run();
    } catch (err) {
      if (options.signal.aborted) throw new TransferFailure('CANCELLED', 'Cancelado');
      if (isLocalFsError(err, localPath)) {
        this.close();
        throw localFailure(err, localPath);
      }
      throw mapFtpError(err);
    } finally {
      options.signal.removeEventListener('abort', onAbort);
      if (!client.closed) client.trackProgress();
    }
  }

  onLost(listener: (error: Error) => void): void {
    this.lostListener = listener;
  }

  close(): void {
    this.closing = true;
    this.client?.close();
  }
}

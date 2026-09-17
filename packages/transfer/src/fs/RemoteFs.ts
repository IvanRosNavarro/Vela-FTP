import type { ConnectionConfig, LogLevel, RemoteEntry, RemoteProtocol } from '@vela-ftp/shared';

export interface StreamOptions {
  /** Byte desde el que empezar (reanudación). */
  offset: number;
  /** Bytes transferidos desde la última llamada. */
  onProgress: (deltaBytes: number) => void;
  signal: AbortSignal;
}

export type LogSink = (level: LogLevel, message: string) => void;

/**
 * Operaciones sobre un servidor remoto. Una instancia es una conexión: no
 * admite operaciones concurrentes (el pool se encarga de serializarlas).
 */
export interface RemoteFs {
  readonly protocol: RemoteProtocol;
  readonly closed: boolean;
  connect(): Promise<void>;
  /** Directorio inicial tras el login. */
  home(): Promise<string>;
  list(path: string): Promise<RemoteEntry[]>;
  /** null si no existe. */
  stat(path: string): Promise<RemoteEntry | null>;
  mkdir(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  /** Borra la carpeta y su contenido. */
  deleteDir(path: string): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  /** Fija la fecha de modificación (ms epoch). false si el servidor no lo admite. */
  setModifiedTime(path: string, time: number): Promise<boolean>;
  realpath(path: string): Promise<string>;
  download(remotePath: string, localPath: string, options: StreamOptions): Promise<void>;
  upload(localPath: string, remotePath: string, options: StreamOptions): Promise<void>;
  /** Se llama una vez si la conexión se cae sin haber llamado a close(). */
  onLost(listener: (error: Error) => void): void;
  close(): void;
}

export type RemoteFsFactory = (config: ConnectionConfig, log: LogSink) => RemoteFs;

/** Nombres de ruta remota: POSIX siempre. */
export function joinRemote(dir: string, name: string): string {
  return dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`;
}

export function parentRemote(path: string): string {
  const trimmed = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  const idx = trimmed.lastIndexOf('/');
  return idx <= 0 ? '/' : trimmed.slice(0, idx);
}

export function basenameRemote(path: string): string {
  const trimmed = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  return trimmed.slice(trimmed.lastIndexOf('/') + 1);
}

/** Quita contraseñas y passphrases de una línea de log. */
export function redact(line: string): string {
  return line
    .replace(/^(>\s*PASS\s+).*/i, '$1****')
    .replace(/(password|passphrase)=\S+/gi, '$1=****');
}

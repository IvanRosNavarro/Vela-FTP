export type RemoteProtocol = 'ftp' | 'ftps' | 'ftps-implicit' | 'sftp';

export const DEFAULT_PORTS: Record<RemoteProtocol, number> = {
  ftp: 21,
  ftps: 21,
  'ftps-implicit': 990,
  sftp: 22,
};

export type AuthMethod = 'password' | 'key' | 'agent' | 'anonymous';

/** Todo lo necesario para abrir una conexión. Las credenciales viajan en claro solo en memoria. */
export interface ConnectionConfig {
  protocol: RemoteProtocol;
  host: string;
  port: number;
  username: string;
  auth: AuthMethod;
  password?: string;
  /** Contenido de la clave privada (OpenSSH o PuTTY .ppk). */
  privateKey?: string;
  passphrase?: string;
  /** Huellas ya aceptadas por el usuario: clave de host SSH o certificado TLS. */
  trustedFingerprints: string[];
  timeoutMs?: number;
}

export type RemoteEntryType = 'file' | 'dir' | 'symlink' | 'unknown';

export interface RemoteEntry {
  name: string;
  /** Ruta absoluta POSIX. */
  path: string;
  type: RemoteEntryType;
  size: number;
  /** ms epoch, o null si el servidor no lo da. */
  modifiedAt: number | null;
  /** Modo octal (p. ej. 0o755) si se conoce. */
  mode: number | null;
  owner: string | null;
  group: string | null;
  /** Destino de un enlace simbólico si se conoce. */
  target: string | null;
}

export type TransferDirection = 'upload' | 'download';

export type ConflictPolicy = 'ask' | 'overwrite' | 'overwrite-if-newer' | 'resume' | 'rename' | 'skip';

export type ConflictDecision = Exclude<ConflictPolicy, 'ask'>;

export type JobStatus =
  | 'queued'
  | 'running'
  | 'conflict'
  | 'done'
  | 'skipped'
  | 'failed'
  | 'cancelled'
  /** La app se cerró o el motor se reinició con el trabajo a medias. */
  | 'interrupted';

export interface TransferJob {
  id: string;
  sessionId: string;
  direction: TransferDirection;
  localPath: string;
  remotePath: string;
  /** true si es una carpeta: se expande en trabajos de fichero al empezar. */
  isDirectory: boolean;
  conflictPolicy: ConflictPolicy;
  /** Trabajo de carpeta del que sale, si lo hay. */
  parentId: string | null;
}

export interface JobSnapshot extends TransferJob {
  status: JobStatus;
  size: number | null;
  transferred: number;
  /** bytes/s, media reciente. */
  speed: number;
  attempts: number;
  error: TransferError | null;
  startedAt: number | null;
  finishedAt: number | null;
}

export type TransferErrorCode =
  | 'AUTH_FAILED'
  | 'HOST_KEY_UNKNOWN'
  | 'HOST_KEY_MISMATCH'
  | 'CERT_UNTRUSTED'
  | 'CONNECTION_FAILED'
  | 'TIMEOUT'
  | 'NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'ALREADY_EXISTS'
  | 'NOT_CONNECTED'
  | 'CANCELLED'
  | 'LOCAL_IO'
  /** El fichero supera el tamaño admitido para abrirlo (editor, vista previa). */
  | 'TOO_LARGE'
  /** El fichero remoto cambió desde que se abrió: guardar lo pisaría. */
  | 'REMOTE_CHANGED'
  | 'PROTOCOL'
  | 'INTERNAL';

export interface TransferError {
  code: TransferErrorCode;
  message: string;
  /** Para HOST_KEY_* y CERT_UNTRUSTED: huella, algoritmo, sujeto… */
  details?: Record<string, string | number | boolean | null>;
}

/** Errores tras los que tiene sentido reintentar automáticamente. */
export const RETRYABLE_ERRORS: ReadonlySet<TransferErrorCode> = new Set(['CONNECTION_FAILED', 'TIMEOUT', 'PROTOCOL']);

export interface ConflictInfo {
  jobId: string;
  direction: TransferDirection;
  localPath: string;
  remotePath: string;
  source: { size: number; modifiedAt: number | null };
  target: { size: number; modifiedAt: number | null };
}

export type LogLevel = 'command' | 'response' | 'info' | 'error';

export interface ProtocolLogLine {
  sessionId: string;
  level: LogLevel;
  message: string;
  at: number;
}

import type { TransferError, TransferErrorCode } from '@vela-ftp/shared';

/** Error del motor con código tipado; es lo único que cruza hacia main. */
export class TransferFailure extends Error {
  readonly info: TransferError;

  constructor(code: TransferErrorCode, message: string, details?: TransferError['details']) {
    super(message);
    this.name = 'TransferFailure';
    this.info = details ? { code, message, details } : { code, message };
  }

  get code(): TransferErrorCode {
    return this.info.code;
  }
}

const NETWORK_CODES: Record<string, TransferErrorCode> = {
  ECONNREFUSED: 'CONNECTION_FAILED',
  ECONNRESET: 'CONNECTION_FAILED',
  ENOTFOUND: 'CONNECTION_FAILED',
  EAI_AGAIN: 'CONNECTION_FAILED',
  EHOSTUNREACH: 'CONNECTION_FAILED',
  ENETUNREACH: 'CONNECTION_FAILED',
  EPIPE: 'CONNECTION_FAILED',
  ETIMEDOUT: 'TIMEOUT',
};

const LOCAL_CODES: Record<string, TransferErrorCode> = {
  ENOENT: 'NOT_FOUND',
  EACCES: 'PERMISSION_DENIED',
  EPERM: 'PERMISSION_DENIED',
  EEXIST: 'ALREADY_EXISTS',
  ENOSPC: 'LOCAL_IO',
  EISDIR: 'LOCAL_IO',
  ENOTDIR: 'LOCAL_IO',
};

function errorCode(err: unknown): string | number | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? (err as { code?: string | number }).code
    : undefined;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Convierte cualquier error en `TransferFailure`, conservando uno que ya lo sea. */
export function toFailure(err: unknown): TransferFailure {
  if (err instanceof TransferFailure) return err;
  const code = errorCode(err);
  const message = messageOf(err);
  const network = typeof code === 'string' ? NETWORK_CODES[code] : undefined;
  if (network) return new TransferFailure(network, message);
  if (/timeout/i.test(message)) return new TransferFailure('TIMEOUT', message);
  if (err instanceof Error && err.name === 'AbortError') return new TransferFailure('CANCELLED', 'Cancelado');
  return new TransferFailure('INTERNAL', message);
}

/**
 * true si es un error del fs de Node sobre `localPath` (abrir, leer o escribir
 * el fichero local), para no confundirlo con un error del servidor.
 */
export function isLocalFsError(err: unknown, localPath: string): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; path?: unknown; syscall?: unknown };
  return typeof e.code === 'string' && typeof e.syscall === 'string' && e.path === localPath;
}

/** Errores de ficheros locales (fs de Node). */
export function localFailure(err: unknown, path: string): TransferFailure {
  if (err instanceof TransferFailure) return err;
  const code = errorCode(err);
  const mapped = typeof code === 'string' ? LOCAL_CODES[code] : undefined;
  return new TransferFailure(mapped ?? 'LOCAL_IO', `${path}: ${messageOf(err)}`, { local: true });
}

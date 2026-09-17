import type { AppErrorCode, AppResponse, TransferError } from '@vela-ftp/shared';

/** Error de una llamada IPC con su código tipado. */
export class AppError extends Error {
  constructor(
    readonly code: AppErrorCode,
    readonly details: unknown,
  ) {
    super(describeError(code, details));
    this.name = 'AppError';
  }

  /** Detalles del motor (huella, algoritmo…) si los hay. */
  get transferDetails(): TransferError['details'] | undefined {
    const d = this.details as Partial<TransferError> | undefined;
    return d && typeof d === 'object' && 'details' in d ? d.details : undefined;
  }
}

/** Devuelve los datos o lanza `AppError`. */
export async function call<T>(promise: Promise<AppResponse<T>>): Promise<T> {
  const res = await promise;
  if (res.ok) return res.data;
  throw new AppError(res.error, res.details);
}

const MESSAGES: Partial<Record<AppErrorCode, string>> = {
  AUTH_FAILED: 'Usuario o contraseña incorrectos',
  HOST_KEY_UNKNOWN: 'Servidor desconocido: hay que confirmar su huella',
  HOST_KEY_MISMATCH: 'La clave del servidor ha cambiado',
  CERT_UNTRUSTED: 'El certificado del servidor no es de confianza',
  CONNECTION_FAILED: 'No se pudo conectar con el servidor',
  TIMEOUT: 'El servidor no responde',
  NOT_FOUND: 'No existe',
  PERMISSION_DENIED: 'Permiso denegado',
  ALREADY_EXISTS: 'Ya existe',
  NOT_CONNECTED: 'No hay conexión',
  CANCELLED: 'Cancelado',
  LOCAL_IO: 'Error de disco local',
  PROTOCOL: 'Respuesta inesperada del servidor',
  VAULT_LOCKED: 'Los secretos están bloqueados',
  INVALID_MASTER_PASSWORD: 'Contraseña maestra incorrecta',
  KEYCHAIN_UNAVAILABLE: 'No hay llavero del sistema: establece una contraseña maestra',
  INVALID_INPUT: 'Datos no válidos',
  UNTRUSTED_FRAME: 'Operación no permitida',
  INTERNAL: 'Error interno',
};

export function describeError(code: AppErrorCode, details?: unknown): string {
  const base = MESSAGES[code] ?? code;
  const serverMessage = (details as { message?: unknown } | undefined)?.message;
  return typeof serverMessage === 'string' && serverMessage && !['INVALID_INPUT', 'INTERNAL'].includes(code)
    ? `${base}: ${serverMessage}`
    : base;
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

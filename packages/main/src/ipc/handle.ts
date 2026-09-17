import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { AppErrorCode, IpcEventName, MainEventPayloads } from '@vela-ftp/shared';
import { NotFoundError, fail, ok, validatePayload, type IpcResponse } from 'vela-kit/ipc';
import { logger } from 'vela-kit/logger';
import type { z } from 'zod';
import { BinaryFileError } from '../files/EditorManager';
import { InvalidMasterPasswordError, KeychainUnavailableError, VaultLockedError } from '../security/SecretStore';
import { TransferRequestError } from '../transfer/TransferHost';
import { isTrustedSender } from './guard';

export type AppIpcResponse<T> = IpcResponse<T, AppErrorCode>;

/** Traduce errores conocidos a la respuesta del renderer; el resto se registra. */
export function toErrorResponse(err: unknown, channel: string): AppIpcResponse<never> {
  if (err instanceof TransferRequestError) return fail(err.info.code, err.info);
  if (err instanceof VaultLockedError) return fail('VAULT_LOCKED');
  if (err instanceof BinaryFileError) return fail('BINARY_FILE', { name: err.fileName });
  if (err instanceof InvalidMasterPasswordError) return fail('INVALID_MASTER_PASSWORD');
  if (err instanceof KeychainUnavailableError) return fail('KEYCHAIN_UNAVAILABLE');
  if (err instanceof NotFoundError) return fail('NOT_FOUND', { entity: err.entity, id: err.id });
  if (err instanceof Error && err.name === 'InvalidShortcutRequestError') return fail('INVALID_INPUT', { message: err.message });
  const code = (err as { code?: unknown })?.code;
  if (code === 'ENOENT') return fail('NOT_FOUND', { message: (err as Error).message });
  if (code === 'EEXIST') return fail('ALREADY_EXISTS', { message: (err as Error).message });
  if (code === 'EACCES' || code === 'EPERM') return fail('PERMISSION_DENIED', { message: (err as Error).message });
  logger.error(`[ipc] ${channel} falló`, err);
  return fail('INTERNAL', { message: err instanceof Error ? err.message : String(err) });
}

/**
 * Registra un handler que solo atiende a la shell, valida el payload con zod y
 * nunca lanza al renderer.
 */
export function handle<S extends z.ZodType, T>(
  channel: string,
  schema: S | null,
  fn: (input: z.output<S>, event: IpcMainInvokeEvent) => T | Promise<T>,
): void {
  ipcMain.handle(channel, async (event, raw): Promise<AppIpcResponse<T>> => {
    if (!isTrustedSender(event, channel)) return fail('UNTRUSTED_FRAME');
    let input: z.output<S> = undefined as z.output<S>;
    if (schema) {
      const parsed = validatePayload(schema, raw);
      if (!parsed.ok) return parsed;
      input = parsed.data;
    }
    try {
      return ok(await fn(input, event));
    } catch (err) {
      return toErrorResponse(err, channel);
    }
  });
}

/** Envía un evento a todas las ventanas de la app. */
export function broadcast<E extends IpcEventName>(event: E, payload: MainEventPayloads[E]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(event, payload);
  }
}

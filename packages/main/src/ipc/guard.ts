import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import { app } from 'electron';
import { createFrameGuard } from 'vela-kit/ipc';
import { logger } from 'vela-kit/logger';
import { APP_ORIGIN } from '../protocol/appProtocol';

export const DEV_SERVER_ORIGIN = 'http://localhost:5183';

const guard = createFrameGuard({
  trustedPrefixes: [`${APP_ORIGIN}/`],
  devServerOrigin: app.isPackaged ? null : DEV_SERVER_ORIGIN,
  logger,
});

/**
 * true si el remitente es la shell. Si no, registra el intento y devuelve
 * false para que el handler responda `UNTRUSTED_FRAME` sin lanzar.
 */
export function isTrustedSender(event: IpcMainEvent | IpcMainInvokeEvent, channel: string): boolean {
  try {
    guard.guardTrustedFrame(event, channel);
    return true;
  } catch {
    return false;
  }
}

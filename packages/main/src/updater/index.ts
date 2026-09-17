import { app, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import { IPC_EVENTS } from '@vela-ftp/shared';
import { logger } from 'vela-kit/logger';
import { broadcast } from '../ipc/handle';
import type { SettingsRepository } from '../storage/repositories/SettingsRepository';
import { UpdateService } from './UpdateService';

const RELEASES_URL = 'https://github.com/IvanRosNavarro/Vela-FTP/releases';

export function createUpdateService(settings: SettingsRepository): UpdateService {
  autoUpdater.logger = {
    info: (msg: unknown) => logger.info(`[updater] ${String(msg)}`),
    warn: (msg: unknown) => logger.warn(`[updater] ${String(msg)}`),
    error: (msg: unknown) => logger.error(`[updater] ${String(msg)}`),
    debug: (msg: unknown) => logger.debug(`[updater] ${String(msg)}`),
  };
  return new UpdateService({
    updater: autoUpdater,
    currentVersion: app.getVersion(),
    packaged: app.isPackaged,
    // TODO(deuda): Squirrel.Mac solo instala binarios firmados. Al firmar en
    // macOS, quitar esta excepción para que actualice solo como en Windows y Linux.
    canInstall: process.platform !== 'darwin',
    autoCheckEnabled: () => settings.get('updates:auto-check'),
    onChange: (status) => broadcast(IPC_EVENTS.UPDATES_CHANGED, status),
    openExternal: (url) => void shell.openExternal(url),
    releasesUrl: RELEASES_URL,
  });
}

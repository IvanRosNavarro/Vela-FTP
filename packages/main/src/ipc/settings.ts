import { ipcMain } from 'electron';
import { IPC_CHANNELS, settingsGetInputSchema, settingsSetInputSchema, type SettingKey, type SettingValue } from '@vela-ftp/shared';
import { fail, ok, validatePayload, type IpcResponse } from 'vela-kit/ipc';
import { logger } from 'vela-kit/logger';
import type { SettingsRepository } from '../storage/repositories/SettingsRepository';
import { isTrustedSender } from './guard';

export function registerSettingsHandlers(settings: SettingsRepository): void {
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, (event, raw): IpcResponse<unknown> => {
    if (!isTrustedSender(event, IPC_CHANNELS.SETTINGS_GET)) return fail('UNTRUSTED_FRAME');
    const input = validatePayload(settingsGetInputSchema, raw);
    if (!input.ok) return input;
    return ok(settings.get(input.data.key));
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, (event, raw): IpcResponse<null> => {
    if (!isTrustedSender(event, IPC_CHANNELS.SETTINGS_SET)) return fail('UNTRUSTED_FRAME');
    const input = validatePayload(settingsSetInputSchema, raw);
    if (!input.ok) return input;
    try {
      const key: SettingKey = input.data.key;
      settings.set(key, input.data.value as SettingValue<typeof key>);
      return ok(null);
    } catch (err) {
      logger.error(`[settings] no se pudo guardar ${input.data.key}`, err);
      return fail('INTERNAL');
    }
  });
}

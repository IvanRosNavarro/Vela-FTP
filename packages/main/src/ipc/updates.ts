import { IPC_CHANNELS } from '@vela-ftp/shared';
import type { UpdateService } from '../updater/UpdateService';
import { handle } from './handle';

export function registerUpdateHandlers(updates: UpdateService): void {
  handle(IPC_CHANNELS.UPDATES_STATUS, null, () => updates.current);
  handle(IPC_CHANNELS.UPDATES_CHECK, null, () => updates.check());
  handle(IPC_CHANNELS.UPDATES_DOWNLOAD, null, () => {
    void updates.download();
    return null;
  });
  handle(IPC_CHANNELS.UPDATES_INSTALL, null, () => {
    updates.install();
    return null;
  });
  handle(IPC_CHANNELS.UPDATES_OPEN_RELEASE, null, () => {
    updates.openRelease();
    return null;
  });
}

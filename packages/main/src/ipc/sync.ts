import { IPC_CHANNELS, syncCategoriesInputSchema, syncEmailInputSchema, syncPasswordInputSchema } from '@vela-ftp/shared';
import type { SyncManager } from '../sync/SyncManager';
import { handle } from './handle';

export function registerSyncHandlers(sync: SyncManager): void {
  handle(IPC_CHANNELS.SYNC_STATUS, null, () => sync.status());

  handle(IPC_CHANNELS.SYNC_REQUEST_LINK, syncEmailInputSchema, async ({ email }) => {
    await sync.requestLink(email);
    return null;
  });

  handle(IPC_CHANNELS.SYNC_ACTIVATE, syncPasswordInputSchema, async ({ password }) => {
    await sync.activate(password);
    return sync.status();
  });

  handle(IPC_CHANNELS.SYNC_DEACTIVATE, null, async () => {
    await sync.deactivate();
    return null;
  });

  handle(IPC_CHANNELS.SYNC_NOW, null, async () => {
    await sync.syncNow();
    return sync.status();
  });

  handle(IPC_CHANNELS.SYNC_SET_CATEGORIES, syncCategoriesInputSchema, ({ disabled }) => {
    sync.setDisabledCategories(disabled);
    return sync.status();
  });
}

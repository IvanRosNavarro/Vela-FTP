import { create } from 'zustand';
import type { SyncStatus } from '@vela-ftp/shared';
import { call } from '../lib/ipc';

/** Reflejo del estado de la sincronización que mantiene main. */
interface SyncState {
  status: SyncStatus | null;
  setStatus(status: SyncStatus): void;
  load(): Promise<void>;
}

export const useSyncStore = create<SyncState>((set) => ({
  status: null,
  setStatus: (status) => set({ status }),
  load: async () => {
    const status = await call(window.api.sync.status()).catch(() => null);
    if (status) set({ status });
  },
}));

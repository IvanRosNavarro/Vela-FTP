import { create } from 'zustand';
import type { UpdateStatus } from '@vela-ftp/shared';

/** Reflejo del estado del actualizador de main. */
interface UpdatesState {
  status: UpdateStatus | null;
  setStatus(status: UpdateStatus): void;
}

export const useUpdatesStore = create<UpdatesState>((set) => ({
  status: null,
  setStatus: (status) => set({ status }),
}));

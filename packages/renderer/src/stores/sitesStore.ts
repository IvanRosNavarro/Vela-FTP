import { create } from 'zustand';
import type { Site, VaultStatusInfo } from '@vela-ftp/shared';
import { toast } from 'vela-kit/ui';
import { call, errorText } from '../lib/ipc';

interface SitesState {
  sites: Site[];
  vault: VaultStatusInfo | null;
  loadSites(): Promise<void>;
  loadVault(): Promise<void>;
}

export const useSitesStore = create<SitesState>((set) => ({
  sites: [],
  vault: null,
  async loadSites() {
    try {
      set({ sites: await call(window.api.sites.list()) });
    } catch (err) {
      toast(`No se pudieron cargar los sitios: ${errorText(err)}`, 'error');
    }
  },
  async loadVault() {
    try {
      set({ vault: await call(window.api.vault.status()) });
    } catch (err) {
      toast(`No se pudo leer el estado de los secretos: ${errorText(err)}`, 'error');
    }
  },
}));

import { create } from 'zustand';
import type { Bookmark, CommandInfo, Project, Site, VaultStatusInfo } from '@vela-ftp/shared';
import { toast } from 'vela-kit/ui';
import { call, errorText } from '../lib/ipc';

interface SitesState {
  sites: Site[];
  projects: Project[];
  bookmarks: Bookmark[];
  commands: CommandInfo[];
  vault: VaultStatusInfo | null;
  loadSites(): Promise<void>;
  loadProjects(): Promise<void>;
  loadBookmarks(): Promise<void>;
  loadCommands(): Promise<void>;
  loadVault(): Promise<void>;
  setCommands(commands: CommandInfo[]): void;
}

async function load<T>(what: string, promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (err) {
    toast(`No se pudieron cargar ${what}: ${errorText(err)}`, 'error');
    return null;
  }
}

export const useSitesStore = create<SitesState>((set) => ({
  sites: [],
  projects: [],
  bookmarks: [],
  commands: [],
  vault: null,
  async loadSites() {
    const sites = await load('los sitios', call(window.api.sites.list()));
    if (sites) set({ sites });
  },
  async loadProjects() {
    const projects = await load('los proyectos', call(window.api.projects.list()));
    if (projects) set({ projects });
  },
  async loadBookmarks() {
    const bookmarks = await load('los marcadores', call(window.api.bookmarks.list()));
    if (bookmarks) set({ bookmarks });
  },
  async loadCommands() {
    const commands = await load('los comandos', call(window.api.commands.list()));
    if (commands) set({ commands });
  },
  async loadVault() {
    const vault = await load('el estado de los secretos', call(window.api.vault.status()));
    if (vault) set({ vault });
  },
  setCommands: (commands) => set({ commands }),
}));

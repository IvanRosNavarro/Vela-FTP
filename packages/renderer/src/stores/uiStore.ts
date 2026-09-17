import { create } from 'zustand';

/** Carpetas que se tomaron como equivalentes al activar la navegación sincronizada. */
export interface SyncBrowsing {
  sessionId: string;
  localBase: string;
  remoteBase: string;
}

/** Estado de la shell que no se persiste. */
interface UiState {
  /** Panel con el foco, destino de los atajos de navegación. */
  focusedPane: 'local' | 'remote';
  bottomPanelVisible: boolean;
  /** Colorear las diferencias entre el panel local y el remoto activo. */
  compareMode: boolean;
  syncBrowsing: SyncBrowsing | null;
  setFocusedPane(pane: 'local' | 'remote'): void;
  toggleBottomPanel(): void;
  toggleCompare(): void;
  setSyncBrowsing(sync: SyncBrowsing | null): void;
}

export const useUiStore = create<UiState>((set) => ({
  focusedPane: 'local',
  bottomPanelVisible: true,
  compareMode: false,
  syncBrowsing: null,
  setFocusedPane: (focusedPane) => set({ focusedPane }),
  toggleBottomPanel: () => set((s) => ({ bottomPanelVisible: !s.bottomPanelVisible })),
  toggleCompare: () => set((s) => ({ compareMode: !s.compareMode })),
  setSyncBrowsing: (syncBrowsing) => set({ syncBrowsing }),
}));

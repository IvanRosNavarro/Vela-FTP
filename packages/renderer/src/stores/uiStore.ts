import { create } from 'zustand';

/** Estado de la shell que no se persiste. */
interface UiState {
  /** Panel con el foco, destino de los atajos de navegación. */
  focusedPane: 'local' | 'remote';
  bottomPanelVisible: boolean;
  setFocusedPane(pane: 'local' | 'remote'): void;
  toggleBottomPanel(): void;
}

export const useUiStore = create<UiState>((set) => ({
  focusedPane: 'local',
  bottomPanelVisible: true,
  setFocusedPane: (focusedPane) => set({ focusedPane }),
  toggleBottomPanel: () => set((s) => ({ bottomPanelVisible: !s.bottomPanelVisible })),
}));

import { create } from 'zustand';
import { useUiStore } from './uiStore';

export type TerminalStatus = 'connecting' | 'open' | 'closed';

/** Una terminal de la interfaz. Su xterm vive en `lib/terminal/runtime.ts`. */
export interface TerminalTab {
  /** id local de la pestaña; la conexión del motor cambia si se reabre. */
  id: string;
  sessionId: string;
  title: string;
  /** Como pestaña del panel inferior o como pestaña propia junto a las sesiones. */
  placement: 'panel' | 'tab';
  status: TerminalStatus;
  /** Carpeta a la que ir al abrir (solo se usa la primera vez). */
  initialCwd: string | null;
}

interface TerminalsState {
  tabs: TerminalTab[];
  /** Terminal elegida en el panel inferior; null = una de sus pestañas propias (cola, registro…). */
  selected: string | null;
  /** Terminal en pestaña propia que se está viendo; null = se ven los ficheros. */
  viewing: string | null;
  add(sessionId: string, title: string, initialCwd: string | null): string;
  close(id: string): void;
  closeSession(sessionId: string): void;
  move(id: string, placement: TerminalTab['placement']): void;
  /** Muestra una terminal en el panel inferior (y el panel, si estaba oculto). */
  select(id: string | null): void;
  view(id: string | null): void;
  setStatus(id: string, status: TerminalStatus): void;
}

/** El xterm se carga aparte: solo hace falta soltarlo si ya se creó. */
function disposeRuntime(id: string): void {
  void import('../lib/terminal/runtime').then((m) => m.disposeRuntime(id));
}

function showBottomPanel(): void {
  if (!useUiStore.getState().bottomPanelVisible) useUiStore.getState().toggleBottomPanel();
}

/** Otra terminal del panel a la que pasar al quitar `id`, preferiblemente de la misma sesión. */
function fallback(tabs: TerminalTab[], removed: TerminalTab): string | null {
  const inPanel = tabs.filter((t) => t.placement === 'panel' && t.id !== removed.id);
  return (inPanel.filter((t) => t.sessionId === removed.sessionId).at(-1) ?? inPanel.at(-1))?.id ?? null;
}

export const useTerminalsStore = create<TerminalsState>((set, get) => ({
  tabs: [],
  selected: null,
  viewing: null,

  add(sessionId, title, initialCwd) {
    const id = crypto.randomUUID();
    set((s) => ({ tabs: [...s.tabs, { id, sessionId, title, placement: 'panel', status: 'connecting', initialCwd }], selected: id, viewing: null }));
    showBottomPanel();
    return id;
  },

  close(id) {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab) return;
    disposeRuntime(id);
    set((s) => ({
      tabs: s.tabs.filter((t) => t.id !== id),
      selected: s.selected === id ? fallback(s.tabs, tab) : s.selected,
      viewing: s.viewing === id ? null : s.viewing,
    }));
  },

  closeSession(sessionId) {
    for (const tab of get().tabs.filter((t) => t.sessionId === sessionId)) get().close(tab.id);
  },

  move(id, placement) {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab || tab.placement === placement) return;
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, placement } : t)),
      selected: placement === 'panel' ? id : s.selected === id ? fallback(s.tabs, tab) : s.selected,
      viewing: placement === 'tab' ? id : null,
    }));
    if (placement === 'panel') showBottomPanel();
  },

  select(id) {
    set({ selected: id });
    if (id) showBottomPanel();
  },

  view: (viewing) => set({ viewing }),

  setStatus: (id, status) => set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, status } : t)) })),
}));

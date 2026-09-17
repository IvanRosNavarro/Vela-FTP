import { create } from 'zustand';
import type { RemoteEntry } from '@vela-ftp/shared';
import { call, errorText } from '../lib/ipc';

export type SortKey = 'name' | 'size' | 'modifiedAt' | 'mode';

export interface PaneState {
  path: string;
  entries: RemoteEntry[];
  loading: boolean;
  error: string | null;
  /** Rutas seleccionadas. */
  selected: string[];
  /** Última fila clicada, para seleccionar rangos con Shift. */
  anchor: string | null;
  sort: { key: SortKey; dir: 'asc' | 'desc' };
  showHidden: boolean;
  /** Rutas visitadas, para Atrás. */
  history: string[];
}

/**
 * `local` (sin ninguna conexión), `local:<sessionId>` o `remote:<sessionId>`.
 * Como en FileZilla, cada pestaña remota lleva su propia carpeta local.
 */
export type PaneKey = 'local' | `local:${string}` | `remote:${string}`;

export function remotePaneKey(sessionId: string): PaneKey {
  return `remote:${sessionId}`;
}

export function localPaneKey(sessionId: string | null): PaneKey {
  return sessionId ? `local:${sessionId}` : 'local';
}

export function isRemotePane(key: PaneKey): boolean {
  return key.startsWith('remote:');
}

/** La sesión a la que pertenece el panel, sea el local o el remoto. */
export function sessionOfPane(key: PaneKey): string | null {
  const separator = key.indexOf(':');
  return separator < 0 ? null : key.slice(separator + 1);
}

async function fetchEntries(key: PaneKey, path: string): Promise<RemoteEntry[]> {
  const sessionId = isRemotePane(key) ? sessionOfPane(key) : null;
  return sessionId ? call(window.api.remote.list(sessionId, path)) : call(window.api.local.list(path));
}

const initialPane = (path: string): PaneState => ({
  path,
  entries: [],
  loading: false,
  error: null,
  selected: [],
  anchor: null,
  sort: { key: 'name', dir: 'asc' },
  showHidden: true,
  history: [],
});

interface PanesState {
  panes: Partial<Record<PaneKey, PaneState>>;
  ensure(key: PaneKey, path: string): void;
  navigate(key: PaneKey, path: string, options?: { pushHistory?: boolean; keepSelection?: boolean }): Promise<boolean>;
  refresh(key: PaneKey): Promise<void>;
  back(key: PaneKey): Promise<void>;
  setSelection(key: PaneKey, selected: string[], anchor: string | null): void;
  setSort(key: PaneKey, sortKey: SortKey): void;
  toggleHidden(key: PaneKey): void;
  drop(key: PaneKey): void;
}

/** Evita que una respuesta lenta pise la de una navegación posterior. */
const requestIds: Partial<Record<PaneKey, number>> = {};

export const usePanesStore = create<PanesState>((set, get) => {
  const patch = (key: PaneKey, update: Partial<PaneState>) =>
    set((s) => {
      const current = s.panes[key];
      return current ? { panes: { ...s.panes, [key]: { ...current, ...update } } } : s;
    });

  return {
    panes: {},
    ensure(key, path) {
      if (get().panes[key]) return;
      set((s) => ({ panes: { ...s.panes, [key]: initialPane(path) } }));
    },
    async navigate(key, path, options = {}) {
      const pane = get().panes[key];
      if (!pane) return false;
      const requestId = (requestIds[key] ?? 0) + 1;
      requestIds[key] = requestId;
      patch(key, { loading: true, error: null });
      try {
        const entries = await fetchEntries(key, path);
        if (requestIds[key] !== requestId) return false;
        const current = get().panes[key];
        const history =
          options.pushHistory && current && current.path !== path ? [...current.history.slice(-49), current.path] : (current?.history ?? []);
        const keep = options.keepSelection ? current?.selected.filter((p) => entries.some((e) => e.path === p)) ?? [] : [];
        patch(key, { path, entries, loading: false, error: null, selected: keep, anchor: keep.length ? current?.anchor ?? null : null, history });
        return true;
      } catch (err) {
        if (requestIds[key] !== requestId) return false;
        patch(key, { loading: false, error: errorText(err) });
        return false;
      }
    },
    async refresh(key) {
      const pane = get().panes[key];
      if (pane) await get().navigate(key, pane.path, { keepSelection: true });
    },
    async back(key) {
      const pane = get().panes[key];
      const previous = pane?.history.at(-1);
      if (!pane || previous === undefined) return;
      patch(key, { history: pane.history.slice(0, -1) });
      await get().navigate(key, previous);
    },
    setSelection: (key, selected, anchor) => patch(key, { selected, anchor }),
    setSort(key, sortKey) {
      const pane = get().panes[key];
      if (!pane) return;
      const dir = pane.sort.key === sortKey && pane.sort.dir === 'asc' ? 'desc' : 'asc';
      patch(key, { sort: { key: sortKey, dir } });
    },
    toggleHidden(key) {
      const pane = get().panes[key];
      if (pane) patch(key, { showHidden: !pane.showHidden });
    },
    drop(key) {
      set((s) => {
        const panes = { ...s.panes };
        delete panes[key];
        return { panes };
      });
    },
  };
});

const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });

/** Carpetas primero; dentro de cada grupo, por la columna elegida. */
export function sortEntries(entries: RemoteEntry[], sort: PaneState['sort'], showHidden: boolean): RemoteEntry[] {
  const visible = showHidden ? entries : entries.filter((e) => !e.name.startsWith('.'));
  const factor = sort.dir === 'asc' ? 1 : -1;
  return [...visible].sort((a, b) => {
    const aDir = a.type === 'dir' ? 0 : 1;
    const bDir = b.type === 'dir' ? 0 : 1;
    if (aDir !== bDir) return aDir - bDir;
    let cmp = 0;
    if (sort.key === 'size') cmp = a.size - b.size;
    else if (sort.key === 'modifiedAt') cmp = (a.modifiedAt ?? 0) - (b.modifiedAt ?? 0);
    else if (sort.key === 'mode') cmp = (a.mode ?? 0) - (b.mode ?? 0);
    if (cmp === 0) cmp = collator.compare(a.name, b.name);
    return cmp * factor;
  });
}

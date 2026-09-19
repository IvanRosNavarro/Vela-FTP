import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';
import {
  ArrowLeft,
  ArrowUp,
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileCode,
  GitCompareArrows,
  Radar,
  ScanEye,
  ExternalLink,
  File,
  Folder,
  FolderInput,
  FolderPlus,
  Link2,
  Lock,
  Pencil,
  Star,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import { List, useListRef, type RowComponentProps } from 'react-window';
import type { LocalRoot, RemoteEntry } from '@vela-ftp/shared';
import { toast } from 'vela-kit/ui';
import type { CompareStatus } from '../../lib/compare';
import { formatSize } from '../../lib/format';
import { COLUMNS, availableColumns, cellText, gridTemplate, minGridWidth, visibleColumns, type FileColumnId } from '../../lib/columns';
import { call, errorText } from '../../lib/ipc';
import { isValidName, localPaths, remotePaths, type PathOps } from '../../lib/paths';
import { downloadEntries, uploadDroppedFiles, uploadEntries } from '../../lib/transfers';
import { writeClipboardText } from '../../lib/clipboard';
import { confirmDialog, promptDialog, useDialogStore } from '../../stores/dialogStore';
import { isRemotePane, localPaneKey, remotePaneKey, sessionOfPane, sortEntries, usePanesStore, type PaneKey, type SortKey } from '../../stores/panesStore';
import { useSessionsStore } from '../../stores/sessionsStore';
import { useUiStore } from '../../stores/uiStore';
import { useSitesStore } from '../../stores/sitesStore';
import { startWatch } from '../../stores/watchStore';
import { addBookmarkFor } from '../../lib/bookmarks';
import { useContextMenu, type MenuItem } from '../ContextMenu';
import { PathInput } from './PathInput';

const ROW_HEIGHT = 24;
/**
 * Ventana para acumular letras al buscar por teclado ("or" debe llevar a
 * «order», no saltar de la o a la r y parar en «render»). Pasado este tiempo
 * sin teclear, la siguiente letra empieza una búsqueda nueva.
 */
const TYPEAHEAD_TIMEOUT = 1000;
const DRAG_MIME = 'application/x-vela-ftp-entries';
const IS_WINDOWS = window.api.platform === 'win32';

interface DragPayload {
  paneKey: PaneKey;
  paths: string[];
}

export interface FilePaneProps {
  paneKey: PaneKey;
  /** Sesión remota de este panel (remoto) o la sesión activa a la que transferir (local). */
  sessionId: string | null;
  focused: boolean;
  onFocus: () => void;
  /** Estado de cada nombre frente al otro panel, con la comparación activa. */
  compare?: Map<string, CompareStatus> | null;
}

/** Fondo de fila por estado de comparación; `older` y `same` no se marcan. */
export const COMPARE_COLORS: Partial<Record<CompareStatus, string>> = {
  only: 'color-mix(in srgb, var(--vela-warning) 22%, transparent)',
  newer: 'color-mix(in srgb, var(--vela-success) 22%, transparent)',
  different: 'color-mix(in srgb, var(--vela-danger) 22%, transparent)',
};

const COMPARE_LABELS: Record<CompareStatus, string> = {
  only: 'No existe en el otro lado',
  newer: 'Más reciente que en el otro lado',
  older: 'Más antiguo que en el otro lado',
  different: 'Distinto tamaño que en el otro lado',
  same: 'Igual en los dos lados',
};

interface RowProps {
  entries: RemoteEntry[];
  /** Columnas visibles, sin el nombre. */
  columns: FileColumnId[];
  grid: string;
  compare: Map<string, CompareStatus> | null;
  selected: Set<string>;
  isRemote: boolean;
  dropTarget: string | null;
  onRowMouseDown: (e: MouseEvent, entry: RemoteEntry, index: number) => void;
  onRowDoubleClick: (entry: RemoteEntry) => void;
  onRowContextMenu: (e: MouseEvent, entry: RemoteEntry) => void;
  onRowDragStart: (e: DragEvent, entry: RemoteEntry) => void;
  onRowDragOver: (e: DragEvent, entry: RemoteEntry) => void;
  onRowDrop: (e: DragEvent, entry: RemoteEntry) => void;
}


function EntryIcon({ entry }: { entry: RemoteEntry }) {
  if (entry.type === 'dir') return <Folder size={14} className="shrink-0 text-[var(--vela-accent)]" />;
  if (entry.type === 'symlink') return <Link2 size={14} className="shrink-0 text-[var(--vela-fg-muted)]" />;
  return <File size={14} className="shrink-0 text-[var(--vela-fg-muted)]" />;
}

function Row({ index, style, ariaAttributes, entries, columns, grid, compare, selected, isRemote: _isRemote, dropTarget, ...handlers }: RowComponentProps<RowProps>) {
  const entry = entries[index]!;
  const isSelected = selected.has(entry.path);
  const status = compare?.get(entry.name);
  const compareColor = status && !isSelected ? COMPARE_COLORS[status] : undefined;
  return (
    <div
      {...ariaAttributes}
      style={{ ...style, gridTemplateColumns: grid, ...(compareColor ? { background: compareColor } : {}) } as CSSProperties}
      className={`vela-file-row grid cursor-default select-none items-center gap-2 px-2 text-xs ${
        isSelected ? 'bg-[var(--vela-sidebar-active-bg)]' : index % 2 ? 'bg-black/[0.03]' : ''
      } ${dropTarget === entry.path ? 'outline outline-1 outline-[var(--vela-accent)]' : ''}`}
      draggable
      onMouseDown={(e) => handlers.onRowMouseDown(e, entry, index)}
      onDoubleClick={() => handlers.onRowDoubleClick(entry)}
      onContextMenu={(e) => handlers.onRowContextMenu(e, entry)}
      onDragStart={(e) => handlers.onRowDragStart(e, entry)}
      onDragOver={(e) => handlers.onRowDragOver(e, entry)}
      onDrop={(e) => handlers.onRowDrop(e, entry)}
      title={[entry.target ? `${entry.name} → ${entry.target}` : entry.name, status ? COMPARE_LABELS[status] : null].filter(Boolean).join('\n')}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <EntryIcon entry={entry} />
        <span className="truncate">{entry.name}</span>
      </span>
      {columns.map((id) => {
        const def = COLUMNS[id];
        const text = cellText(entry, id);
        return (
          <span
            key={id}
            title={id === 'target' || id === 'owner' || id === 'group' ? text : undefined}
            className={`truncate tabular-nums text-[var(--vela-fg-muted)] ${def.align === 'right' ? 'text-right' : ''} ${def.mono ? 'font-mono text-[10px]' : ''}`}
          >
            {text}
          </span>
        );
      })}
    </div>
  );
}

export function FilePane({ paneKey, sessionId, focused, onFocus, compare = null }: FilePaneProps) {
  const isRemote = isRemotePane(paneKey);
  const pane = usePanesStore((s) => s.panes[paneKey]);
  const store = usePanesStore.getState;
  const ops: PathOps = isRemote ? remotePaths : localPaths(window.api.local.separator);
  const listRef = useListRef(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<{ buffer: string; at: number; anchor: number }>({ buffer: '', at: 0, anchor: -1 });
  const [roots, setRoots] = useState<LocalRoot[]>([]);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [dragOverPane, setDragOverPane] = useState(false);
  const showMenu = useContextMenu((s) => s.show);
  const openWith = useUiStore((s) => s.openWith);
  const side = isRemote ? 'remote' : 'local';
  const chosenColumns = useUiStore((s) => s.columns[side]);
  const columns = useMemo(() => visibleColumns(chosenColumns, side, window.api.platform), [chosenColumns, side]);
  const grid = gridTemplate(columns);
  const minWidth = minGridWidth(columns);
  const paneSiteId = useSessionsStore((s) => (sessionId ? s.sessions.find((x) => x.sessionId === sessionId)?.siteId : undefined));
  const isBookmarked = useSitesStore((s) => !!pane && !!paneSiteId && s.bookmarks.some((b) => b.siteId === paneSiteId && b.remotePath === pane.path));


  useEffect(() => {
    if (isRemote) return;
    void call(window.api.local.roots())
      .then(setRoots)
      .catch(() => setRoots([]));
  }, [isRemote]);

  const entries = useMemo(() => (pane ? sortEntries(pane.entries, pane.sort, pane.showHidden) : []), [pane]);
  const selectedSet = useMemo(() => new Set(pane?.selected ?? []), [pane?.selected]);
  const selectedEntries = useCallback(() => entries.filter((e) => selectedSet.has(e.path)), [entries, selectedSet]);

  if (!pane) return null;

  const navigate = (path: string) => void store().navigate(paneKey, path, { pushHistory: true });
  const refresh = () => void store().refresh(paneKey);
  const up = () => {
    const parent = ops.parent(pane.path);
    if (parent) navigate(parent);
  };

  /** El panel de enfrente en esta misma pestaña, destino de las transferencias. */
  const otherPane = () => {
    const paneSession = sessionOfPane(paneKey);
    if (!paneSession) return null;
    return store().panes[isRemote ? localPaneKey(paneSession) : remotePaneKey(paneSession)] ?? null;
  };

  const transfer = async (items: RemoteEntry[], targetDir?: string) => {
    const other = otherPane();
    const paneSession = sessionOfPane(paneKey);
    if (isRemote) {
      if (!paneSession || !other) return;
      await downloadEntries(paneSession, items, targetDir ?? other.path);
    } else {
      if (!paneSession || !other) {
        toast('Conéctate a un sitio para subir ficheros', 'warning');
        return;
      }
      await uploadEntries(paneSession, items, targetDir ?? other.path);
    }
  };

  const open = (entry: RemoteEntry) => {
    if (entry.type === 'dir') {
      navigate(entry.path);
      return;
    }
    if (isRemote || sessionOfPane(paneKey)) {
      void transfer([entry]);
      return;
    }
    void call(window.api.local.open(entry.path)).catch((err) => toast(errorText(err), 'error'));
  };

  const select = (paths: string[], anchor: string | null) => store().setSelection(paneKey, paths, anchor);

  const preview = (entry: RemoteEntry) => {
    if (entry.type === 'dir') return;
    const source = isRemote ? { kind: 'remote' as const, sessionId: sessionId!, path: entry.path } : { kind: 'local' as const, path: entry.path };
    useDialogStore.getState().open({ kind: 'preview', source });
  };

  const edit = (entry: RemoteEntry) => {
    if (!isRemote || !sessionId || entry.type === 'dir') return;
    void call(window.api.files.editRemote(sessionId, entry.path)).catch((err) => toast(`No se pudo abrir: ${errorText(err)}`, 'error'));
  };

  /**
   * Con el programa del sistema. Un remoto se baja a una copia temporal; para
   * editar, lo que se guarde allí vuelve al servidor.
   */
  const openWithSystem = (entry: RemoteEntry, mode: 'edit' | 'view') => {
    if (entry.type === 'dir') return;
    const request = isRemote && sessionId ? window.api.files.openExternal(sessionId, entry.path, mode) : window.api.local.open(entry.path);
    void call(request).catch((err) => toast(`No se pudo abrir: ${errorText(err)}`, 'error'));
  };

  /** Espacio y F4 abren lo que diga el ajuste: Vela FTP o el programa del sistema. */
  const viewEntry = (entry: RemoteEntry) => (openWith === 'system' ? openWithSystem(entry, 'view') : preview(entry));
  const editEntry = (entry: RemoteEntry) => (openWith === 'system' ? openWithSystem(entry, 'edit') : edit(entry));

  /** El fichero con el mismo nombre en la carpeta del otro panel, si existe. */
  const counterpart = (entry: RemoteEntry): { sessionId: string; remotePath: string; localPath: string } | null => {
    const other = otherPane();
    const paneSession = sessionOfPane(paneKey);
    const match = other?.entries.find((x) => x.name === entry.name && x.type !== 'dir');
    if (!match || entry.type === 'dir' || !paneSession) return null;
    return isRemote
      ? { sessionId: paneSession, remotePath: entry.path, localPath: match.path }
      : { sessionId: paneSession, remotePath: match.path, localPath: entry.path };
  };

  /** Vigilar una carpeta local y subir sus cambios a la carpeta equivalente del panel remoto activo. */
  const watchFolder = (localDir: string, remoteDir: string) => {
    const paneSession = sessionOfPane(paneKey);
    const session = useSessionsStore.getState().sessions.find((s) => s.sessionId === paneSession);
    if (!session) return;
    void startWatch(session.sessionId, session.siteName, localDir, remoteDir);
  };

  const diff = (entry: RemoteEntry) => {
    const pair = counterpart(entry);
    if (!pair) return;
    void call(window.api.files.diff(pair.sessionId, pair.remotePath, pair.localPath)).catch((err) => toast(`No se pudo comparar: ${errorText(err)}`, 'error'));
  };

  const onRowMouseDown = (e: MouseEvent, entry: RemoteEntry, index: number) => {
    onFocus();
    containerRef.current?.focus();
    if (e.button === 2 && selectedSet.has(entry.path)) return;
    if (e.shiftKey && pane.anchor) {
      const from = entries.findIndex((x) => x.path === pane.anchor);
      const [a, b] = from < index ? [from, index] : [index, from];
      select(entries.slice(Math.max(a, 0), b + 1).map((x) => x.path), pane.anchor);
    } else if (e.ctrlKey || e.metaKey) {
      select(selectedSet.has(entry.path) ? pane.selected.filter((p) => p !== entry.path) : [...pane.selected, entry.path], entry.path);
    } else if (!(e.button === 0 && selectedSet.has(entry.path) && pane.selected.length > 1)) {
      // Con varios seleccionados, un clic sin soltar puede ser el inicio de un arrastre.
      select([entry.path], entry.path);
    }
  };

  const mkdir = async () => {
    const name = await promptDialog({
      title: 'Nueva carpeta',
      label: `Dentro de ${pane.path}`,
      initial: 'Nueva carpeta',
      confirmLabel: 'Crear',
      validate: (v) => (isValidName(v, !isRemote && IS_WINDOWS) ? null : 'Nombre no válido'),
    });
    if (!name) return;
    const path = ops.join(pane.path, name);
    try {
      await call(isRemote ? window.api.remote.mkdir(sessionId!, path) : window.api.local.mkdir(path));
      await store().refresh(paneKey);
      select([path], path);
    } catch (err) {
      toast(`No se pudo crear la carpeta: ${errorText(err)}`, 'error');
    }
  };

  const rename = async (entry: RemoteEntry) => {
    const name = await promptDialog({
      title: 'Renombrar',
      label: entry.path,
      initial: entry.name,
      confirmLabel: 'Renombrar',
      validate: (v) => (v === entry.name ? '' : isValidName(v, !isRemote && IS_WINDOWS) ? null : 'Nombre no válido'),
    });
    if (!name || name === entry.name) return;
    const to = ops.join(pane.path, name);
    try {
      await call(isRemote ? window.api.remote.rename(sessionId!, entry.path, to) : window.api.local.rename(entry.path, to));
      await store().refresh(paneKey);
      select([to], to);
    } catch (err) {
      toast(`No se pudo renombrar: ${errorText(err)}`, 'error');
    }
  };

  const remove = async (items: RemoteEntry[]) => {
    if (items.length === 0) return;
    const what = items.length === 1 ? `«${items[0]!.name}»` : `${items.length} elementos`;
    const ok = await confirmDialog({
      title: isRemote ? 'Borrar del servidor' : 'Mover a la papelera',
      message: isRemote
        ? `¿Borrar ${what} del servidor? Las carpetas se borran con todo su contenido.\nNo se puede deshacer.`
        : `¿Mover ${what} a la papelera?`,
      confirmLabel: isRemote ? 'Borrar' : 'Mover a la papelera',
      danger: isRemote,
    });
    if (!ok) return;
    try {
      if (isRemote) await call(window.api.remote.delete(sessionId!, items.map((i) => ({ path: i.path, isDirectory: i.type === 'dir' }))));
      else await call(window.api.local.trash(items.map((i) => i.path)));
    } catch (err) {
      toast(`No se pudo borrar: ${errorText(err)}`, 'error');
    }
    await store().refresh(paneKey);
  };

  const copyPaths = (items: RemoteEntry[]) => {
    writeClipboardText(items.map((i) => i.path).join('\n'));
    toast(items.length === 1 ? 'Ruta copiada' : `${items.length} rutas copiadas`, 'success');
  };

  const onRowContextMenu = (e: MouseEvent, entry: RemoteEntry) => {
    e.preventDefault();
    const items = selectedSet.has(entry.path) ? selectedEntries() : [entry];
    if (!selectedSet.has(entry.path)) select([entry.path], entry.path);
    const single = items.length === 1 ? items[0]! : null;
    const canTransfer = sessionOfPane(paneKey) !== null;
    const menu: MenuItem[] = [
      ...(single?.type === 'dir' ? [{ label: 'Abrir', icon: <FolderInput size={13} />, shortcut: 'Intro', onSelect: () => navigate(single.path) }] : []),
      {
        label: isRemote ? 'Descargar' : 'Subir',
        icon: isRemote ? <Download size={13} /> : <Upload size={13} />,
        disabled: !canTransfer,
        onSelect: () => void transfer(items),
      },
      ...(single && single.type !== 'dir'
        ? [
            {
              label: 'Vista previa',
              icon: <ScanEye size={13} />,
              ...(openWith === 'vela' ? { shortcut: 'Espacio' } : {}),
              onSelect: () => preview(single),
            },
            ...(isRemote
              ? [
                  {
                    label: 'Editar en Vela FTP',
                    icon: <FileCode size={13} />,
                    ...(openWith === 'vela' ? { shortcut: 'F4' } : {}),
                    onSelect: () => edit(single),
                  },
                  {
                    label: 'Abrir con la aplicación predeterminada',
                    icon: <ExternalLink size={13} />,
                    ...(openWith === 'system' ? { shortcut: 'F4' } : {}),
                    onSelect: () => openWithSystem(single, 'edit'),
                  },
                ]
              : []),
            {
              label: isRemote ? 'Comparar con el fichero local' : 'Comparar con el fichero del servidor',
              icon: <GitCompareArrows size={13} />,
              disabled: !counterpart(single),
              onSelect: () => diff(single),
            },
          ]
        : []),
      ...(!isRemote && single?.type === 'dir' && sessionOfPane(paneKey)
        ? [
            {
              label: `Vigilar y subir cambios a ${remotePaths.join(otherPane()?.path ?? '/', single.name)}`,
              icon: <Radar size={13} />,
              onSelect: () => watchFolder(single.path, remotePaths.join(otherPane()?.path ?? '/', single.name)),
            },
          ]
        : []),
      ...(!isRemote && single
        ? [
            { label: 'Abrir con la aplicación predeterminada', icon: <ExternalLink size={13} />, onSelect: () => void call(window.api.local.open(single.path)) },
            { label: 'Mostrar en el explorador', icon: <FolderInput size={13} />, onSelect: () => void call(window.api.local.reveal(single.path)) },
          ]
        : []),
      { kind: 'separator' },
      { label: 'Renombrar', icon: <Pencil size={13} />, shortcut: 'F2', disabled: !single, onSelect: () => single && void rename(single) },
      ...(isRemote && single
        ? [
            {
              label: 'Permisos…',
              icon: <Lock size={13} />,
              onSelect: () => useDialogStore.getState().open({ kind: 'chmod', sessionId: sessionId!, path: single.path, mode: single.mode }),
            },
          ]
        : []),
      { label: 'Copiar ruta', icon: <Copy size={13} />, onSelect: () => copyPaths(items) },
      { kind: 'separator' },
      { label: isRemote ? 'Borrar' : 'Mover a la papelera', icon: <Trash2 size={13} />, shortcut: 'Supr', danger: true, onSelect: () => void remove(items) },
    ];
    showMenu(e.clientX, e.clientY, menu);
  };

  const onBackgroundContextMenu = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('.vela-file-row')) return;
    e.preventDefault();
    select([], null);
    showMenu(e.clientX, e.clientY, [
      { label: 'Nueva carpeta', icon: <FolderPlus size={13} />, onSelect: () => void mkdir() },
      { label: 'Refrescar', icon: <RefreshCw size={13} />, shortcut: 'F5', onSelect: refresh },
      { label: pane.showHidden ? 'Ocultar ficheros ocultos' : 'Mostrar ficheros ocultos', icon: pane.showHidden ? <EyeOff size={13} /> : <Eye size={13} />, onSelect: () => store().toggleHidden(paneKey) },
      ...(!isRemote && sessionOfPane(paneKey) && otherPane()
        ? [
            {
              label: `Vigilar esta carpeta y subir cambios a ${otherPane()!.path}`,
              icon: <Radar size={13} />,
              onSelect: () => watchFolder(pane.path, otherPane()!.path),
            },
          ]
        : []),
      { kind: 'separator' },
      { label: 'Copiar ruta de esta carpeta', icon: <Copy size={13} />, onSelect: () => copyPaths([{ path: pane.path } as RemoteEntry]) },
    ]);
  };

  // ── Arrastrar y soltar ────────────────────────────────────────────────
  const onRowDragStart = (e: DragEvent, entry: RemoteEntry) => {
    const paths = selectedSet.has(entry.path) ? pane.selected : [entry.path];
    if (!selectedSet.has(entry.path)) select([entry.path], entry.path);
    const payload: DragPayload = { paneKey, paths };
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'copy';
  };

  const acceptsDrag = (e: DragEvent) => {
    const types = Array.from(e.dataTransfer.types);
    if (types.includes(DRAG_MIME)) return true;
    // Ficheros del explorador del SO: solo tiene sentido soltarlos en remoto.
    return isRemote && types.includes('Files');
  };

  const handleDrop = async (e: DragEvent, targetDir: string) => {
    e.preventDefault();
    setDropTarget(null);
    setDragOverPane(false);
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (raw) {
      const payload = JSON.parse(raw) as DragPayload;
      if (payload.paneKey === paneKey) return; // Mover dentro del mismo panel: fuera de alcance por ahora.
      const source = store().panes[payload.paneKey];
      if (!source) return;
      const items = source.entries.filter((x) => payload.paths.includes(x.path));
      const sourceSession = sessionOfPane(payload.paneKey);
      if (isRemote && sessionId) await uploadEntries(sessionId, items, targetDir);
      if (!isRemote && isRemotePane(payload.paneKey) && sourceSession) await downloadEntries(sourceSession, items, targetDir);
      return;
    }
    if (isRemote && sessionId && e.dataTransfer.files.length > 0) {
      await uploadDroppedFiles(sessionId, e.dataTransfer.files, targetDir, (p) =>
        window.api.local.list(p).then((r) => r.ok),
      );
    }
  };

  const onRowDragOver = (e: DragEvent, entry: RemoteEntry) => {
    if (!acceptsDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOverPane(true);
    setDropTarget(entry.type === 'dir' ? entry.path : null);
  };

  const onRowDrop = (e: DragEvent, entry: RemoteEntry) => {
    e.stopPropagation();
    void handleDrop(e, entry.type === 'dir' ? entry.path : pane.path);
  };

  // ── Teclado ────────────────────────────────────────────────────────────
  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const index = entries.findIndex((x) => x.path === pane.anchor);
    const moveTo = (i: number) => {
      const target = entries[Math.max(0, Math.min(entries.length - 1, i))];
      if (!target) return;
      e.preventDefault();
      if (e.shiftKey && pane.anchor) {
        const from = entries.findIndex((x) => x.path === pane.anchor);
        const to = entries.indexOf(target);
        const [a, b] = from < to ? [from, to] : [to, from];
        store().setSelection(paneKey, entries.slice(a, b + 1).map((x) => x.path), pane.anchor);
      } else {
        select([target.path], target.path);
      }
      listRef.current?.scrollToRow({ index: entries.indexOf(target), align: 'smart' });
    };
    switch (e.key) {
      case 'ArrowDown':
        return moveTo(index + 1);
      case 'ArrowUp':
        return moveTo(index - 1);
      case 'Home':
        return moveTo(0);
      case 'End':
        return moveTo(entries.length - 1);
      case 'PageDown':
        return moveTo(index + 20);
      case 'PageUp':
        return moveTo(index - 20);
      case 'Enter': {
        const current = entries[index];
        if (current) open(current);
        return;
      }
      case 'Backspace':
        e.preventDefault();
        return up();
      case 'Delete':
        e.preventDefault();
        return void remove(selectedEntries());
      case 'F2': {
        const current = selectedEntries();
        if (current.length === 1) void rename(current[0]!);
        return;
      }
      case 'F5':
        e.preventDefault();
        return refresh();
      case ' ': {
        const current = selectedEntries();
        if (current.length !== 1) return;
        e.preventDefault();
        return viewEntry(current[0]!);
      }
      case 'F4': {
        const current = selectedEntries();
        if (current.length !== 1 || (!isRemote && openWith === 'vela')) return;
        e.preventDefault();
        return editEntry(current[0]!);
      }
      default:
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
          e.preventDefault();
          select(
            entries.map((x) => x.path),
            entries[0]?.path ?? null,
          );
          return;
        }
        // Buscar por nombre según se teclea, como los exploradores.
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const key = e.key.toLowerCase();
          const now = Date.now();
          const state = searchRef.current;
          const continuing = now - state.at < TYPEAHEAD_TIMEOUT;
          // Repetir la misma letra cicla entre las coincidencias (como pulsar
          // "r" varias veces para pasar de un «render» al siguiente); cualquier
          // otra letra amplía la búsqueda ("o" y luego "r" busca "or").
          const repeatingSameLetter = continuing && state.buffer.length > 0 && [...state.buffer].every((c) => c === key);
          const buffer = continuing && !repeatingSameLetter ? state.buffer + key : key;
          const anchor = repeatingSameLetter ? index : continuing ? state.anchor : index;
          searchRef.current = { buffer, at: now, anchor };
          const start = anchor + 1;
          const match = [...entries.slice(start), ...entries.slice(0, start)].find((x) => x.name.toLowerCase().startsWith(buffer));
          if (match) moveTo(entries.indexOf(match));
        }
    }
  };

  /** Como en FileZilla: clic derecho en la cabecera para mostrar u ocultar columnas. */
  const onHeaderContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    const toggle = (id: FileColumnId) => {
      const next = chosenColumns.includes(id) ? chosenColumns.filter((c) => c !== id) : [...chosenColumns, id];
      useUiStore.getState().setColumns(side, next);
      void call(window.api.settings.set(isRemote ? 'ui:columns-remote' : 'ui:columns-local', next)).catch((err) => toast(errorText(err), 'error'));
    };
    showMenu(
      e.clientX,
      e.clientY,
      availableColumns(side, window.api.platform).map((id) => ({
        label: COLUMNS[id].label,
        icon: columns.includes(id) ? <Check size={13} /> : <span className="inline-block w-[13px]" />,
        onSelect: () => toggle(id),
      })),
    );
  };

  const header = (key: SortKey, label: string, className = '') => (
    <button className={`truncate text-left hover:text-[var(--vela-fg)] ${className}`} onClick={() => store().setSort(paneKey, key)}>
      {label}
      {pane.sort.key === key ? (pane.sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
    </button>
  );

  return (
    <section
      className={`flex min-h-0 min-w-0 flex-1 flex-col ${focused ? '' : 'opacity-[0.97]'}`}
      onMouseDown={onFocus}
      aria-label={isRemote ? 'Ficheros remotos' : 'Ficheros locales'}
    >
      <div className="flex items-center gap-1 border-b border-[var(--vela-border)] px-1.5 py-1">
        <button className="vf-icon-btn" title="Atrás" disabled={pane.history.length === 0} onClick={() => void store().back(paneKey)}>
          <ArrowLeft size={14} />
        </button>
        <button className="vf-icon-btn" title="Subir un nivel (Retroceso)" disabled={!ops.parent(pane.path)} onClick={up}>
          <ArrowUp size={14} />
        </button>
        {!isRemote && roots.length > 0 && (
          <select
            className="vf-input w-auto py-1"
            value=""
            title="Unidades y carpetas"
            onChange={(e) => e.target.value && navigate(e.target.value)}
          >
            <option value="">▾</option>
            {roots.map((r) => (
              <option key={r.path} value={r.path}>
                {r.label}
              </option>
            ))}
          </select>
        )}
        <PathInput paneKey={paneKey} path={pane.path} siteId={paneSiteId ?? null} onNavigate={navigate} />
        {isRemote && sessionId && paneSiteId && (
          <button
            className={`vf-icon-btn ${isBookmarked ? 'text-[var(--vela-accent)]' : ''}`}
            title={isBookmarked ? 'Carpeta en marcadores' : 'Añadir marcador (Ctrl+D)'}
            onClick={() => void addBookmarkFor(paneSiteId, pane.path)}
          >
            <Star size={14} fill={isBookmarked ? 'currentColor' : 'none'} />
          </button>
        )}
        <button className="vf-icon-btn" title="Nueva carpeta" onClick={() => void mkdir()}>
          <FolderPlus size={14} />
        </button>
        <button className="vf-icon-btn" title="Refrescar (F5)" onClick={refresh}>
          <RefreshCw size={14} className={pane.loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Cabecera y filas se desplazan juntas cuando las columnas no caben. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-x-auto overflow-y-hidden">
      <div className="flex min-h-0 flex-1 flex-col" style={{ minWidth }}>
      <div
        className="grid gap-2 border-b border-[var(--vela-border)] px-2 py-1 text-[10px] uppercase tracking-wide text-[var(--vela-fg-muted)]"
        style={{ gridTemplateColumns: grid }}
        title="Clic derecho para elegir las columnas"
        onContextMenu={onHeaderContextMenu}
      >
        {header('name', 'Nombre')}
        {columns.map((id) => header(id, COLUMNS[id].label, COLUMNS[id].align === 'right' ? 'text-right' : ''))}
      </div>

      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onContextMenu={onBackgroundContextMenu}
        onMouseDown={(e) => {
          if (!(e.target as HTMLElement).closest('.vela-file-row')) select([], null);
        }}
        onDragOver={(e) => {
          if (!acceptsDrag(e)) return;
          e.preventDefault();
          setDragOverPane(true);
          setDropTarget(null);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setDragOverPane(false);
            setDropTarget(null);
          }
        }}
        onDrop={(e) => void handleDrop(e, pane.path)}
        className={`relative min-h-0 flex-1 outline-none ${dragOverPane ? 'bg-[var(--vela-sidebar-hover-bg)]' : ''}`}
      >
        {pane.error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-xs">
            <span className="text-[var(--vela-danger)]">{pane.error}</span>
            <button className="vf-btn" onClick={refresh}>
              Reintentar
            </button>
          </div>
        ) : entries.length === 0 && !pane.loading ? (
          <div className="flex h-full items-center justify-center text-xs text-[var(--vela-fg-muted)]">Carpeta vacía</div>
        ) : (
          <List
            listRef={listRef}
            rowComponent={Row}
            rowCount={entries.length}
            rowHeight={ROW_HEIGHT}
            rowProps={{
              entries,
              columns,
              grid,
              compare,
              selected: selectedSet,
              isRemote,
              dropTarget,
              onRowMouseDown,
              onRowDoubleClick: open,
              onRowContextMenu,
              onRowDragStart,
              onRowDragOver,
              onRowDrop,
            }}
            style={{ height: '100%' }}
          />
        )}
      </div>
      </div>
      </div>

      <div className="flex justify-between border-t border-[var(--vela-border)] px-2 py-0.5 text-[10px] text-[var(--vela-fg-muted)]">
        <span>
          {entries.filter((x) => x.type === 'dir').length} carpetas, {entries.filter((x) => x.type !== 'dir').length} ficheros
        </span>
        {pane.selected.length > 0 && (
          <span>
            {pane.selected.length} seleccionados · {formatSize(selectedEntries().reduce((n, x) => n + (x.type === 'dir' ? 0 : x.size), 0))}
          </span>
        )}
      </div>
    </section>
  );
}

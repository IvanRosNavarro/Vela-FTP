import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ClipboardPaste, Copy, Eraser, FolderSymlink, Search, TextSelect, X } from 'lucide-react';
import { ensureRuntime, type TerminalRuntime } from '../../lib/terminal/runtime';
import { remotePaneKey, usePanesStore } from '../../stores/panesStore';
import type { TerminalTab } from '../../stores/terminalsStore';
import { useContextMenu } from '../ContextMenu';
import { ServerStatsBar } from './ServerStatsBar';

const MOD = window.api.platform === 'darwin' ? '⌘' : 'Ctrl';

function SearchBar({ runtime, onClose }: { runtime: TerminalRuntime; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [missing, setMissing] = useState(false);
  const find = (backwards: boolean) => {
    if (!query) return;
    const found = backwards ? runtime.search.findPrevious(query) : runtime.search.findNext(query);
    setMissing(!found);
  };
  return (
    <div className="absolute right-3 top-2 z-10 flex items-center gap-1 rounded-md border border-[var(--vela-border)] bg-[var(--vela-bg-elevated)] p-1 shadow-lg">
      <Search size={12} className="ml-1 text-[var(--vela-fg-muted)]" />
      <input
        autoFocus
        className={`vf-input w-48 py-0.5 text-xs ${missing ? 'text-[var(--vela-danger)]' : ''}`}
        placeholder="Buscar en la terminal"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setMissing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            find(e.shiftKey);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
      />
      <button className="vf-icon-btn" title="Anterior (Mayús+Intro)" onClick={() => find(true)}>
        <ArrowUp size={12} />
      </button>
      <button className="vf-icon-btn" title="Siguiente (Intro)" onClick={() => find(false)}>
        <ArrowDown size={12} />
      </button>
      <button className="vf-icon-btn" title="Cerrar (Esc)" onClick={onClose}>
        <X size={12} />
      </button>
    </div>
  );
}

/**
 * Hueco donde se pinta una terminal. El xterm no es de React: se engancha al
 * montar y se suelta al desmontar, así que pasar del panel a una pestaña no
 * pierde ni la conexión ni lo que había en pantalla.
 */
export function TerminalView({ tab }: { tab: TerminalTab }) {
  const ref = useRef<HTMLDivElement>(null);
  const [searching, setSearching] = useState(false);
  // Una por pestaña: el resto de campos de `tab` cambia sin tocar la terminal.
  const runtime = useMemo(() => ensureRuntime(tab), [tab.id]);
  const remotePath = usePanesStore((s) => s.panes[remotePaneKey(tab.sessionId)]?.path ?? null);
  const showMenu = useContextMenu((s) => s.show);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    runtime.attach(container);
    runtime.onSearchRequest = () => setSearching(true);
    runtime.focus();
    return () => {
      runtime.onSearchRequest = null;
      runtime.detach(container);
    };
  }, [runtime]);

  // El disco que se mide es el de la carpeta que se ve en el panel remoto.
  useEffect(() => runtime.setDiskPath(remotePath), [runtime, remotePath]);

  const closeSearch = () => {
    setSearching(false);
    runtime.search.clearDecorations();
    runtime.focus();
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const hasSelection = runtime.term.hasSelection();
    showMenu(e.clientX, e.clientY, [
      { label: 'Copiar', icon: <Copy size={13} />, shortcut: `${MOD}+Mayús+C`, disabled: !hasSelection, onSelect: () => runtime.copySelection() },
      { label: 'Pegar', icon: <ClipboardPaste size={13} />, shortcut: `${MOD}+Mayús+V`, disabled: !runtime.isOpen, onSelect: () => void runtime.pasteFromClipboard() },
      { label: 'Seleccionar todo', icon: <TextSelect size={13} />, onSelect: () => runtime.term.selectAll() },
      { kind: 'separator' },
      { label: 'Buscar…', icon: <Search size={13} />, shortcut: `${MOD}+Mayús+F`, onSelect: () => setSearching(true) },
      { label: 'Limpiar la pantalla', icon: <Eraser size={13} />, onSelect: () => runtime.clear() },
      ...(remotePath
        ? [
            { kind: 'separator' as const },
            {
              label: `Ir a ${remotePath}`,
              icon: <FolderSymlink size={13} />,
              disabled: !runtime.isOpen,
              onSelect: () => runtime.goTo(remotePath),
            },
          ]
        : []),
    ]);
  };

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col" style={{ background: 'var(--vela-bg)' }}>
      {searching && <SearchBar runtime={runtime} onClose={closeSearch} />}
      <div ref={ref} className="min-h-0 min-w-0 flex-1 overflow-hidden py-1 pl-2" onContextMenu={onContextMenu} />
      <ServerStatsBar runtime={runtime} />
    </div>
  );
}

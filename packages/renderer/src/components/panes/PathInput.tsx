import { useEffect, useMemo, useRef, useState } from 'react';
import { Clock, Server, Terminal } from 'lucide-react';
import type { PathVisit } from '@vela-ftp/shared';
import { fuzzyFilter } from 'vela-kit/ui';
import { useDialogStore } from '../../stores/dialogStore';
import { useSessionsStore } from '../../stores/sessionsStore';
import { useSitesStore } from '../../stores/sitesStore';

interface Suggestion {
  id: string;
  label: string;
  detail: string;
  icon: 'site' | 'history';
  run: () => void;
}

interface PathInputProps {
  paneKey: string;
  path: string;
  /** Sitio de este panel (remoto), para el historial con `#`. */
  siteId: string | null;
  onNavigate: (path: string) => void;
}

const HINTS = [
  { prefix: '>', text: 'comandos' },
  { prefix: '@', text: 'sitios' },
  { prefix: '#', text: 'carpetas visitadas' },
];

/**
 * Barra de ruta con prefijos, como la URL bar de Vela Browser:
 * `>` abre la paleta, `@` busca un sitio para conectar, `#` busca en el
 * historial de carpetas del sitio.
 */
export function PathInput({ paneKey, path, siteId, onNavigate }: PathInputProps) {
  const [value, setValue] = useState(path);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const [history, setHistory] = useState<PathVisit[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const sites = useSitesStore((s) => s.sites);

  useEffect(() => {
    if (!focused) setValue(path);
  }, [path, focused]);

  const mode = value.startsWith('@') ? 'site' : value.startsWith('#') ? 'history' : null;
  const query = mode ? value.slice(1).trim() : '';

  useEffect(() => {
    if (mode !== 'history' || !siteId) return;
    let cancelled = false;
    void window.api.bookmarks.history(siteId, 200).then((res) => {
      if (!cancelled && res.ok) setHistory(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [mode, siteId]);

  const suggestions = useMemo<Suggestion[]>(() => {
    if (mode === 'site') {
      const list = query ? fuzzyFilter(sites, query, (s) => [s.name, s.host]) : sites;
      return list.slice(0, 12).map((s) => ({
        id: s.id,
        label: s.name,
        detail: s.host,
        icon: 'site',
        run: () => void useSessionsStore.getState().connect(s.id),
      }));
    }
    if (mode === 'history') {
      const list = query ? fuzzyFilter(history, query, (h) => h.path) : history;
      return list.slice(0, 12).map((h) => ({
        id: h.path,
        label: h.path,
        detail: new Date(h.visitedAt).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }),
        icon: 'history',
        run: () => onNavigate(h.path),
      }));
    }
    return [];
  }, [mode, query, sites, history, onNavigate]);

  useEffect(() => setActive(0), [value]);

  const finish = () => {
    setValue(path);
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      finish();
      return;
    }
    if (value === '>' || (value.startsWith('>') && e.key === 'Enter')) {
      e.preventDefault();
      useDialogStore.getState().open({ kind: 'palette', initialQuery: value.slice(1) });
      finish();
      return;
    }
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        suggestions[active]?.run();
        finish();
        return;
      }
    }
    if (e.key === 'Enter' && !mode && value.trim()) {
      onNavigate(value.trim());
      inputRef.current?.blur();
    }
  };

  const showHints = focused && value === '';
  const showSuggestions = focused && mode !== null;

  return (
    <div className="relative flex-1">
      <input
        ref={inputRef}
        data-path-input={paneKey}
        className="vf-input py-1 font-mono"
        value={value}
        spellCheck={false}
        aria-label="Ruta"
        aria-autocomplete="list"
        onChange={(e) => setValue(e.target.value)}
        onFocus={(e) => {
          setFocused(true);
          e.target.select();
        }}
        onBlur={() => {
          // Dejar que un clic en una sugerencia llegue antes de ocultarlas.
          setTimeout(() => setFocused(false), 120);
        }}
        onKeyDown={onKeyDown}
        placeholder="Ruta · > comandos · @ sitios · # historial"
      />
      {value.startsWith('>') && focused && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 flex items-center gap-2 rounded-md border border-[var(--vela-border)] bg-[var(--vela-bg-elevated)] px-3 py-2 text-xs shadow-xl">
          <Terminal size={13} /> Intro para abrir la paleta de comandos
        </div>
      )}
      {showHints && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 flex gap-3 rounded-md border border-[var(--vela-border)] bg-[var(--vela-bg-elevated)] px-3 py-2 text-[11px] text-[var(--vela-fg-muted)] shadow-xl">
          {HINTS.map((h) => (
            <span key={h.prefix}>
              <kbd className="rounded border border-[var(--vela-border)] px-1 font-mono">{h.prefix}</kbd> {h.text}
            </span>
          ))}
        </div>
      )}
      {showSuggestions && (
        <div role="listbox" className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-md border border-[var(--vela-border)] bg-[var(--vela-bg-elevated)] py-1 shadow-xl">
          {suggestions.length === 0 && (
            <div className="px-3 py-2 text-xs text-[var(--vela-fg-muted)]">
              {mode === 'history' && !siteId ? 'El historial es de las carpetas remotas: conéctate a un sitio' : 'Sin coincidencias'}
            </div>
          )}
          {suggestions.map((s, i) => (
            <button
              key={s.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => {
                s.run();
                finish();
              }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${i === active ? 'bg-[var(--vela-sidebar-active-bg)]' : ''}`}
            >
              {s.icon === 'site' ? <Server size={13} className="shrink-0" /> : <Clock size={13} className="shrink-0" />}
              <span className="min-w-0 flex-1 truncate font-mono">{s.label}</span>
              <span className="shrink-0 text-[10px] text-[var(--vela-fg-muted)]">{s.detail}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GitCompareArrows, Link2, Plus, Unplug, X } from 'lucide-react';
import { SiteIcon } from './SiteIcon';
import { QUICK_CONNECT_SITES, mostUsedFirst } from '../lib/quickConnect';
import { compareListings, type CompareStatus } from '../lib/compare';
import { toggleSyncBrowsing, useSyncBrowsing } from '../lib/syncBrowsing';
import { useDialogStore } from '../stores/dialogStore';
import { localPaneKey, remotePaneKey, usePanesStore } from '../stores/panesStore';
import { useSessionsStore } from '../stores/sessionsStore';
import { useSitesStore } from '../stores/sitesStore';
import { useUiStore } from '../stores/uiStore';
import { COMPARE_COLORS, FilePane } from './panes/FilePane';
import { call } from '../lib/ipc';

/** Límites del reparto: ningún panel puede quedarse sin sitio. */
const MIN_RATIO = 0.15;
const MAX_RATIO = 0.85;

function RemotePlaceholder() {
  const sites = useSitesStore((s) => s.sites);
  const connect = useSessionsStore((s) => s.connect);
  const connecting = useSessionsStore((s) => s.connecting);
  const openDialog = useDialogStore((s) => s.open);
  const quick = useMemo(() => mostUsedFirst(sites).slice(0, QUICK_CONNECT_SITES), [sites]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-xs text-[var(--vela-fg-muted)]">
      <Unplug size={28} className="opacity-50" />
      <p>Sin conexión</p>
      <div className="flex max-w-sm flex-wrap justify-center gap-2">
        {quick.map((site) => (
          <button
            key={site.id}
            className="vf-btn"
            disabled={connecting !== null}
            title={site.uses > 0 ? `${site.host} · ${site.uses} ${site.uses === 1 ? 'conexión' : 'conexiones'}` : site.host}
            onClick={() => void connect(site.id)}
          >
            <SiteIcon protocol={site.protocol} size={12} /> {site.name}
          </button>
        ))}
        <button className="vf-btn-primary" onClick={() => openDialog({ kind: 'siteEditor', site: null })}>
          <Plus size={12} /> Nuevo sitio
        </button>
      </div>
    </div>
  );
}

function CompareLegend() {
  const item = (status: CompareStatus, label: string) => (
    <span className="flex items-center gap-1">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: COMPARE_COLORS[status] }} />
      {label}
    </span>
  );
  return (
    <div className="flex items-center gap-4 border-b border-[var(--vela-border)] px-3 py-1 text-[10px] text-[var(--vela-fg-muted)]">
      <span className="font-semibold uppercase tracking-wider">Comparando</span>
      {item('only', 'Solo en un lado')}
      {item('newer', 'Más reciente')}
      {item('different', 'Distinto tamaño')}
    </div>
  );
}

export function Workspace() {
  const sessions = useSessionsStore((s) => s.sessions);
  const activeId = useSessionsStore((s) => s.activeId);
  const activate = useSessionsStore((s) => s.activate);
  const disconnect = useSessionsStore((s) => s.disconnect);
  const focused = useUiStore((s) => s.focusedPane);
  const setFocused = useUiStore((s) => s.setFocusedPane);
  const compareMode = useUiStore((s) => s.compareMode);
  const toggleCompare = useUiStore((s) => s.toggleCompare);
  const syncBrowsing = useUiStore((s) => s.syncBrowsing);
  const localEntries = usePanesStore((s) => s.panes[localPaneKey(activeId)]?.entries);
  const remoteEntries = usePanesStore((s) => (activeId ? s.panes[remotePaneKey(activeId)]?.entries : undefined));

  useSyncBrowsing();

  // Reparto entre el panel local y el remoto, en proporción: al cambiar el
  // tamaño de la ventana cada uno conserva su parte.
  const [ratio, setRatio] = useState(0.5);
  const panesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void call(window.api.settings.get('ui:panes-ratio')).then(setRatio).catch(() => undefined);
  }, []);
  const dragRatio = useCallback((clientX: number) => {
    const rect = panesRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    setRatio(Math.min(MAX_RATIO, Math.max(MIN_RATIO, (clientX - rect.left) / rect.width)));
  }, []);

  const dragging = useRef(false);

  const comparison = useMemo(
    () => (compareMode && localEntries && remoteEntries ? compareListings(localEntries, remoteEntries) : null),
    [compareMode, localEntries, remoteEntries],
  );

  return (
    <main id="vela-content" className="flex min-h-0 min-w-0 flex-1 flex-col">
      {sessions.length > 0 && (
        <div className="flex items-end gap-0.5 border-b border-[var(--vela-border)] px-1 pt-1">
          <div className="flex min-w-0 flex-1 items-end gap-0.5" role="tablist" aria-label="Sesiones">
          {sessions.map((session) => (
            <div
              key={session.sessionId}
              role="tab"
              aria-selected={session.sessionId === activeId}
              onMouseDown={() => activate(session.sessionId)}
              onAuxClick={(e) => e.button === 1 && void disconnect(session.sessionId)}
              className={`group flex max-w-[220px] cursor-default items-center gap-2 rounded-t-md px-3 py-1 text-xs ${
                session.sessionId === activeId ? 'bg-[var(--vela-tab-active-bg)] text-[var(--vela-fg)]' : 'text-[var(--vela-fg-muted)] hover:bg-[var(--vela-sidebar-hover-bg)]'
              }`}
              title={`${session.protocol}://${session.host}`}
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--vela-success)]" />
              <span className="truncate">{session.siteName}</span>
              <button
                className="rounded p-0.5 opacity-50 hover:bg-black/20 hover:opacity-100"
                title="Desconectar"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => void disconnect(session.sessionId)}
              >
                <X size={11} />
              </button>
            </div>
          ))}
          </div>
          <div className="flex items-center gap-0.5 pb-1">
            <button
              className={`vf-icon-btn ${compareMode ? 'bg-[var(--vela-sidebar-active-bg)] text-[var(--vela-accent)]' : ''}`}
              aria-pressed={compareMode}
              title="Comparar carpetas (Ctrl+O)"
              onClick={toggleCompare}
            >
              <GitCompareArrows size={14} />
            </button>
            <button
              className={`vf-icon-btn ${syncBrowsing ? 'bg-[var(--vela-sidebar-active-bg)] text-[var(--vela-accent)]' : ''}`}
              aria-pressed={syncBrowsing !== null}
              title={syncBrowsing ? `Navegación sincronizada: ${syncBrowsing.localBase} ↔ ${syncBrowsing.remoteBase} (Ctrl+Y)` : 'Navegación sincronizada (Ctrl+Y)'}
              onClick={toggleSyncBrowsing}
            >
              <Link2 size={14} />
            </button>
          </div>
        </div>
      )}
      {comparison && <CompareLegend />}
      <div ref={panesRef} className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0" style={{ flex: `0 0 ${ratio * 100}%` }}>
          {sessions.length === 0 ? (
            <FilePane paneKey="local" sessionId={null} focused={focused === 'local'} onFocus={() => setFocused('local')} compare={null} />
          ) : (
            // Como en FileZilla, cada pestaña recuerda su propia carpeta local.
            sessions.map((session) => (
              <div key={session.sessionId} className={session.sessionId === activeId ? 'flex min-h-0 min-w-0 flex-1' : 'hidden'}>
                <FilePane
                  paneKey={localPaneKey(session.sessionId)}
                  sessionId={session.sessionId}
                  focused={focused === 'local'}
                  onFocus={() => setFocused('local')}
                  compare={session.sessionId === activeId ? (comparison?.local ?? null) : null}
                />
              </div>
            ))
          )}
        </div>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Repartir el espacio entre los paneles"
          aria-valuenow={Math.round(ratio * 100)}
          tabIndex={0}
          className="w-1 shrink-0 cursor-col-resize bg-[var(--vela-border)] transition-colors hover:bg-[var(--vela-accent)]"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            dragging.current = true;
          }}
          onPointerMove={(e) => {
            if (dragging.current) dragRatio(e.clientX);
          }}
          onPointerUp={() => {
            if (!dragging.current) return;
            dragging.current = false;
            void window.api.settings.set('ui:panes-ratio', ratio);
          }}
          onDoubleClick={() => {
            setRatio(0.5);
            void window.api.settings.set('ui:panes-ratio', 0.5);
          }}
          onKeyDown={(e) => {
            const step = e.key === 'ArrowLeft' ? -0.02 : e.key === 'ArrowRight' ? 0.02 : 0;
            if (step === 0) return;
            e.preventDefault();
            const next = Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio + step));
            setRatio(next);
            void window.api.settings.set('ui:panes-ratio', next);
          }}
          title="Arrastra para repartir el espacio · doble clic para igualarlos"
        />
        {sessions.map((session) => (
          // Cada sesión conserva su panel montado para no perder selección ni scroll.
          <div key={session.sessionId} className={session.sessionId === activeId ? 'flex min-h-0 min-w-0 flex-1' : 'hidden'}>
            <FilePane
              paneKey={remotePaneKey(session.sessionId)}
              sessionId={session.sessionId}
              focused={focused === 'remote'}
              onFocus={() => setFocused('remote')}
              compare={session.sessionId === activeId ? (comparison?.remote ?? null) : null}
            />
          </div>
        ))}
        {sessions.length === 0 && <RemotePlaceholder />}
      </div>
    </main>
  );
}

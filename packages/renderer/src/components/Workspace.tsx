import { useState } from 'react';
import { Plug, Plus, Unplug, X } from 'lucide-react';
import { useDialogStore } from '../stores/dialogStore';
import { remotePaneKey } from '../stores/panesStore';
import { useSessionsStore } from '../stores/sessionsStore';
import { useSitesStore } from '../stores/sitesStore';
import { FilePane } from './panes/FilePane';

function RemotePlaceholder() {
  const sites = useSitesStore((s) => s.sites);
  const connect = useSessionsStore((s) => s.connect);
  const connecting = useSessionsStore((s) => s.connecting);
  const openDialog = useDialogStore((s) => s.open);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-xs text-[var(--vela-fg-muted)]">
      <Unplug size={28} className="opacity-50" />
      <p>Sin conexión</p>
      <div className="flex max-w-sm flex-wrap justify-center gap-2">
        {sites.slice(0, 6).map((site) => (
          <button key={site.id} className="vf-btn" disabled={connecting !== null} onClick={() => void connect(site.id)}>
            <Plug size={12} /> {site.name}
          </button>
        ))}
        <button className="vf-btn-primary" onClick={() => openDialog({ kind: 'siteEditor', site: null })}>
          <Plus size={12} /> Nuevo sitio
        </button>
      </div>
    </div>
  );
}

export function Workspace() {
  const sessions = useSessionsStore((s) => s.sessions);
  const activeId = useSessionsStore((s) => s.activeId);
  const activate = useSessionsStore((s) => s.activate);
  const disconnect = useSessionsStore((s) => s.disconnect);
  const [focused, setFocused] = useState<'local' | 'remote'>('local');

  return (
    <main id="vela-content" className="flex min-h-0 min-w-0 flex-1 flex-col">
      {sessions.length > 0 && (
        <div className="flex items-end gap-0.5 border-b border-[var(--vela-border)] px-1 pt-1" role="tablist" aria-label="Sesiones">
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
      )}
      <div className="flex min-h-0 flex-1">
        <FilePane paneKey="local" sessionId={activeId} focused={focused === 'local'} onFocus={() => setFocused('local')} />
        <div className="w-px shrink-0 bg-[var(--vela-border)]" />
        {sessions.map((session) => (
          // Cada sesión conserva su panel montado para no perder selección ni scroll.
          <div key={session.sessionId} className={session.sessionId === activeId ? 'flex min-h-0 min-w-0 flex-1' : 'hidden'}>
            <FilePane
              paneKey={remotePaneKey(session.sessionId)}
              sessionId={session.sessionId}
              focused={focused === 'remote'}
              onFocus={() => setFocused('remote')}
            />
          </div>
        ))}
        {sessions.length === 0 && <RemotePlaceholder />}
      </div>
    </main>
  );
}

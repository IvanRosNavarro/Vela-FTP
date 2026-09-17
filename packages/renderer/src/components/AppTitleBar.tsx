import { useEffect, useState } from 'react';
import { ArrowDownCircle } from 'lucide-react';
import { IPC_EVENTS } from '@vela-ftp/shared';
import { NO_DRAG_STYLE, TitleBar } from 'vela-kit/ui';
import { openUpdatesSettings } from '../lib/updates';
import { useUpdatesStore } from '../stores/updatesStore';

const PLATFORM = window.api.platform;

function useWindowMaximized(): boolean {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.api.window.isMaximized().then((res) => {
      if (!cancelled && res.ok) setMaximized(res.data);
    });
    const off = window.api.on(IPC_EVENTS.WINDOW_MAXIMIZED_CHANGED, ({ maximized: next }) => setMaximized(next));
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  return maximized;
}

/** Aviso persistente de versión nueva: el toast desaparece y este no. */
function UpdateBadge() {
  const status = useUpdatesStore((s) => s.status);
  if (!status?.version) return null;
  const label =
    status.phase === 'downloaded'
      ? 'Reiniciar para actualizar'
      : status.phase === 'downloading'
        ? `Descargando ${status.percent}%`
        : status.phase === 'available'
          ? `Versión ${status.version} disponible`
          : null;
  if (!label) return null;
  return (
    <button
      style={NO_DRAG_STYLE}
      onClick={openUpdatesSettings}
      className="mx-2 flex items-center gap-1 rounded-full bg-[var(--vela-accent)] px-2 py-0.5 text-[10px] font-medium text-[var(--vela-accent-fg)] hover:brightness-110"
    >
      <ArrowDownCircle size={11} /> {label}
    </button>
  );
}

export function AppTitleBar() {
  const maximized = useWindowMaximized();

  return (
    <TitleBar
      platform={PLATFORM}
      maximized={maximized}
      controls={{
        onMinimize: () => void window.api.window.minimize(),
        onToggleMaximize: () => void window.api.window.toggleMaximize(),
        onClose: () => void window.api.window.close(),
      }}
    >
      <span className="px-3 text-xs font-medium">Vela FTP</span>
      <UpdateBadge />
    </TitleBar>
  );
}

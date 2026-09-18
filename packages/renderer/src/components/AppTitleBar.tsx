import { useEffect, useMemo, useState } from 'react';
import { ArrowDownCircle, ArrowDownUp, Search } from 'lucide-react';
import { IPC_EVENTS, PALETTE_SHORTCUT } from '@vela-ftp/shared';
import { NO_DRAG_STYLE, TitleBar, formatShortcut } from 'vela-kit/ui';
import velaIcon from '../assets/vela-ftp-icon.png';
import { formatSpeed } from '../lib/format';
import { openUpdatesSettings } from '../lib/updates';
import { useDialogStore } from '../stores/dialogStore';
import { ACTIVE_STATUSES, useQueueStore } from '../stores/queueStore';
import { useUiStore } from '../stores/uiStore';
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

/** Lo que hay en marcha, sin tener que abrir el panel de la cola. */
function QueueSummary() {
  const jobs = useQueueStore((s) => s.jobs);
  const toggleBottomPanel = useUiStore((s) => s.toggleBottomPanel);

  const { active, speed, percent } = useMemo(() => {
    const list = Object.values(jobs).filter((job) => ACTIVE_STATUSES.has(job.status));
    const total = list.reduce((n, job) => n + (job.size ?? 0), 0);
    const done = list.reduce((n, job) => n + job.transferred, 0);
    return {
      active: list.length,
      speed: list.reduce((n, job) => n + job.speed, 0),
      percent: total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0,
    };
  }, [jobs]);

  if (active === 0) return null;

  return (
    <>
      <button
        style={NO_DRAG_STYLE}
        onClick={toggleBottomPanel}
        title="Mostrar u ocultar la cola (Ctrl+J)"
        className="mr-2 flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] tabular-nums text-[var(--vela-fg-muted)] hover:bg-[var(--vela-titlebar-button-hover)] hover:text-[var(--vela-fg)]"
      >
        <ArrowDownUp size={12} />
        {active} {active === 1 ? 'activa' : 'activas'}
        {speed > 0 && ` · ${formatSpeed(speed)}`}
      </button>
      {/* Hilo de progreso al pie de la barra: se ve sin robar altura. */}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-transparent">
        <span className="block h-full bg-[var(--vela-accent)] transition-[width] duration-300" style={{ width: `${percent}%` }} />
      </span>
    </>
  );
}

/** Entrada a la paleta desde el ratón, para quien no se sabe el atajo. */
function PaletteSearch() {
  const open = useDialogStore((s) => s.open);
  return (
    <button
      style={NO_DRAG_STYLE}
      onClick={() => open({ kind: 'palette' })}
      title="Buscar sitios, carpetas y comandos"
      className="flex h-[22px] min-w-0 max-w-[320px] flex-1 items-center gap-1.5 rounded-md border border-[var(--vela-border)] bg-[var(--vela-bg)]/60 px-2 text-[11px] text-[var(--vela-fg-muted)] hover:border-[var(--vela-accent)]"
    >
      <Search size={11} className="shrink-0" />
      <span className="truncate">Buscar o ejecutar…</span>
      <span className="ml-auto hidden shrink-0 opacity-60 sm:inline">{formatShortcut(PALETTE_SHORTCUT, PLATFORM)}</span>
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
      <span className="flex shrink-0 items-center gap-1.5 px-3 text-xs font-medium">
        <img src={velaIcon} alt="" width={14} height={14} className="shrink-0" />
        Vela FTP
      </span>
      <span className="flex min-w-0 flex-1 justify-center px-2">
        <PaletteSearch />
      </span>
      <UpdateBadge />
      <QueueSummary />
    </TitleBar>
  );
}

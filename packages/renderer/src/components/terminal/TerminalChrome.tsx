import { FolderSymlink, PanelBottom, SquareArrowOutUpRight, X } from 'lucide-react';
import { remotePaneKey, usePanesStore } from '../../stores/panesStore';
import { useTerminalsStore, type TerminalStatus, type TerminalTab } from '../../stores/terminalsStore';

// Sin importar el runtime: este módulo va en el bundle principal y xterm no.

const STATUS_COLOR: Record<TerminalStatus, string> = {
  connecting: 'bg-[var(--vela-warning)]',
  open: 'bg-[var(--vela-success)]',
  closed: 'bg-[var(--vela-fg-muted)]',
};

const STATUS_LABEL: Record<TerminalStatus, string> = {
  connecting: 'Conectando…',
  open: 'Conectada',
  closed: 'Cerrada: Intro para abrir otra',
};

export function StatusDot({ status }: { status: TerminalStatus }) {
  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_COLOR[status]}`} title={STATUS_LABEL[status]} />;
}

/** Botones de una terminal: ir a la carpeta remota, cambiarla de sitio y, en pestaña propia, cerrarla. */
export function TerminalActions({ tab }: { tab: TerminalTab }) {
  const remotePath = usePanesStore((s) => s.panes[remotePaneKey(tab.sessionId)]?.path ?? null);
  const store = useTerminalsStore.getState;
  const goTo = (path: string) => void import('../../lib/terminal/runtime').then((m) => m.getRuntime(tab.id)?.goTo(path));
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <button
        className="vf-icon-btn"
        disabled={!remotePath || tab.status !== 'open'}
        title={remotePath ? `Ir a la carpeta del panel remoto (${remotePath})` : 'Ir a la carpeta del panel remoto'}
        onClick={() => remotePath && goTo(remotePath)}
      >
        <FolderSymlink size={13} />
      </button>
      {tab.placement === 'panel' ? (
        <button className="vf-icon-btn" title="Llevar a una pestaña propia" onClick={() => store().move(tab.id, 'tab')}>
          <SquareArrowOutUpRight size={13} />
        </button>
      ) : (
        <>
          <button className="vf-icon-btn" title="Devolver al panel inferior" onClick={() => store().move(tab.id, 'panel')}>
            <PanelBottom size={13} />
          </button>
          <button className="vf-icon-btn" title="Cerrar la terminal" onClick={() => store().close(tab.id)}>
            <X size={13} />
          </button>
        </>
      )}
    </div>
  );
}

import { useSessionsStore } from '../../stores/sessionsStore';
import type { TerminalTab } from '../../stores/terminalsStore';
import { TerminalActions } from './TerminalChrome';
import { TerminalView } from './TerminalView';

/** Una terminal en pestaña propia: ocupa el sitio de los paneles de ficheros. */
export default function TerminalTabView({ tab }: { tab: TerminalTab }) {
  const session = useSessionsStore((s) => s.sessions.find((x) => x.sessionId === tab.sessionId));
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--vela-border)] py-1 pl-3 pr-1 text-xs text-[var(--vela-fg-muted)]">
        <span className="truncate">
          {session ? `${session.host} · ` : ''}
          {tab.title}
        </span>
        <TerminalActions tab={tab} />
      </div>
      <TerminalView key={tab.id} tab={tab} />
    </div>
  );
}

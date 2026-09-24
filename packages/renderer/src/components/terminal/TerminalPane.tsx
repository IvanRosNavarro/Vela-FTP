import type { TerminalTab } from '../../stores/terminalsStore';
import { TerminalView } from './TerminalView';

/** Cuerpo de una pestaña de terminal del panel inferior (módulo aparte: arrastra xterm). */
export default function TerminalPane({ tab }: { tab: TerminalTab }) {
  return <TerminalView key={tab.id} tab={tab} />;
}

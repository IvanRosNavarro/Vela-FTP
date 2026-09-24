import { toast } from 'vela-kit/ui';
import { useSessionsStore } from '../../stores/sessionsStore';
import { useTerminalsStore } from '../../stores/terminalsStore';
import { useUiStore } from '../../stores/uiStore';

/** Abre una terminal de la sesión como pestaña del panel inferior, opcionalmente en una carpeta. */
export function openTerminal(sessionId: string | null, cwd: string | null = null): void {
  const session = useSessionsStore.getState().sessions.find((s) => s.sessionId === sessionId);
  if (!session) {
    toast('Conéctate a un sitio SFTP para abrir una terminal', 'info');
    return;
  }
  if (session.protocol !== 'sftp') {
    toast('La terminal va por SSH: solo está disponible en sitios SFTP', 'info');
    return;
  }
  const store = useTerminalsStore.getState();
  const count = store.tabs.filter((t) => t.sessionId === session.sessionId).length;
  store.add(session.sessionId, count === 0 ? session.siteName : `${session.siteName} (${count + 1})`, cwd);
}

/**
 * Ctrl+`: desde una terminal en pestaña propia vuelve a los ficheros. Si el
 * panel inferior ya muestra una terminal, lo oculta; si no, enseña la última de
 * la sesión activa, y abre una si no tenía ninguna.
 */
export function toggleTerminal(): void {
  const store = useTerminalsStore.getState();
  if (store.viewing) {
    store.view(null);
    return;
  }
  const ui = useUiStore.getState();
  const selected = store.tabs.find((t) => t.id === store.selected && t.placement === 'panel');
  if (ui.bottomPanelVisible && selected) {
    ui.toggleBottomPanel();
    return;
  }
  const { activeId } = useSessionsStore.getState();
  const inPanel = store.tabs.filter((t) => t.placement === 'panel');
  const target = inPanel.filter((t) => t.sessionId === activeId).at(-1) ?? selected ?? inPanel.at(-1);
  if (target) store.select(target.id);
  else openTerminal(activeId);
}

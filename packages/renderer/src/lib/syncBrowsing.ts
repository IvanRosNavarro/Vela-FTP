import { useEffect } from 'react';
import { toast } from 'vela-kit/ui';
import { mirrorPath } from './compare';
import { localPaths, remotePaths } from './paths';
import { remotePaneKey, usePanesStore } from '../stores/panesStore';
import { useSessionsStore } from '../stores/sessionsStore';
import { useUiStore } from '../stores/uiStore';

/** Activa la navegación sincronizada tomando las carpetas actuales como equivalentes. */
export function toggleSyncBrowsing(): void {
  const ui = useUiStore.getState();
  if (ui.syncBrowsing) {
    ui.setSyncBrowsing(null);
    toast('Navegación sincronizada desactivada');
    return;
  }
  const { activeId } = useSessionsStore.getState();
  const { panes } = usePanesStore.getState();
  const local = panes.local;
  const remote = activeId ? panes[remotePaneKey(activeId)] : undefined;
  if (!activeId || !local || !remote) {
    toast('Conéctate a un sitio para sincronizar la navegación', 'info');
    return;
  }
  ui.setSyncBrowsing({ sessionId: activeId, localBase: local.path, remoteBase: remote.path });
  toast(`Navegación sincronizada: ${local.path} ↔ ${remote.path}`, 'success');
}

/** Al entrar en una carpeta de un lado, entra en la equivalente del otro. */
export function useSyncBrowsing(): void {
  useEffect(() => {
    const local = localPaths(window.api.local.separator);
    const stop = (message: string) => {
      useUiStore.getState().setSyncBrowsing(null);
      toast(message, 'warning');
    };

    return usePanesStore.subscribe((state, previous) => {
      const sync = useUiStore.getState().syncBrowsing;
      if (!sync) return;
      const remoteKey = remotePaneKey(sync.sessionId);
      const localPane = state.panes.local;
      const remotePane = state.panes[remoteKey];
      if (!localPane || !remotePane) {
        useUiStore.getState().setSyncBrowsing(null);
        return;
      }

      const follow = (kind: 'local' | 'remote') => {
        const [pane, other, otherKey] = kind === 'local' ? [localPane, remotePane, remoteKey] : [remotePane, localPane, 'local' as const];
        const target =
          kind === 'local'
            ? mirrorPath(pane.path, sync.localBase, sync.remoteBase, local, remotePaths)
            : mirrorPath(pane.path, sync.remoteBase, sync.localBase, remotePaths, local);
        if (target === null) {
          stop(`Has salido de ${kind === 'local' ? sync.localBase : sync.remoteBase}: navegación sincronizada desactivada`);
          return;
        }
        // Cuando el otro lado ya está ahí (es él quien ha seguido a este), no hay nada que hacer.
        if (target === other.path) return;
        void usePanesStore
          .getState()
          .navigate(otherKey, target, { pushHistory: true })
          .then((ok) => {
            if (!ok) toast(`No existe ${kind === 'local' ? 'en el servidor' : 'en local'}: ${target}`, 'warning');
          });
      };

      if (localPane.path !== previous.panes.local?.path) follow('local');
      else if (remotePane.path !== previous.panes[remoteKey]?.path) follow('remote');
    });
  }, []);
}

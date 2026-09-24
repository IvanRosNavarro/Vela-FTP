import type { CommandAction } from '@vela-ftp/shared';
import { toast } from 'vela-kit/ui';
import { createProject } from '../components/SitesSidebar';
import { addBookmarkFor } from './bookmarks';
import { call, errorText } from './ipc';
import { useDialogStore } from '../stores/dialogStore';
import { localPaneKey, remotePaneKey, usePanesStore, type PaneKey } from '../stores/panesStore';
import { ACTIVE_STATUSES, FAILED_STATUSES, useQueueStore } from '../stores/queueStore';
import { useSessionsStore } from '../stores/sessionsStore';
import { useUiStore } from '../stores/uiStore';
import { checkForUpdates, openUpdatesSettings } from './updates';
import { toggleSyncBrowsing } from './syncBrowsing';
import { openTerminal, toggleTerminal } from './terminal/actions';

/** Panel con el foco; si es el remoto y no hay sesión, el local. */
function focusedPaneKey(): PaneKey {
  const { activeId } = useSessionsStore.getState();
  return useUiStore.getState().focusedPane === 'remote' && activeId ? remotePaneKey(activeId) : localPaneKey(activeId);
}

/** Ejecuta en la interfaz una acción pedida por un comando de main. */
export function runCommandAction(action: CommandAction): void {
  const dialogs = useDialogStore.getState();
  const sessions = useSessionsStore.getState();
  const panes = usePanesStore.getState();

  switch (action) {
    case 'open-palette':
      if (!dialogs.stack.some((d) => d.kind === 'palette')) dialogs.open({ kind: 'palette' });
      return;
    case 'open-settings':
      if (!dialogs.stack.some((d) => d.kind === 'settings')) dialogs.open({ kind: 'settings' });
      return;
    case 'new-site':
      dialogs.open({ kind: 'siteEditor', site: null });
      return;
    case 'new-project':
      void createProject();
      return;
    case 'import-filezilla':
      dialogs.open({ kind: 'importFileZilla' });
      return;
    case 'disconnect-active':
      if (sessions.activeId) void sessions.disconnect(sessions.activeId);
      return;
    case 'next-session':
    case 'previous-session': {
      const { sessions: list, activeId } = sessions;
      if (list.length < 2) return;
      const index = list.findIndex((s) => s.sessionId === activeId);
      const step = action === 'next-session' ? 1 : list.length - 1;
      sessions.activate(list[(index + step) % list.length]!.sessionId);
      return;
    }
    case 'focus-path': {
      const input = document.querySelector<HTMLInputElement>(`[data-path-input="${focusedPaneKey()}"]`);
      input?.focus();
      return;
    }
    case 'add-bookmark': {
      const active = sessions.sessions.find((s) => s.sessionId === sessions.activeId);
      const path = active ? panes.panes[remotePaneKey(active.sessionId)]?.path : undefined;
      if (!active || !path) {
        toast('Los marcadores son de carpetas remotas: conéctate a un sitio', 'info');
        return;
      }
      void addBookmarkFor(active.siteId, path, active.sessionId);
      return;
    }
    case 'toggle-hidden':
      panes.toggleHidden(focusedPaneKey());
      return;
    case 'refresh':
      void panes.refresh(localPaneKey(sessions.activeId));
      if (sessions.activeId) void panes.refresh(remotePaneKey(sessions.activeId));
      return;
    case 'toggle-compare':
      useUiStore.getState().toggleCompare();
      return;
    case 'toggle-sync-browsing':
      toggleSyncBrowsing();
      return;
    case 'open-updates':
      openUpdatesSettings();
      void checkForUpdates();
      return;
    case 'toggle-terminal':
      toggleTerminal();
      return;
    case 'new-terminal':
      openTerminal(sessions.activeId);
      return;
    case 'toggle-bottom-panel':
      useUiStore.getState().toggleBottomPanel();
      return;
    case 'cancel-all':
    case 'retry-failed': {
      const { jobs } = useQueueStore.getState();
      const wanted = action === 'cancel-all' ? ACTIVE_STATUSES : FAILED_STATUSES;
      // Los recuperados de otra ejecución se reintentan desde la pestaña de fallidas.
      const ids = Object.values(jobs)
        .filter((j) => wanted.has(j.status) && !j.sessionId.startsWith('restored:'))
        .map((j) => j.id);
      if (ids.length === 0) return;
      const request = action === 'cancel-all' ? window.api.queue.cancel(ids) : window.api.queue.retry(ids);
      void call(request).catch((err) => toast(errorText(err), 'error'));
      return;
    }
  }
}

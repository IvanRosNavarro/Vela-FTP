import { useEffect, useState } from 'react';
import { IPC_EVENTS, type JobSnapshot, type SettingKey, type UpdateStatus } from '@vela-ftp/shared';
import { toast } from 'vela-kit/ui';
import { AppTitleBar } from './components/AppTitleBar';
import { ContextMenuHost } from './components/ContextMenu';
import { DialogHost } from './components/dialogs/DialogHost';
import { BottomPanel } from './components/queue/BottomPanel';
import { SitesSidebar } from './components/SitesSidebar';
import { Splitter } from './components/Splitter';
import { Workspace } from './components/Workspace';
import { call, describeError } from './lib/ipc';
import { localPaths, remotePaths } from './lib/paths';
import { remotePaneKey, usePanesStore } from './stores/panesStore';
import { useQueueStore } from './stores/queueStore';
import { useSessionsStore } from './stores/sessionsStore';
import { useSitesStore } from './stores/sitesStore';
import { useUiStore } from './stores/uiStore';
import { runCommandAction } from './lib/commandActions';
import { createUpdateNotifier } from './lib/updates';
import { useUpdatesStore } from './stores/updatesStore';
import { useWatchStore } from './stores/watchStore';
import { useSyncStore } from './stores/syncStore';
import { useDialogStore } from './stores/dialogStore';

async function readSetting<K extends 'ui:bottom-panel-height' | 'ui:sidebar-width' | 'local:last-path'>(key: K) {
  const res = await window.api.settings.get(key);
  return res.ok ? res.data : null;
}

const saveSetting = (key: SettingKey, value: number | string) => void window.api.settings.set(key as 'ui:sidebar-width', value as number);

/**
 * Refresca los paneles cuya carpeta acaba de recibir ficheros. Se agrupa para
 * no relistar una carpeta por cada fichero de una subida grande.
 */
function useRefreshAfterTransfers() {
  useEffect(() => {
    const pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const local = localPaths(window.api.local.separator);

    const flush = () => {
      timer = null;
      const { panes, refresh } = usePanesStore.getState();
      for (const key of pending) {
        const [kind, dir] = [key.slice(0, key.indexOf('|')), key.slice(key.indexOf('|') + 1)];
        const paneKey = kind === 'local' ? 'local' : remotePaneKey(kind);
        if (panes[paneKey]?.path === dir) void refresh(paneKey);
      }
      pending.clear();
    };

    return window.api.on(IPC_EVENTS.QUEUE_UPDATED, ({ jobs }) => {
      for (const job of jobs as JobSnapshot[]) {
        if (job.status !== 'done') continue;
        if (job.direction === 'download') pending.add(`local|${local.parent(job.localPath) ?? job.localPath}`);
        else pending.add(`${job.sessionId}|${remotePaths.parent(job.remotePath) ?? '/'}`);
      }
      if (pending.size > 0 && !timer) timer = setTimeout(flush, 400);
    });
  }, []);
}

export function App() {
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [bottomHeight, setBottomHeight] = useState(220);
  const bottomVisible = useUiStore((s) => s.bottomPanelVisible);

  useRefreshAfterTransfers();

  useEffect(() => {
    const queue = useQueueStore.getState();
    const sites = useSitesStore.getState();
    void sites.loadSites();
    void sites.loadProjects();
    void sites.loadBookmarks();
    void sites.loadCommands();
    void sites.loadVault();
    void call(window.api.queue.snapshot()).then(queue.replaceAll).catch(() => undefined);
    const notifyUpdate = createUpdateNotifier();
    const applyUpdateStatus = (status: UpdateStatus) => {
      useUpdatesStore.getState().setStatus(status);
      notifyUpdate(status);
    };
    void call(window.api.updates.status()).then(applyUpdateStatus).catch(() => undefined);
    void call(window.api.watch.list()).then(useWatchStore.getState().setWatches).catch(() => undefined);
    void useSyncStore.getState().load();
    // Bienvenida solo la primera vez, y nunca por encima de datos que ya existen.
    void (async () => {
      const seen = await call(window.api.settings.get('app:welcomed')).catch(() => true);
      if (seen) return;
      const sites = await call(window.api.sites.list()).catch(() => [null]);
      await call(window.api.settings.set('app:welcomed', true)).catch(() => undefined);
      if (sites.length === 0) useDialogStore.getState().open({ kind: 'welcome' });
    })();

    void (async () => {
      const [width, height, lastLocal] = await Promise.all([
        readSetting('ui:sidebar-width'),
        readSetting('ui:bottom-panel-height'),
        readSetting('local:last-path'),
      ]);
      if (width) setSidebarWidth(width);
      if (height) setBottomHeight(height);
      const home = await call(window.api.local.home());
      const start = lastLocal && lastLocal !== '~' ? lastLocal : home;
      const panes = usePanesStore.getState();
      panes.ensure('local', start);
      if (!(await panes.navigate('local', start))) await panes.navigate('local', home);
    })();

    // La última carpeta local se recuerda entre sesiones.
    let lastSaved = '';
    const unsubscribePanes = usePanesStore.subscribe((state) => {
      const path = state.panes.local?.path;
      if (path && path !== lastSaved && !state.panes.local?.error) {
        lastSaved = path;
        saveSetting('local:last-path', path);
      }
    });

    const offs = [
      window.api.on(IPC_EVENTS.SITES_CHANGED, () => void useSitesStore.getState().loadSites()),
      window.api.on(IPC_EVENTS.PROJECTS_CHANGED, () => void useSitesStore.getState().loadProjects()),
      window.api.on(IPC_EVENTS.BOOKMARKS_CHANGED, () => void useSitesStore.getState().loadBookmarks()),
      window.api.on(IPC_EVENTS.COMMAND_ACTION, ({ action }) => runCommandAction(action)),
      window.api.on(IPC_EVENTS.UPDATES_CHANGED, applyUpdateStatus),
      window.api.on(IPC_EVENTS.WATCHES_CHANGED, (list) => useWatchStore.getState().setWatches(list)),
      window.api.on(IPC_EVENTS.SYNC_CHANGED, (status) => {
        const previous = useSyncStore.getState().status;
        useSyncStore.getState().setStatus(status);
        // El enlace del correo llega al proceso main: hay que pedir la contraseña aquí.
        if (status.phase === 'needs-password' && previous?.phase !== 'needs-password') {
          toast('Dispositivo vinculado: introduce tu contraseña de sincronización', 'info', () =>
            useDialogStore.getState().open({ kind: 'settings', section: 'sync' }),
          );
        }
      }),
      window.api.on(IPC_EVENTS.SYNC_DATA_CHANGED, () => {
        const sitesStore = useSitesStore.getState();
        void sitesStore.loadSites();
        void sitesStore.loadProjects();
        void sitesStore.loadBookmarks();
      }),
      window.api.on(IPC_EVENTS.VAULT_CHANGED, () => void useSitesStore.getState().loadVault()),
      window.api.on(IPC_EVENTS.QUEUE_UPDATED, ({ jobs, removedIds }) => queue.applyUpdate(jobs, removedIds)),
      window.api.on(IPC_EVENTS.QUEUE_CONFLICT, (info) => queue.addConflict(info)),
      window.api.on(IPC_EVENTS.PROTOCOL_LOG, (lines) => queue.appendLog(lines)),
      window.api.on(IPC_EVENTS.SESSION_LOST, ({ sessionId, error }) => {
        const session = useSessionsStore.getState().sessions.find((s) => s.sessionId === sessionId);
        if (!session) return;
        toast(`${session.siteName}: conexión perdida (${describeError(error.code)}). Se reconectará al usarla.`, 'warning');
      }),
      window.api.on(IPC_EVENTS.TRANSFER_RESTARTED, () => {
        const { sessions, markLost } = useSessionsStore.getState();
        for (const s of sessions) markLost(s.sessionId);
        toast('El motor de transferencias se reinició: vuelve a conectar', 'error');
      }),
    ];
    return () => {
      unsubscribePanes();
      for (const off of offs) off();
    };
  }, []);

  return (
    <div id="vela-shell" className="flex h-full flex-col">
      <AppTitleBar />
      <div className="flex min-h-0 flex-1">
        <SitesSidebar width={sidebarWidth} />
        <Splitter
          direction="horizontal"
          value={sidebarWidth}
          min={160}
          max={480}
          onChange={setSidebarWidth}
          onCommit={(v) => saveSetting('ui:sidebar-width', v)}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Workspace />
          {bottomVisible && <Splitter
            direction="vertical"
            value={bottomHeight}
            min={80}
            max={Math.round(window.innerHeight * 0.7)}
            invert
            onChange={setBottomHeight}
            onCommit={(v) => saveSetting('ui:bottom-panel-height', v)}
          />}
          {bottomVisible && <BottomPanel height={bottomHeight} />}
        </div>
      </div>
      <DialogHost />
      <ContextMenuHost />
    </div>
  );
}

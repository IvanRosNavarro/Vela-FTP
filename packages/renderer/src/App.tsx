import { useCallback, useEffect, useState } from 'react';
import { IPC_EVENTS, type ExternalFileEvent, type JobSnapshot, type SettingKey, type UpdateStatus } from '@vela-ftp/shared';
import { toast } from 'vela-kit/ui';
import { AppTitleBar } from './components/AppTitleBar';
import { ContextMenuHost } from './components/ContextMenu';
import { DialogHost } from './components/dialogs/DialogHost';
import { BottomPanel } from './components/queue/BottomPanel';
import { SitesSidebar } from './components/SitesSidebar';
import { Splitter } from './components/Splitter';
import { Workspace } from './components/Workspace';
import { call, describeError, errorText } from './lib/ipc';
import { localPaths, remotePaths } from './lib/paths';
import { localPaneKey, remotePaneKey, usePanesStore, type PaneKey } from './stores/panesStore';
import { useQueueStore } from './stores/queueStore';
import { useSessionsStore } from './stores/sessionsStore';
import { useSitesStore } from './stores/sitesStore';
import { useUiStore } from './stores/uiStore';
import { runCommandAction } from './lib/commandActions';
import { createUpdateNotifier } from './lib/updates';
import { useUpdatesStore } from './stores/updatesStore';
import { useWatchStore } from './stores/watchStore';
import { useSyncStore } from './stores/syncStore';
import { confirmDialog, useDialogStore } from './stores/dialogStore';

async function readSetting<K extends 'ui:bottom-panel-height' | 'ui:sidebar-width' | 'ui:sidebar-collapsed' | 'local:last-path'>(key: K) {
  const res = await window.api.settings.get(key);
  return res.ok ? res.data : null;
}

const saveSetting = (key: SettingKey, value: number | string) => void window.api.settings.set(key as 'ui:sidebar-width', value as number);

/** Primer refresco tras una transferencia: rápido, para que se note al momento. */
const REFRESH_FIRST_DELAY = 400;
/**
 * Durante una tanda larga (muchos ficheros seguidos), no refrescar más de una
 * vez cada REFRESH_MIN_INTERVAL: relistar la carpeta en cada fichero sobrecarga
 * el panel sin necesidad. 7 s es un punto medio dentro de los 5-10 s pedidos.
 */
const REFRESH_MIN_INTERVAL = 7000;

/**
 * Refresca los paneles cuya carpeta acaba de recibir ficheros: el local en una
 * bajada, el remoto en una subida. Se agrupa para no relistar una carpeta por
 * cada fichero de una transferencia grande.
 */
function useRefreshAfterTransfers() {
  useEffect(() => {
    const pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastFlushAt = 0;
    const local = localPaths(window.api.local.separator);

    const flush = () => {
      timer = null;
      lastFlushAt = Date.now();
      const { panes, refresh } = usePanesStore.getState();
      for (const key of pending) {
        const sep = key.indexOf('|');
        const paneKey = key.slice(0, sep) as PaneKey;
        const dir = key.slice(sep + 1);
        if (panes[paneKey]?.path === dir) void refresh(paneKey);
      }
      pending.clear();
    };

    const schedule = () => {
      if (timer) return;
      const elapsed = Date.now() - lastFlushAt;
      const delay = elapsed > REFRESH_MIN_INTERVAL ? REFRESH_FIRST_DELAY : REFRESH_MIN_INTERVAL - elapsed;
      timer = setTimeout(flush, delay);
    };

    return window.api.on(IPC_EVENTS.QUEUE_UPDATED, ({ jobs }) => {
      for (const job of jobs as JobSnapshot[]) {
        if (job.status !== 'done') continue;
        // El panel local de una bajada es el de esa pestaña (local:<sessionId>),
        // no el panel local sin sesión: cada pestaña tiene su propia carpeta local.
        if (job.direction === 'download') pending.add(`${localPaneKey(job.sessionId)}|${local.parent(job.localPath) ?? job.localPath}`);
        else pending.add(`${remotePaneKey(job.sessionId)}|${remotePaths.parent(job.remotePath) ?? '/'}`);
      }
      if (pending.size > 0) schedule();
    });
  }, []);
}

/** Lo que pasa con los ficheros abiertos en otra aplicación. */
async function onExternalFile(event: ExternalFileEvent): Promise<void> {
  const upload = (force: boolean) =>
    void call(window.api.files.uploadExternal(event.id, force)).catch((err) => toast(`No se pudo subir ${event.name}: ${errorText(err)}`, 'error'));
  switch (event.kind) {
    case 'uploaded':
      toast(`${event.name} subido a ${event.siteName}`, 'success');
      return;
    case 'changed':
      if (
        await confirmDialog({
          title: 'Subir los cambios',
          message: `Has guardado ${event.name}. ¿Subirlo a ${event.siteName}?`,
          confirmLabel: 'Subir',
          danger: false,
        })
      )
        upload(false);
      return;
    case 'conflict':
      if (
        await confirmDialog({
          title: 'El fichero cambió en el servidor',
          message: `Alguien ha modificado ${event.name} en ${event.siteName} desde que lo abriste. Si lo subes, sus cambios se perderán.`,
          confirmLabel: 'Sobrescribir',
          danger: true,
        })
      )
        upload(true);
      return;
    case 'error':
      toast(`No se pudo subir ${event.name}: ${event.message ?? 'error desconocido'}`, 'error');
      return;
  }
}

export function App() {
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [bottomHeight, setBottomHeight] = useState(220);
  const bottomVisible = useUiStore((s) => s.bottomPanelVisible);

  useRefreshAfterTransfers();

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((collapsed) => {
      void window.api.settings.set('ui:sidebar-collapsed', !collapsed);
      return !collapsed;
    });
  }, []);

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
    void call(window.api.settings.get('files:open-with')).then(useUiStore.getState().setOpenWith).catch(() => undefined);
    void call(window.api.settings.get('ui:columns-remote')).then((c) => useUiStore.getState().setColumns('remote', c)).catch(() => undefined);
    void call(window.api.settings.get('ui:columns-local')).then((c) => useUiStore.getState().setColumns('local', c)).catch(() => undefined);
    // Bienvenida solo la primera vez, y nunca por encima de datos que ya existen.
    void (async () => {
      const seen = await call(window.api.settings.get('app:welcomed')).catch(() => true);
      if (seen) return;
      const sites = await call(window.api.sites.list()).catch(() => [null]);
      await call(window.api.settings.set('app:welcomed', true)).catch(() => undefined);
      if (sites.length === 0) useDialogStore.getState().open({ kind: 'welcome' });
    })();

    void (async () => {
      const [width, height, lastLocal, collapsed] = await Promise.all([
        readSetting('ui:sidebar-width'),
        readSetting('ui:bottom-panel-height'),
        readSetting('local:last-path'),
        readSetting('ui:sidebar-collapsed'),
      ]);
      if (width) setSidebarWidth(width);
      if (height) setBottomHeight(height);
      if (collapsed) setSidebarCollapsed(true);
      const home = await call(window.api.local.home());
      const start = lastLocal && lastLocal !== '~' ? lastLocal : home;
      const panes = usePanesStore.getState();
      panes.ensure('local', start);
      if (!(await panes.navigate('local', start))) await panes.navigate('local', home);
    })();

    // La última carpeta local se recuerda entre arranques: la del panel que se
    // esté viendo, que con varias pestañas no tiene por qué ser el mismo.
    let lastSaved = '';
    const unsubscribePanes = usePanesStore.subscribe((state) => {
      const pane = state.panes[localPaneKey(useSessionsStore.getState().activeId)];
      if (pane?.path && pane.path !== lastSaved && !pane.error) {
        lastSaved = pane.path;
        saveSetting('local:last-path', pane.path);
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
      window.api.on(IPC_EVENTS.EXTERNAL_FILE, (event) => void onExternalFile(event)),
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
        <SitesSidebar width={sidebarWidth} collapsed={sidebarCollapsed} onToggleCollapsed={toggleSidebar} />
        {/* Reducida a iconos tiene un ancho fijo: no hay nada que redimensionar. */}
        {sidebarCollapsed ? (
          <div className="w-px shrink-0 bg-[var(--vela-border)]" />
        ) : (
          <Splitter
            direction="horizontal"
            value={sidebarWidth}
            min={160}
            max={480}
            onChange={setSidebarWidth}
            onCommit={(v) => saveSetting('ui:sidebar-width', v)}
          />
        )}
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

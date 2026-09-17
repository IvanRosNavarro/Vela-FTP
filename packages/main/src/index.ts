import path from 'node:path';
import { app, BrowserWindow, Menu, nativeTheme } from 'electron';
import { initLogger, logger } from 'vela-kit/logger';
import { ShortcutManager, buildCommandRegistry } from './commands';
import { registerOrganizeHandlers } from './ipc/organize';
import { BookmarksRepository, PathHistoryRepository, ProjectsRepository } from './storage/repositories/ProjectsRepository';
import { DEV_SERVER_ORIGIN } from './ipc/guard';
import { registerSettingsHandlers } from './ipc/settings';
import { registerWindowHandlers } from './ipc/window';
import { applyDevCsp, registerAppProtocol, registerAppSchemeAsPrivileged } from './protocol/appProtocol';
import { registerAppHandlers } from './ipc/app';
import { osKeychain } from './security/keychain';
import { SecretStore } from './security/SecretStore';
import { SessionManager } from './sessions/SessionManager';
import { closeStorage, initStorage } from './storage/db';
import { KnownHostsRepository } from './storage/repositories/KnownHostsRepository';
import { SettingsRepository } from './storage/repositories/SettingsRepository';
import { SitesRepository } from './storage/repositories/SitesRepository';
import { TransferJobsRepository } from './storage/repositories/TransferJobsRepository';
import { QueueMirror } from './transfer/QueueMirror';
import { TransferHost } from './transfer/TransferHost';
import { createMainWindow, createShellWindow } from './window/mainWindow';
import { closeSessionsOfWindow } from './sessions/windowSessions';
import { EditorManager } from './files/EditorManager';
import { cleanTempRoot } from './files/tempFiles';
import { WatchManager } from './files/WatchManager';
import { broadcast } from './ipc/handle';
import { IPC_EVENTS } from '@vela-ftp/shared';
import { registerFileHandlers } from './ipc/files';
import { registerSyncHandlers } from './ipc/sync';
import { SyncManager } from './sync/SyncManager';
import { SyncPendingRepository, SyncStateRepository } from './sync/syncState';
import { onSessionToken, registerDeepLink } from './sync/deepLink';
import { registerUpdateHandlers } from './ipc/updates';
import { createUpdateService } from './updater';
import type { UpdateService } from './updater/UpdateService';

let transfer: TransferHost | null = null;
let queue: QueueMirror | null = null;
let updates: UpdateService | null = null;
let watches: WatchManager | null = null;
let sync: SyncManager | null = null;
/** Abre otra ventana; se asigna al arrancar. */
let newWindow: (() => void) | null = null;

app.setName('Vela FTP');
app.setAppUserModelId('com.vela.ftp');

process.on('uncaughtException', (err) => {
  logger.error('uncaughtException', err);
});
process.on('unhandledRejection', (reason) => {
  logger.error('unhandledRejection', reason);
});

registerAppSchemeAsPrivileged();
registerDeepLink();

/** macOS necesita menú de aplicación para copiar/pegar y Cmd+Q; el resto va sin menú. */
function setApplicationMenu(): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]),
  );
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Volver a lanzar Vela FTP abre otra ventana; el enlace de vinculación, en
  // cambio, lo atiende la ventana que ya está delante.
  app.on('second-instance', (_event, argv) => {
    if (argv.some((arg) => arg.startsWith('vela-ftp://'))) {
      const [win] = BrowserWindow.getAllWindows();
      if (win?.isMinimized()) win.restore();
      win?.focus();
      return;
    }
    newWindow?.();
  });

  void app.whenReady().then(() => {
    initLogger({ fileBaseName: 'vela-ftp' });
    logger.info(`Vela FTP ${app.getVersion()} arrancando`);

    const db = initStorage();
    const settings = new SettingsRepository(db);

    if (app.isPackaged) {
      registerAppProtocol(path.join(__dirname, '../../renderer/dist'));
    } else {
      applyDevCsp(DEV_SERVER_ORIGIN);
    }
    setApplicationMenu();

    const secrets = new SecretStore(db, osKeychain);
    try {
      secrets.initialize();
    } catch (err) {
      // p. ej. el llavero del SO cambió de usuario: los secretos no se pueden leer.
      logger.error('[secrets] no se pudo abrir el almacén de secretos', err);
    }
    const sites = new SitesRepository(db, secrets);
    const knownHosts = new KnownHostsRepository(db);

    transfer = new TransferHost();
    transfer.start();
    const sessions = new SessionManager(transfer, sites, knownHosts);
    queue = new QueueMirror({
      transfer,
      repo: new TransferJobsRepository(db),
      siteIdForSession: (sessionId) => sessions.get(sessionId)?.siteId ?? null,
    });

    registerSettingsHandlers(settings);
    registerWindowHandlers();
    const projects = new ProjectsRepository(db);
    const bookmarks = new BookmarksRepository(db);
    const history = new PathHistoryRepository(db);
    registerAppHandlers({ sites, knownHosts, secrets, sessions, transfer, queue, history });

    void cleanTempRoot();
    const editor = new EditorManager({
      transfer,
      sessions,
      openWindow: (query, title) =>
        createShellWindow({
          themeId: settings.get('ui:theme'),
          prefersDark: nativeTheme.shouldUseDarkColors,
          title,
          width: 1000,
          height: 720,
          minWidth: 480,
          minHeight: 320,
          query,
        }),
    });
    sync = new SyncManager({
      state: new SyncStateRepository(db),
      pending: new SyncPendingRepository(db),
      repos: { sites, projects, bookmarks, knownHosts, settings },
      onStatus: (status) => broadcast(IPC_EVENTS.SYNC_CHANGED, status),
      onDataChanged: () => broadcast(IPC_EVENTS.SYNC_DATA_CHANGED, null),
    });
    registerSyncHandlers(sync);
    onSessionToken((token) => sync?.onSessionToken(token));
    void sync.restore();

    watches = new WatchManager({ transfer, sessions, onChange: (list) => broadcast(IPC_EVENTS.WATCHES_CHANGED, list) });
    registerFileHandlers(editor, watches);

    updates = createUpdateService(settings);
    registerUpdateHandlers(updates);
    updates.startAutoCheck();

    const openWindow = () => {
      const win = createMainWindow({
        themeId: settings.get('ui:theme'),
        prefersDark: nativeTheme.shouldUseDarkColors,
        getShortcuts: () => shortcuts.current,
      });
      const windowId = win.id;
      // Cada ventana lleva sus conexiones: al cerrarla se sueltan solo las suyas.
      win.on('closed', () => {
        if (sessions) void closeSessionsOfWindow(windowId, sessions);
      });
      return win;
    };

    newWindow = () => void openWindow();
    const registry = buildCommandRegistry(() => newWindow?.());
    const shortcuts = new ShortcutManager(registry, settings);
    registerOrganizeHandlers({ sites, projects, bookmarks, history, knownHosts, settings, registry, shortcuts });

    openWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) openWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => {
    updates?.stop();
    sync?.stop();
    void watches?.stopAll();
    queue?.persist();
    transfer?.stop();
    closeStorage();
  });
}

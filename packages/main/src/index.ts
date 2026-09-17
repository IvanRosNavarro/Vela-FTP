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
import { createMainWindow } from './window/mainWindow';

let transfer: TransferHost | null = null;
let queue: QueueMirror | null = null;

app.setName('Vela FTP');
app.setAppUserModelId('com.vela.ftp');

process.on('uncaughtException', (err) => {
  logger.error('uncaughtException', err);
});
process.on('unhandledRejection', (reason) => {
  logger.error('unhandledRejection', reason);
});

registerAppSchemeAsPrivileged();

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
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
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

    const registry = buildCommandRegistry();
    const shortcuts = new ShortcutManager(registry, settings);
    registerOrganizeHandlers({ sites, projects, bookmarks, history, knownHosts, settings, registry, shortcuts });

    const openWindow = () =>
      createMainWindow({
        themeId: settings.get('ui:theme'),
        prefersDark: nativeTheme.shouldUseDarkColors,
        getShortcuts: () => shortcuts.current,
      });
    openWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) openWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => {
    queue?.persist();
    transfer?.stop();
    closeStorage();
  });
}

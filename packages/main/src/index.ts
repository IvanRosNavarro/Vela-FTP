import path from 'node:path';
import { app, BrowserWindow, Menu, nativeTheme } from 'electron';
import { ShortcutTable, registerCommandShortcuts } from 'vela-kit/commands';
import { initLogger, logger } from 'vela-kit/logger';
import { buildCommandRegistry } from './commands';
import { DEV_SERVER_ORIGIN } from './ipc/guard';
import { registerSettingsHandlers } from './ipc/settings';
import { registerWindowHandlers } from './ipc/window';
import { applyDevCsp, registerAppProtocol, registerAppSchemeAsPrivileged } from './protocol/appProtocol';
import { closeStorage, initStorage } from './storage/db';
import { SettingsRepository } from './storage/repositories/SettingsRepository';
import { createMainWindow } from './window/mainWindow';

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

    registerSettingsHandlers(settings);
    registerWindowHandlers();

    const registry = buildCommandRegistry();
    const shortcuts = new ShortcutTable({ reserved: ['Ctrl+Shift+P'] });
    registerCommandShortcuts(shortcuts, registry, {
      buildContext: (windowId) => ({ windowId }),
      onConflict: (combo, id) => logger.warn(`[shortcuts] "${combo}" de ${id} ignorado por conflicto`),
    });

    const openWindow = () =>
      createMainWindow({
        themeId: settings.get('ui:theme'),
        prefersDark: nativeTheme.shouldUseDarkColors,
        getShortcuts: () => shortcuts,
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
    closeStorage();
  });
}

import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import { IPC_EVENTS } from '@vela-ftp/shared';
import type { ShortcutTable } from 'vela-kit/commands';
import { attachShortcuts } from 'vela-kit/commands';
import { logger } from 'vela-kit/logger';
import { resolveTheme } from 'vela-kit/theme/themes';
import { titleBarWindowOptions, watchMaximized, type DesktopPlatform } from 'vela-kit/window';
import { suspendedShortcutWindows } from '../commands';
import { DEV_SERVER_ORIGIN } from '../ipc/guard';
import { APP_URL } from '../protocol/appProtocol';

export interface MainWindowOptions {
  /** Tema guardado, para que el marco nativo nazca con su color y no parpadee. */
  themeId: string;
  prefersDark: boolean;
  getShortcuts: () => ShortcutTable | null;
}

export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  const platform = process.platform as DesktopPlatform;
  const theme = resolveTheme(options.themeId, options.prefersDark);
  const bg = theme.variables['--vela-bg'] ?? '#0e0f12';

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    title: 'Vela FTP',
    backgroundColor: bg,
    show: false,
    ...titleBarWindowOptions(platform, {
      color: theme.variables['--vela-titlebar-bg'] ?? '#1a1a1a',
      symbolColor: theme.variables['--vela-titlebar-fg'] ?? '#e0e0e0',
    }),
    webPreferences: {
      preload: path.join(__dirname, '../../preload/dist/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  win.once('ready-to-show', () => win.show());

  // La shell nunca navega ni abre ventanas: los enlaces externos pasarán por
  // shell.openExternal cuando haga falta.
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Sin esto, un fallo del renderer solo se ve abriendo DevTools.
  win.webContents.on('console-message', (event) => {
    if (event.level !== 'error' && event.level !== 'warning') return;
    const log = event.level === 'error' ? logger.error : logger.warn;
    log(`[renderer] ${event.message}`, `${event.sourceId}:${event.lineNumber}`);
  });
  win.webContents.on('did-fail-load', (_event, code, description, url) => {
    logger.error('[renderer] fallo de carga', { code, description, url });
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    logger.error('[renderer] proceso terminado', details);
  });
  win.webContents.on('did-finish-load', () => {
    logger.info('[renderer] shell cargada');
  });

  const stopWatching = watchMaximized(win, (maximized) => {
    if (!win.isDestroyed()) win.webContents.send(IPC_EVENTS.WINDOW_MAXIMIZED_CHANGED, { maximized });
  });
  const detachShortcuts = attachShortcuts(options.getShortcuts, win.webContents, () => (win.isDestroyed() ? null : win.id), {
    // Mientras se captura un atajo en ajustes, las teclas llegan a la página.
    passThrough: (_input, windowId) => suspendedShortcutWindows.has(windowId),
    onError: (source, err) => logger.warn(`[shortcuts] ${source} falló`, err),
  });
  const windowId = win.id;
  win.on('closed', () => {
    suspendedShortcutWindows.delete(windowId);
    stopWatching();
    detachShortcuts();
  });

  const url = app.isPackaged ? APP_URL : `${DEV_SERVER_ORIGIN}/`;
  win.loadURL(url).catch((err: unknown) => {
    logger.error('No se pudo cargar la shell', err);
  });

  return win;
}

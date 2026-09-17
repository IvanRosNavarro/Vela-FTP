import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import { initLogger, logger } from './logger';

// Puerto distinto al de Vela Browser (5173) para poder tener los dos dev
// servers abiertos a la vez.
const DEV_SERVER_URL = 'http://localhost:5183';

app.setName('Vela FTP');
app.setAppUserModelId('com.vela.ftp');

process.on('uncaughtException', (err) => {
  logger.error('uncaughtException', err);
});
process.on('unhandledRejection', (reason) => {
  logger.error('unhandledRejection', reason);
});

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    title: 'Vela FTP',
    backgroundColor: '#0e0f12',
    show: false,
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

  const load = app.isPackaged
    ? win.loadFile(path.join(__dirname, '../../renderer/dist/index.html'))
    : win.loadURL(DEV_SERVER_URL);
  load.catch((err: unknown) => {
    logger.error('No se pudo cargar la shell', err);
  });

  return win;
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
    initLogger();
    logger.info(`Vela FTP ${app.getVersion()} arrancando`);
    createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

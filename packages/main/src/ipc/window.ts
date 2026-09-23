import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS, titleBarOverlayInputSchema } from '@vela-ftp/shared';
import { fail, ok, validatePayload, type IpcResponse } from 'vela-kit/ipc';
import { isTrustedSender } from './guard';
import { backgroundMaterialSupported } from '../window/mainWindow';

type WindowAction = (win: BrowserWindow) => void;

/** Ventana cuya propia shell envía el mensaje (nunca una vista incrustada). */
function ownWindow(event: IpcMainInvokeEvent): BrowserWindow | null {
  const win = BrowserWindow.fromWebContents(event.sender);
  return win && win.webContents.id === event.sender.id ? win : null;
}

function handleWindowAction(channel: string, action: WindowAction): void {
  ipcMain.handle(channel, (event): IpcResponse<null> => {
    if (!isTrustedSender(event, channel)) return fail('UNTRUSTED_FRAME');
    const win = ownWindow(event);
    if (!win) return fail('NOT_FOUND');
    action(win);
    return ok(null);
  });
}

export function registerWindowHandlers(): void {
  handleWindowAction(IPC_CHANNELS.WINDOW_MINIMIZE, (win) => win.minimize());
  handleWindowAction(IPC_CHANNELS.WINDOW_TOGGLE_MAXIMIZE, (win) => {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  handleWindowAction(IPC_CHANNELS.WINDOW_CLOSE, (win) => win.close());

  ipcMain.handle(IPC_CHANNELS.WINDOW_IS_MAXIMIZED, (event): IpcResponse<boolean> => {
    if (!isTrustedSender(event, IPC_CHANNELS.WINDOW_IS_MAXIMIZED)) return fail('UNTRUSTED_FRAME');
    const win = ownWindow(event);
    return win ? ok(win.isMaximized()) : fail('NOT_FOUND');
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_BACKGROUND_MATERIAL, (event): IpcResponse<{ supported: boolean }> => {
    if (!isTrustedSender(event, IPC_CHANNELS.WINDOW_BACKGROUND_MATERIAL)) return fail('UNTRUSTED_FRAME');
    return ok({ supported: backgroundMaterialSupported.value });
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_UPDATE_TITLE_BAR_OVERLAY, (event, raw): IpcResponse<null> => {
    if (!isTrustedSender(event, IPC_CHANNELS.WINDOW_UPDATE_TITLE_BAR_OVERLAY)) return fail('UNTRUSTED_FRAME');
    const input = validatePayload(titleBarOverlayInputSchema, raw);
    if (!input.ok) return input;
    const win = ownWindow(event);
    if (!win) return fail('NOT_FOUND');
    // El overlay solo existe en Windows; en el resto no hay nada que actualizar.
    if (process.platform === 'win32') win.setTitleBarOverlay(input.data);
    return ok(null);
  });
}

import { BrowserWindow, MessageChannelMain, shell } from 'electron';
import { v7 as uuidv7 } from 'uuid';
import {
  IPC_CHANNELS,
  TERMINAL_PORT_CHANNEL,
  terminalFocusInputSchema,
  terminalOpenInputSchema,
  terminalOpenLinkInputSchema,
} from '@vela-ftp/shared';
import { logger } from 'vela-kit/logger';
import { terminalFocusedWindows } from '../commands';
import type { SessionManager } from '../sessions/SessionManager';
import { TransferRequestError, type TransferHost } from '../transfer/TransferHost';
import { handle } from './handle';

/**
 * Terminales SSH. main solo las abre: crea el canal, pasa un extremo al motor
 * con la petición y el otro a la ventana que la pidió. Lo que se teclea y lo
 * que responde el servidor no pasa por aquí.
 */
export function registerTerminalHandlers(sessions: SessionManager, transfer: TransferHost): void {
  handle(IPC_CHANNELS.TERMINAL_OPEN, terminalOpenInputSchema, async ({ sessionId, cols, rows }, event) => {
    const info = sessions.get(sessionId);
    if (!info) throw new TransferRequestError({ code: 'NOT_CONNECTED', message: 'La sesión no está abierta' });
    if (info.protocol !== 'sftp') {
      throw new TransferRequestError({ code: 'PROTOCOL', message: 'La terminal solo está disponible en sitios SFTP' });
    }
    const terminalId = uuidv7();
    const { port1, port2 } = new MessageChannelMain();
    try {
      await transfer.request('terminal.open', { terminalId, sessionId, cols, rows }, [port1]);
    } catch (err) {
      port2.close();
      throw err;
    }
    event.sender.postMessage(TERMINAL_PORT_CHANNEL, { terminalId }, [port2]);
    logger.info(`[terminal] abierta ${terminalId} en ${sessionId}`);
    return { terminalId };
  });

  handle(IPC_CHANNELS.TERMINAL_FOCUS, terminalFocusInputSchema, ({ focused }, event) => {
    const windowId = BrowserWindow.fromWebContents(event.sender)?.id;
    if (windowId === undefined) return null;
    if (focused) terminalFocusedWindows.add(windowId);
    else terminalFocusedWindows.delete(windowId);
    return null;
  });

  handle(IPC_CHANNELS.TERMINAL_OPEN_LINK, terminalOpenLinkInputSchema, async ({ url }) => {
    await shell.openExternal(url);
    return null;
  });
}

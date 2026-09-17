import { BrowserWindow, type WebContents } from 'electron';
import { logger } from 'vela-kit/logger';
import type { SessionManager } from './SessionManager';

/**
 * Qué ventana abrió cada sesión. Con varias ventanas abiertas, cerrar una debe
 * llevarse solo sus conexiones: las de las demás siguen trabajando.
 */
const owners = new Map<string, number>();

export function rememberSessionOwner(sender: WebContents, sessionId: string): void {
  const window = BrowserWindow.fromWebContents(sender);
  if (window) owners.set(sessionId, window.id);
}

export function forgetSession(sessionId: string): void {
  owners.delete(sessionId);
}

export function sessionsOfWindow(windowId: number): string[] {
  return [...owners.entries()].filter(([, id]) => id === windowId).map(([sessionId]) => sessionId);
}

/** Cierra las conexiones de una ventana que se va. */
export async function closeSessionsOfWindow(windowId: number, sessions: SessionManager): Promise<void> {
  const ids = sessionsOfWindow(windowId);
  if (ids.length === 0) return;
  logger.info(`[sessions] la ventana ${windowId} se cierra: ${ids.length} conexiones`);
  for (const sessionId of ids) {
    forgetSession(sessionId);
    await sessions.close(sessionId).catch((err: unknown) => logger.warn(`[sessions] no se pudo cerrar ${sessionId}`, err));
  }
}

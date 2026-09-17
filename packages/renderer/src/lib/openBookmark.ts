import type { Bookmark } from '@vela-ftp/shared';
import { toast } from 'vela-kit/ui';
import { remotePaneKey, usePanesStore } from '../stores/panesStore';
import { useSessionsStore } from '../stores/sessionsStore';

/** Abre un marcador: conecta al sitio si hace falta y lleva ambos paneles a sus carpetas. */
export async function openBookmark(bookmark: Bookmark): Promise<void> {
  const sessions = useSessionsStore.getState();
  const sessionId = await sessions.ensureSession(bookmark.siteId);
  if (!sessionId) return;
  useSessionsStore.getState().activate(sessionId);
  const panes = usePanesStore.getState();
  const key = remotePaneKey(sessionId);
  panes.ensure(key, bookmark.remotePath);
  const ok = await panes.navigate(key, bookmark.remotePath, { pushHistory: true });
  if (!ok) toast(`No se pudo abrir ${bookmark.remotePath}`, 'warning');
  if (bookmark.localPath) await panes.navigate('local', bookmark.localPath, { pushHistory: true });
}

import { toast } from 'vela-kit/ui';
import { call, errorText } from './ipc';
import { promptDialog } from '../stores/dialogStore';
import { usePanesStore } from '../stores/panesStore';
import { useSitesStore } from '../stores/sitesStore';

/**
 * Marca una carpeta remota. La carpeta local abierta en ese momento queda
 * emparejada: al abrir el marcador, el panel local vuelve a ella.
 */
export async function addBookmarkFor(siteId: string, remotePath: string): Promise<void> {
  const existing = useSitesStore.getState().bookmarks.find((b) => b.siteId === siteId && b.remotePath === remotePath);
  if (existing) {
    toast(`Ya está en marcadores como «${existing.name}»`, 'info');
    return;
  }
  const initial = remotePath === '/' ? 'Raíz' : (remotePath.split('/').filter(Boolean).pop() ?? remotePath);
  const name = await promptDialog({
    title: 'Añadir marcador',
    label: remotePath,
    initial,
    confirmLabel: 'Añadir',
    validate: (v) => (v.trim() ? null : 'Escribe un nombre'),
  });
  if (!name) return;
  const localPath = usePanesStore.getState().panes.local?.path ?? null;
  try {
    await call(window.api.bookmarks.create({ siteId, name: name.trim(), remotePath, localPath }));
    toast(`Marcador «${name.trim()}» añadido`, 'success');
  } catch (err) {
    toast(`No se pudo añadir el marcador: ${errorText(err)}`, 'error');
  }
}

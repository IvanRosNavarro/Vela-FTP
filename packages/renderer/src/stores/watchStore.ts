import { create } from 'zustand';
import type { WatchInfo } from '@vela-ftp/shared';
import { toast } from 'vela-kit/ui';
import { call, errorText } from '../lib/ipc';
import { confirmDialog } from './dialogStore';

/** Reflejo de las carpetas vigiladas por main. */
interface WatchState {
  watches: WatchInfo[];
  setWatches(watches: WatchInfo[]): void;
}

export const useWatchStore = create<WatchState>((set) => ({
  watches: [],
  setWatches: (watches) => set({ watches }),
}));

export async function startWatch(sessionId: string, siteName: string, localDir: string, remoteDir: string): Promise<void> {
  const ok = await confirmDialog({
    title: 'Vigilar carpeta',
    message: `Lo que crees o modifiques en\n${localDir}\nse subirá a ${siteName}:${remoteDir}\n\nLo que ya hay no se sube, y borrar en local no borra en el servidor. La vigilancia dura hasta que la pares o cierres Vela FTP.`,
    confirmLabel: 'Vigilar',
    danger: false,
  });
  if (!ok) return;
  try {
    await call(window.api.watch.start(sessionId, localDir, remoteDir));
    toast(`Vigilando ${localDir}`, 'success');
  } catch (err) {
    toast(`No se pudo vigilar: ${errorText(err)}`, 'error');
  }
}

export function stopWatch(id: string): void {
  void call(window.api.watch.stop(id)).catch((err) => toast(errorText(err), 'error'));
}

import type { UpdateStatus } from '@vela-ftp/shared';
import { toast } from 'vela-kit/ui';
import { call, errorText } from './ipc';
import { confirmDialog, useDialogStore } from '../stores/dialogStore';
import { ACTIVE_STATUSES, useQueueStore } from '../stores/queueStore';
import { useUpdatesStore } from '../stores/updatesStore';

export function openUpdatesSettings(): void {
  const dialogs = useDialogStore.getState();
  if (!dialogs.stack.some((d) => d.kind === 'settings')) dialogs.open({ kind: 'settings', section: 'about' });
}

export async function checkForUpdates(): Promise<void> {
  try {
    useUpdatesStore.getState().setStatus(await call(window.api.updates.check()));
  } catch (err) {
    toast(errorText(err), 'error');
  }
}

/** Descarga la versión nueva o, si esta plataforma no se instala sola, abre su página. */
export function downloadUpdate(status: UpdateStatus): void {
  const request = status.canInstall ? window.api.updates.download() : window.api.updates.openRelease();
  void call(request).catch((err) => toast(errorText(err), 'error'));
}

/** Reinicia e instala; si hay transferencias en marcha, avisa antes. */
export async function installUpdate(): Promise<void> {
  const active = Object.values(useQueueStore.getState().jobs).filter((j) => ACTIVE_STATUSES.has(j.status)).length;
  if (active > 0) {
    const ok = await confirmDialog({
      title: 'Instalar actualización',
      message: `Hay ${active} ${active === 1 ? 'transferencia en curso' : 'transferencias en curso'}. Se interrumpirán y podrás reanudarlas desde la cola al volver a abrir Vela FTP.`,
      confirmLabel: 'Reiniciar e instalar',
      danger: false,
    });
    if (!ok) return;
  }
  void call(window.api.updates.install()).catch((err) => toast(errorText(err), 'error'));
}

/** Avisa una sola vez por versión cuando aparece una nueva. */
export function createUpdateNotifier(): (status: UpdateStatus) => void {
  let notified: string | null = null;
  return (status) => {
    if (status.phase !== 'available' || !status.version || status.version === notified) return;
    notified = status.version;
    if (useDialogStore.getState().stack.some((d) => d.kind === 'settings')) return;
    toast(`Vela FTP ${status.version} disponible`, 'info', openUpdatesSettings);
  };
}

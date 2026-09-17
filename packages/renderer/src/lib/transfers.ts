import type { RemoteEntry } from '@vela-ftp/shared';
import { toast } from 'vela-kit/ui';
import { call, errorText } from './ipc';
import { localPaths, remotePaths } from './paths';

async function conflictPolicy() {
  const res = await window.api.settings.get('transfer:conflict-policy');
  return res.ok ? res.data : 'ask';
}

/** Encola la subida de entradas locales a una carpeta remota. */
export async function uploadEntries(sessionId: string, entries: RemoteEntry[], remoteDir: string): Promise<void> {
  if (entries.length === 0) return;
  try {
    await call(
      window.api.queue.enqueue({
        sessionId,
        conflictPolicy: await conflictPolicy(),
        items: entries.map((e) => ({
          direction: 'upload',
          localPath: e.path,
          remotePath: remotePaths.join(remoteDir, e.name),
          isDirectory: e.type === 'dir',
        })),
      }),
    );
  } catch (err) {
    toast(`No se pudo encolar la subida: ${errorText(err)}`, 'error');
  }
}

/** Encola la descarga de entradas remotas a una carpeta local. */
export async function downloadEntries(sessionId: string, entries: RemoteEntry[], localDir: string): Promise<void> {
  if (entries.length === 0) return;
  const local = localPaths(window.api.local.separator);
  try {
    await call(
      window.api.queue.enqueue({
        sessionId,
        conflictPolicy: await conflictPolicy(),
        items: entries.map((e) => ({
          direction: 'download',
          localPath: local.join(localDir, e.name),
          remotePath: e.path,
          isDirectory: e.type === 'dir',
        })),
      }),
    );
  } catch (err) {
    toast(`No se pudo encolar la descarga: ${errorText(err)}`, 'error');
  }
}

/** Sube ficheros arrastrados desde el explorador del sistema. */
export async function uploadDroppedFiles(sessionId: string, files: FileList, remoteDir: string, isDirectory: (path: string) => Promise<boolean>): Promise<void> {
  const local = localPaths(window.api.local.separator);
  const entries: RemoteEntry[] = [];
  for (const file of Array.from(files)) {
    const path = window.api.local.pathForFile(file);
    if (!path) continue;
    entries.push({
      name: local.basename(path),
      path,
      type: (await isDirectory(path)) ? 'dir' : 'file',
      size: file.size,
      modifiedAt: file.lastModified,
      mode: null,
      owner: null,
      group: null,
      target: null,
    });
  }
  await uploadEntries(sessionId, entries, remoteDir);
}

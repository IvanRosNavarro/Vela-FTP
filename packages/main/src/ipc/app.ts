import { mkdir, readdir, lstat, rename, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BrowserWindow, dialog, shell } from 'electron';
import {
  IPC_CHANNELS,
  IPC_EVENTS,
  enqueueInputSchema,
  jobIdsInputSchema,
  localDeleteInputSchema,
  localPathInputSchema,
  localRenameInputSchema,
  masterPasswordInputSchema,
  openFileDialogInputSchema,
  remoteChmodInputSchema,
  remoteDeleteInputSchema,
  remotePathInputSchema,
  remoteRenameInputSchema,
  resolveConflictInputSchema,
  resumeJobsInputSchema,
  sessionIdInputSchema,
  sessionOpenInputSchema,
  siteIdInputSchema,
  siteInputSchema,
  siteMoveInputSchema,
  siteUpdateInputSchema,
  trustFingerprintInputSchema,
  unlockInputSchema,
  type LocalEntry,
  type LocalRoot,
  type TransferJob,
} from '@vela-ftp/shared';
import { v7 as uuidv7 } from 'uuid';
import type { SecretStore } from '../security/SecretStore';
import { restoredSessionId } from '../storage/repositories/TransferJobsRepository';
import type { SessionManager } from '../sessions/SessionManager';
import { forgetSession, rememberSessionOwner } from '../sessions/windowSessions';
import type { KnownHostsRepository } from '../storage/repositories/KnownHostsRepository';
import type { PathHistoryRepository } from '../storage/repositories/ProjectsRepository';
import type { SitesRepository } from '../storage/repositories/SitesRepository';
import type { QueueMirror } from '../transfer/QueueMirror';
import { TransferRequestError, type TransferHost } from '../transfer/TransferHost';
import { broadcast, handle } from './handle';

export interface AppIpcDeps {
  sites: SitesRepository;
  knownHosts: KnownHostsRepository;
  secrets: SecretStore;
  sessions: SessionManager;
  transfer: TransferHost;
  queue: QueueMirror;
  history: PathHistoryRepository;
}

async function listLocal(dir: string): Promise<LocalEntry[]> {
  const dirents = await readdir(dir, { withFileTypes: true });
  const entries = await Promise.all(
    dirents.map(async (d): Promise<LocalEntry | null> => {
      const full = path.join(dir, d.name);
      try {
        const info = await lstat(full);
        let type: LocalEntry['type'] = info.isDirectory() ? 'dir' : info.isFile() ? 'file' : info.isSymbolicLink() ? 'symlink' : 'unknown';
        if (type === 'symlink') {
          // Los enlaces a carpetas se tratan como carpetas para poder entrar.
          const target = await stat(full).catch(() => null);
          if (target?.isDirectory()) type = 'dir';
        }
        return {
          name: d.name,
          path: full,
          type,
          size: info.size,
          modifiedAt: info.mtimeMs,
          mode: process.platform === 'win32' ? null : info.mode & 0o7777,
          owner: null,
          group: null,
          target: null,
        };
      } catch {
        // Ficheros de sistema que no se pueden leer (pagefile.sys…): se omiten.
        return null;
      }
    }),
  );
  return entries.filter((e): e is LocalEntry => e !== null);
}

async function localRoots(): Promise<LocalRoot[]> {
  if (process.platform !== 'win32') {
    return [
      { path: '/', label: '/' },
      { path: os.homedir(), label: 'Inicio' },
    ];
  }
  const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZAB'.split('');
  const found = await Promise.all(
    letters.map(async (l) => {
      const root = `${l}:\\`;
      return (await stat(root).then(() => true).catch(() => false)) ? { path: root, label: `${l}:` } : null;
    }),
  );
  return [{ path: os.homedir(), label: 'Inicio' }, ...found.filter((r): r is LocalRoot => r !== null)];
}

export function registerAppHandlers(deps: AppIpcDeps): void {
  const { sites, knownHosts, secrets, sessions, transfer, queue, history } = deps;
  const sitesChanged = () => broadcast(IPC_EVENTS.SITES_CHANGED, null);
  const vaultChanged = () => broadcast(IPC_EVENTS.VAULT_CHANGED, null);

  // ── Sitios ─────────────────────────────────────────────────────────────
  handle(IPC_CHANNELS.SITES_LIST, null, () => sites.list());
  handle(IPC_CHANNELS.SITES_CREATE, siteInputSchema, (input) => {
    const site = sites.create(input);
    sitesChanged();
    return site;
  });
  handle(IPC_CHANNELS.SITES_UPDATE, siteUpdateInputSchema, ({ id, site }) => {
    const updated = sites.update(id, site);
    sitesChanged();
    return updated;
  });
  handle(IPC_CHANNELS.SITES_DELETE, siteIdInputSchema, ({ id }) => {
    sites.delete(id);
    sitesChanged();
    return null;
  });
  handle(IPC_CHANNELS.SITES_DUPLICATE, siteIdInputSchema, ({ id }) => {
    const copy = sites.duplicate(id);
    sitesChanged();
    return copy;
  });
  handle(IPC_CHANNELS.SITES_MOVE, siteMoveInputSchema, ({ id, beforeId, afterId }) => {
    const moved = sites.move(id, beforeId, afterId);
    sitesChanged();
    return moved;
  });

  handle(IPC_CHANNELS.KNOWN_HOSTS_TRUST, trustFingerprintInputSchema, ({ host, port, fingerprint, keyType, replace }) => {
    knownHosts.trust(host, port, fingerprint, keyType, replace);
    return null;
  });

  // ── Almacén de secretos ─────────────────────────────────────────────────
  handle(IPC_CHANNELS.VAULT_STATUS, null, () => secrets.status());
  handle(IPC_CHANNELS.VAULT_UNLOCK, unlockInputSchema, async ({ password }) => {
    await secrets.unlock(password);
    vaultChanged();
    return null;
  });
  handle(IPC_CHANNELS.VAULT_LOCK, null, () => {
    secrets.lock();
    vaultChanged();
    return null;
  });
  handle(IPC_CHANNELS.VAULT_SET_MASTER_PASSWORD, masterPasswordInputSchema, async ({ current, next }) => {
    await secrets.setMasterPassword(current, next);
    vaultChanged();
    return null;
  });

  // ── Sesiones y operaciones remotas ──────────────────────────────────────
  handle(IPC_CHANNELS.SESSION_OPEN, sessionOpenInputSchema, async ({ siteId }, event) => {
    const info = await sessions.open(siteId);
    sites.recordUse(siteId);
    // Para poder cerrarla si la ventana que la abrió se va.
    rememberSessionOwner(event.sender, info.sessionId);
    return info;
  });
  handle(IPC_CHANNELS.SESSION_CLOSE, sessionIdInputSchema, async ({ sessionId }) => {
    forgetSession(sessionId);
    await sessions.close(sessionId);
    return null;
  });
  handle(IPC_CHANNELS.REMOTE_LIST, remotePathInputSchema, async ({ sessionId, path: p }) => {
    const entries = await transfer.request('fs.list', { sessionId, path: p });
    const siteId = sessions.get(sessionId)?.siteId;
    if (siteId) history.record(siteId, p);
    return entries;
  });
  handle(IPC_CHANNELS.REMOTE_MKDIR, remotePathInputSchema, ({ sessionId, path: p }) => transfer.request('fs.mkdir', { sessionId, path: p }));
  handle(IPC_CHANNELS.REMOTE_RENAME, remoteRenameInputSchema, (input) => transfer.request('fs.rename', input));
  handle(IPC_CHANNELS.REMOTE_CHMOD, remoteChmodInputSchema, (input) => transfer.request('fs.chmod', input));
  handle(IPC_CHANNELS.REMOTE_DELETE, remoteDeleteInputSchema, async ({ sessionId, items }) => {
    for (const item of items) {
      await transfer.request('fs.delete', { sessionId, path: item.path, isDirectory: item.isDirectory });
    }
    return null;
  });

  // ── Disco local ─────────────────────────────────────────────────────────
  handle(IPC_CHANNELS.LOCAL_LIST, localPathInputSchema, ({ path: p }) => listLocal(p));
  handle(IPC_CHANNELS.LOCAL_HOME, null, () => os.homedir());
  handle(IPC_CHANNELS.LOCAL_ROOTS, null, () => localRoots());
  handle(IPC_CHANNELS.LOCAL_MKDIR, localPathInputSchema, async ({ path: p }) => {
    await mkdir(p);
    return null;
  });
  handle(IPC_CHANNELS.LOCAL_RENAME, localRenameInputSchema, async ({ from, to }) => {
    if (await stat(to).then(() => true).catch(() => false)) {
      throw Object.assign(new Error(`Ya existe: ${to}`), { code: 'EEXIST' });
    }
    await rename(from, to);
    return null;
  });
  handle(IPC_CHANNELS.LOCAL_TRASH, localDeleteInputSchema, async ({ paths }) => {
    for (const p of paths) await shell.trashItem(p);
    return null;
  });
  handle(IPC_CHANNELS.LOCAL_OPEN, localPathInputSchema, async ({ path: p }) => {
    const error = await shell.openPath(p);
    if (error) throw new Error(error);
    return null;
  });
  handle(IPC_CHANNELS.LOCAL_REVEAL, localPathInputSchema, ({ path: p }) => {
    shell.showItemInFolder(p);
    return null;
  });

  // ── Cola ────────────────────────────────────────────────────────────────
  handle(IPC_CHANNELS.QUEUE_ENQUEUE, enqueueInputSchema, async ({ sessionId, conflictPolicy, items }) => {
    if (!sessions.get(sessionId)) {
      throw new TransferRequestError({ code: 'NOT_CONNECTED', message: 'La sesión no está abierta' });
    }
    const jobs: TransferJob[] = items.map((item) => ({
      id: uuidv7(),
      sessionId,
      direction: item.direction,
      localPath: item.localPath,
      remotePath: item.remotePath,
      isDirectory: item.isDirectory,
      conflictPolicy,
      parentId: null,
    }));
    await transfer.request('queue.enqueue', { jobs });
    return jobs.map((j) => j.id);
  });
  handle(IPC_CHANNELS.QUEUE_CANCEL, jobIdsInputSchema, ({ jobIds }) => transfer.request('queue.cancel', { jobIds }));
  handle(IPC_CHANNELS.QUEUE_RETRY, jobIdsInputSchema, ({ jobIds }) => transfer.request('queue.retry', { jobIds }));
  handle(IPC_CHANNELS.QUEUE_REMOVE, jobIdsInputSchema, async ({ jobIds }) => {
    queue.removeRestored(jobIds);
    const live = jobIds.filter((id) => queue.get(id));
    if (live.length > 0) await transfer.request('queue.remove', { jobIds: live });
    return null;
  });
  handle(IPC_CHANNELS.QUEUE_RESUME, resumeJobsInputSchema, async ({ sessionId, jobIds }) => {
    const session = sessions.get(sessionId);
    if (!session) throw new TransferRequestError({ code: 'NOT_CONNECTED', message: 'La sesión no está abierta' });
    const restored = jobIds
      .map((id) => queue.get(id))
      .filter((j): j is NonNullable<typeof j> => !!j && j.sessionId === restoredSessionId(session.siteId));
    if (restored.length === 0) return [];
    // Reanudar: lo ya transferido se aprovecha si el destino es un trozo del origen.
    const jobs: TransferJob[] = restored.map((j) => ({
      id: uuidv7(),
      sessionId,
      direction: j.direction,
      localPath: j.localPath,
      remotePath: j.remotePath,
      isDirectory: j.isDirectory,
      conflictPolicy: 'resume',
      parentId: null,
    }));
    await transfer.request('queue.enqueue', { jobs });
    queue.removeRestored(restored.map((j) => j.id));
    return jobs.map((j) => j.id);
  });
  handle(IPC_CHANNELS.QUEUE_RESOLVE_CONFLICT, resolveConflictInputSchema, (input) => transfer.request('queue.resolveConflict', input));
  handle(IPC_CHANNELS.QUEUE_SNAPSHOT, null, () => queue.snapshot());

  handle(IPC_CHANNELS.DIALOG_OPEN, openFileDialogInputSchema, async ({ title, directory }, event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options = { title, properties: [directory ? ('openDirectory' as const) : ('openFile' as const), 'showHiddenFiles' as const] };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
}

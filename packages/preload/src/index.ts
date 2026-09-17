import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
// Subpath: el índice de shared arrastraría zod y los schemas al preload.
import { IPC_CHANNELS as C, IPC_EVENTS } from '@vela-ftp/shared/ipc-channels';
import type { Platform, PreloadApi } from '@vela-ftp/shared';

const ALLOWED_EVENTS = new Set<string>(Object.values(IPC_EVENTS));
const invoke = (channel: string, payload?: unknown) => ipcRenderer.invoke(channel, payload);

const api: PreloadApi = {
  platform: process.platform as Platform,

  settings: {
    get: (key) => invoke(C.SETTINGS_GET, { key }),
    set: (key, value) => invoke(C.SETTINGS_SET, { key, value }),
  },

  window: {
    minimize: () => invoke(C.WINDOW_MINIMIZE),
    toggleMaximize: () => invoke(C.WINDOW_TOGGLE_MAXIMIZE),
    close: () => invoke(C.WINDOW_CLOSE),
    isMaximized: () => invoke(C.WINDOW_IS_MAXIMIZED),
    updateTitleBarOverlay: (colors) => invoke(C.WINDOW_UPDATE_TITLE_BAR_OVERLAY, colors),
  },

  sites: {
    list: () => invoke(C.SITES_LIST),
    create: (site) => invoke(C.SITES_CREATE, site),
    update: (id, site) => invoke(C.SITES_UPDATE, { id, site }),
    delete: (id) => invoke(C.SITES_DELETE, { id }),
    duplicate: (id) => invoke(C.SITES_DUPLICATE, { id }),
    move: (id, beforeId, afterId) => invoke(C.SITES_MOVE, { id, beforeId, afterId }),
  },

  vault: {
    status: () => invoke(C.VAULT_STATUS),
    unlock: (password) => invoke(C.VAULT_UNLOCK, { password }),
    lock: () => invoke(C.VAULT_LOCK),
    setMasterPassword: (current, next) => invoke(C.VAULT_SET_MASTER_PASSWORD, { current, next }),
  },

  sessions: {
    open: (siteId) => invoke(C.SESSION_OPEN, { siteId }),
    close: (sessionId) => invoke(C.SESSION_CLOSE, { sessionId }),
    trust: (input) => invoke(C.KNOWN_HOSTS_TRUST, input),
  },

  remote: {
    list: (sessionId, path) => invoke(C.REMOTE_LIST, { sessionId, path }),
    mkdir: (sessionId, path) => invoke(C.REMOTE_MKDIR, { sessionId, path }),
    rename: (sessionId, from, to) => invoke(C.REMOTE_RENAME, { sessionId, from, to }),
    delete: (sessionId, items) => invoke(C.REMOTE_DELETE, { sessionId, items }),
    chmod: (sessionId, path, mode) => invoke(C.REMOTE_CHMOD, { sessionId, path, mode }),
  },

  local: {
    list: (path) => invoke(C.LOCAL_LIST, { path }),
    home: () => invoke(C.LOCAL_HOME),
    roots: () => invoke(C.LOCAL_ROOTS),
    mkdir: (path) => invoke(C.LOCAL_MKDIR, { path }),
    rename: (from, to) => invoke(C.LOCAL_RENAME, { from, to }),
    trash: (paths) => invoke(C.LOCAL_TRASH, { paths }),
    open: (path) => invoke(C.LOCAL_OPEN, { path }),
    reveal: (path) => invoke(C.LOCAL_REVEAL, { path }),
    pathForFile: (file) => webUtils.getPathForFile(file),
    separator: process.platform === 'win32' ? '\\' : '/',
  },

  queue: {
    enqueue: (input) => invoke(C.QUEUE_ENQUEUE, input),
    cancel: (jobIds) => invoke(C.QUEUE_CANCEL, { jobIds }),
    retry: (jobIds) => invoke(C.QUEUE_RETRY, { jobIds }),
    remove: (jobIds) => invoke(C.QUEUE_REMOVE, { jobIds }),
    resolveConflict: (jobId, decision, applyToAll) => invoke(C.QUEUE_RESOLVE_CONFLICT, { jobId, decision, applyToAll }),
    snapshot: () => invoke(C.QUEUE_SNAPSHOT),
  },

  dialog: {
    open: (options) => invoke(C.DIALOG_OPEN, options),
  },

  on: (event, listener) => {
    if (!ALLOWED_EVENTS.has(event)) {
      throw new Error(`Evento no permitido: ${event}`);
    }
    // El main es quien emite estos eventos con el payload de MainEventPayloads.
    const wrapped = (_e: IpcRendererEvent, payload: unknown) => listener(payload as Parameters<typeof listener>[0]);
    ipcRenderer.on(event, wrapped);
    return () => {
      ipcRenderer.removeListener(event, wrapped);
    };
  },
};

contextBridge.exposeInMainWorld('api', api);

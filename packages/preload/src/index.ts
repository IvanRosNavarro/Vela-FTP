import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
// Subpath: el índice de shared arrastraría zod y los schemas al preload.
import { IPC_CHANNELS as C, IPC_EVENTS, TERMINAL_PORT_CHANNEL } from '@vela-ftp/shared/ipc-channels';
import type { Platform, PreloadApi, TerminalInput, TerminalOutput } from '@vela-ftp/shared';

const ALLOWED_EVENTS = new Set<string>(Object.values(IPC_EVENTS));
const invoke = (channel: string, payload?: unknown) => ipcRenderer.invoke(channel, payload);

// ── Terminales ────────────────────────────────────────────────────────────
// main entrega aquí el extremo del MessagePort de cada terminal; el otro está
// en el motor. El puerto no sale del preload: el renderer usa `api.terminal`.
interface TerminalChannel {
  port: MessagePort;
  listener: ((message: TerminalOutput) => void) | null;
  /** Salida recibida antes de que el renderer empiece a escuchar. */
  buffer: TerminalOutput[];
}
const terminals = new Map<string, TerminalChannel>();
const portWaiters = new Map<string, () => void>();
const PORT_WAIT_MS = 5000;

ipcRenderer.on(TERMINAL_PORT_CHANNEL, (event: IpcRendererEvent, payload: { terminalId?: unknown }) => {
  const port = event.ports[0];
  const terminalId = payload?.terminalId;
  if (!port || typeof terminalId !== 'string') return;
  const channel: TerminalChannel = { port, listener: null, buffer: [] };
  port.onmessage = (e: MessageEvent<TerminalOutput>) => {
    if (channel.listener) channel.listener(e.data);
    else channel.buffer.push(e.data);
  };
  terminals.set(terminalId, channel);
  portWaiters.get(terminalId)?.();
  portWaiters.delete(terminalId);
});

const sendToTerminal = (terminalId: string, message: TerminalInput) => terminals.get(terminalId)?.port.postMessage(message);

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
    backgroundMaterial: () => invoke(C.WINDOW_BACKGROUND_MATERIAL),
  },

  sites: {
    list: () => invoke(C.SITES_LIST),
    create: (site) => invoke(C.SITES_CREATE, site),
    update: (id, site) => invoke(C.SITES_UPDATE, { id, site }),
    delete: (id) => invoke(C.SITES_DELETE, { id }),
    duplicate: (id) => invoke(C.SITES_DUPLICATE, { id }),
    move: (id, beforeId, afterId) => invoke(C.SITES_MOVE, { id, beforeId, afterId }),
    relocate: (id, projectId, beforeId, afterId) => invoke(C.SITES_RELOCATE, { id, projectId, beforeId, afterId }),
  },

  projects: {
    list: () => invoke(C.PROJECTS_LIST),
    create: (input) => invoke(C.PROJECTS_CREATE, input),
    update: (id, patch) => invoke(C.PROJECTS_UPDATE, { id, ...patch }),
    delete: (id) => invoke(C.PROJECTS_DELETE, { id }),
    move: (id, beforeId, afterId) => invoke(C.PROJECTS_MOVE, { id, beforeId, afterId }),
  },

  bookmarks: {
    list: () => invoke(C.BOOKMARKS_LIST),
    create: (input) => invoke(C.BOOKMARKS_CREATE, input),
    update: (id, patch) => invoke(C.BOOKMARKS_UPDATE, { id, ...patch }),
    delete: (id) => invoke(C.BOOKMARKS_DELETE, { id }),
    history: (siteId, limit) => invoke(C.HISTORY_LIST, { siteId, limit }),
  },

  commands: {
    list: () => invoke(C.COMMANDS_LIST),
    execute: (id) => invoke(C.COMMANDS_EXECUTE, { id }),
    setShortcut: (commandId, combo) => invoke(C.SHORTCUTS_SET, { commandId, combo }),
    resetShortcuts: () => invoke(C.SHORTCUTS_RESET),
    suspendShortcuts: (suspended) => invoke(C.SHORTCUTS_SUSPEND, { suspended }),
  },

  import: {
    previewFileZilla: (path) => invoke(C.IMPORT_FILEZILLA_PREVIEW, { path }),
    applyFileZilla: (path, keys) => invoke(C.IMPORT_FILEZILLA_APPLY, { path, keys }),
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
    knownHosts: () => invoke(C.KNOWN_HOSTS_LIST),
    forget: (host, port, fingerprint) => invoke(C.KNOWN_HOSTS_REMOVE, { host, port, fingerprint }),
  },

  terminal: {
    open: async (sessionId, cols, rows) => {
      const res = await invoke(C.TERMINAL_OPEN, { sessionId, cols, rows });
      const terminalId: string | undefined = res?.ok ? res.data.terminalId : undefined;
      // El puerto suele llegar antes que la respuesta, pero no está garantizado.
      if (terminalId && !terminals.has(terminalId)) {
        await new Promise<void>((resolve) => {
          portWaiters.set(terminalId, resolve);
          setTimeout(resolve, PORT_WAIT_MS);
        });
        portWaiters.delete(terminalId);
      }
      return res;
    },
    listen: (terminalId, listener) => {
      const channel = terminals.get(terminalId);
      if (!channel) {
        listener({ t: 'lost', message: 'La terminal no existe' });
        return () => undefined;
      }
      channel.listener = listener;
      for (const message of channel.buffer.splice(0)) listener(message);
      return () => {
        if (channel.listener === listener) channel.listener = null;
      };
    },
    write: (terminalId, data) => sendToTerminal(terminalId, { t: 'data', data }),
    writeBinary: (terminalId, data) => sendToTerminal(terminalId, { t: 'binary', data }),
    resize: (terminalId, cols, rows) => sendToTerminal(terminalId, { t: 'resize', cols, rows }),
    close: (terminalId) => {
      const channel = terminals.get(terminalId);
      if (!channel) return;
      terminals.delete(terminalId);
      channel.port.postMessage({ t: 'close' } satisfies TerminalInput);
      channel.port.close();
    },
    setFocused: (focused) => invoke(C.TERMINAL_FOCUS, { focused }),
    openLink: (url) => invoke(C.TERMINAL_OPEN_LINK, { url }),
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
    startDrag: (paths) => invoke(C.LOCAL_START_DRAG, { paths }),
    copyInto: (paths, targetDir) => invoke(C.LOCAL_COPY_INTO, { paths, targetDir }),
    separator: process.platform === 'win32' ? '\\' : '/',
  },

  queue: {
    enqueue: (input) => invoke(C.QUEUE_ENQUEUE, input),
    cancel: (jobIds) => invoke(C.QUEUE_CANCEL, { jobIds }),
    retry: (jobIds) => invoke(C.QUEUE_RETRY, { jobIds }),
    remove: (jobIds) => invoke(C.QUEUE_REMOVE, { jobIds }),
    resolveConflict: (jobId, decision, applyToAll) => invoke(C.QUEUE_RESOLVE_CONFLICT, { jobId, decision, applyToAll }),
    snapshot: () => invoke(C.QUEUE_SNAPSHOT),
    resume: (sessionId, jobIds) => invoke(C.QUEUE_RESUME, { sessionId, jobIds }),
  },

  dialog: {
    open: (options) => invoke(C.DIALOG_OPEN, options),
  },

  files: {
    editRemote: (sessionId, path) => invoke(C.FILES_EDIT_REMOTE, { sessionId, path }),
    previewRemote: (sessionId, path) => invoke(C.FILES_PREVIEW_REMOTE, { sessionId, path }),
    previewLocal: (path) => invoke(C.FILES_PREVIEW_LOCAL, { path }),
    diff: (sessionId, remotePath, localPath) => invoke(C.FILES_DIFF, { sessionId, remotePath, localPath }),
    openExternal: (sessionId, path, mode) => invoke(C.FILES_OPEN_EXTERNAL, { sessionId, path, mode }),
    uploadExternal: (id, force) => invoke(C.FILES_UPLOAD_EXTERNAL, { id, force }),
    prepareDrag: (sessionId, items) => invoke(C.FILES_PREPARE_DRAG, { sessionId, items }),
  },

  editor: {
    load: (id) => invoke(C.EDITOR_LOAD, { id }),
    save: (id, content, force) => invoke(C.EDITOR_SAVE, { id, content, force }),
    setDirty: (id, dirty) => invoke(C.EDITOR_SET_DIRTY, { id, dirty }),
    close: (id) => invoke(C.EDITOR_CLOSE, { id }),
  },

  sync: {
    status: () => invoke(C.SYNC_STATUS),
    requestLink: (email) => invoke(C.SYNC_REQUEST_LINK, { email }),
    activate: (password) => invoke(C.SYNC_ACTIVATE, { password }),
    deactivate: () => invoke(C.SYNC_DEACTIVATE),
    now: () => invoke(C.SYNC_NOW),
    setCategories: (disabled) => invoke(C.SYNC_SET_CATEGORIES, { disabled }),
  },

  watch: {
    list: () => invoke(C.WATCH_LIST),
    start: (sessionId, localDir, remoteDir) => invoke(C.WATCH_START, { sessionId, localDir, remoteDir }),
    stop: (id) => invoke(C.WATCH_STOP, { id }),
  },

  updates: {
    status: () => invoke(C.UPDATES_STATUS),
    check: () => invoke(C.UPDATES_CHECK),
    download: () => invoke(C.UPDATES_DOWNLOAD),
    install: () => invoke(C.UPDATES_INSTALL),
    openRelease: () => invoke(C.UPDATES_OPEN_RELEASE),
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

// Canales IPC renderer → main. Patrón: `{dominio}:{accion}`.
import type { BaseIpcErrorCode } from 'vela-kit/ipc';
import type { CommandAction } from './commands';
import type { UpdateStatus } from './updates';
import type { WatchInfo } from './schemas/watch';
import type { SyncStatus } from './schemas/sync';
import type { ExternalFileEvent } from './schemas/editor';
import type { ConflictInfo, JobSnapshot, ProtocolLogLine, TransferError, TransferErrorCode } from './transfer/types';

export const IPC_CHANNELS = {
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',

  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_TOGGLE_MAXIMIZE: 'window:toggle-maximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_IS_MAXIMIZED: 'window:is-maximized',
  WINDOW_UPDATE_TITLE_BAR_OVERLAY: 'window:update-title-bar-overlay',
  WINDOW_BACKGROUND_MATERIAL: 'window:background-material',

  SITES_LIST: 'sites:list',
  SITES_CREATE: 'sites:create',
  SITES_UPDATE: 'sites:update',
  SITES_DELETE: 'sites:delete',
  SITES_DUPLICATE: 'sites:duplicate',
  SITES_MOVE: 'sites:move',
  SITES_RELOCATE: 'sites:relocate',

  PROJECTS_LIST: 'projects:list',
  PROJECTS_CREATE: 'projects:create',
  PROJECTS_UPDATE: 'projects:update',
  PROJECTS_DELETE: 'projects:delete',
  PROJECTS_MOVE: 'projects:move',

  BOOKMARKS_LIST: 'bookmarks:list',
  BOOKMARKS_CREATE: 'bookmarks:create',
  BOOKMARKS_UPDATE: 'bookmarks:update',
  BOOKMARKS_DELETE: 'bookmarks:delete',

  HISTORY_LIST: 'history:list',

  COMMANDS_LIST: 'commands:list',
  COMMANDS_EXECUTE: 'commands:execute',
  SHORTCUTS_SET: 'shortcuts:set',
  SHORTCUTS_RESET: 'shortcuts:reset',
  SHORTCUTS_SUSPEND: 'shortcuts:suspend',

  IMPORT_FILEZILLA_PREVIEW: 'import:filezilla-preview',
  IMPORT_FILEZILLA_APPLY: 'import:filezilla-apply',

  KNOWN_HOSTS_TRUST: 'known-hosts:trust',
  KNOWN_HOSTS_LIST: 'known-hosts:list',
  KNOWN_HOSTS_REMOVE: 'known-hosts:remove',

  VAULT_STATUS: 'vault:status',
  VAULT_UNLOCK: 'vault:unlock',
  VAULT_LOCK: 'vault:lock',
  VAULT_SET_MASTER_PASSWORD: 'vault:set-master-password',

  SESSION_OPEN: 'session:open',
  SESSION_CLOSE: 'session:close',

  REMOTE_LIST: 'remote:list',
  REMOTE_MKDIR: 'remote:mkdir',
  REMOTE_RENAME: 'remote:rename',
  REMOTE_DELETE: 'remote:delete',
  REMOTE_CHMOD: 'remote:chmod',

  LOCAL_LIST: 'local:list',
  LOCAL_HOME: 'local:home',
  LOCAL_ROOTS: 'local:roots',
  LOCAL_MKDIR: 'local:mkdir',
  LOCAL_RENAME: 'local:rename',
  LOCAL_TRASH: 'local:trash',
  LOCAL_OPEN: 'local:open',
  LOCAL_REVEAL: 'local:reveal',
  LOCAL_START_DRAG: 'local:start-drag',
  LOCAL_COPY_INTO: 'local:copy-into',

  QUEUE_ENQUEUE: 'queue:enqueue',
  QUEUE_CANCEL: 'queue:cancel',
  QUEUE_RETRY: 'queue:retry',
  QUEUE_REMOVE: 'queue:remove',
  QUEUE_RESOLVE_CONFLICT: 'queue:resolve-conflict',
  QUEUE_SNAPSHOT: 'queue:snapshot',
  QUEUE_RESUME: 'queue:resume',

  DIALOG_OPEN: 'dialog:open',

  FILES_EDIT_REMOTE: 'files:edit-remote',
  FILES_PREVIEW_REMOTE: 'files:preview-remote',
  FILES_PREVIEW_LOCAL: 'files:preview-local',
  FILES_DIFF: 'files:diff',
  FILES_OPEN_EXTERNAL: 'files:open-external',
  FILES_UPLOAD_EXTERNAL: 'files:upload-external',
  FILES_PREPARE_DRAG: 'files:prepare-drag',
  EDITOR_LOAD: 'editor:load',
  EDITOR_SAVE: 'editor:save',
  EDITOR_SET_DIRTY: 'editor:set-dirty',
  EDITOR_CLOSE: 'editor:close',
  SYNC_STATUS: 'sync:status',
  SYNC_REQUEST_LINK: 'sync:request-link',
  SYNC_ACTIVATE: 'sync:activate',
  SYNC_DEACTIVATE: 'sync:deactivate',
  SYNC_NOW: 'sync:now',
  SYNC_SET_CATEGORIES: 'sync:set-categories',

  WATCH_LIST: 'watch:list',
  WATCH_START: 'watch:start',
  WATCH_STOP: 'watch:stop',

  TERMINAL_OPEN: 'terminal:open',
  TERMINAL_FOCUS: 'terminal:focus',
  TERMINAL_OPEN_LINK: 'terminal:open-link',

  UPDATES_STATUS: 'updates:status',
  UPDATES_CHECK: 'updates:check',
  UPDATES_DOWNLOAD: 'updates:download',
  UPDATES_INSTALL: 'updates:install',
  UPDATES_OPEN_RELEASE: 'updates:open-release',
} as const;

// Eventos push main → renderer.
export const IPC_EVENTS = {
  WINDOW_MAXIMIZED_CHANGED: 'state:window-maximized-changed',
  SITES_CHANGED: 'state:sites-changed',
  VAULT_CHANGED: 'state:vault-changed',
  QUEUE_UPDATED: 'state:queue-updated',
  QUEUE_CONFLICT: 'state:queue-conflict',
  PROTOCOL_LOG: 'state:protocol-log',
  SESSION_LOST: 'state:session-lost',
  TRANSFER_RESTARTED: 'state:transfer-restarted',
  PROJECTS_CHANGED: 'state:projects-changed',
  BOOKMARKS_CHANGED: 'state:bookmarks-changed',
  COMMAND_ACTION: 'state:command-action',
  UPDATES_CHANGED: 'state:updates-changed',
  /** El usuario quiere cerrar un editor con cambios sin guardar. */
  EDITOR_CLOSE_REQUESTED: 'state:editor-close-requested',
  WATCHES_CHANGED: 'state:watches-changed',
  SYNC_CHANGED: 'state:sync-changed',
  EXTERNAL_FILE: 'state:external-file',
  /** La sincronización ha traído datos nuevos: el renderer recarga sitios y marcadores. */
  SYNC_DATA_CHANGED: 'state:sync-data-changed',
} as const;

/**
 * main → preload: el extremo del MessagePort de una terminal recién abierta.
 * No está en IPC_EVENTS: lo recoge el preload y el renderer nunca ve el puerto.
 */
export const TERMINAL_PORT_CHANNEL = 'state:terminal-port';

export type IpcEventName = (typeof IPC_EVENTS)[keyof typeof IPC_EVENTS];

export interface MainEventPayloads {
  [IPC_EVENTS.WINDOW_MAXIMIZED_CHANGED]: { maximized: boolean };
  [IPC_EVENTS.SITES_CHANGED]: null;
  [IPC_EVENTS.VAULT_CHANGED]: null;
  [IPC_EVENTS.QUEUE_UPDATED]: { jobs: JobSnapshot[]; removedIds: string[] };
  [IPC_EVENTS.QUEUE_CONFLICT]: ConflictInfo;
  [IPC_EVENTS.PROTOCOL_LOG]: ProtocolLogLine[];
  [IPC_EVENTS.SESSION_LOST]: { sessionId: string; error: TransferError };
  [IPC_EVENTS.TRANSFER_RESTARTED]: null;
  [IPC_EVENTS.PROJECTS_CHANGED]: null;
  [IPC_EVENTS.BOOKMARKS_CHANGED]: null;
  [IPC_EVENTS.COMMAND_ACTION]: { action: CommandAction };
  [IPC_EVENTS.UPDATES_CHANGED]: UpdateStatus;
  [IPC_EVENTS.EDITOR_CLOSE_REQUESTED]: null;
  [IPC_EVENTS.WATCHES_CHANGED]: WatchInfo[];
  [IPC_EVENTS.SYNC_CHANGED]: SyncStatus;
  [IPC_EVENTS.EXTERNAL_FILE]: ExternalFileEvent;
  [IPC_EVENTS.SYNC_DATA_CHANGED]: null;
}

/** Códigos de error que el renderer puede recibir en un `IpcResponse`. */
export type AppErrorCode =
  | BaseIpcErrorCode
  | TransferErrorCode
  | 'VAULT_LOCKED'
  | 'INVALID_MASTER_PASSWORD'
  | 'KEYCHAIN_UNAVAILABLE'
  | 'BINARY_FILE';

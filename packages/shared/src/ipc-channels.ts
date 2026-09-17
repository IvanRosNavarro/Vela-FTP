// Canales IPC renderer → main. Patrón: `{dominio}:{accion}`.
import type { BaseIpcErrorCode } from 'vela-kit/ipc';
import type { CommandAction } from './commands';
import type { ConflictInfo, JobSnapshot, ProtocolLogLine, TransferError, TransferErrorCode } from './transfer/types';

export const IPC_CHANNELS = {
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',

  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_TOGGLE_MAXIMIZE: 'window:toggle-maximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_IS_MAXIMIZED: 'window:is-maximized',
  WINDOW_UPDATE_TITLE_BAR_OVERLAY: 'window:update-title-bar-overlay',

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

  QUEUE_ENQUEUE: 'queue:enqueue',
  QUEUE_CANCEL: 'queue:cancel',
  QUEUE_RETRY: 'queue:retry',
  QUEUE_REMOVE: 'queue:remove',
  QUEUE_RESOLVE_CONFLICT: 'queue:resolve-conflict',
  QUEUE_SNAPSHOT: 'queue:snapshot',
  QUEUE_RESUME: 'queue:resume',

  DIALOG_OPEN: 'dialog:open',
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
} as const;

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
}

/** Códigos de error que el renderer puede recibir en un `IpcResponse`. */
export type AppErrorCode =
  | BaseIpcErrorCode
  | TransferErrorCode
  | 'VAULT_LOCKED'
  | 'INVALID_MASTER_PASSWORD'
  | 'KEYCHAIN_UNAVAILABLE';

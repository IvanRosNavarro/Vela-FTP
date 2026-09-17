import type { IpcResponse } from 'vela-kit/ipc';
import type { AppErrorCode, IpcEventName, MainEventPayloads } from './ipc-channels';
import type {
  EnqueueInput,
  LocalEntry,
  LocalRoot,
  SessionInfo,
  SettingKey,
  SettingValue,
  Site,
  SiteInput,
  TitleBarOverlayInput,
} from './schemas';
import type { ConflictDecision, JobSnapshot, RemoteEntry } from './transfer/types';

export type Platform = 'win32' | 'darwin' | 'linux';

/** Respuesta IPC con los códigos de error de la app. */
export type AppResponse<T> = IpcResponse<T, AppErrorCode>;

export interface SettingsApi {
  get<K extends SettingKey>(key: K): Promise<AppResponse<SettingValue<K>>>;
  set<K extends SettingKey>(key: K, value: SettingValue<K>): Promise<AppResponse<null>>;
}

export interface WindowApi {
  minimize(): Promise<AppResponse<null>>;
  toggleMaximize(): Promise<AppResponse<null>>;
  close(): Promise<AppResponse<null>>;
  isMaximized(): Promise<AppResponse<boolean>>;
  /** Solo tiene efecto en Windows. */
  updateTitleBarOverlay(colors: TitleBarOverlayInput): Promise<AppResponse<null>>;
}

export interface SitesApi {
  list(): Promise<AppResponse<Site[]>>;
  create(site: SiteInput): Promise<AppResponse<Site>>;
  update(id: string, site: SiteInput): Promise<AppResponse<Site>>;
  delete(id: string): Promise<AppResponse<null>>;
  duplicate(id: string): Promise<AppResponse<Site>>;
  move(id: string, beforeId: string | null, afterId: string | null): Promise<AppResponse<Site>>;
}

export interface VaultStatusInfo {
  mode: 'keychain' | 'master-password' | 'uninitialized';
  locked: boolean;
  keychainAvailable: boolean;
}

export interface VaultApi {
  status(): Promise<AppResponse<VaultStatusInfo>>;
  unlock(password: string): Promise<AppResponse<null>>;
  lock(): Promise<AppResponse<null>>;
  setMasterPassword(current: string | null, next: string | null): Promise<AppResponse<null>>;
}

export interface TrustInput {
  host: string;
  port: number;
  fingerprint: string;
  keyType: string | null;
  replace: boolean;
}

export interface SessionsApi {
  open(siteId: string): Promise<AppResponse<SessionInfo>>;
  close(sessionId: string): Promise<AppResponse<null>>;
  trust(input: TrustInput): Promise<AppResponse<null>>;
}

export interface RemoteApi {
  list(sessionId: string, path: string): Promise<AppResponse<RemoteEntry[]>>;
  mkdir(sessionId: string, path: string): Promise<AppResponse<null>>;
  rename(sessionId: string, from: string, to: string): Promise<AppResponse<null>>;
  delete(sessionId: string, items: Array<{ path: string; isDirectory: boolean }>): Promise<AppResponse<null>>;
  chmod(sessionId: string, path: string, mode: number): Promise<AppResponse<null>>;
}

export interface LocalApi {
  list(path: string): Promise<AppResponse<LocalEntry[]>>;
  home(): Promise<AppResponse<string>>;
  roots(): Promise<AppResponse<LocalRoot[]>>;
  mkdir(path: string): Promise<AppResponse<null>>;
  rename(from: string, to: string): Promise<AppResponse<null>>;
  /** Mueve a la papelera del sistema. */
  trash(paths: string[]): Promise<AppResponse<null>>;
  open(path: string): Promise<AppResponse<null>>;
  reveal(path: string): Promise<AppResponse<null>>;
  /** Ruta de un File arrastrado desde el explorador del SO. */
  pathForFile(file: File): string;
  separator: '/' | '\\';
}

export interface QueueApi {
  enqueue(input: EnqueueInput): Promise<AppResponse<string[]>>;
  cancel(jobIds: string[]): Promise<AppResponse<null>>;
  retry(jobIds: string[]): Promise<AppResponse<null>>;
  remove(jobIds: string[]): Promise<AppResponse<null>>;
  resolveConflict(jobId: string, decision: ConflictDecision, applyToAll: boolean): Promise<AppResponse<null>>;
  snapshot(): Promise<AppResponse<JobSnapshot[]>>;
}

export interface DialogApi {
  /** Ruta elegida o null si se cancela. */
  open(options: { title: string; directory: boolean }): Promise<AppResponse<string | null>>;
}

export interface PreloadApi {
  platform: Platform;
  settings: SettingsApi;
  window: WindowApi;
  sites: SitesApi;
  vault: VaultApi;
  sessions: SessionsApi;
  remote: RemoteApi;
  local: LocalApi;
  queue: QueueApi;
  dialog: DialogApi;
  /** Suscribe a un evento push del main. Devuelve la función de baja. */
  on<E extends IpcEventName>(event: E, listener: (payload: MainEventPayloads[E]) => void): () => void;
}

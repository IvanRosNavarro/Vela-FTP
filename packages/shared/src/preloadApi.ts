import type { IpcResponse } from 'vela-kit/ipc';
import type { AppErrorCode, IpcEventName, MainEventPayloads } from './ipc-channels';
import type { CommandInfo } from './commands';
import type {
  Bookmark,
  BookmarkInput,
  EditorDocument,
  EditorSaveResult,
  EnqueueInput,
  FilePreview,
  FileZillaPreview,
  PathVisit,
  Project,
  ProjectInput,
  LocalEntry,
  LocalRoot,
  SessionInfo,
  SettingKey,
  SettingValue,
  Site,
  SiteInput,
  TitleBarOverlayInput,
  SyncCategory,
  SyncStatus,
  WatchInfo,
} from './schemas';
import type { UpdateStatus } from './updates';
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
  /** Mueve a otro proyecto (null = ninguno) entre dos vecinos de ese grupo. */
  relocate(id: string, projectId: string | null, beforeId: string | null, afterId: string | null): Promise<AppResponse<Site>>;
}

export interface ProjectsApi {
  list(): Promise<AppResponse<Project[]>>;
  create(input: ProjectInput): Promise<AppResponse<Project>>;
  update(id: string, patch: { name?: string; color?: string | null; collapsed?: boolean }): Promise<AppResponse<Project>>;
  delete(id: string): Promise<AppResponse<null>>;
  move(id: string, beforeId: string | null, afterId: string | null): Promise<AppResponse<Project>>;
}

export interface BookmarksApi {
  list(): Promise<AppResponse<Bookmark[]>>;
  create(input: BookmarkInput): Promise<AppResponse<Bookmark>>;
  update(id: string, patch: { name?: string; localPath?: string | null }): Promise<AppResponse<Bookmark>>;
  delete(id: string): Promise<AppResponse<null>>;
  history(siteId: string, limit: number): Promise<AppResponse<PathVisit[]>>;
}

export interface KnownHostInfo {
  host: string;
  port: number;
  fingerprint: string;
  keyType: string | null;
  addedAt: number;
}

export interface CommandsApi {
  list(): Promise<AppResponse<CommandInfo[]>>;
  execute(id: string): Promise<AppResponse<null>>;
  /** Devuelve la lista actualizada. INVALID_INPUT con `details.message` si no se puede. */
  setShortcut(commandId: string, combo: string | null): Promise<AppResponse<CommandInfo[]>>;
  resetShortcuts(): Promise<AppResponse<CommandInfo[]>>;
  /** Suspende los atajos de esta ventana (mientras se captura uno nuevo). */
  suspendShortcuts(suspended: boolean): Promise<AppResponse<null>>;
}

export interface ImportApi {
  /** `path` null = ubicación por defecto de FileZilla. */
  previewFileZilla(path: string | null): Promise<AppResponse<FileZillaPreview>>;
  applyFileZilla(path: string, keys: string[]): Promise<AppResponse<{ created: number }>>;
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
  knownHosts(): Promise<AppResponse<KnownHostInfo[]>>;
  forget(host: string, port: number, fingerprint: string): Promise<AppResponse<null>>;
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
  /** Reencola en `sessionId`, reanudando, trabajos recuperados al abrir la app. Devuelve los ids nuevos. */
  resume(sessionId: string, jobIds: string[]): Promise<AppResponse<string[]>>;
}

export interface DialogApi {
  /** Ruta elegida o null si se cancela. */
  open(options: { title: string; directory: boolean }): Promise<AppResponse<string | null>>;
}

export interface FilesApi {
  /** Abre el fichero remoto en una ventana de edición. */
  editRemote(sessionId: string, path: string): Promise<AppResponse<null>>;
  previewRemote(sessionId: string, path: string): Promise<AppResponse<FilePreview>>;
  previewLocal(path: string): Promise<AppResponse<FilePreview>>;
  /** Compara un fichero remoto con uno local en una ventana de diff. */
  diff(sessionId: string, remotePath: string, localPath: string): Promise<AppResponse<null>>;
}

export interface SyncApi {
  status(): Promise<AppResponse<SyncStatus>>;
  /** Envía el enlace mágico al correo para vincular este dispositivo. */
  requestLink(email: string): Promise<AppResponse<null>>;
  /** Deriva la clave con la contraseña de sincronización y arranca. */
  activate(password: string): Promise<AppResponse<SyncStatus>>;
  deactivate(): Promise<AppResponse<null>>;
  now(): Promise<AppResponse<SyncStatus>>;
  setCategories(disabled: SyncCategory[]): Promise<AppResponse<SyncStatus>>;
}

export interface WatchApi {
  list(): Promise<AppResponse<WatchInfo[]>>;
  /** Sube a `remoteDir` lo que se cree o cambie en `localDir` mientras dure la vigilancia. */
  start(sessionId: string, localDir: string, remoteDir: string): Promise<AppResponse<WatchInfo>>;
  stop(id: string): Promise<AppResponse<null>>;
}

export interface EditorApi {
  load(id: string): Promise<AppResponse<EditorDocument>>;
  save(id: string, content: string, force: boolean): Promise<AppResponse<EditorSaveResult>>;
  setDirty(id: string, dirty: boolean): Promise<AppResponse<null>>;
  /** Cierra la ventana descartando los cambios. */
  close(id: string): Promise<AppResponse<null>>;
}

export interface UpdatesApi {
  status(): Promise<AppResponse<UpdateStatus>>;
  check(): Promise<AppResponse<UpdateStatus>>;
  download(): Promise<AppResponse<null>>;
  /** Cierra la app e instala la versión descargada. */
  install(): Promise<AppResponse<null>>;
  /** Abre en el navegador la página de la release disponible. */
  openRelease(): Promise<AppResponse<null>>;
}

export interface PreloadApi {
  platform: Platform;
  settings: SettingsApi;
  window: WindowApi;
  sites: SitesApi;
  projects: ProjectsApi;
  bookmarks: BookmarksApi;
  commands: CommandsApi;
  import: ImportApi;
  vault: VaultApi;
  sessions: SessionsApi;
  remote: RemoteApi;
  local: LocalApi;
  queue: QueueApi;
  dialog: DialogApi;
  updates: UpdatesApi;
  files: FilesApi;
  editor: EditorApi;
  watch: WatchApi;
  sync: SyncApi;
  /** Suscribe a un evento push del main. Devuelve la función de baja. */
  on<E extends IpcEventName>(event: E, listener: (payload: MainEventPayloads[E]) => void): () => void;
}

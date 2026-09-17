import type { IpcResponse } from 'vela-kit/ipc';
import type { IpcEventName, MainEventPayloads } from './ipc-channels';
import type { SettingKey, SettingValue, TitleBarOverlayInput } from './schemas';

export type Platform = 'win32' | 'darwin' | 'linux';

export interface SettingsApi {
  get<K extends SettingKey>(key: K): Promise<IpcResponse<SettingValue<K>>>;
  set<K extends SettingKey>(key: K, value: SettingValue<K>): Promise<IpcResponse<null>>;
}

export interface WindowApi {
  minimize(): Promise<IpcResponse<null>>;
  toggleMaximize(): Promise<IpcResponse<null>>;
  close(): Promise<IpcResponse<null>>;
  isMaximized(): Promise<IpcResponse<boolean>>;
  /** Solo tiene efecto en Windows. */
  updateTitleBarOverlay(colors: TitleBarOverlayInput): Promise<IpcResponse<null>>;
}

export interface PreloadApi {
  platform: Platform;
  settings: SettingsApi;
  window: WindowApi;
  /** Suscribe a un evento push del main. Devuelve la función de baja. */
  on<E extends IpcEventName>(event: E, listener: (payload: MainEventPayloads[E]) => void): () => void;
}

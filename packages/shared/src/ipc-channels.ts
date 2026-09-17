// Canales IPC renderer → main. Patrón: `{dominio}:{accion}`.
export const IPC_CHANNELS = {
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',

  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_TOGGLE_MAXIMIZE: 'window:toggle-maximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_IS_MAXIMIZED: 'window:is-maximized',
  WINDOW_UPDATE_TITLE_BAR_OVERLAY: 'window:update-title-bar-overlay',
} as const;

// Eventos push main → renderer.
export const IPC_EVENTS = {
  WINDOW_MAXIMIZED_CHANGED: 'state:window-maximized-changed',
} as const;

export type IpcEventName = (typeof IPC_EVENTS)[keyof typeof IPC_EVENTS];

export interface MainEventPayloads {
  [IPC_EVENTS.WINDOW_MAXIMIZED_CHANGED]: { maximized: boolean };
}

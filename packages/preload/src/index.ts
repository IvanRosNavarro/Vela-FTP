import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
// Subpath: el índice de shared arrastraría zod y los schemas al preload.
import { IPC_CHANNELS, IPC_EVENTS } from '@vela-ftp/shared/ipc-channels';
import type { Platform, PreloadApi } from '@vela-ftp/shared';

const ALLOWED_EVENTS = new Set<string>(Object.values(IPC_EVENTS));

const api: PreloadApi = {
  platform: process.platform as Platform,

  settings: {
    get: (key) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET, { key }),
    set: (key, value) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET, { key, value }),
  },

  window: {
    minimize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MINIMIZE),
    toggleMaximize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_TOGGLE_MAXIMIZE),
    close: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_CLOSE),
    isMaximized: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_IS_MAXIMIZED),
    updateTitleBarOverlay: (colors) => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_UPDATE_TITLE_BAR_OVERLAY, colors),
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

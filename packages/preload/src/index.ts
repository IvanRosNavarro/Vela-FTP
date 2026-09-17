import { contextBridge } from 'electron';
import type { Platform, PreloadApi } from '@vela-ftp/shared';

const api: PreloadApi = {
  platform: process.platform as Platform,
};

contextBridge.exposeInMainWorld('api', api);

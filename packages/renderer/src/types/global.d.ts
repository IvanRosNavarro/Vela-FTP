import type { PreloadApi } from '@vela-ftp/shared';

declare global {
  const __APP_VERSION__: string;

  interface Window {
    api: PreloadApi;
  }
}

export {};

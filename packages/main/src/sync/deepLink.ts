import path from 'node:path';
import { app } from 'electron';
import { logger } from 'vela-kit/logger';

const SCHEME = 'vela-ftp';

/**
 * Registra `vela-ftp://` en el sistema para que el enlace mágico del correo
 * vuelva a la aplicación. En desarrollo hay que decirle al SO qué ejecutable
 * abrir, porque el binario es el de Electron.
 */
export function registerDeepLink(): void {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(SCHEME, process.execPath, [path.resolve(process.argv[1]!)]);
    return;
  }
  app.setAsDefaultProtocolClient(SCHEME);
}

/** Token de `vela-ftp://sync-callback?token=…`, o null si la URL es otra cosa. */
export function sessionTokenFromUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== `${SCHEME}:`) return null;
    // `vela-ftp://sync-callback?token=x` deja el nombre en el host.
    const target = url.host || url.pathname.replace(/^\/+/, '');
    if (target !== 'sync-callback') return null;
    const token = url.searchParams.get('token');
    return token && token.length <= 512 ? token : null;
  } catch {
    return null;
  }
}

/** Primer argumento de la línea de comandos que sea un enlace nuestro. */
export function sessionTokenFromArgv(argv: string[]): string | null {
  for (const arg of argv) {
    const token = sessionTokenFromUrl(arg);
    if (token) return token;
  }
  return null;
}

/**
 * Engancha las tres vías por las que llega el enlace: el arranque en Windows y
 * Linux, la segunda instancia y `open-url` en macOS.
 */
export function onSessionToken(handler: (token: string) => void): void {
  const fromStart = sessionTokenFromArgv(process.argv);
  if (fromStart) {
    logger.info('[sync] enlace de vinculación recibido al arrancar');
    handler(fromStart);
  }

  app.on('second-instance', (_event, argv) => {
    const token = sessionTokenFromArgv(argv);
    if (token) handler(token);
  });

  app.on('open-url', (event, url) => {
    const token = sessionTokenFromUrl(url);
    if (!token) return;
    event.preventDefault();
    handler(token);
  });
}

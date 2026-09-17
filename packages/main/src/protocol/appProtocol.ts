import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { net, protocol, session } from 'electron';
import { DEV_CSP_HEADER, PROD_CSP_HEADER } from '../security/csp';

/** Esquema desde el que se sirve la shell empaquetada: `vela-ftp://app/`. */
export const APP_SCHEME = 'vela-ftp';
export const APP_ORIGIN = `${APP_SCHEME}://app`;
export const APP_URL = `${APP_ORIGIN}/index.html`;

/** Llamar antes de `app.whenReady()`. */
export function registerAppSchemeAsPrivileged(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': PROD_CSP_HEADER,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

/**
 * Sirve `renderer/dist` bajo `vela-ftp://app/` con la CSP de producción en la
 * cabecera. Rechaza hosts desconocidos y rutas que salgan de `dist`.
 */
export function registerAppProtocol(distRoot: string): void {
  const root = path.resolve(distRoot);
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'app') return new Response('Not Found', { status: 404 });

    const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const filePath = path.resolve(root, `.${relative}`);
    if (filePath !== root && !filePath.startsWith(root + path.sep)) {
      return new Response('Forbidden', { status: 403 });
    }

    const upstream = await net.fetch(pathToFileURL(filePath).toString());
    const headers = new Headers(upstream.headers);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
  });
}

/** En desarrollo la shell sale del dev server: se le añade la CSP de desarrollo. */
export function applyDevCsp(devServerOrigin: string): void {
  session.defaultSession.webRequest.onHeadersReceived({ urls: [`${devServerOrigin}/*`] }, (details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [DEV_CSP_HEADER] },
    });
  });
}

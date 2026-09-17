import { BASE_DEV_CSP, BASE_PROD_CSP, buildCspHeader } from 'vela-kit/security';

// De momento la shell no carga nada externo. Las fuentes que hagan falta (p. ej.
// el servidor de sync en Fase 4) se añaden aquí con extendCsp.
export const DEV_CSP_HEADER = buildCspHeader(BASE_DEV_CSP);
export const PROD_CSP_HEADER = buildCspHeader(BASE_PROD_CSP);

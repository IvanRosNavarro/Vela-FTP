import type { Site } from '@vela-ftp/shared';

/** Cuántos sitios ofrece la conexión rápida del panel remoto vacío. */
export const QUICK_CONNECT_SITES = 6;

/**
 * Los que más se usan primero y, a igualdad de usos, los usados hace menos.
 * Recién instalado nadie tiene usos, así que se quedan en el orden de la
 * sidebar y se ofrecen los primeros.
 */
export function mostUsedFirst(sites: Site[]): Site[] {
  return [...sites].sort((a, b) => b.uses - a.uses || (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0));
}

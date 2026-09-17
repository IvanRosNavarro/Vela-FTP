import type { RemoteEntry } from '@vela-ftp/shared';
import type { PathOps } from './paths';

/**
 * Estado de una entrada frente a la del otro lado:
 * - `only`: no existe en el otro lado.
 * - `newer` / `older`: más nueva o más antigua que la del otro lado.
 * - `different`: mismo nombre pero distinto tamaño o tipo, sin fechas para decidir.
 * - `same`: igual tamaño y fecha (o dos carpetas).
 */
export type CompareStatus = 'only' | 'newer' | 'older' | 'different' | 'same';

/** Un LIST sin MLSD da las fechas con precisión de minuto. */
export const DATE_TOLERANCE_MS = 60_000;

export interface Comparison {
  local: Map<string, CompareStatus>;
  remote: Map<string, CompareStatus>;
}

function compareFiles(a: RemoteEntry, b: RemoteEntry): [CompareStatus, CompareStatus] {
  if ((a.type === 'dir') !== (b.type === 'dir')) return ['different', 'different'];
  if (a.type === 'dir') return ['same', 'same'];
  const dated = a.modifiedAt !== null && b.modifiedAt !== null && Math.abs(a.modifiedAt - b.modifiedAt) > DATE_TOLERANCE_MS;
  if (dated) return a.modifiedAt! > b.modifiedAt! ? ['newer', 'older'] : ['older', 'newer'];
  return a.size === b.size ? ['same', 'same'] : ['different', 'different'];
}

/** Compara dos listados por nombre (sensible a mayúsculas, como el servidor). */
export function compareListings(local: RemoteEntry[], remote: RemoteEntry[]): Comparison {
  const result: Comparison = { local: new Map(), remote: new Map() };
  const remoteByName = new Map(remote.map((e) => [e.name, e]));
  for (const entry of local) {
    const other = remoteByName.get(entry.name);
    if (!other) {
      result.local.set(entry.name, 'only');
      continue;
    }
    const [l, r] = compareFiles(entry, other);
    result.local.set(entry.name, l);
    result.remote.set(entry.name, r);
  }
  for (const entry of remote) if (!result.remote.has(entry.name)) result.remote.set(entry.name, 'only');
  return result;
}

/**
 * Ruta equivalente en el otro lado para la navegación sincronizada: la parte
 * de `path` bajo `base` se añade a `otherBase`. null si `path` queda fuera de `base`.
 */
export function mirrorPath(path: string, base: string, otherBase: string, from: PathOps, to: PathOps): string | null {
  const parts: string[] = [];
  let current: string | null = path;
  while (current !== null && current !== base) {
    parts.unshift(from.basename(current));
    current = from.parent(current);
  }
  if (current === null) return null;
  return parts.reduce((dir, name) => to.join(dir, name), otherBase);
}

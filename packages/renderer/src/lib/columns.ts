import { FILE_COLUMN_IDS, type FileColumnId, type RemoteEntry } from '@vela-ftp/shared';
import { formatDate, formatMode, formatSize } from './format';

export type { FileColumnId };
export { FILE_COLUMN_IDS };

export interface ColumnDef {
  id: FileColumnId;
  label: string;
  /** Ancho en la rejilla; el nombre ocupa siempre el resto. */
  width: string;
  align?: 'right';
  /** Monoespaciada (permisos). */
  mono?: boolean;
}

export const COLUMNS: Record<FileColumnId, ColumnDef> = {
  size: { id: 'size', label: 'Tamaño', width: '80px', align: 'right' },
  type: { id: 'type', label: 'Tipo', width: '96px' },
  modifiedAt: { id: 'modifiedAt', label: 'Modificado', width: '120px' },
  mode: { id: 'mode', label: 'Permisos', width: '84px', mono: true },
  owner: { id: 'owner', label: 'Propietario', width: '96px' },
  group: { id: 'group', label: 'Grupo', width: '96px' },
  target: { id: 'target', label: 'Destino del enlace', width: '180px' },
};

/**
 * Columnas que tienen datos en cada lado. En local no hay propietario ni grupo
 * y, en Windows, tampoco permisos.
 */
export function availableColumns(side: 'local' | 'remote', platform: string): FileColumnId[] {
  if (side === 'remote') return [...FILE_COLUMN_IDS];
  return platform === 'win32' ? ['size', 'type', 'modifiedAt'] : ['size', 'type', 'modifiedAt', 'mode'];
}

/** Las visibles, en el orden canónico y solo las que existen en ese lado. */
export function visibleColumns(chosen: FileColumnId[], side: 'local' | 'remote', platform: string): FileColumnId[] {
  const available = availableColumns(side, platform);
  return FILE_COLUMN_IDS.filter((id) => available.includes(id) && chosen.includes(id));
}

/** Lo mínimo que ocupa el nombre: por debajo, la tabla se desplaza en horizontal. */
export const NAME_MIN_WIDTH = 160;
/** `gap-2` entre celdas y `px-2` a cada lado de la fila. */
const GAP = 8;
const PADDING = 16;

export function gridTemplate(columns: FileColumnId[]): string {
  return [`minmax(${NAME_MIN_WIDTH}px,1fr)`, ...columns.map((id) => COLUMNS[id].width)].join(' ');
}

/** Ancho a partir del cual caben todas las columnas sin aplastar el nombre. */
export function minGridWidth(columns: FileColumnId[]): number {
  return NAME_MIN_WIDTH + PADDING + columns.reduce((n, id) => n + parseInt(COLUMNS[id].width, 10) + GAP, 0);
}

/** Tipo legible: carpeta, enlace o la extensión, como el explorador del sistema. */
export function fileType(entry: Pick<RemoteEntry, 'name' | 'type'> & { target?: string | null }): string {
  // Un enlace a una carpeta se lista como carpeta para poder entrar en él.
  if (entry.type === 'dir') return entry.target ? 'Enlace a carpeta' : 'Carpeta';
  if (entry.type === 'symlink') return 'Enlace';
  const dot = entry.name.lastIndexOf('.');
  // `.htaccess` no tiene extensión: es el nombre entero.
  if (dot <= 0 || dot === entry.name.length - 1) return 'Fichero';
  return `Fichero ${entry.name.slice(dot + 1).toUpperCase()}`;
}

export function cellText(entry: RemoteEntry, column: FileColumnId): string {
  switch (column) {
    case 'size':
      return entry.type === 'dir' ? '' : formatSize(entry.size);
    case 'type':
      return fileType(entry);
    case 'modifiedAt':
      return formatDate(entry.modifiedAt);
    case 'mode':
      return formatMode(entry.mode);
    case 'owner':
      return entry.owner ?? '';
    case 'group':
      return entry.group ?? '';
    case 'target':
      return entry.target ?? '';
  }
}

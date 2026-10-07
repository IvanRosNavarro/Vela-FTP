import { z } from 'zod';

// Extraer y comprimir: contrato común a renderer, main y motor.

export type ArchiveFormat = 'zip' | 'tar' | 'tar.gz' | 'gz';

/** De más largo a más corto: `.tar.gz` antes que `.gz`. */
const SUFFIXES: ReadonlyArray<readonly [string, ArchiveFormat]> = [
  ['.tar.gz', 'tar.gz'],
  ['.tgz', 'tar.gz'],
  ['.tar', 'tar'],
  ['.zip', 'zip'],
  ['.gz', 'gz'],
];

function suffixOf(name: string): readonly [string, ArchiveFormat] | null {
  const lower = name.toLowerCase();
  return SUFFIXES.find(([suffix]) => lower.endsWith(suffix) && lower.length > suffix.length) ?? null;
}

/** Formato por la extensión del nombre; null si no se sabe extraer. */
export function archiveFormatOf(name: string): ArchiveFormat | null {
  return suffixOf(name)?.[1] ?? null;
}

/** El nombre sin la extensión del archivo: «web.tar.gz» → «web». */
export function archiveStem(name: string): string {
  const match = suffixOf(name);
  return match ? name.slice(0, name.length - match[0].length) : name;
}

const sessionId = z.string().min(1).max(100);
const remotePath = z.string().min(1).max(4096).startsWith('/');
const localPath = z.string().min(1).max(4096);
const opId = z.string().min(1).max(100);

/** Un fichero o carpeta en el disco local o en el servidor de una sesión. */
export const archiveLocationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('local'), path: localPath }),
  z.object({ kind: z.literal('remote'), sessionId, path: remotePath }),
]);
export type ArchiveLocation = z.output<typeof archiveLocationSchema>;

/** Qué hacer con un fichero que ya existe en el destino. */
export const archiveConflictSchema = z.enum(['overwrite', 'skip']);
export type ArchiveConflict = z.output<typeof archiveConflictSchema>;

export const archiveExtractInputSchema = z.object({
  opId,
  /** El archivo comprimido. */
  source: archiveLocationSchema,
  /** Carpeta donde extraer; se crea si no existe. */
  targetDir: archiveLocationSchema,
  conflict: archiveConflictSchema,
});
export type ArchiveExtractInput = z.output<typeof archiveExtractInputSchema>;

export const archiveCompressInputSchema = z.object({
  opId,
  /** Ficheros y carpetas de una misma carpeta. */
  sources: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('local'), paths: z.array(localPath).min(1).max(10_000) }),
    z.object({ kind: z.literal('remote'), sessionId, paths: z.array(remotePath).min(1).max(10_000) }),
  ]),
  /** El .zip que se crea; no debe existir. */
  target: archiveLocationSchema,
});
export type ArchiveCompressInput = z.output<typeof archiveCompressInputSchema>;

export const archiveCancelInputSchema = z.object({ opId });

export interface ArchiveResult {
  /** Ficheros escritos; null si lo hizo el servidor y no lo sabemos. */
  files: number | null;
  /** Ficheros que ya existían y no se tocaron, o entradas no seguras (enlaces, rutas fuera del destino). */
  skipped: number | null;
  /** true si se hizo en el servidor por SSH, sin bajar nada. */
  onServer: boolean;
}

export type ArchivePhase = 'download' | 'extract' | 'compress' | 'upload' | 'server';

export interface ArchiveProgress {
  opId: string;
  phase: ArchivePhase;
  /** Bytes hechos en esta fase. */
  done: number;
  /** null si no se sabe (p. ej. mientras trabaja el servidor). */
  total: number | null;
}

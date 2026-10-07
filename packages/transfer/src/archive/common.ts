import { createWriteStream } from 'node:fs';
import { lstat, rm } from 'node:fs/promises';
import path from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ArchiveConflict, ArchivePhase } from '@vela-ftp/shared';
import { TransferFailure, isLocalFsError, localFailure } from '../errors';

export interface ArchiveContext {
  signal: AbortSignal;
  progress(phase: ArchivePhase, done: number, total: number | null): void;
}

export interface ExtractStats {
  files: number;
  /** Ya existían (con `skip`) o no eran seguras: enlaces, dispositivos, rutas fuera del destino. */
  skipped: number;
}

export interface ExtractOptions {
  conflict: ArchiveConflict;
  ctx: ArchiveContext;
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

/** Un nombre que Windows no deja crear, retocado lo justo para que sí. */
function windowsSafe(part: string): string {
  let name = part.replace(/[<>:"|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '');
  if (!name) name = '_';
  return WINDOWS_RESERVED.test(name) ? `_${name}` : name;
}

/**
 * Ruta en disco de una entrada del archivo, o null si se saldría de `root`
 * (zip-slip: `../`, rutas absolutas). Las rutas absolutas pierden la barra
 * inicial, como hace tar.
 */
export function entryTarget(root: string, entryName: string, windows = process.platform === 'win32'): string | null {
  const parts = entryName.replace(/\\/g, '/').split('/').filter((p) => p !== '' && p !== '.');
  if (parts.length === 0 || parts.includes('..')) return null;
  const base = path.resolve(root);
  const target = path.resolve(base, ...(windows ? parts.map(windowsSafe) : parts));
  const rel = path.relative(base, target);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return target;
}

export async function localExists(p: string): Promise<boolean> {
  try {
    await lstat(p);
    return true;
  } catch {
    return false;
  }
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new TransferFailure('CANCELLED', 'Cancelado');
}

/** Error al leer el archivo (no del disco de destino): está dañado o no es de ese formato. */
export function corrupt(err: unknown, what: string): TransferFailure {
  if (err instanceof TransferFailure) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new TransferFailure('PROTOCOL', `${what} está dañado o no tiene el formato esperado: ${message}`);
}

/** Cuenta los bytes que pasan. */
export function byteCounter(onBytes: (delta: number) => void): Transform {
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      onBytes(chunk.length);
      cb(null, chunk);
    },
  });
}

/**
 * Escribe `source` en `target`. Si falla, borra lo escrito a medias. Distingue
 * un fallo del disco local de uno del archivo de origen (`what`).
 */
export async function writeEntry(source: Readable | AsyncIterable<Buffer>, target: string, what: string, signal: AbortSignal): Promise<void> {
  try {
    await pipeline(source, createWriteStream(target), { signal });
  } catch (err) {
    await rm(target, { force: true }).catch(() => undefined);
    if (signal.aborted) throw new TransferFailure('CANCELLED', 'Cancelado');
    if (isLocalFsError(err, target)) throw localFailure(err, target);
    throw corrupt(err, what);
  }
}

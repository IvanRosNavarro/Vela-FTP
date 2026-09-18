import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import { logger } from 'vela-kit/logger';

function tempRoot(): string {
  return path.join(app.getPath('temp'), 'vela-ftp');
}

/** Carpeta temporal propia; borrarla con `removeTempDir` al terminar. */
export async function createTempDir(kind: 'edit' | 'preview' | 'diff' | 'external'): Promise<string> {
  const dir = path.join(tempRoot(), kind, randomUUID());
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function removeTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch((err: unknown) => logger.warn(`[files] no se pudo borrar ${dir}`, err));
}

/** Restos de un cierre abrupto: copias de ficheros remotos que no deben quedarse en disco. */
export async function cleanTempRoot(): Promise<void> {
  await removeTempDir(tempRoot());
}

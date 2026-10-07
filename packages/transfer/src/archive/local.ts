import { createReadStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { PassThrough, pipeline } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { archiveStem, type ArchiveFormat } from '@vela-ftp/shared';
import { localFailure } from '../errors';
import { byteCounter, entryTarget, localExists, writeEntry, type ExtractOptions, type ExtractStats } from './common';
import { extractTar } from './tar';
import { extractZip } from './zip';

/**
 * Lee el archivo contando lo leído para el progreso y, si hace falta, lo
 * descomprime. Un fallo de cualquier tramo rompe el flujo que se devuelve.
 */
function readArchive(archivePath: string, gunzip: boolean, onBytes: (done: number) => void): PassThrough {
  let done = 0;
  const out = new PassThrough();
  const counter = byteCounter((delta) => onBytes((done += delta)));
  const stages = gunzip ? [createReadStream(archivePath), counter, createGunzip(), out] : [createReadStream(archivePath), counter, out];
  pipeline(stages, (err) => {
    if (err) out.destroy(err);
  });
  return out;
}

/** Extrae en `root` un archivo que ya está en el disco local. */
export async function extractLocal(archivePath: string, format: ArchiveFormat, root: string, options: ExtractOptions): Promise<ExtractStats> {
  let total: number;
  try {
    total = (await stat(archivePath)).size;
  } catch (err) {
    throw localFailure(err, archivePath);
  }
  try {
    await mkdir(root, { recursive: true });
  } catch (err) {
    throw localFailure(err, root);
  }
  const onBytes = (done: number) => options.ctx.progress('extract', done, total);
  switch (format) {
    case 'zip':
      return extractZip(archivePath, root, options, total);
    case 'tar':
    case 'tar.gz':
      return extractTar(readArchive(archivePath, format === 'tar.gz', onBytes), root, options);
    case 'gz': {
      // Un .gz suelto es un único fichero: el nombre sin la extensión.
      const target = entryTarget(root, archiveStem(path.basename(archivePath)));
      if (!target || (options.conflict === 'skip' && (await localExists(target)))) return { files: 0, skipped: 1 };
      await writeEntry(readArchive(archivePath, true, onBytes), target, 'El fichero .gz', options.ctx.signal);
      return { files: 1, skipped: 0 };
    }
  }
}

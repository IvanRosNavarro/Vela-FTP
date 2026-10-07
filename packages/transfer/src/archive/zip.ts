import { createReadStream, createWriteStream, type Stats } from 'node:fs';
import { lstat, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import yazl from 'yazl';
import { TransferFailure, isLocalFsError, localFailure } from '../errors';
import { applyMetadata } from './tar';
import { byteCounter, corrupt, entryTarget, localExists, throwIfAborted, writeEntry, type ArchiveContext, type ExtractOptions, type ExtractStats } from './common';

const WHAT = 'El ZIP';
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;
/** `versionMadeBy` de un ZIP creado en Unix: los atributos externos llevan el modo. */
const MADE_BY_UNIX = 3;

/** Extrae un ZIP en `root`. El progreso va en bytes comprimidos sobre el tamaño del archivo. */
export async function extractZip(archivePath: string, root: string, { conflict, ctx }: ExtractOptions, totalBytes: number): Promise<ExtractStats> {
  let zip: yauzl.ZipFile;
  try {
    zip = await yauzl.openPromise(archivePath, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true, strictFileNames: false });
  } catch (err) {
    if (isLocalFsError(err, archivePath)) throw localFailure(err, archivePath);
    throw corrupt(err, WHAT);
  }
  const stats: ExtractStats = { files: 0, skipped: 0 };
  let done = 0;
  try {
    const entries = zip.eachEntry();
    for (;;) {
      throwIfAborted(ctx.signal);
      let next: IteratorResult<yauzl.Entry>;
      try {
        next = await entries.next();
      } catch (err) {
        throw corrupt(err, WHAT);
      }
      if (next.done) break;
      const entry = next.value;
      const unixMode = entry.versionMadeBy >> 8 === MADE_BY_UNIX ? entry.externalFileAttributes >>> 16 : 0;
      const isDir = entry.fileName.endsWith('/') || (unixMode & S_IFMT) === S_IFDIR;
      const target = entryTarget(root, entry.fileName);

      if (isDir && target) {
        try {
          await mkdir(target, { recursive: true });
        } catch (err) {
          throw localFailure(err, target);
        }
      } else if (isDir || !target || (unixMode & S_IFMT) === S_IFLNK || (conflict === 'skip' && (await localExists(target)))) {
        stats.skipped++;
      } else {
        if (entry.isEncrypted()) throw new TransferFailure('PROTOCOL', 'El ZIP está protegido con contraseña: Vela FTP aún no sabe abrirlo');
        if (!entry.canDecodeFileData()) throw new TransferFailure('PROTOCOL', `El ZIP usa un método de compresión no admitido (${entry.compressionMethod})`);
        try {
          await mkdir(path.dirname(target), { recursive: true });
        } catch (err) {
          throw localFailure(err, path.dirname(target));
        }
        let stream;
        try {
          stream = await zip.openReadStreamPromise(entry);
        } catch (err) {
          throw corrupt(err, WHAT);
        }
        // Avance dentro de la entrada: lo descomprimido, a escala de lo comprimido.
        const ratio = entry.uncompressedSize > 0 ? entry.compressedSize / entry.uncompressedSize : 0;
        let written = 0;
        const counter = byteCounter((delta) => {
          written += delta;
          ctx.progress('extract', done + Math.min(entry.compressedSize, written * ratio), totalBytes);
        });
        await writeEntry(stream.pipe(counter), target, WHAT, ctx.signal);
        await applyMetadata(target, entry.getLastModDate().getTime() / 1000, unixMode & 0o777);
        stats.files++;
      }
      done += entry.compressedSize;
      ctx.progress('extract', done, totalBytes);
    }
  } finally {
    zip.close();
  }
  return stats;
}

export interface ZipSource {
  /** Ruta en disco. */
  path: string;
  /** Nombre dentro del ZIP (la raíz). */
  name: string;
}

interface ZipItem {
  fsPath: string;
  zipPath: string;
  dir: boolean;
  stats: Stats;
}

/** Permisos para el ZIP: en Windows el modo de Node no dice nada útil. */
function zipMode(stats: Stats, dir: boolean): number {
  const perms = process.platform === 'win32' ? (dir ? 0o755 : 0o644) : stats.mode & 0o777;
  return (dir ? S_IFDIR : S_IFREG) | perms;
}

/** Recorre las fuentes. Los enlaces a ficheros se siguen; a carpetas no, para no entrar en bucles. */
async function collect(sources: ZipSource[], exclude: Set<string>, signal: AbortSignal): Promise<{ items: ZipItem[]; skipped: number }> {
  const items: ZipItem[] = [];
  let skipped = 0;
  const visit = async (fsPath: string, zipPath: string): Promise<void> => {
    throwIfAborted(signal);
    if (exclude.has(path.resolve(fsPath))) return;
    let info: Stats;
    try {
      info = await lstat(fsPath);
      if (info.isSymbolicLink()) {
        info = await stat(fsPath);
        if (!info.isFile()) {
          skipped++;
          return;
        }
      }
    } catch (err) {
      throw localFailure(err, fsPath);
    }
    if (info.isFile()) {
      items.push({ fsPath, zipPath, dir: false, stats: info });
    } else if (info.isDirectory()) {
      items.push({ fsPath, zipPath: `${zipPath}/`, dir: true, stats: info });
      let children: string[];
      try {
        children = await readdir(fsPath);
      } catch (err) {
        throw localFailure(err, fsPath);
      }
      for (const child of children) await visit(path.join(fsPath, child), `${zipPath}/${child}`);
    } else {
      skipped++;
    }
  };
  for (const source of sources) await visit(source.path, source.name);
  return { items, skipped };
}

/**
 * Crea `outPath` con las fuentes. Se escribe en un `.part` y se renombra al
 * final: nunca queda un ZIP a medias con el nombre bueno.
 */
export async function createZip(sources: ZipSource[], outPath: string, ctx: ArchiveContext): Promise<ExtractStats> {
  if (await localExists(outPath)) throw new TransferFailure('ALREADY_EXISTS', `Ya existe: ${outPath}`, { local: true });
  const partPath = `${outPath}.part`;
  const { items, skipped } = await collect(sources, new Set([path.resolve(outPath), path.resolve(partPath)]), ctx.signal);
  const total = items.reduce((n, item) => n + (item.dir ? 0 : item.stats.size), 0);
  let done = 0;
  const zip = new yazl.ZipFile();
  for (const item of items) {
    const options = { mtime: item.stats.mtime, mode: zipMode(item.stats, item.dir) };
    if (item.dir) {
      zip.addEmptyDirectory(item.zipPath, options);
      continue;
    }
    zip.addReadStreamLazy(item.zipPath, options, (cb) => {
      const input = createReadStream(item.fsPath);
      const counter = byteCounter((delta) => {
        done += delta;
        ctx.progress('compress', done, total);
      });
      input.on('error', (err) => counter.destroy(localFailure(err, item.fsPath)));
      cb(null, input.pipe(counter));
    });
  }
  zip.end();
  try {
    await pipeline(zip.outputStream, createWriteStream(partPath), { signal: ctx.signal });
    await rename(partPath, outPath);
  } catch (err) {
    await rm(partPath, { force: true }).catch(() => undefined);
    if (ctx.signal.aborted) throw new TransferFailure('CANCELLED', 'Cancelado');
    if (err instanceof TransferFailure) throw err;
    throw localFailure(err, outPath);
  }
  return { files: items.filter((i) => !i.dir).length, skipped };
}

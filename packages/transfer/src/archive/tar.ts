import { chmod, mkdir, utimes } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { TransferFailure, localFailure } from '../errors';
import { entryTarget, localExists, throwIfAborted, writeEntry, type ExtractOptions, type ExtractStats } from './common';

// Lector de tar (ustar, GNU y pax) solo para extraer. Ficheros y carpetas; los
// enlaces y dispositivos se saltan: un enlace dentro del archivo podría apuntar
// fuera de la carpeta de destino.

const BLOCK = 512;
/** Tope para cabeceras largas (nombres GNU, registros pax): se leen enteras en memoria. */
const META_MAX = 1024 * 1024;
const WHAT = 'El archivo tar';

/** Lee un flujo por bloques exactos, sin cargarlo entero. */
class ByteReader {
  private buffer = Buffer.alloc(0);
  private readonly iterator: AsyncIterator<Buffer>;
  private ended = false;

  constructor(source: AsyncIterable<Buffer>) {
    this.iterator = source[Symbol.asyncIterator]();
  }

  private async fill(): Promise<boolean> {
    if (this.ended) return false;
    const next = await this.iterator.next();
    if (next.done) {
      this.ended = true;
      return false;
    }
    const chunk = Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value);
    this.buffer = this.buffer.length > 0 ? Buffer.concat([this.buffer, chunk]) : chunk;
    return true;
  }

  /** `n` bytes, o null si el flujo acaba antes. */
  async read(n: number): Promise<Buffer | null> {
    while (this.buffer.length < n) if (!(await this.fill())) return null;
    const out = this.buffer.subarray(0, n);
    this.buffer = this.buffer.subarray(n);
    return out;
  }

  /** `n` bytes por trozos. */
  async *chunks(n: number): AsyncGenerator<Buffer> {
    let left = n;
    while (left > 0) {
      if (this.buffer.length === 0 && !(await this.fill())) throw new TransferFailure('PROTOCOL', `${WHAT} está incompleto`);
      const take = Math.min(left, this.buffer.length);
      yield this.buffer.subarray(0, take);
      this.buffer = this.buffer.subarray(take);
      left -= take;
    }
  }

  async skip(n: number): Promise<void> {
    for await (const _ of this.chunks(n));
  }
}

function readString(block: Buffer, start: number, length: number): string {
  const field = block.subarray(start, start + length);
  const end = field.indexOf(0);
  return field.subarray(0, end < 0 ? length : end).toString('utf8');
}

/** Octal con espacios o nulos; o binario big-endian con el bit alto marcado (GNU, tamaños > 8 GiB). */
function readNumber(block: Buffer, start: number, length: number): number {
  const first = block[start]!;
  if (first & 0x80) {
    let value = first & 0x7f;
    for (let i = start + 1; i < start + length; i++) value = value * 256 + block[i]!;
    return value;
  }
  const text = readString(block, start, length).trim();
  return text ? parseInt(text, 8) : 0;
}

function checksumMatches(block: Buffer): boolean {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : block[i]!;
  return sum === readNumber(block, 148, 8);
}

/** Registros `longitud clave=valor\n` de una cabecera pax. */
export function parsePax(data: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let pos = 0;
  while (pos < data.length) {
    const space = data.indexOf(0x20, pos);
    if (space < 0) break;
    const length = parseInt(data.subarray(pos, space).toString('ascii'), 10);
    if (!Number.isFinite(length) || length <= 0) break;
    const record = data.subarray(space + 1, pos + length - 1).toString('utf8');
    const eq = record.indexOf('=');
    if (eq > 0) out[record.slice(0, eq)] = record.slice(eq + 1);
    pos += length;
  }
  return out;
}

const padding = (size: number) => (BLOCK - (size % BLOCK)) % BLOCK;

/** Extrae un tar (ya descomprimido) en `root`. */
export async function extractTar(source: AsyncIterable<Buffer>, root: string, { conflict, ctx }: ExtractOptions): Promise<ExtractStats> {
  const reader = new ByteReader(source);
  const stats: ExtractStats = { files: 0, skipped: 0 };
  let longName: string | null = null;
  let pax: Record<string, string> = {};

  const readMeta = async (size: number): Promise<Buffer> => {
    if (size > META_MAX) throw new TransferFailure('PROTOCOL', `${WHAT} tiene una cabecera demasiado grande`);
    const data = await reader.read(size);
    if (!data) throw new TransferFailure('PROTOCOL', `${WHAT} está incompleto`);
    await reader.skip(padding(size));
    return Buffer.from(data);
  };

  for (;;) {
    throwIfAborted(ctx.signal);
    const header = await reader.read(BLOCK);
    // Sin los bloques de cierre también vale: algunos programas no los escriben.
    if (!header || header.every((b) => b === 0)) break;
    if (!checksumMatches(header)) throw new TransferFailure('PROTOCOL', `${WHAT} está dañado o no es un tar`);

    const typeByte = header[156]!;
    const type = typeByte === 0 ? '0' : String.fromCharCode(typeByte);
    const headerSize = readNumber(header, 124, 12);

    // Cabeceras que describen la entrada siguiente.
    if (type === 'L') {
      longName = readString(await readMeta(headerSize), 0, headerSize);
      continue;
    }
    if (type === 'x') {
      pax = parsePax(await readMeta(headerSize));
      continue;
    }
    if (type === 'g' || type === 'K') {
      await reader.skip(headerSize + padding(headerSize));
      continue;
    }

    const size = pax['size'] !== undefined ? Number(pax['size']) : headerSize;
    // POSIX ustar parte los nombres largos en prefijo y nombre; GNU usa ese hueco para otras cosas.
    const ustar = header.subarray(257, 263).toString('latin1') === 'ustar\0';
    const prefix = ustar ? readString(header, 345, 155) : '';
    const shortName = readString(header, 0, 100);
    const name = pax['path'] ?? longName ?? (prefix ? `${prefix}/${shortName}` : shortName);
    const mtime = pax['mtime'] !== undefined ? Number(pax['mtime']) : readNumber(header, 136, 12);
    const mode = readNumber(header, 100, 8);
    longName = null;
    pax = {};

    const target = entryTarget(root, name);
    const isFile = type === '0' || type === '7';
    if (type === '5' && target) {
      try {
        await mkdir(target, { recursive: true });
      } catch (err) {
        throw localFailure(err, target);
      }
    } else if (!isFile || !target || (conflict === 'skip' && (await localExists(target)))) {
      stats.skipped++;
    } else {
      try {
        await mkdir(path.dirname(target), { recursive: true });
      } catch (err) {
        throw localFailure(err, path.dirname(target));
      }
      await writeEntry(Readable.from(reader.chunks(size)), target, WHAT, ctx.signal);
      await applyMetadata(target, mtime, mode);
      stats.files++;
      await reader.skip(padding(size));
      continue;
    }
    await reader.skip(size + padding(size));
  }
  return stats;
}

/** Fecha y permisos del archivo, sin bits que den escritura a otros. */
export async function applyMetadata(target: string, mtimeSeconds: number, mode: number): Promise<void> {
  if (Number.isFinite(mtimeSeconds) && mtimeSeconds > 0) await utimes(target, mtimeSeconds, mtimeSeconds).catch(() => undefined);
  if (process.platform !== 'win32' && mode > 0) await chmod(target, mode & 0o755).catch(() => undefined);
}

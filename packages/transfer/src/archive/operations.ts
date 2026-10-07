import { mkdir, readdir, stat, utimes } from 'node:fs/promises';
import path from 'node:path';
import {
  archiveFormatOf,
  type ArchiveCompressInput,
  type ArchiveConflict,
  type ArchiveExtractInput,
  type ArchiveFormat,
  type ArchiveResult,
} from '@vela-ftp/shared';
import { TransferFailure, localFailure } from '../errors';
import { basenameRemote, joinRemote, parentRemote, type RemoteFs } from '../fs/RemoteFs';
import { isBrokenConnection } from '../pool';
import { localExists, throwIfAborted, type ArchiveContext } from './common';
import { extractLocal } from './local';
import { SERVER_TOOL, hasToolCommand, serverCompressCommand, serverExtractCommand, serverFailure } from './serverCommands';
import { createZip } from './zip';

export interface ArchiveDeps {
  /** Una conexión de transferencia de la sesión, en exclusiva mientras dure `fn`. */
  withTransfer<T>(sessionId: string, fn: (fs: RemoteFs) => Promise<T>): Promise<T>;
}

type ExtractParams = ArchiveExtractInput & { workDir: string };
type CompressParams = ArchiveCompressInput & { workDir: string };

/** La sesión de la operación: como mucho una, aunque origen y destino estén en lados distintos. */
function sessionOf(...locations: Array<{ kind: 'local' } | { kind: 'remote'; sessionId: string }>): string | null {
  const ids = new Set(locations.flatMap((l) => (l.kind === 'remote' ? [l.sessionId] : [])));
  if (ids.size > 1) throw new TransferFailure('PROTOCOL', 'El origen y el destino están en servidores distintos');
  return ids.values().next().value ?? null;
}

/**
 * true si el servidor deja ejecutar órdenes y tiene `tool`. Un servidor que no
 * da shell (Plesk o cPanel con SFTP solo) rechaza el canal: se hace en local.
 */
async function serverHasTool(fs: RemoteFs, tool: string, signal: AbortSignal): Promise<boolean> {
  if (!fs.exec) return false;
  try {
    const result = await fs.exec(hasToolCommand(tool), signal);
    return result.code === 0;
  } catch (err) {
    if (fs.closed || signal.aborted) throw err;
    return false;
  }
}

async function runOnServer(fs: RemoteFs, tool: string, command: string, conflict: ArchiveConflict, ctx: ArchiveContext): Promise<void> {
  ctx.progress('server', 0, null);
  const result = await fs.exec!(command, ctx.signal);
  const failure = serverFailure(tool, conflict, result);
  if (failure) throw new TransferFailure('PROTOCOL', `El servidor no pudo terminar: ${failure}`);
}

// ── Bajar y subir ───────────────────────────────────────────────────────────

/** Baja ficheros y carpetas remotos a `localDir`, cada uno con su nombre. */
async function downloadTree(fs: RemoteFs, remotePaths: string[], localDir: string, ctx: ArchiveContext): Promise<void> {
  const files: Array<{ remote: string; local: string; size: number; modifiedAt: number | null }> = [];
  const dirs: Array<{ local: string; modifiedAt: number | null }> = [{ local: localDir, modifiedAt: null }];
  const walk = async (remote: string, local: string): Promise<void> => {
    throwIfAborted(ctx.signal);
    const entry = await fs.stat(remote);
    if (!entry) throw new TransferFailure('NOT_FOUND', `No existe en el servidor: ${remote}`);
    if (entry.type !== 'dir') {
      files.push({ remote, local, size: entry.size, modifiedAt: entry.modifiedAt });
      return;
    }
    dirs.push({ local, modifiedAt: entry.modifiedAt });
    for (const child of await fs.list(remote)) await walk(child.path, path.join(local, child.name));
  };
  for (const remote of remotePaths) await walk(remote, path.join(localDir, basenameRemote(remote)));

  for (const dir of dirs) {
    try {
      await mkdir(dir.local, { recursive: true });
    } catch (err) {
      throw localFailure(err, dir.local);
    }
  }
  const total = files.reduce((n, f) => n + f.size, 0);
  let done = 0;
  ctx.progress('download', 0, total);
  for (const file of files) {
    await fs.download(file.remote, file.local, {
      offset: 0,
      signal: ctx.signal,
      onProgress: (delta) => ctx.progress('download', (done += delta), total),
    });
    if (file.modifiedAt !== null) await utimes(file.local, file.modifiedAt / 1000, file.modifiedAt / 1000).catch(() => undefined);
  }
  // Las carpetas al final y de dentro afuera: escribir en ellas les cambia la fecha.
  for (const dir of dirs.reverse()) {
    if (dir.modifiedAt !== null) await utimes(dir.local, dir.modifiedAt / 1000, dir.modifiedAt / 1000).catch(() => undefined);
  }
}

/** Crea `dir` en el servidor y las carpetas que le falten por encima. */
async function ensureRemoteDir(fs: RemoteFs, dir: string): Promise<boolean> {
  const entry = await fs.stat(dir);
  if (entry?.type === 'dir') return true;
  if (entry) throw new TransferFailure('ALREADY_EXISTS', `Ya existe un fichero con ese nombre: ${dir}`);
  const parent = parentRemote(dir);
  if (parent !== dir) await ensureRemoteDir(fs, parent);
  await fs.mkdir(dir);
  return false;
}

/** Sube el contenido de `localRoot` dentro de `remoteRoot`. */
async function uploadTree(fs: RemoteFs, localRoot: string, remoteRoot: string, conflict: ArchiveConflict, ctx: ArchiveContext): Promise<{ files: number; skipped: number }> {
  const files: Array<{ local: string; remote: string; size: number; mtime: number }> = [];
  const dirs: string[] = [];
  const walk = async (local: string, remote: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(local, { withFileTypes: true });
    } catch (err) {
      throw localFailure(err, local);
    }
    for (const entry of entries) {
      const childLocal = path.join(local, entry.name);
      const childRemote = joinRemote(remote, entry.name);
      if (entry.isDirectory()) {
        dirs.push(childRemote);
        await walk(childLocal, childRemote);
      } else if (entry.isFile()) {
        const info = await stat(childLocal).catch((err: unknown) => {
          throw localFailure(err, childLocal);
        });
        files.push({ local: childLocal, remote: childRemote, size: info.size, mtime: info.mtimeMs });
      }
    }
  };
  await walk(localRoot, remoteRoot);

  // Lo que ya hay en cada carpeta del servidor, listado una sola vez.
  const existing = new Map<string, Set<string>>();
  const known = async (dir: string, existed: boolean) =>
    existing.set(dir, existed ? new Set((await fs.list(dir)).map((e) => e.name)) : new Set());
  await known(remoteRoot, await ensureRemoteDir(fs, remoteRoot));
  for (const dir of dirs) {
    throwIfAborted(ctx.signal);
    const existed = existing.get(parentRemote(dir))?.has(basenameRemote(dir)) ?? false;
    if (!existed) await fs.mkdir(dir);
    await known(dir, existed);
  }

  const total = files.reduce((n, f) => n + f.size, 0);
  let done = 0;
  let written = 0;
  let skipped = 0;
  ctx.progress('upload', 0, total);
  for (const file of files) {
    throwIfAborted(ctx.signal);
    if (conflict === 'skip' && existing.get(parentRemote(file.remote))?.has(basenameRemote(file.remote))) {
      skipped++;
      ctx.progress('upload', (done += file.size), total);
      continue;
    }
    await fs.upload(file.local, file.remote, { offset: 0, signal: ctx.signal, onProgress: (delta) => ctx.progress('upload', (done += delta), total) });
    // Igual que la cola: la fecha es best-effort, salvo que se haya caído la conexión.
    await fs.setModifiedTime(file.remote, file.mtime).catch((err: unknown) => {
      if (isBrokenConnection(err)) throw err;
    });
    written++;
  }
  return { files: written, skipped };
}

// ── Operaciones ─────────────────────────────────────────────────────────────

function formatOrFail(name: string): ArchiveFormat {
  const format = archiveFormatOf(name);
  if (!format) throw new TransferFailure('PROTOCOL', `No se reconoce el formato de ${name}`);
  return format;
}

export async function extractArchive(params: ExtractParams, deps: ArchiveDeps, ctx: ArchiveContext): Promise<ArchiveResult> {
  const { source, targetDir, conflict, workDir } = params;
  const name = source.kind === 'remote' ? basenameRemote(source.path) : path.basename(source.path);
  const format = formatOrFail(name);
  const sessionId = sessionOf(source, targetDir);
  const options = { conflict, ctx };

  if (!sessionId) {
    const stats = await extractLocal(source.path, format, targetDir.path, options);
    return { ...stats, onServer: false };
  }

  return deps.withTransfer(sessionId, async (fs) => {
    if (source.kind === 'remote' && targetDir.kind === 'remote') {
      const tool = SERVER_TOOL[format];
      if (await serverHasTool(fs, tool, ctx.signal)) {
        await runOnServer(fs, tool, serverExtractCommand(format, source.path, targetDir.path, conflict), conflict, ctx);
        return { files: null, skipped: null, onServer: true };
      }
    }

    let archivePath = source.path;
    if (source.kind === 'remote') {
      const downloads = path.join(workDir, 'archive');
      await downloadTree(fs, [source.path], downloads, ctx);
      archivePath = path.join(downloads, name);
    }
    if (targetDir.kind === 'local') return { ...(await extractLocal(archivePath, format, targetDir.path, options)), onServer: false };

    const extracted = path.join(workDir, 'extracted');
    const local = await extractLocal(archivePath, format, extracted, { conflict: 'overwrite', ctx });
    const uploaded = await uploadTree(fs, extracted, targetDir.path, conflict, ctx);
    return { files: uploaded.files, skipped: local.skipped + uploaded.skipped, onServer: false };
  });
}

export async function compressArchive(params: CompressParams, deps: ArchiveDeps, ctx: ArchiveContext): Promise<ArchiveResult> {
  const { sources, target, workDir } = params;
  const sessionId = sessionOf(sources, target);
  if (target.kind === 'local' && (await localExists(target.path))) throw new TransferFailure('ALREADY_EXISTS', `Ya existe: ${target.path}`, { local: true });

  if (!sessionId) {
    const zipSources = sources.paths.map((p) => ({ path: p, name: path.basename(p) }));
    const stats = await createZip(zipSources, target.path, ctx);
    return { ...stats, onServer: false };
  }

  return deps.withTransfer(sessionId, async (fs) => {
    // Antes de bajar nada: el ZIP no debe existir.
    if (target.kind === 'remote' && (await fs.stat(target.path))) throw new TransferFailure('ALREADY_EXISTS', `Ya existe: ${target.path}`);

    if (sources.kind === 'remote' && target.kind === 'remote') {
      const dir = parentRemote(sources.paths[0]!);
      const sameDir = sources.paths.every((p) => parentRemote(p) === dir);
      if (sameDir && (await serverHasTool(fs, 'zip', ctx.signal))) {
        await runOnServer(fs, 'zip', serverCompressCommand(dir, target.path, sources.paths.map(basenameRemote)), 'overwrite', ctx);
        return { files: null, skipped: null, onServer: true };
      }
    }

    let localSources = sources.paths;
    if (sources.kind === 'remote') {
      const downloads = path.join(workDir, 'sources');
      await downloadTree(fs, sources.paths, downloads, ctx);
      localSources = sources.paths.map((p) => path.join(downloads, basenameRemote(p)));
    }
    const zipSources = localSources.map((p) => ({ path: p, name: path.basename(p) }));
    if (target.kind === 'local') return { ...(await createZip(zipSources, target.path, ctx)), onServer: false };

    const outDir = path.join(workDir, 'zip');
    try {
      await mkdir(outDir, { recursive: true });
    } catch (err) {
      throw localFailure(err, outDir);
    }
    const zipPath = path.join(outDir, basenameRemote(target.path));
    const stats = await createZip(zipSources, zipPath, ctx);
    const size = (await stat(zipPath)).size;
    let done = 0;
    ctx.progress('upload', 0, size);
    await fs.upload(zipPath, target.path, { offset: 0, signal: ctx.signal, onProgress: (delta) => ctx.progress('upload', (done += delta), size) });
    return { ...stats, onServer: false };
  });
}

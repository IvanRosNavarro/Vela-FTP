import type { ArchiveConflict, ArchiveLocation, ArchiveResult, RemoteEntry } from '@vela-ftp/shared';
import { toast } from 'vela-kit/ui';
import { useArchiveStore } from '../stores/archiveStore';
import { isRemotePane, localPaneKey, remotePaneKey, sessionOfPane, usePanesStore, type PaneKey } from '../stores/panesStore';
import { AppError, call, errorText } from './ipc';
import { localPaths, remotePaths, type PathOps } from './paths';

export function pathOpsFor(paneKey: PaneKey): PathOps {
  return isRemotePane(paneKey) ? remotePaths : localPaths(window.api.local.separator);
}

/** El panel del otro lado en la misma pestaña; null sin conexión. */
export function oppositePane(paneKey: PaneKey): PaneKey | null {
  const sessionId = sessionOfPane(paneKey);
  if (!sessionId) return null;
  return isRemotePane(paneKey) ? localPaneKey(sessionId) : remotePaneKey(sessionId);
}

function locationIn(paneKey: PaneKey, path: string): ArchiveLocation {
  const sessionId = sessionOfPane(paneKey);
  return isRemotePane(paneKey) && sessionId ? { kind: 'remote', sessionId, path } : { kind: 'local', path };
}

/** Nombre del ZIP por defecto: el del elemento sin extensión, o el de la carpeta si son varios. */
export function defaultZipName(entries: RemoteEntry[], folderName: string): string {
  const single = entries.length === 1 ? entries[0]! : null;
  if (!single) return `${folderName || 'Archivo'}.zip`;
  const dot = single.name.lastIndexOf('.');
  return `${single.type !== 'dir' && dot > 0 ? single.name.slice(0, dot) : single.name}.zip`;
}

/** `nombre.zip`, o `nombre (2).zip` si ya existe. */
export function uniqueName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Refresca los paneles de esta ventana que enseñan `dir` en el lado de
 * `paneKey` y, si se indica, deja `select` seleccionado en `paneKey`.
 */
async function refreshShowing(paneKey: PaneKey, dir: string, select?: string): Promise<void> {
  const store = usePanesStore.getState();
  const remote = isRemotePane(paneKey);
  const sessionId = sessionOfPane(paneKey);
  const keys = (Object.keys(store.panes) as PaneKey[]).filter((key) => {
    if (isRemotePane(key) !== remote || store.panes[key]?.path !== dir) return false;
    return !remote || sessionOfPane(key) === sessionId;
  });
  await Promise.all(keys.map((key) => store.refresh(key)));
  if (select && store.panes[paneKey]?.path === dir) usePanesStore.getState().setSelection(paneKey, [select], select);
}

/** Ejecuta la operación con su fila de progreso, avisa del resultado y refresca. */
async function track(label: string, verb: string, run: (opId: string) => Promise<ArchiveResult>, onDone: (result: ArchiveResult) => string, after: () => Promise<void>) {
  const opId = crypto.randomUUID();
  const archive = useArchiveStore.getState();
  archive.start(opId, label);
  try {
    toast(onDone(await run(opId)), 'success');
  } catch (err) {
    if (err instanceof AppError && err.code === 'CANCELLED') toast(`${label}: cancelado`, 'info');
    else toast(`No se pudo ${verb}: ${errorText(err)}`, 'error');
  } finally {
    useArchiveStore.getState().finish(opId);
  }
  // Aun si falla, puede haber quedado algo a medias en el destino.
  await after().catch(() => undefined);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export interface ExtractRequest {
  sourcePane: PaneKey;
  entry: RemoteEntry;
  targetPane: PaneKey;
  targetDir: string;
  conflict: ArchiveConflict;
}

export async function extractArchive({ sourcePane, entry, targetPane, targetDir, conflict }: ExtractRequest): Promise<void> {
  const ops = pathOpsFor(targetPane);
  // Si se crea la carpeta dentro de la que se ve, se deja seleccionada.
  const parent = ops.parent(targetDir);
  const showsParent = parent !== null && usePanesStore.getState().panes[targetPane]?.path === parent;
  await track(
    `Extrayendo «${entry.name}»`,
    'extraer',
    (opId) => call(window.api.archive.extract({ opId, source: locationIn(sourcePane, entry.path), targetDir: locationIn(targetPane, targetDir), conflict })),
    (result) => {
      if (result.onServer) return `«${entry.name}» extraído en el servidor`;
      const skipped = result.skipped ? ` · ${plural(result.skipped, 'omitido', 'omitidos')}` : '';
      return `«${entry.name}» extraído: ${plural(result.files ?? 0, 'fichero', 'ficheros')}${skipped}`;
    },
    async () => {
      await refreshShowing(targetPane, targetDir);
      if (showsParent) await refreshShowing(targetPane, parent, targetDir);
    },
  );
}

export interface CompressRequest {
  sourcePane: PaneKey;
  entries: RemoteEntry[];
  targetPane: PaneKey;
  zipPath: string;
}

export async function compressEntries({ sourcePane, entries, targetPane, zipPath }: CompressRequest): Promise<void> {
  const ops = pathOpsFor(targetPane);
  const name = ops.basename(zipPath);
  const remote = isRemotePane(sourcePane);
  const sessionId = sessionOfPane(sourcePane);
  const paths = entries.map((e) => e.path);
  await track(
    `Comprimiendo «${name}»`,
    'comprimir',
    (opId) =>
      call(
        window.api.archive.compress({
          opId,
          sources: remote && sessionId ? { kind: 'remote', sessionId, paths } : { kind: 'local', paths },
          target: locationIn(targetPane, zipPath),
        }),
      ),
    (result) => (result.files === null ? `«${name}» creado en el servidor` : `«${name}» creado con ${plural(result.files, 'fichero', 'ficheros')}`),
    () => refreshShowing(targetPane, ops.parent(zipPath) ?? zipPath, zipPath),
  );
}

export async function cancelArchiveOp(opId: string): Promise<void> {
  useArchiveStore.getState().markCancelling(opId);
  await call(window.api.archive.cancel(opId)).catch((err) => toast(errorText(err), 'error'));
}

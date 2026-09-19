import { z } from 'zod';
import { conflictPolicySchema } from '../transfer/protocol';
import type { RemoteEntry, RemoteProtocol } from '../transfer/types';

const sessionId = z.string().min(1).max(100);
const remotePath = z.string().min(1).max(4096).startsWith('/');
const localPath = z.string().min(1).max(4096);
const jobIds = z.array(z.string().max(200)).max(10_000);

/** Una entrada del disco local tiene la misma forma que una remota (ruta nativa). */
export type LocalEntry = RemoteEntry;

export interface LocalRoot {
  path: string;
  label: string;
}

export interface SessionInfo {
  sessionId: string;
  siteId: string;
  siteName: string;
  protocol: RemoteProtocol;
  host: string;
  /** Directorio en el que abrir el panel remoto. */
  startPath: string;
  /** Carpeta local inicial del sitio, si tiene. */
  localStartPath: string | null;
}

export const sessionOpenInputSchema = z.object({ siteId: z.string().min(1).max(100) });
export const sessionIdInputSchema = z.object({ sessionId });

export const remotePathInputSchema = z.object({ sessionId, path: remotePath });
export const remoteRenameInputSchema = z.object({ sessionId, from: remotePath, to: remotePath });
export const remoteDeleteInputSchema = z.object({
  sessionId,
  items: z.array(z.object({ path: remotePath, isDirectory: z.boolean() })).min(1).max(10_000),
});
export const remoteChmodInputSchema = z.object({ sessionId, path: remotePath, mode: z.number().int().min(0).max(0o7777) });

export const localPathInputSchema = z.object({ path: localPath });
export const localRenameInputSchema = z.object({ from: localPath, to: localPath });
export const localDeleteInputSchema = z.object({ paths: z.array(localPath).min(1).max(10_000) });

/** Arrastre nativo fuera de la ventana (al Explorador, a otro programa…). */
export const startDragInputSchema = z.object({ paths: z.array(localPath).min(1).max(200) });

/** Copia ficheros del SO (soltados desde el Explorador) dentro de una carpeta local. */
export const localCopyIntoInputSchema = z.object({ paths: z.array(localPath).min(1).max(10_000), targetDir: localPath });

/** Copia de ficheros remotos a un temporal para poder arrastrarlos fuera. */
export const prepareDragInputSchema = z.object({
  sessionId,
  items: z.array(z.object({ path: remotePath, name: z.string().min(1).max(1024) })).min(1).max(200),
});
/** Un elemento por cada pedido; `null` si no se pudo bajar. */
export type PreparedDragFile = { path: string; name: string } | null;

export const enqueueInputSchema = z.object({
  sessionId,
  conflictPolicy: conflictPolicySchema,
  items: z
    .array(
      z.object({
        direction: z.enum(['upload', 'download']),
        localPath,
        remotePath,
        isDirectory: z.boolean(),
      }),
    )
    .min(1)
    .max(10_000),
});
export type EnqueueInput = z.output<typeof enqueueInputSchema>;

export const jobIdsInputSchema = z.object({ jobIds });

/** Reanuda en una sesión abierta trabajos recuperados de una ejecución anterior. */
export const resumeJobsInputSchema = z.object({ sessionId, jobIds });
export const resolveConflictInputSchema = z.object({
  jobId: z.string().max(200),
  decision: z.enum(['overwrite', 'overwrite-if-newer', 'resume', 'rename', 'skip']),
  applyToAll: z.boolean(),
});

export const openFileDialogInputSchema = z.object({
  title: z.string().max(200),
  directory: z.boolean(),
});

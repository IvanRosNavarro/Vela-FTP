import { z } from 'zod';

export const watchStartInputSchema = z.object({
  sessionId: z.string().min(1).max(100),
  localDir: z.string().min(1).max(4096),
  remoteDir: z.string().min(1).max(4096).startsWith('/'),
});

export const watchIdInputSchema = z.object({ id: z.string().uuid() });

/** Carpeta local vigilada: lo que se crea o cambia en ella se sube a `remoteDir`. */
export interface WatchInfo {
  id: string;
  siteId: string;
  siteName: string;
  localDir: string;
  remoteDir: string;
  /** Ficheros encolados desde que empezó. */
  uploads: number;
  lastUploadAt: number | null;
  /** Último problema (p. ej. sin conexión); null si va bien. */
  error: string | null;
}

import { z } from 'zod';
import type { AuthMethod, RemoteProtocol } from '../transfer/types';

export interface ImportedSite {
  /** Índice estable dentro del fichero, para elegir qué importar. */
  key: string;
  name: string;
  /** Carpetas de FileZilla unidas con « / ». null = raíz. */
  projectName: string | null;
  protocol: RemoteProtocol;
  host: string;
  port: number;
  username: string;
  auth: AuthMethod;
  keyPath: string | null;
  remotePath: string | null;
  localPath: string | null;
  notes: string;
  /** Contraseña legible en el fichero (base64). Nunca se envía al renderer. */
  hasPassword: boolean;
  /** Avisos que el usuario debe ver antes de importar. */
  warnings: string[];
}

export interface FileZillaPreview {
  path: string;
  sites: ImportedSite[];
  skipped: Array<{ name: string; reason: string }>;
}

export const filezillaPreviewInputSchema = z.object({
  /** null = ubicación por defecto de FileZilla en este sistema. */
  path: z.string().min(1).max(4096).nullable(),
});

export const filezillaApplyInputSchema = z.object({
  path: z.string().min(1).max(4096),
  keys: z.array(z.string().max(50)).min(1).max(5000),
});

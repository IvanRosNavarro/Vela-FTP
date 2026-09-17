import { z } from 'zod';

/** Tope para abrir un fichero en el editor. */
export const EDITOR_MAX_BYTES = 5 * 1024 * 1024;
/** Tope para la vista previa; el texto se muestra recortado a `PREVIEW_TEXT_BYTES`. */
export const PREVIEW_MAX_BYTES = 20 * 1024 * 1024;
export const PREVIEW_TEXT_BYTES = 1024 * 1024;

const sessionId = z.string().min(1).max(100);
const remotePath = z.string().min(1).max(4096).startsWith('/');
const localPath = z.string().min(1).max(4096);
const documentId = z.string().uuid();

export const editorIdInputSchema = z.object({ id: documentId });

export const editorSaveInputSchema = z.object({
  id: documentId,
  // En UTF-16 cada unidad puede ocupar hasta 3 bytes en UTF-8: el tope real se mide al guardar.
  content: z.string().max(EDITOR_MAX_BYTES),
  /** Guardar aunque el fichero haya cambiado en el servidor. */
  force: z.boolean(),
});

export const editorDirtyInputSchema = z.object({ id: documentId, dirty: z.boolean() });

export const diffInputSchema = z.object({ sessionId, remotePath, localPath });

export type EditorDocument =
  | {
      id: string;
      mode: 'edit';
      name: string;
      remotePath: string;
      siteName: string;
      content: string;
    }
  | {
      id: string;
      mode: 'diff';
      name: string;
      remotePath: string;
      localPath: string;
      siteName: string;
      /** Remoto a la izquierda, local a la derecha. */
      original: string;
      modified: string;
    };

export interface EditorSaveResult {
  savedAt: number;
  size: number;
}

export type FilePreview =
  | { kind: 'image'; name: string; size: number; dataUrl: string }
  | { kind: 'text'; name: string; size: number; content: string; truncated: boolean }
  | { kind: 'binary'; name: string; size: number };

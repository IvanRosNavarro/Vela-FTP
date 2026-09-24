import { z } from 'zod';
import { terminalSizeSchema } from '../transfer/terminal';

export const terminalOpenInputSchema = z.object({
  sessionId: z.string().min(1).max(100),
  cols: terminalSizeSchema.shape.cols,
  rows: terminalSizeSchema.shape.rows,
});

export const terminalFocusInputSchema = z.object({ focused: z.boolean() });

/** Solo enlaces web: un `file:` o un esquema raro desde el servidor no se abre. */
export const terminalOpenLinkInputSchema = z.object({
  url: z
    .string()
    .max(4096)
    .refine((value) => {
      try {
        return ['http:', 'https:'].includes(new URL(value).protocol);
      } catch {
        return false;
      }
    }, 'Solo se abren enlaces http y https'),
});

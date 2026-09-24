import { z } from 'zod';

// Mensajes de una terminal SSH. Viajan por un MessagePort directo entre el
// renderer y el motor: main lo crea y lo entrega, pero no ve el tráfico.

export const terminalSizeSchema = z.object({
  cols: z.number().int().min(2).max(1000),
  rows: z.number().int().min(1).max(500),
});

/** Del renderer al motor. El motor valida cada mensaje con este schema. */
export const terminalInputSchema = z.discriminatedUnion('t', [
  /** Lo que teclea o pega el usuario (UTF-16, se envía en UTF-8). */
  z.object({ t: z.literal('data'), data: z.string().max(1_000_000) }),
  /** Informes del ratón y otras secuencias binarias de xterm (un byte por carácter). */
  z.object({ t: z.literal('binary'), data: z.string().max(1_000_000) }),
  z.object({ t: z.literal('resize'), cols: terminalSizeSchema.shape.cols, rows: terminalSizeSchema.shape.rows }),
  z.object({ t: z.literal('close') }),
]);

export type TerminalInput = z.infer<typeof terminalInputSchema>;

/** Del motor al renderer. Tras `exit` o `lost` el puerto se cierra. */
export type TerminalOutput =
  | { t: 'data'; data: Uint8Array }
  /** El shell remoto terminó (`exit`, Ctrl+D). */
  | { t: 'exit'; code: number | null; signal: string | null }
  /** Se cayó la conexión SSH o se cerró la sesión. */
  | { t: 'lost'; message: string };

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
  /** Enciende o apaga el estado del servidor bajo la terminal. */
  z.object({ t: z.literal('monitor'), enabled: z.boolean() }),
  /** Carpeta de la que medir el disco (la del panel remoto); null = ninguna. */
  z.object({ t: z.literal('disk-path'), path: z.string().min(1).max(4096).startsWith('/').nullable() }),
]);

export type TerminalInput = z.infer<typeof terminalInputSchema>;

/** Estado del servidor, leído de `/proc` una vez por segundo. Bytes y segundos. */
export interface ServerStats {
  /** % de CPU ocupada desde la muestra anterior; null en la primera. */
  cpu: number | null;
  cores: number | null;
  memTotal: number;
  memUsed: number;
  swapTotal: number;
  swapUsed: number;
  /** Carga media de 1, 5 y 15 minutos. */
  load: [number, number, number];
  uptime: number;
  /** Bytes por segundo de todas las interfaces salvo `lo`; null en la primera muestra. */
  rxRate: number | null;
  txRate: number | null;
}

/** Uso del sistema de ficheros de una carpeta (`df -Pk`). */
export interface DiskUsage {
  path: string;
  mount: string;
  total: number;
  used: number;
}

/** Del motor al renderer. Tras `exit` o `lost` el puerto se cierra. */
export type TerminalOutput =
  | { t: 'data'; data: Uint8Array }
  | { t: 'stats'; stats: ServerStats }
  | { t: 'disk'; disk: DiskUsage | null }
  /** El servidor no da estado (no es Linux, o no deja ejecutar órdenes). */
  | { t: 'stats-unavailable'; reason: string }
  /** El shell remoto terminó (`exit`, Ctrl+D). */
  | { t: 'exit'; code: number | null; signal: string | null }
  /** Se cayó la conexión SSH o se cerró la sesión. */
  | { t: 'lost'; message: string };

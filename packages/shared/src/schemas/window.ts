import { z } from 'zod';

// Electron acepta #RGB, #RRGGBB y #AARRGGBB (alfa delante, al revés que en CSS).
// Los temas builtin usan #rrggbb; el glassmorphism envía #00000000.
const cssColor = z
  .string()
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'color hex #rgb, #rrggbb o #aarrggbb');

export const titleBarOverlayInputSchema = z.object({
  color: cssColor,
  symbolColor: cssColor,
});

export type TitleBarOverlayInput = z.output<typeof titleBarOverlayInputSchema>;

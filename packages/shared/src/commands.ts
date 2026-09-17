import { z } from 'zod';

export type CommandCategory = 'app' | 'site' | 'navigation' | 'transfer' | 'view' | 'window';

export const COMMAND_CATEGORY_LABELS: Record<CommandCategory, string> = {
  app: 'General',
  site: 'Sitios',
  navigation: 'Navegación',
  transfer: 'Transferencias',
  view: 'Vista',
  window: 'Ventana',
};

/** Acciones que un comando de main pide ejecutar a la interfaz. */
export type CommandAction =
  | 'open-palette'
  | 'open-settings'
  | 'new-site'
  | 'new-project'
  | 'import-filezilla'
  | 'disconnect-active'
  | 'next-session'
  | 'previous-session'
  | 'focus-path'
  | 'add-bookmark'
  | 'toggle-hidden'
  | 'refresh'
  | 'cancel-all'
  | 'retry-failed'
  | 'toggle-bottom-panel'
  | 'open-updates'
  | 'toggle-compare'
  | 'toggle-sync-browsing';

export interface CommandInfo {
  id: string;
  title: string;
  category: CommandCategory;
  defaultShortcut: string | null;
  /** Atajo efectivo (el del usuario o el por defecto), null si no tiene. */
  shortcut: string | null;
  /** Combinaciones que no se pueden asignar. */
  reserved: boolean;
}

export const commandExecuteInputSchema = z.object({ id: z.string().min(1).max(100) });

export const shortcutSetInputSchema = z.object({
  commandId: z.string().min(1).max(100),
  /** null = quitar el atajo. */
  combo: z.string().min(1).max(50).nullable(),
});

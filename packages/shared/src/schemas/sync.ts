import { z } from 'zod';

/** Grupos que el usuario puede activar o desactivar por dispositivo. */
export type SyncCategory = 'sites' | 'credentials' | 'hosts' | 'settings';

export const SYNC_CATEGORIES: Array<{ id: SyncCategory; label: string; description: string }> = [
  { id: 'sites', label: 'Sitios y proyectos', description: 'Servidores, proyectos y marcadores de carpeta.' },
  { id: 'credentials', label: 'Contraseñas de los sitios', description: 'Las contraseñas y passphrases guardadas, cifradas de extremo a extremo.' },
  { id: 'hosts', label: 'Servidores de confianza', description: 'Las huellas SSH y los certificados que ya has aceptado.' },
  { id: 'settings', label: 'Ajustes y atajos', description: 'Tema, política de conflictos y atajos de teclado.' },
];

/** Tipo de entidad remota → categoría. El prefijo `ftp.` separa lo nuestro de Vela Browser. */
export const SYNC_TYPE_TO_CATEGORY: Record<string, SyncCategory> = {
  'ftp.project': 'sites',
  'ftp.site': 'sites',
  'ftp.bookmark': 'sites',
  'ftp.site_secret': 'credentials',
  'ftp.known_host': 'hosts',
  'ftp.setting': 'settings',
};

export type SyncPhase =
  | 'off'
  /** Hay sesión pero falta la contraseña de sincronización para derivar la clave. */
  | 'needs-password'
  | 'connecting'
  | 'active'
  | 'error';

export interface SyncStatus {
  phase: SyncPhase;
  /** Cuenta con la que se ha vinculado el dispositivo. */
  email: string | null;
  connected: boolean;
  lastSyncAt: number | null;
  pendingChanges: number;
  error: string | null;
  disabledCategories: SyncCategory[];
}

export const syncEmailInputSchema = z.object({ email: z.string().email().max(320) });
export const syncPasswordInputSchema = z.object({ password: z.string().min(8).max(512) });
export const syncCategoriesInputSchema = z.object({
  disabled: z.array(z.enum(['sites', 'credentials', 'hosts', 'settings'])).max(4),
});

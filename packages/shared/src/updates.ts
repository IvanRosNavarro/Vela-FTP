/**
 * Estado del actualizador. Lo mantiene main y lo emite completo en cada cambio.
 * - `unsupported`: build sin empaquetar (desarrollo).
 */
export type UpdatePhase = 'unsupported' | 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'downloaded' | 'error';

export interface UpdateStatus {
  phase: UpdatePhase;
  currentVersion: string;
  /** Versión nueva cuando la hay. */
  version: string | null;
  /** 0-100 durante la descarga. */
  percent: number;
  error: string | null;
  checkedAt: number | null;
  /**
   * false cuando la plataforma no puede instalar sola (macOS sin firmar): se
   * ofrece la página de la release en su lugar.
   */
  canInstall: boolean;
}

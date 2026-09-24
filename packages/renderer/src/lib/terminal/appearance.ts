import { SETTING_DEFAULTS } from '@vela-ftp/shared';

/** Ajustes de la terminal que se aplican en caliente a todas las abiertas. */
export interface TerminalAppearance {
  fontSize: number;
  fontFamily: string;
  scrollback: number;
  /** Barra con el estado del servidor bajo la terminal. */
  serverStats: boolean;
}

let current: TerminalAppearance = {
  fontSize: SETTING_DEFAULTS['terminal:font-size'],
  fontFamily: SETTING_DEFAULTS['terminal:font-family'],
  scrollback: SETTING_DEFAULTS['terminal:scrollback'],
  serverStats: SETTING_DEFAULTS['terminal:server-stats'],
};
const listeners = new Set<(appearance: TerminalAppearance) => void>();

export function getTerminalAppearance(): TerminalAppearance {
  return current;
}

export function setTerminalAppearance(patch: Partial<TerminalAppearance>): void {
  current = { ...current, ...patch };
  for (const listener of listeners) listener(current);
}

export function onTerminalAppearance(listener: (appearance: TerminalAppearance) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Lee los ajustes guardados; si alguno falla se queda el valor por defecto. */
export async function loadTerminalAppearance(): Promise<void> {
  const [fontSize, fontFamily, scrollback, serverStats] = await Promise.all([
    window.api.settings.get('terminal:font-size'),
    window.api.settings.get('terminal:font-family'),
    window.api.settings.get('terminal:scrollback'),
    window.api.settings.get('terminal:server-stats'),
  ]);
  setTerminalAppearance({
    ...(fontSize.ok ? { fontSize: fontSize.data } : {}),
    ...(fontFamily.ok ? { fontFamily: fontFamily.data } : {}),
    ...(scrollback.ok ? { scrollback: scrollback.data } : {}),
    ...(serverStats.ok ? { serverStats: serverStats.data } : {}),
  });
}

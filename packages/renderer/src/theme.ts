import { ThemeManager } from 'vela-kit/theme';

export const themeManager = new ThemeManager({
  // El overlay nativo de Windows no lee CSS: hay que pasarle los colores.
  onTitleBarColors: (colors) => {
    if (window.api.platform !== 'win32') return;
    void window.api.window.updateTitleBarOverlay(colors);
  },
});

/** Aplica el tema guardado. Si los ajustes fallan, se queda en `system`. */
export async function applySavedTheme(): Promise<void> {
  themeManager.initialize();
  const res = await window.api.settings.get('ui:theme');
  themeManager.setTheme(res.ok ? res.data : 'system');
}

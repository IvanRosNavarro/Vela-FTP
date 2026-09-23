import { ThemeManager } from 'vela-kit/theme';

export const themeManager = new ThemeManager({
  // El overlay nativo de Windows no lee CSS: hay que pasarle los colores.
  onTitleBarColors: (colors) => {
    if (window.api.platform !== 'win32') return;
    void window.api.window.updateTitleBarOverlay(colors);
  },
});

/** Aplica el tema y el cristal guardados. Si los ajustes fallan, se queda en `system`. */
export async function applySavedTheme(): Promise<void> {
  themeManager.initialize();
  const res = await window.api.settings.get('ui:theme');
  themeManager.setTheme(res.ok ? res.data : 'system');
  await applySavedGlass();
}

/** Relee los tres ajustes del cristal y se los pasa al tema. */
export async function applySavedGlass(): Promise<void> {
  const [enabled, intensity, opacity] = await Promise.all([
    window.api.settings.get('ui:glassmorphism'),
    window.api.settings.get('ui:glassmorphism-intensity'),
    window.api.settings.get('ui:glassmorphism-opacity'),
  ]);
  themeManager.applyGlassmorphism(
    enabled.ok ? enabled.data : false,
    intensity.ok ? intensity.data : 60,
    opacity.ok ? opacity.data : 60,
  );
}

const IS_MAC = window.api.platform === 'darwin';

/**
 * Modificador para sacar ficheros de la app arrastrando. Tiene que ser el que
 * el sistema entiende como «copiar» al soltar: en Windows, Alt pide un acceso
 * directo y el Explorador rechaza el drop; Ctrl pide copia, que es lo que
 * ofrecemos. En macOS ese papel lo hace Option.
 */
export const EXPORT_MODIFIER_LABEL = IS_MAC ? 'Option' : 'Ctrl';

export const wantsExport = (e: { altKey: boolean; ctrlKey: boolean }): boolean => (IS_MAC ? e.altKey : e.ctrlKey);

import { z } from 'zod';

/**
 * Ajustes conocidos y el schema de su valor. Un ajuste nuevo se declara aquí;
 * el IPC rechaza claves que no estén en esta lista.
 */
export const SETTING_SCHEMAS = {
  /** id de tema builtin o custom, o `system`. */
  'ui:theme': z.string().min(1).max(100),
  /** Qué hacer por defecto cuando el destino de una transferencia ya existe. */
  'transfer:conflict-policy': z.enum(['ask', 'overwrite', 'overwrite-if-newer', 'resume', 'rename', 'skip']),
  /** Alto del panel inferior (cola y registro) en px. */
  'ui:bottom-panel-height': z.number().int().min(80).max(2000),
  /** Ancho de la sidebar en px. */
  'ui:sidebar-width': z.number().int().min(160).max(600),
  /** Sidebar reducida a una franja de iconos. */
  'ui:sidebar-collapsed': z.boolean(),
  /** Parte del ancho que se lleva el panel local frente al remoto. */
  'ui:panes-ratio': z.number().min(0.15).max(0.85),
  /** Última carpeta del panel local. */
  'local:last-path': z.string().min(1).max(4096),
  /** Atajos del usuario por id de comando: string = combinación, null = sin atajo. */
  'shortcuts:custom': z.record(z.string().max(100), z.string().max(50).nullable()),
  /** Qué abren F4 y Espacio: el editor y la vista previa de Vela FTP, o el programa del sistema. */
  'files:open-with': z.enum(['vela', 'system']),
  /** Al guardar en un programa externo: subir solo o preguntar antes. */
  'files:external-save': z.enum(['upload', 'ask']),
  /** Ya se mostró la bienvenida del primer arranque. */
  'app:welcomed': z.boolean(),
  /** Buscar actualizaciones al arrancar y cada pocas horas. */
  'updates:auto-check': z.boolean(),
} as const;

export type SettingKey = keyof typeof SETTING_SCHEMAS;
export type SettingValue<K extends SettingKey> = z.output<(typeof SETTING_SCHEMAS)[K]>;

/** `local:last-path` vacío = carpeta de usuario (se resuelve en el renderer). */
export const SETTING_DEFAULTS: { [K in SettingKey]: SettingValue<K> } = {
  'ui:theme': 'system',
  'transfer:conflict-policy': 'ask',
  'ui:bottom-panel-height': 220,
  'ui:sidebar-width': 240,
  'ui:sidebar-collapsed': false,
  'ui:panes-ratio': 0.5,
  'local:last-path': '~',
  'shortcuts:custom': {},
  'files:open-with': 'vela',
  'files:external-save': 'upload',
  'app:welcomed': false,
  'updates:auto-check': true,
};

const settingKeySchema = z.enum(Object.keys(SETTING_SCHEMAS) as [SettingKey, ...SettingKey[]]);

export const settingsGetInputSchema = z.object({ key: settingKeySchema });

/** Valida la clave y después el valor con el schema de esa clave. */
export const settingsSetInputSchema = z
  .object({ key: settingKeySchema, value: z.unknown() })
  .superRefine((input, ctx) => {
    const parsed = SETTING_SCHEMAS[input.key].safeParse(input.value);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({ ...issue, path: ['value', ...issue.path] });
      }
    }
  });

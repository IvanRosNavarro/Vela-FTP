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
  /** Última carpeta del panel local. */
  'local:last-path': z.string().min(1).max(4096),
  /** Atajos del usuario por id de comando: string = combinación, null = sin atajo. */
  'shortcuts:custom': z.record(z.string().max(100), z.string().max(50).nullable()),
} as const;

export type SettingKey = keyof typeof SETTING_SCHEMAS;
export type SettingValue<K extends SettingKey> = z.output<(typeof SETTING_SCHEMAS)[K]>;

/** `local:last-path` vacío = carpeta de usuario (se resuelve en el renderer). */
export const SETTING_DEFAULTS: { [K in SettingKey]: SettingValue<K> } = {
  'ui:theme': 'system',
  'transfer:conflict-policy': 'ask',
  'ui:bottom-panel-height': 220,
  'ui:sidebar-width': 240,
  'local:last-path': '~',
  'shortcuts:custom': {},
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

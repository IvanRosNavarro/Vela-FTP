import { z } from 'zod';

/**
 * Ajustes conocidos y el schema de su valor. Un ajuste nuevo se declara aquí;
 * el IPC rechaza claves que no estén en esta lista.
 */
export const SETTING_SCHEMAS = {
  /** id de tema builtin o custom, o `system`. */
  'ui:theme': z.string().min(1).max(100),
} as const;

export type SettingKey = keyof typeof SETTING_SCHEMAS;
export type SettingValue<K extends SettingKey> = z.output<(typeof SETTING_SCHEMAS)[K]>;

export const SETTING_DEFAULTS: { [K in SettingKey]: SettingValue<K> } = {
  'ui:theme': 'system',
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

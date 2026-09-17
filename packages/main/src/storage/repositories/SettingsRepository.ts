import type { DatabaseSync } from 'node:sqlite';
import {
  SETTING_DEFAULTS,
  SETTING_SCHEMAS,
  type SettingKey,
  type SettingValue,
} from '@vela-ftp/shared';
import { logger } from 'vela-kit/logger';

interface SettingRow {
  value: string;
}

/** Ajustes globales tipados por clave. El valor se guarda como JSON. */
export class SettingsRepository {
  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Devuelve el valor guardado o el por defecto. Un valor corrupto o que ya no
   * cumple el schema (p. ej. tras cambiarlo) cae al por defecto.
   */
  get<K extends SettingKey>(key: K): SettingValue<K> {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as SettingRow | undefined;
    if (!row) return SETTING_DEFAULTS[key];
    try {
      const parsed = SETTING_SCHEMAS[key].safeParse(JSON.parse(row.value));
      if (parsed.success) return parsed.data as SettingValue<K>;
    } catch {
      // JSON no válido: se trata igual que un valor que no cumple el schema
    }
    logger.warn(`[settings] valor no válido para ${key}; se usa el por defecto`);
    return SETTING_DEFAULTS[key];
  }

  set<K extends SettingKey>(key: K, value: SettingValue<K>): void {
    const parsed = SETTING_SCHEMAS[key].parse(value);
    this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, JSON.stringify(parsed), this.now());
  }
}

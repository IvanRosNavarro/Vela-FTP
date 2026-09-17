import { describe, expect, it } from 'vitest';
import { createTestDb } from '../../test/createTestDb';
import { SettingsRepository } from './SettingsRepository';

describe('SettingsRepository', () => {
  it('devuelve el valor por defecto si no hay nada guardado', () => {
    const repo = new SettingsRepository(createTestDb());
    expect(repo.get('ui:theme')).toBe('system');
  });

  it('guarda, sobrescribe y sella updated_at', () => {
    const db = createTestDb();
    let now = 1000;
    const repo = new SettingsRepository(db, () => now);
    repo.set('ui:theme', 'nord');
    now = 2000;
    repo.set('ui:theme', 'dracula');
    expect(repo.get('ui:theme')).toBe('dracula');
    expect(db.prepare("SELECT value, updated_at FROM settings WHERE key = 'ui:theme'").get())
      .toEqual({ value: '"dracula"', updated_at: 2000 });
  });

  it('rechaza valores que no cumplen el schema', () => {
    const repo = new SettingsRepository(createTestDb());
    expect(() => repo.set('ui:theme', '')).toThrow();
  });

  it('un valor corrupto en BD cae al por defecto', () => {
    const db = createTestDb();
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('ui:theme', '{roto', 0)").run();
    expect(new SettingsRepository(db).get('ui:theme')).toBe('system');
  });
});

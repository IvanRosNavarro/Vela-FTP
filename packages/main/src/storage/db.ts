import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { app } from 'electron';
import { logger } from 'vela-kit/logger';
import { migrationsFromGlob, openDatabase } from 'vela-kit/storage';

const MIGRATIONS = migrationsFromGlob(
  import.meta.glob('./migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>,
);

let db: DatabaseSync | null = null;

export function initStorage(): DatabaseSync {
  if (db) return db;
  const userDataDir = app.getPath('userData');
  fs.mkdirSync(userDataDir, { recursive: true });
  const dbPath = path.join(userDataDir, 'vela.db');
  logger.info(`[storage] abriendo ${dbPath}`);
  db = openDatabase({ path: dbPath, migrations: MIGRATIONS, logger });
  db.prepare(
    `INSERT INTO app_metadata (key, value) VALUES ('app_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(app.getVersion());
  return db;
}

export function closeStorage(): void {
  db?.close();
  db = null;
}

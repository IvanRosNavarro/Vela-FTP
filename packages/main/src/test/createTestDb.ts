import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from 'vela-kit/storage';

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../storage/migrations');

/** BD en memoria con todas las migraciones reales aplicadas. */
export function createTestDb(): DatabaseSync {
  const migrations = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .map((name) => ({ name, sql: fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8') }));
  return openDatabase({ path: ':memory:', migrations });
}

import type { DatabaseSync } from 'node:sqlite';
import { safeStorage } from 'electron';
import { logger } from 'vela-kit/logger';

/** Claves de `app_metadata` que usa la sincronización. */
type Key =
  | 'sync:session-token-enc'
  | 'sync:session-token'
  | 'sync:email'
  | 'sync:remote-profile-id'
  | 'sync:key-salt'
  | 'sync:last-seq'
  | 'sync:disabled-categories'
  | 'sync:last-sync-at'
  | 'sync:key-enc';

/**
 * Estado de la sincronización. Vive en `app_metadata`, no en `settings`: el
 * renderer puede escribir cualquier ajuste por IPC y aquí hay un token de sesión.
 */
export class SyncStateRepository {
  constructor(private readonly db: DatabaseSync) {}

  private get(key: Key): string | null {
    const row = this.db.prepare('SELECT value FROM app_metadata WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  private set(key: Key, value: string): void {
    this.db
      .prepare('INSERT INTO app_metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }

  private remove(key: Key): void {
    this.db.prepare('DELETE FROM app_metadata WHERE key = ?').run(key);
  }

  /** El token se guarda cifrado con el llavero del SO cuando lo hay. */
  saveSessionToken(token: string): void {
    try {
      if (safeStorage.isEncryptionAvailable()) {
        this.set('sync:session-token-enc', safeStorage.encryptString(token).toString('base64'));
        this.remove('sync:session-token');
        return;
      }
    } catch (err) {
      logger.warn('[sync] no se pudo cifrar el token de sesión', err);
    }
    this.set('sync:session-token', token);
  }

  sessionToken(): string | null {
    const encrypted = this.get('sync:session-token-enc');
    if (encrypted) {
      try {
        if (safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
      } catch (err) {
        logger.warn('[sync] no se pudo descifrar el token de sesión', err);
      }
      return null;
    }
    return this.get('sync:session-token');
  }

  email(): string | null {
    return this.get('sync:email');
  }

  saveEmail(email: string): void {
    this.set('sync:email', email);
  }

  /** Id del perfil en el servidor: no es ningún id local. */
  remoteProfileId(): string | null {
    return this.get('sync:remote-profile-id');
  }

  saveRemoteProfileId(id: string): void {
    this.set('sync:remote-profile-id', id);
  }

  /** Salt canónico del usuario, tal como lo devolvió el servidor. */
  keySalt(): Buffer | null {
    const hex = this.get('sync:key-salt');
    return hex ? Buffer.from(hex, 'hex') : null;
  }

  saveKeySalt(salt: Buffer): void {
    this.set('sync:key-salt', salt.toString('hex'));
  }

  lastSeq(): number {
    return Number(this.get('sync:last-seq') ?? 0) || 0;
  }

  saveLastSeq(seq: number): void {
    this.set('sync:last-seq', String(seq));
  }

  lastSyncAt(): number | null {
    const value = this.get('sync:last-sync-at');
    return value ? Number(value) : null;
  }

  saveLastSyncAt(at: number): void {
    this.set('sync:last-sync-at', String(at));
  }

  disabledCategories(): string[] {
    try {
      const raw = this.get('sync:disabled-categories');
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  }

  saveDisabledCategories(categories: string[]): void {
    this.set('sync:disabled-categories', JSON.stringify(categories));
  }

  /** Clave de sincronización cifrada con el llavero del SO, para no pedirla en cada arranque. */
  syncKey(): string | null {
    return this.get('sync:key-enc');
  }

  saveSyncKey(encrypted: string): void {
    this.set('sync:key-enc', encrypted);
  }

  clearSyncKey(): void {
    this.remove('sync:key-enc');
  }

  /** Desvincular: fuera el token y todo rastro de la cuenta. */
  clear(): void {
    for (const key of [
      'sync:session-token-enc',
      'sync:session-token',
      'sync:email',
      'sync:remote-profile-id',
      'sync:key-salt',
      'sync:last-seq',
      'sync:last-sync-at',
      'sync:key-enc',
    ] as Key[]) {
      this.remove(key);
    }
  }
}

export interface PendingChange {
  entity_type: string;
  entity_id: string;
  data_json: string | null;
  updated_at: number;
}

/** Cambios que no se pudieron enviar todavía. */
export class SyncPendingRepository {
  constructor(private readonly db: DatabaseSync) {}

  upsert(entityType: string, entityId: string, dataJson: string | null, updatedAt: number): void {
    this.db
      .prepare(
        `INSERT INTO sync_pending (entity_type, entity_id, data_json, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(entity_type, entity_id) DO UPDATE SET
           data_json = excluded.data_json,
           updated_at = excluded.updated_at`,
      )
      .run(entityType, entityId, dataJson, updatedAt);
  }

  listAll(): PendingChange[] {
    return this.db.prepare('SELECT entity_type, entity_id, data_json, updated_at FROM sync_pending ORDER BY updated_at ASC').all() as PendingChange[];
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM sync_pending').get() as { n: number }).n;
  }

  clearAll(): void {
    this.db.prepare('DELETE FROM sync_pending').run();
  }
}

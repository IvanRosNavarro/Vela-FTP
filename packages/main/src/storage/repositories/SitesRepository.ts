import type { DatabaseSync } from 'node:sqlite';
import { generateKeyBetween } from 'fractional-indexing';
import { v7 as uuidv7 } from 'uuid';
import type { Site, SiteInput } from '@vela-ftp/shared';
import { NotFoundError } from 'vela-kit/ipc';
import { transaction } from 'vela-kit/storage';
import type { SecretStore } from '../../security/SecretStore';

type SecretKind = 'password' | 'passphrase';

interface SiteRow {
  id: string;
  name: string;
  protocol: Site['protocol'];
  host: string;
  port: number;
  username: string;
  auth: Site['auth'];
  key_path: string | null;
  initial_remote_path: string | null;
  initial_local_path: string | null;
  max_connections: number;
  notes: string;
  position: string;
  created_at: number;
  updated_at: number;
  has_password: number;
  has_passphrase: number;
}

const SELECT = `
  SELECT s.*,
    EXISTS (SELECT 1 FROM site_secrets x WHERE x.site_id = s.id AND x.kind = 'password') AS has_password,
    EXISTS (SELECT 1 FROM site_secrets x WHERE x.site_id = s.id AND x.kind = 'passphrase') AS has_passphrase
  FROM sites s`;

function toSite(row: SiteRow): Site {
  return {
    id: row.id,
    name: row.name,
    protocol: row.protocol,
    host: row.host,
    port: row.port,
    username: row.username,
    auth: row.auth,
    keyPath: row.key_path,
    initialRemotePath: row.initial_remote_path,
    initialLocalPath: row.initial_local_path,
    maxConnections: row.max_connections,
    notes: row.notes,
    position: row.position,
    hasPassword: row.has_password === 1,
    hasPassphrase: row.has_passphrase === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SitesRepository {
  constructor(
    private readonly db: DatabaseSync,
    private readonly secrets: SecretStore,
    private readonly now: () => number = Date.now,
  ) {}

  list(): Site[] {
    return (this.db.prepare(`${SELECT} ORDER BY s.position COLLATE BINARY`).all() as unknown as SiteRow[]).map(toSite);
  }

  get(id: string): Site {
    const row = this.db.prepare(`${SELECT} WHERE s.id = ?`).get(id) as SiteRow | undefined;
    if (!row) throw new NotFoundError('site', id);
    return toSite(row);
  }

  private lastPosition(): string | null {
    const row = this.db.prepare('SELECT position FROM sites ORDER BY position COLLATE BINARY DESC LIMIT 1').get() as
      | { position: string }
      | undefined;
    return row?.position ?? null;
  }

  create(input: SiteInput): Site {
    const id = uuidv7();
    const now = this.now();
    transaction(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO sites (id, name, protocol, host, port, username, auth, key_path, initial_remote_path,
             initial_local_path, max_connections, notes, position, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.name,
          input.protocol,
          input.host,
          input.port,
          input.username,
          input.auth,
          input.keyPath,
          input.initialRemotePath,
          input.initialLocalPath,
          input.maxConnections,
          input.notes,
          generateKeyBetween(this.lastPosition(), null),
          now,
          now,
        );
      this.applySecrets(id, input);
    });
    return this.get(id);
  }

  update(id: string, input: SiteInput): Site {
    this.get(id);
    transaction(this.db, () => {
      this.db
        .prepare(
          `UPDATE sites SET name = ?, protocol = ?, host = ?, port = ?, username = ?, auth = ?, key_path = ?,
             initial_remote_path = ?, initial_local_path = ?, max_connections = ?, notes = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          input.name,
          input.protocol,
          input.host,
          input.port,
          input.username,
          input.auth,
          input.keyPath,
          input.initialRemotePath,
          input.initialLocalPath,
          input.maxConnections,
          input.notes,
          this.now(),
          id,
        );
      this.applySecrets(id, input);
    });
    return this.get(id);
  }

  /** undefined = no tocar, null = borrar, string = cifrar y guardar. */
  private applySecrets(id: string, input: Pick<SiteInput, 'password' | 'passphrase'>): void {
    for (const kind of ['password', 'passphrase'] as const) {
      const value = input[kind];
      if (value === undefined) continue;
      if (value === null || value === '') {
        this.db.prepare('DELETE FROM site_secrets WHERE site_id = ? AND kind = ?').run(id, kind);
        continue;
      }
      this.db
        .prepare(
          `INSERT INTO site_secrets (site_id, kind, ciphertext, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(site_id, kind) DO UPDATE SET ciphertext = excluded.ciphertext, updated_at = excluded.updated_at`,
        )
        .run(id, kind, this.secrets.encrypt(value), this.now());
    }
  }

  getSecret(id: string, kind: SecretKind): string | null {
    const row = this.db.prepare('SELECT ciphertext FROM site_secrets WHERE site_id = ? AND kind = ?').get(id, kind) as
      | { ciphertext: Uint8Array }
      | undefined;
    return row ? this.secrets.decrypt(row.ciphertext) : null;
  }

  delete(id: string): void {
    this.get(id);
    this.db.prepare('DELETE FROM sites WHERE id = ?').run(id);
  }

  duplicate(id: string): Site {
    const site = this.get(id);
    const password = site.hasPassword ? this.getSecret(id, 'password') : null;
    const passphrase = site.hasPassphrase ? this.getSecret(id, 'passphrase') : null;
    return this.create({ ...site, name: `${site.name} (copia)`, password, passphrase });
  }

  /** Coloca el sitio entre dos vecinos (ids de la lista ya ordenada). */
  move(id: string, beforeId: string | null, afterId: string | null): Site {
    const before = beforeId ? this.get(beforeId).position : null;
    const after = afterId ? this.get(afterId).position : null;
    this.db.prepare('UPDATE sites SET position = ?, updated_at = ? WHERE id = ?').run(generateKeyBetween(before, after), this.now(), id);
    return this.get(id);
  }
}

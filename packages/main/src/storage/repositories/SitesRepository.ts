import type { DatabaseSync } from 'node:sqlite';
import { generateKeyBetween } from 'fractional-indexing';
import { v7 as uuidv7 } from 'uuid';
import type { Site, SiteInput } from '@vela-ftp/shared';
import { NotFoundError } from 'vela-kit/ipc';
import { transaction } from 'vela-kit/storage';
import type { SecretStore } from '../../security/SecretStore';
import { emitEntity, emitEntityDeleted } from '../../sync/emit';

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
  project_id: string | null;
  position: string;
  created_at: number;
  updated_at: number;
  has_password: number;
  has_passphrase: number;
  uses: number | null;
  last_used_at: number | null;
}

const SELECT = `
  SELECT s.*,
    EXISTS (SELECT 1 FROM site_secrets x WHERE x.site_id = s.id AND x.kind = 'password') AS has_password,
    EXISTS (SELECT 1 FROM site_secrets x WHERE x.site_id = s.id AND x.kind = 'passphrase') AS has_passphrase,
    u.uses AS uses, u.last_used_at AS last_used_at
  FROM sites s
  LEFT JOIN site_usage u ON u.site_id = s.id`;

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
    projectId: row.project_id,
    position: row.position,
    hasPassword: row.has_password === 1,
    hasPassphrase: row.has_passphrase === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    uses: row.uses ?? 0,
    lastUsedAt: row.last_used_at,
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

  private lastPosition(projectId: string | null): string | null {
    const row = this.db
      .prepare('SELECT position FROM sites WHERE project_id IS ? ORDER BY position COLLATE BINARY DESC LIMIT 1')
      .get(projectId) as { position: string } | undefined;
    return row?.position ?? null;
  }

  create(input: SiteInput): Site {
    const id = uuidv7();
    const now = this.now();
    transaction(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO sites (id, name, protocol, host, port, username, auth, key_path, initial_remote_path,
             initial_local_path, max_connections, notes, project_id, position, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          input.projectId ?? null,
          generateKeyBetween(this.lastPosition(input.projectId ?? null), null),
          now,
          now,
        );
      this.applySecrets(id, input);
    });
    const site = this.get(id);
    this.publish(site);
    return site;
  }

  update(id: string, input: SiteInput): Site {
    const current = this.get(id);
    const projectId = input.projectId === undefined ? current.projectId : input.projectId;
    transaction(this.db, () => {
      this.db
        .prepare(
          `UPDATE sites SET name = ?, protocol = ?, host = ?, port = ?, username = ?, auth = ?, key_path = ?,
             initial_remote_path = ?, initial_local_path = ?, max_connections = ?, notes = ?, project_id = ?, updated_at = ?
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
          projectId,
          this.now(),
          id,
        );
      this.applySecrets(id, input);
    });
    const site = this.get(id);
    this.publish(site);
    return site;
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
    emitEntityDeleted('ftp.site', id);
    emitEntityDeleted('ftp.site_secret', id);
  }

  duplicate(id: string): Site {
    const site = this.get(id);
    const password = site.hasPassword ? this.getSecret(id, 'password') : null;
    const passphrase = site.hasPassphrase ? this.getSecret(id, 'passphrase') : null;
    return this.create({ ...site, name: `${site.name} (copia)`, projectId: site.projectId, password, passphrase });
  }

  /**
   * Coloca el sitio en un proyecto (o en ninguno) entre dos vecinos de ese
   * grupo. Sin vecinos, va al final del grupo.
   */
  relocate(id: string, projectId: string | null, beforeId: string | null, afterId: string | null): Site {
    this.get(id);
    const before = beforeId ? this.get(beforeId).position : afterId ? null : this.lastPosition(projectId);
    const after = afterId ? this.get(afterId).position : null;
    this.db
      .prepare('UPDATE sites SET project_id = ?, position = ?, updated_at = ? WHERE id = ?')
      .run(projectId, generateKeyBetween(before, after), this.now(), id);
    const site = this.get(id);
    this.publish(site);
    return site;
  }

  /** Compatibilidad: mover dentro del mismo proyecto. */
  move(id: string, beforeId: string | null, afterId: string | null): Site {
    return this.relocate(id, this.get(id).projectId, beforeId, afterId);
  }

  // ── Sincronización ─────────────────────────────────────────────────────────

  /** El sitio tal como viaja: sin secretos ni uso local, que son de este equipo. */
  toSync(site: Site): object {
    const { hasPassword: _p, hasPassphrase: _s, createdAt: _c, uses: _u, lastUsedAt: _l, ...rest } = site;
    return rest;
  }

  /**
   * Apunta una conexión más. No toca `sites`: su `updated_at` decide quién gana
   * en la sincronización y conectarse no es un cambio que deba viajar.
   */
  recordUse(id: string): void {
    this.db
      .prepare(
        `INSERT INTO site_usage (site_id, uses, last_used_at) VALUES (?, 1, ?)
         ON CONFLICT(site_id) DO UPDATE SET uses = uses + 1, last_used_at = excluded.last_used_at`,
      )
      .run(id, this.now());
  }

  /** Secretos descifrados; null si el sitio no tiene o el almacén está bloqueado. */
  secretsToSync(id: string): object | null {
    try {
      const site = this.get(id);
      const password = site.hasPassword ? this.getSecret(id, 'password') : null;
      const passphrase = site.hasPassphrase ? this.getSecret(id, 'passphrase') : null;
      if (password === null && passphrase === null) return null;
      return { id, password, passphrase, updatedAt: this.secretsUpdatedAt(id) ?? site.updatedAt };
    } catch {
      // Vault bloqueado o sitio recién borrado: ya se enviará al desbloquear.
      return null;
    }
  }

  secretsUpdatedAt(id: string): number | null {
    const row = this.db.prepare('SELECT MAX(updated_at) AS at FROM site_secrets WHERE site_id = ?').get(id) as { at: number | null } | undefined;
    return row?.at ?? null;
  }

  syncUpdatedAt(id: string): number | null {
    const row = this.db.prepare('SELECT updated_at FROM sites WHERE id = ?').get(id) as { updated_at: number } | undefined;
    return row?.updated_at ?? null;
  }

  /** Aplica un sitio recibido de otro dispositivo. No vuelve a emitirlo. */
  syncUpsert(site: SyncedSite): void {
    this.db
      .prepare(
        `INSERT INTO sites (id, name, protocol, host, port, username, auth, key_path, initial_remote_path,
           initial_local_path, max_connections, notes, project_id, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, protocol = excluded.protocol, host = excluded.host, port = excluded.port,
           username = excluded.username, auth = excluded.auth, key_path = excluded.key_path,
           initial_remote_path = excluded.initial_remote_path, initial_local_path = excluded.initial_local_path,
           max_connections = excluded.max_connections, notes = excluded.notes, project_id = excluded.project_id,
           position = excluded.position, updated_at = excluded.updated_at`,
      )
      .run(
        site.id,
        site.name,
        site.protocol,
        site.host,
        site.port,
        site.username,
        site.auth,
        site.keyPath,
        site.initialRemotePath,
        site.initialLocalPath,
        site.maxConnections,
        site.notes,
        site.projectId,
        site.position,
        site.updatedAt,
        site.updatedAt,
      );
  }

  /** Guarda los secretos que llegan de otro dispositivo, cifrándolos aquí. */
  syncUpsertSecrets(siteId: string, password: string | null, passphrase: string | null, updatedAt: number): void {
    for (const [kind, value] of [
      ['password', password],
      ['passphrase', passphrase],
    ] as const) {
      if (value === null) {
        this.db.prepare('DELETE FROM site_secrets WHERE site_id = ? AND kind = ?').run(siteId, kind);
        continue;
      }
      this.db
        .prepare(
          `INSERT INTO site_secrets (site_id, kind, ciphertext, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(site_id, kind) DO UPDATE SET ciphertext = excluded.ciphertext, updated_at = excluded.updated_at`,
        )
        .run(siteId, kind, this.secrets.encrypt(value), updatedAt);
    }
  }

  syncDelete(id: string): void {
    this.db.prepare('DELETE FROM sites WHERE id = ?').run(id);
  }

  /** Anuncia el sitio y, si los hay, sus secretos. */
  private publish(site: Site): void {
    emitEntity('ftp.site', site.id, this.toSync(site), site.updatedAt);
    const secrets = this.secretsToSync(site.id);
    if (secrets) emitEntity('ftp.site_secret', site.id, secrets, this.secretsUpdatedAt(site.id) ?? site.updatedAt);
    else if (!site.hasPassword && !site.hasPassphrase) emitEntityDeleted('ftp.site_secret', site.id, site.updatedAt);
  }
}

/** Sitio tal como llega por sincronización. */
export interface SyncedSite {
  id: string;
  name: string;
  protocol: Site['protocol'];
  host: string;
  port: number;
  username: string;
  auth: Site['auth'];
  keyPath: string | null;
  initialRemotePath: string | null;
  initialLocalPath: string | null;
  maxConnections: number;
  notes: string;
  projectId: string | null;
  position: string;
  updatedAt: number;
}

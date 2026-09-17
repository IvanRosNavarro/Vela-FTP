import type { DatabaseSync } from 'node:sqlite';
import { emitEntity, emitEntityDeleted } from '../../sync/emit';

export interface KnownHost {
  host: string;
  port: number;
  fingerprint: string;
  keyType: string | null;
  addedAt: number;
  updatedAt: number;
}

/** Id de la huella para la sincronización. */
export function knownHostId(host: string, port: number, fingerprint: string): string {
  return `${host.toLowerCase()}|${port}|${fingerprint}`;
}

/** `SHA256:…` = clave de host SSH; `tls:…` = certificado. Se sustituyen por separado. */
function kindPrefix(fingerprint: string): string {
  return fingerprint.startsWith('tls:') ? 'tls:' : 'SHA256:';
}

export class KnownHostsRepository {
  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => number = Date.now,
  ) {}

  fingerprintsFor(host: string, port: number): string[] {
    return (
      this.db.prepare('SELECT fingerprint FROM known_hosts WHERE host = ? AND port = ? ORDER BY added_at').all(host.toLowerCase(), port) as Array<{
        fingerprint: string;
      }>
    ).map((r) => r.fingerprint);
  }

  list(): KnownHost[] {
    return (
      this.db.prepare('SELECT host, port, fingerprint, key_type, added_at, updated_at FROM known_hosts ORDER BY host, port').all() as Array<{
        host: string;
        port: number;
        fingerprint: string;
        key_type: string | null;
        added_at: number;
        updated_at: number;
      }>
    ).map((r) => ({ host: r.host, port: r.port, fingerprint: r.fingerprint, keyType: r.key_type, addedAt: r.added_at, updatedAt: r.updated_at }));
  }

  /**
   * Confía en una huella. Con `replace`, borra antes las del mismo tipo para ese
   * host (la clave cambió y el usuario lo ha aceptado).
   */
  trust(host: string, port: number, fingerprint: string, keyType: string | null, replace: boolean): void {
    const h = host.toLowerCase();
    const now = this.now();
    if (replace) {
      const replaced = this.db
        .prepare('SELECT host, port, fingerprint FROM known_hosts WHERE host = ? AND port = ? AND fingerprint LIKE ?')
        .all(h, port, `${kindPrefix(fingerprint)}%`) as Array<{ host: string; port: number; fingerprint: string }>;
      this.db
        .prepare('DELETE FROM known_hosts WHERE host = ? AND port = ? AND fingerprint LIKE ?')
        .run(h, port, `${kindPrefix(fingerprint)}%`);
      for (const old of replaced) emitEntityDeleted('ftp.known_host', knownHostId(old.host, old.port, old.fingerprint), now);
    }
    this.db
      .prepare(
        `INSERT INTO known_hosts (host, port, fingerprint, key_type, added_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(host, port, fingerprint) DO NOTHING`,
      )
      .run(h, port, fingerprint, keyType, now, now);
    emitEntity('ftp.known_host', knownHostId(h, port, fingerprint), { host: h, port, fingerprint, keyType, updatedAt: now }, now);
  }

  remove(host: string, port: number, fingerprint: string): void {
    this.db.prepare('DELETE FROM known_hosts WHERE host = ? AND port = ? AND fingerprint = ?').run(host.toLowerCase(), port, fingerprint);
    emitEntityDeleted('ftp.known_host', knownHostId(host, port, fingerprint));
  }

  // ── Sincronización ─────────────────────────────────────────────────────────

  syncUpdatedAt(id: string): number | null {
    const [host, port, fingerprint] = splitId(id);
    if (!fingerprint) return null;
    const row = this.db
      .prepare('SELECT updated_at FROM known_hosts WHERE host = ? AND port = ? AND fingerprint = ?')
      .get(host, port, fingerprint) as { updated_at: number } | undefined;
    return row?.updated_at ?? null;
  }

  syncUpsert(entry: { host: string; port: number; fingerprint: string; keyType: string | null; updatedAt: number }): void {
    this.db
      .prepare(
        `INSERT INTO known_hosts (host, port, fingerprint, key_type, added_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(host, port, fingerprint) DO UPDATE SET key_type = excluded.key_type, updated_at = excluded.updated_at`,
      )
      .run(entry.host.toLowerCase(), entry.port, entry.fingerprint, entry.keyType, entry.updatedAt, entry.updatedAt);
  }

  syncDelete(id: string): void {
    const [host, port, fingerprint] = splitId(id);
    if (!fingerprint) return;
    this.db.prepare('DELETE FROM known_hosts WHERE host = ? AND port = ? AND fingerprint = ?').run(host, port, fingerprint);
  }
}

/** `host|puerto|huella`; la huella puede llevar `|`, así que solo se parten dos. */
function splitId(id: string): [string, number, string | null] {
  const first = id.indexOf('|');
  const second = id.indexOf('|', first + 1);
  if (first < 0 || second < 0) return ['', 0, null];
  return [id.slice(0, first), Number(id.slice(first + 1, second)), id.slice(second + 1)];
}

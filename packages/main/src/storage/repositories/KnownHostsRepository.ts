import type { DatabaseSync } from 'node:sqlite';

export interface KnownHost {
  host: string;
  port: number;
  fingerprint: string;
  keyType: string | null;
  addedAt: number;
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
      this.db.prepare('SELECT host, port, fingerprint, key_type, added_at FROM known_hosts ORDER BY host, port').all() as Array<{
        host: string;
        port: number;
        fingerprint: string;
        key_type: string | null;
        added_at: number;
      }>
    ).map((r) => ({ host: r.host, port: r.port, fingerprint: r.fingerprint, keyType: r.key_type, addedAt: r.added_at }));
  }

  /**
   * Confía en una huella. Con `replace`, borra antes las del mismo tipo para ese
   * host (la clave cambió y el usuario lo ha aceptado).
   */
  trust(host: string, port: number, fingerprint: string, keyType: string | null, replace: boolean): void {
    const h = host.toLowerCase();
    if (replace) {
      this.db
        .prepare('DELETE FROM known_hosts WHERE host = ? AND port = ? AND fingerprint LIKE ?')
        .run(h, port, `${kindPrefix(fingerprint)}%`);
    }
    this.db
      .prepare(
        `INSERT INTO known_hosts (host, port, fingerprint, key_type, added_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(host, port, fingerprint) DO NOTHING`,
      )
      .run(h, port, fingerprint, keyType, this.now());
  }

  remove(host: string, port: number, fingerprint: string): void {
    this.db.prepare('DELETE FROM known_hosts WHERE host = ? AND port = ? AND fingerprint = ?').run(host.toLowerCase(), port, fingerprint);
  }
}

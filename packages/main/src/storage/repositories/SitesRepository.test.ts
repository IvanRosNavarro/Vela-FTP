import { describe, expect, it } from 'vitest';
import type { SiteInput } from '@vela-ftp/shared';
import { siteInputSchema } from '@vela-ftp/shared';
import { SecretStore } from '../../security/SecretStore';
import { createTestDb } from '../../test/createTestDb';
import { KnownHostsRepository } from './KnownHostsRepository';
import { SitesRepository } from './SitesRepository';

function setup() {
  const db = createTestDb();
  const mask = (b: Buffer) => Buffer.from(b.map((x) => x ^ 0x33));
  const secrets = new SecretStore(db, { isAvailable: () => true, encrypt: mask, decrypt: mask });
  secrets.initialize();
  return { db, repo: new SitesRepository(db, secrets), known: new KnownHostsRepository(db) };
}

const base: SiteInput = {
  name: 'Producción',
  protocol: 'sftp',
  host: 'example.com',
  port: 22,
  username: 'deploy',
  auth: 'password',
  keyPath: null,
  initialRemotePath: '/var/www',
  initialLocalPath: null,
  maxConnections: 2,
  notes: '',
  password: 'hunter2',
};

describe('SitesRepository', () => {
  it('crea, lista en orden, actualiza y borra', () => {
    const { repo } = setup();
    const a = repo.create(base);
    const b = repo.create({ ...base, name: 'Staging' });
    expect(repo.list().map((s) => s.name)).toEqual(['Producción', 'Staging']);
    expect(a).toMatchObject({ hasPassword: true, hasPassphrase: false, initialRemotePath: '/var/www' });

    const updated = repo.update(b.id, { ...base, name: 'Staging 2', password: undefined });
    expect(updated.name).toBe('Staging 2');
    expect(repo.getSecret(b.id, 'password')).toBe('hunter2');

    repo.move(b.id, null, a.id);
    expect(repo.list().map((s) => s.name)).toEqual(['Staging 2', 'Producción']);

    repo.delete(a.id);
    expect(repo.list()).toHaveLength(1);
    expect(() => repo.get(a.id)).toThrow();
  });

  it('guarda los secretos cifrados y permite quitarlos', () => {
    const { db, repo } = setup();
    const site = repo.create(base);
    const raw = db.prepare("SELECT ciphertext FROM site_secrets WHERE kind = 'password'").get() as { ciphertext: Uint8Array };
    expect(Buffer.from(raw.ciphertext).toString('utf8')).not.toContain('hunter2');
    expect(repo.getSecret(site.id, 'password')).toBe('hunter2');

    repo.update(site.id, { ...base, password: null });
    expect(repo.get(site.id).hasPassword).toBe(false);
    expect(repo.getSecret(site.id, 'password')).toBeNull();
  });

  it('duplica con sus secretos y borra en cascada', () => {
    const { db, repo } = setup();
    const site = repo.create({ ...base, auth: 'key', keyPath: 'C:/keys/id_ed25519', passphrase: 'frase' });
    const copy = repo.duplicate(site.id);
    expect(copy.name).toBe('Producción (copia)');
    expect(repo.getSecret(copy.id, 'passphrase')).toBe('frase');
    repo.delete(copy.id);
    expect(db.prepare('SELECT COUNT(*) AS n FROM site_secrets WHERE site_id = ?').get(copy.id)).toEqual({ n: 0 });
  });
});

describe('siteInputSchema', () => {
  it('valida combinaciones de protocolo y autenticación', () => {
    expect(siteInputSchema.safeParse(base).success).toBe(true);
    expect(siteInputSchema.safeParse({ ...base, protocol: 'ftp', auth: 'key', keyPath: 'x' }).success).toBe(false);
    expect(siteInputSchema.safeParse({ ...base, auth: 'key', keyPath: null }).success).toBe(false);
    expect(siteInputSchema.safeParse({ ...base, host: 'ftp://x.com' }).success).toBe(false);
    expect(siteInputSchema.safeParse({ ...base, initialRemotePath: 'relativa' }).success).toBe(false);
  });
});

describe('KnownHostsRepository', () => {
  it('confía, lista por host y sustituye por tipo', () => {
    const { known } = setup();
    known.trust('Example.com', 22, 'SHA256:aaa', 'ssh-ed25519', false);
    known.trust('example.com', 22, 'tls:BB', null, false);
    expect(known.fingerprintsFor('example.com', 22)).toEqual(['SHA256:aaa', 'tls:BB']);

    known.trust('example.com', 22, 'SHA256:nueva', 'ssh-ed25519', true);
    expect(known.fingerprintsFor('EXAMPLE.COM', 22).sort()).toEqual(['SHA256:nueva', 'tls:BB']);
    expect(known.fingerprintsFor('example.com', 2222)).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import type { JobSnapshot } from '@vela-ftp/shared';
import { SecretStore } from '../../security/SecretStore';
import { createTestDb } from '../../test/createTestDb';
import { SitesRepository } from './SitesRepository';
import { TransferJobsRepository, siteIdOfRestored } from './TransferJobsRepository';

function setup() {
  const db = createTestDb();
  const mask = (b: Buffer) => b;
  const secrets = new SecretStore(db, { isAvailable: () => true, encrypt: mask, decrypt: mask });
  secrets.initialize();
  const sites = new SitesRepository(db, secrets);
  const site = sites.create({
    name: 's',
    protocol: 'sftp',
    host: 'h',
    port: 22,
    username: 'u',
    auth: 'agent',
    keyPath: null,
    initialRemotePath: null,
    initialLocalPath: null,
    maxConnections: 2,
    notes: '',
  });
  return { db, sites, site, repo: new TransferJobsRepository(db, () => 5000) };
}

const job = (id: string, status: JobSnapshot['status']): JobSnapshot => ({
  id,
  sessionId: 'sesion-viva',
  direction: 'download',
  localPath: `C:\\d\\${id}`,
  remotePath: `/r/${id}`,
  isDirectory: false,
  conflictPolicy: 'ask',
  parentId: 'padre',
  status,
  size: 100,
  transferred: 40,
  speed: 1234,
  attempts: 2,
  error: status === 'failed' ? { code: 'TIMEOUT', message: 'lento' } : null,
  startedAt: 1000,
  finishedAt: null,
});

describe('TransferJobsRepository', () => {
  it('guarda, actualiza y recupera como interrumpido', () => {
    const { repo, site } = setup();
    repo.save([
      { job: job('a', 'running'), siteId: site.id },
      { job: job('b', 'failed'), siteId: site.id },
    ]);
    repo.save([{ job: { ...job('a', 'running'), transferred: 90 }, siteId: site.id }]);
    const loaded = repo.loadInterrupted();
    expect(loaded.map((j) => [j.id, j.status, j.transferred, j.speed, j.parentId])).toEqual([
      ['a', 'interrupted', 90, 0, null],
      ['b', 'interrupted', 40, 0, null],
    ]);
    expect(loaded[1]?.error).toEqual({ code: 'TIMEOUT', message: 'lento' });
    expect(siteIdOfRestored(loaded[0]!.sessionId)).toBe(site.id);
    repo.delete(['a']);
    expect(repo.loadInterrupted().map((j) => j.id)).toEqual(['b']);
  });

  it('borrar el sitio borra sus trabajos', () => {
    const { repo, sites, site } = setup();
    repo.save([{ job: job('a', 'queued'), siteId: site.id }]);
    sites.delete(site.id);
    expect(repo.loadInterrupted()).toEqual([]);
  });
});

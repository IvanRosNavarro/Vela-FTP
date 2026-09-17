import { describe, expect, it } from 'vitest';
import type { SiteInput } from '@vela-ftp/shared';
import { SecretStore } from '../../security/SecretStore';
import { createTestDb } from '../../test/createTestDb';
import { BookmarksRepository, PathHistoryRepository, ProjectsRepository } from './ProjectsRepository';
import { SitesRepository } from './SitesRepository';

function setup() {
  const db = createTestDb();
  const identity = (b: Buffer) => b;
  const secrets = new SecretStore(db, { isAvailable: () => true, encrypt: identity, decrypt: identity });
  secrets.initialize();
  let now = 1000;
  const clock = () => ++now;
  return {
    db,
    sites: new SitesRepository(db, secrets, clock),
    projects: new ProjectsRepository(db, clock),
    bookmarks: new BookmarksRepository(db, clock),
    history: new PathHistoryRepository(db, clock),
  };
}

const site = (name: string, projectId: string | null = null): SiteInput => ({
  name,
  protocol: 'sftp',
  host: `${name}.example.com`,
  port: 22,
  username: 'u',
  auth: 'agent',
  keyPath: null,
  initialRemotePath: null,
  initialLocalPath: null,
  maxConnections: 2,
  notes: '',
  projectId,
});

describe('proyectos', () => {
  it('crea, renombra, pliega, reordena y borra dejando los sitios sueltos', () => {
    const { projects, sites } = setup();
    const web = projects.create({ name: 'Web', color: '#46b5a0' });
    const tienda = projects.create({ name: 'Tienda', color: null });
    expect(projects.list().map((p) => p.name)).toEqual(['Web', 'Tienda']);

    expect(projects.update(web.id, { name: 'Web corporativa', collapsed: true })).toMatchObject({ name: 'Web corporativa', collapsed: true, color: '#46b5a0' });
    projects.move(tienda.id, null, web.id);
    expect(projects.list().map((p) => p.name)).toEqual(['Tienda', 'Web corporativa']);

    const s = sites.create(site('prod', web.id));
    projects.delete(web.id);
    expect(sites.get(s.id).projectId).toBeNull();
  });

  it('mueve sitios entre proyectos manteniendo el orden de cada grupo', () => {
    const { projects, sites } = setup();
    const p = projects.create({ name: 'P', color: null });
    const a = sites.create(site('a', p.id));
    const b = sites.create(site('b', p.id));
    const suelto = sites.create(site('suelto'));
    expect(sites.update(a.id, { ...site('a'), projectId: undefined }).projectId).toBe(p.id);

    sites.relocate(suelto.id, p.id, null, a.id);
    const inProject = sites.list().filter((s) => s.projectId === p.id).map((s) => s.name);
    expect(inProject).toEqual(['suelto', 'a', 'b']);

    sites.relocate(b.id, null, null, null);
    expect(sites.get(b.id).projectId).toBeNull();
    expect(sites.duplicate(a.id).projectId).toBe(p.id);
  });
});

describe('marcadores e historial', () => {
  it('guarda marcadores por sitio y se borran con el sitio', () => {
    const { sites, bookmarks } = setup();
    const s = sites.create(site('web'));
    const bm = bookmarks.create({ siteId: s.id, name: 'Logs', remotePath: '/var/log', localPath: 'C:\\logs' });
    expect(bookmarks.update(bm.id, { name: 'Registros', localPath: null })).toMatchObject({ name: 'Registros', localPath: null, remotePath: '/var/log' });
    sites.delete(s.id);
    expect(bookmarks.list()).toEqual([]);
  });

  it('el historial ordena por visita más reciente y no duplica', () => {
    const { sites, history } = setup();
    const s = sites.create(site('web'));
    history.record(s.id, '/a');
    history.record(s.id, '/b');
    history.record(s.id, '/a');
    expect(history.list(s.id, 10).map((v) => v.path)).toEqual(['/a', '/b']);
    for (let i = 0; i < 210; i++) history.record(s.id, `/d${i}`);
    expect(history.list(s.id, 500)).toHaveLength(200);
  });
});

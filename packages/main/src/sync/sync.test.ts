import { describe, expect, it } from 'vitest';
import { SYNC_CATEGORIES, SYNC_TYPE_TO_CATEGORY, type SiteInput } from '@vela-ftp/shared';
import { SecretStore } from '../security/SecretStore';
import { createTestDb } from '../test/createTestDb';
import { BookmarksRepository, ProjectsRepository } from '../storage/repositories/ProjectsRepository';
import { KnownHostsRepository, knownHostId } from '../storage/repositories/KnownHostsRepository';
import { SettingsRepository } from '../storage/repositories/SettingsRepository';
import { SitesRepository } from '../storage/repositories/SitesRepository';
import { sessionTokenFromArgv, sessionTokenFromUrl } from './deepLink';
import { applyRemoteEntity, localEntities, type SyncRepositories } from './serializers';
import { syncEvents, type SyncEntityEvent } from './syncEvents';

function setup() {
  const db = createTestDb();
  const identity = (b: Buffer) => b;
  const secrets = new SecretStore(db, { isAvailable: () => true, encrypt: identity, decrypt: identity });
  secrets.initialize();
  let now = 1000;
  const clock = () => ++now;
  const repos: SyncRepositories = {
    sites: new SitesRepository(db, secrets, clock),
    projects: new ProjectsRepository(db, clock),
    bookmarks: new BookmarksRepository(db, clock),
    knownHosts: new KnownHostsRepository(db, clock),
    settings: new SettingsRepository(db, clock),
  };
  return { db, repos, at: () => now };
}

const site = (name: string, extra: Partial<SiteInput> = {}): SiteInput => ({
  name,
  protocol: 'sftp',
  host: `${name}.example.com`,
  port: 22,
  username: 'u',
  auth: 'password',
  keyPath: null,
  initialRemotePath: null,
  initialLocalPath: null,
  maxConnections: 2,
  notes: '',
  projectId: null,
  ...extra,
});

/** Recoge lo que los repositorios anuncian mientras corre `fn`. */
function captureEvents(fn: () => void): SyncEntityEvent[] {
  const events: SyncEntityEvent[] = [];
  const off = syncEvents.onChange((event) => events.push(event));
  try {
    fn();
  } finally {
    off();
  }
  return events;
}

describe('categorías', () => {
  it('todo tipo sincronizable tiene categoría y toda categoría tiene interruptor', () => {
    const categories = new Set(SYNC_CATEGORIES.map((c) => c.id));
    for (const [type, category] of Object.entries(SYNC_TYPE_TO_CATEGORY)) {
      expect(categories.has(category), `${type} apunta a una categoría que no existe`).toBe(true);
    }
    for (const category of categories) {
      expect(Object.values(SYNC_TYPE_TO_CATEGORY), `nadie usa la categoría ${category}`).toContain(category);
    }
  });
});

describe('enlace de vinculación', () => {
  it('saca el token de la URL y rechaza lo demás', () => {
    expect(sessionTokenFromUrl('vela-ftp://sync-callback?token=abc123')).toBe('abc123');
    expect(sessionTokenFromUrl('vela-ftp://otra-cosa?token=abc')).toBeNull();
    expect(sessionTokenFromUrl('vela://sync-callback?token=abc')).toBeNull();
    expect(sessionTokenFromUrl('https://sync.vela-browser.com/?token=abc')).toBeNull();
    expect(sessionTokenFromUrl('no es una url')).toBeNull();
    expect(sessionTokenFromUrl(`vela-ftp://sync-callback?token=${'x'.repeat(600)}`)).toBeNull();
  });

  it('lo encuentra entre los argumentos de la línea de comandos', () => {
    expect(sessionTokenFromArgv(['electron.exe', '.', 'vela-ftp://sync-callback?token=t0k'])).toBe('t0k');
    expect(sessionTokenFromArgv(['electron.exe', '.'])).toBeNull();
  });
});

describe('cambios locales', () => {
  it('anuncia sitios, secretos, proyectos, marcadores y huellas', () => {
    const { repos } = setup();
    const events = captureEvents(() => {
      const project = repos.projects.create({ name: 'Clientes', color: null });
      const created = repos.sites.create(site('uno', { projectId: project.id, password: 's3cret' }));
      repos.bookmarks.create({ siteId: created.id, name: 'web', remotePath: '/var/www', localPath: null });
      repos.knownHosts.trust('Host.Example.com', 22, 'SHA256:abc', 'ssh-ed25519', false);
      repos.settings.set('ui:theme', 'vela-dark');
    });

    const types = events.map((e) => e.type);
    expect(types).toContain('ftp.project');
    expect(types).toContain('ftp.site');
    expect(types).toContain('ftp.site_secret');
    expect(types).toContain('ftp.bookmark');
    expect(types).toContain('ftp.known_host');
    expect(types).toContain('ftp.setting');

    // La contraseña viaja en su propia entidad, nunca dentro del sitio.
    const siteEvent = events.find((e) => e.type === 'ftp.site')!;
    expect(JSON.stringify(siteEvent.data)).not.toContain('s3cret');
    expect(JSON.stringify(events.find((e) => e.type === 'ftp.site_secret')!.data)).toContain('s3cret');
  });

  it('borrar anuncia el borrado del sitio y de sus secretos', () => {
    const { repos } = setup();
    const created = repos.sites.create(site('dos', { password: 'p' }));
    const events = captureEvents(() => repos.sites.delete(created.id));
    expect(events.filter((e) => e.data === null).map((e) => e.type)).toEqual(['ftp.site', 'ftp.site_secret']);
  });

  it('los ajustes de este equipo no viajan', () => {
    const { repos } = setup();
    const events = captureEvents(() => {
      repos.settings.set('local:last-path', 'C:\\tmp');
      repos.settings.set('ui:sidebar-width', 300);
    });
    expect(events).toHaveLength(0);
    expect(repos.settings.syncableKeys()).not.toContain('local:last-path');
  });
});

describe('cambios remotos', () => {
  it('aplica lo que llega y respeta lo más reciente', () => {
    const { repos } = setup();
    const created = repos.sites.create(site('web'));
    const local = repos.sites.get(created.id);

    const older = { ...repos.sites.toSync(local), name: 'viejo', updatedAt: local.updatedAt - 1 } as Record<string, unknown>;
    expect(applyRemoteEntity(repos, 'ftp.site', created.id, older, local.updatedAt - 1)).toBe(false);
    expect(repos.sites.get(created.id).name).toBe('web');

    const newer = { ...repos.sites.toSync(local), name: 'nuevo', updatedAt: local.updatedAt + 10 } as Record<string, unknown>;
    expect(applyRemoteEntity(repos, 'ftp.site', created.id, newer, local.updatedAt + 10)).toBe(true);
    expect(repos.sites.get(created.id).name).toBe('nuevo');
  });

  it('guarda los secretos cifrados y borra lo que se borró en el otro lado', () => {
    const { repos } = setup();
    const created = repos.sites.create(site('con-clave'));
    expect(applyRemoteEntity(repos, 'ftp.site_secret', created.id, { id: created.id, password: 'desde-otro', passphrase: null, updatedAt: 9999 }, 9999)).toBe(true);
    expect(repos.sites.getSecret(created.id, 'password')).toBe('desde-otro');

    expect(applyRemoteEntity(repos, 'ftp.site', created.id, null, 100000)).toBe(true);
    expect(repos.sites.list()).toHaveLength(0);
  });

  it('descarta lo que no tiene la forma esperada', () => {
    const { repos } = setup();
    expect(applyRemoteEntity(repos, 'ftp.site', 'x', { id: 'x', name: 'roto' }, 5000)).toBe(false);
    expect(applyRemoteEntity(repos, 'ftp.setting', 'ui:theme', { key: 'ui:theme', value: 42, updatedAt: 5000 }, 5000)).toBe(false);
    expect(applyRemoteEntity(repos, 'ftp.desconocido', 'x', { a: 1 }, 5000)).toBe(false);
    expect(repos.sites.list()).toHaveLength(0);
  });

  it('un marcador sin su sitio se descarta en vez de romper la base de datos', () => {
    const { repos } = setup();
    const bookmark = { id: 'b1', siteId: 'no-existe', name: 'x', remotePath: '/', localPath: null, position: 'a0', updatedAt: 5000 };
    expect(applyRemoteEntity(repos, 'ftp.bookmark', 'b1', bookmark, 5000)).toBe(false);
    expect(repos.bookmarks.list()).toHaveLength(0);
  });

  it('una huella que llega se puede volver a borrar por su id', () => {
    const { repos } = setup();
    const id = knownHostId('host.example.com', 2222, 'SHA256:xyz');
    expect(applyRemoteEntity(repos, 'ftp.known_host', id, { host: 'host.example.com', port: 2222, fingerprint: 'SHA256:xyz', keyType: null, updatedAt: 7000 }, 7000)).toBe(true);
    expect(repos.knownHosts.fingerprintsFor('host.example.com', 2222)).toEqual(['SHA256:xyz']);
    expect(applyRemoteEntity(repos, 'ftp.known_host', id, null, 8000)).toBe(true);
    expect(repos.knownHosts.fingerprintsFor('host.example.com', 2222)).toEqual([]);
  });
});

describe('estado local completo', () => {
  it('reúne todo lo sincronizable para el primer envío', () => {
    const { repos } = setup();
    const project = repos.projects.create({ name: 'P', color: null });
    const created = repos.sites.create(site('s', { projectId: project.id, password: 'clave' }));
    repos.bookmarks.create({ siteId: created.id, name: 'b', remotePath: '/', localPath: null });
    repos.knownHosts.trust('h', 21, 'tls:abc', null, false);
    repos.settings.set('transfer:conflict-policy', 'overwrite');

    const types = localEntities(repos).map((e) => e.type).sort();
    expect(types).toEqual(['ftp.bookmark', 'ftp.known_host', 'ftp.project', 'ftp.setting', 'ftp.site', 'ftp.site_secret']);
    expect(localEntities(repos).every((e) => e.updatedAt > 0)).toBe(true);
  });
});

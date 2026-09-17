import { z } from 'zod';
import { logger } from 'vela-kit/logger';
import type { BookmarksRepository, ProjectsRepository } from '../storage/repositories/ProjectsRepository';
import type { KnownHostsRepository } from '../storage/repositories/KnownHostsRepository';
import { knownHostId } from '../storage/repositories/KnownHostsRepository';
import type { SettingsRepository } from '../storage/repositories/SettingsRepository';
import type { SitesRepository } from '../storage/repositories/SitesRepository';

export interface SyncRepositories {
  sites: SitesRepository;
  projects: ProjectsRepository;
  bookmarks: BookmarksRepository;
  knownHosts: KnownHostsRepository;
  settings: SettingsRepository;
}

export interface LocalEntity {
  type: string;
  id: string;
  data: object;
  updatedAt: number;
}

// Lo que llega del otro dispositivo está cifrado de extremo a extremo, pero se
// valida igual antes de tocar la base de datos: un campo con el tipo equivocado
// rompería consultas o acabaría en una conexión.
const timestamp = z.number().int().min(0);

const syncedProject = z.object({
  id: z.string().min(1).max(128),
  name: z.string().max(200),
  color: z.string().max(40).nullable(),
  position: z.string().min(1).max(200),
  collapsed: z.boolean(),
  updatedAt: timestamp,
});

const syncedSite = z.object({
  id: z.string().min(1).max(128),
  name: z.string().max(200),
  protocol: z.enum(['ftp', 'ftps', 'ftps-implicit', 'sftp']),
  host: z.string().max(255),
  port: z.number().int().min(1).max(65535),
  username: z.string().max(255),
  auth: z.enum(['password', 'key', 'agent', 'anonymous']),
  keyPath: z.string().max(4096).nullable(),
  initialRemotePath: z.string().max(4096).nullable(),
  initialLocalPath: z.string().max(4096).nullable(),
  maxConnections: z.number().int().min(1).max(10),
  notes: z.string().max(10_000),
  projectId: z.string().max(128).nullable(),
  position: z.string().min(1).max(200),
  updatedAt: timestamp,
});

const syncedSecrets = z.object({
  id: z.string().min(1).max(128),
  password: z.string().max(4096).nullable(),
  passphrase: z.string().max(4096).nullable(),
  updatedAt: timestamp,
});

const syncedBookmark = z.object({
  id: z.string().min(1).max(128),
  siteId: z.string().min(1).max(128),
  name: z.string().max(200),
  remotePath: z.string().max(4096),
  localPath: z.string().max(4096).nullable(),
  position: z.string().min(1).max(200),
  updatedAt: timestamp,
});

const syncedKnownHost = z.object({
  host: z.string().max(255),
  port: z.number().int().min(1).max(65535),
  fingerprint: z.string().max(200),
  keyType: z.string().max(60).nullable(),
  updatedAt: timestamp,
});

const syncedSetting = z.object({
  key: z.string().max(100),
  value: z.unknown(),
  updatedAt: timestamp,
});

/** Todo lo sincronizable que ya existe aquí, para el primer envío. */
export function localEntities(repos: SyncRepositories): LocalEntity[] {
  const entities: LocalEntity[] = [];

  for (const project of repos.projects.list()) {
    entities.push({ type: 'ftp.project', id: project.id, data: project, updatedAt: project.updatedAt });
  }
  for (const site of repos.sites.list()) {
    entities.push({ type: 'ftp.site', id: site.id, data: repos.sites.toSync(site), updatedAt: site.updatedAt });
    const secrets = repos.sites.secretsToSync(site.id);
    if (secrets) entities.push({ type: 'ftp.site_secret', id: site.id, data: secrets, updatedAt: repos.sites.secretsUpdatedAt(site.id) ?? site.updatedAt });
  }
  for (const bookmark of repos.bookmarks.list()) {
    entities.push({ type: 'ftp.bookmark', id: bookmark.id, data: bookmark, updatedAt: bookmark.updatedAt });
  }
  for (const host of repos.knownHosts.list()) {
    entities.push({
      type: 'ftp.known_host',
      id: knownHostId(host.host, host.port, host.fingerprint),
      data: { host: host.host, port: host.port, fingerprint: host.fingerprint, keyType: host.keyType, updatedAt: host.updatedAt || host.addedAt },
      updatedAt: host.updatedAt || host.addedAt,
    });
  }
  for (const key of repos.settings.syncableKeys()) {
    const updatedAt = repos.settings.syncUpdatedAt(key) ?? Date.now();
    entities.push({ type: 'ftp.setting', id: key, data: { key, value: repos.settings.get(key), updatedAt }, updatedAt });
  }

  return entities;
}

/** Fecha del que tenemos aquí, para el last-write-wins. */
function localUpdatedAt(repos: SyncRepositories, type: string, id: string): number | null {
  switch (type) {
    case 'ftp.project':
      return repos.projects.syncUpdatedAt(id);
    case 'ftp.site':
      return repos.sites.syncUpdatedAt(id);
    case 'ftp.site_secret':
      return repos.sites.secretsUpdatedAt(id);
    case 'ftp.bookmark':
      return repos.bookmarks.syncUpdatedAt(id);
    case 'ftp.known_host':
      return repos.knownHosts.syncUpdatedAt(id);
    case 'ftp.setting':
      return repos.settings.syncUpdatedAt(id);
    default:
      return null;
  }
}

/**
 * Aplica una entidad que llega del servidor. Devuelve true si cambió algo aquí.
 * Gana la más reciente; en empate se queda lo local.
 */
export function applyRemoteEntity(
  repos: SyncRepositories,
  type: string,
  id: string,
  data: object | null,
  remoteUpdatedAt: number,
): boolean {
  if (!(type in SUPPORTED)) {
    logger.warn(`[sync] tipo desconocido: ${type}`);
    return false;
  }
  if ((localUpdatedAt(repos, type, id) ?? 0) >= remoteUpdatedAt) return false;

  if (data === null) return applyDelete(repos, type, id);

  switch (type) {
    case 'ftp.project': {
      const parsed = syncedProject.safeParse(data);
      if (!parsed.success) return invalid(type, id);
      repos.projects.syncUpsert({ ...parsed.data, createdAt: parsed.data.updatedAt });
      return true;
    }
    case 'ftp.site': {
      const parsed = syncedSite.safeParse(data);
      if (!parsed.success) return invalid(type, id);
      repos.sites.syncUpsert(parsed.data);
      return true;
    }
    case 'ftp.site_secret': {
      const parsed = syncedSecrets.safeParse(data);
      if (!parsed.success) return invalid(type, id);
      // Sin el sitio delante, la clave foránea rechazaría los secretos.
      if (repos.sites.syncUpdatedAt(id) === null) return false;
      repos.sites.syncUpsertSecrets(id, parsed.data.password, parsed.data.passphrase, parsed.data.updatedAt);
      return true;
    }
    case 'ftp.bookmark': {
      const parsed = syncedBookmark.safeParse(data);
      if (!parsed.success) return invalid(type, id);
      return repos.bookmarks.syncUpsert({ ...parsed.data, createdAt: parsed.data.updatedAt });
    }
    case 'ftp.known_host': {
      const parsed = syncedKnownHost.safeParse(data);
      if (!parsed.success) return invalid(type, id);
      repos.knownHosts.syncUpsert(parsed.data);
      return true;
    }
    case 'ftp.setting': {
      const parsed = syncedSetting.safeParse(data);
      if (!parsed.success) return invalid(type, id);
      return repos.settings.syncUpsert(id, parsed.data.value, parsed.data.updatedAt);
    }
    default:
      return false;
  }
}

function applyDelete(repos: SyncRepositories, type: string, id: string): boolean {
  switch (type) {
    case 'ftp.project':
      repos.projects.syncDelete(id);
      return true;
    case 'ftp.site':
      repos.sites.syncDelete(id);
      return true;
    case 'ftp.site_secret':
      repos.sites.syncUpsertSecrets(id, null, null, Date.now());
      return true;
    case 'ftp.bookmark':
      repos.bookmarks.syncDelete(id);
      return true;
    case 'ftp.known_host':
      repos.knownHosts.syncDelete(id);
      return true;
    // Un ajuste no se borra: se queda el valor de este dispositivo.
    default:
      return false;
  }
}

function invalid(type: string, id: string): false {
  logger.warn(`[sync] ${type}/${id} llegó con un formato que no se reconoce; descartado`);
  return false;
}

const SUPPORTED: Record<string, true> = {
  'ftp.project': true,
  'ftp.site': true,
  'ftp.site_secret': true,
  'ftp.bookmark': true,
  'ftp.known_host': true,
  'ftp.setting': true,
};

import { readFile } from 'node:fs/promises';
import { BrowserWindow } from 'electron';
import {
  IPC_CHANNELS,
  IPC_EVENTS,
  bookmarkIdInputSchema,
  bookmarkInputSchema,
  bookmarkUpdateInputSchema,
  commandExecuteInputSchema,
  filezillaApplyInputSchema,
  filezillaPreviewInputSchema,
  projectIdInputSchema,
  projectInputSchema,
  projectMoveInputSchema,
  projectUpdateInputSchema,
  shortcutSetInputSchema,
  siteHistoryInputSchema,
  siteRelocateInputSchema,
  type CommandCategory,
  type FileZillaPreview,
} from '@vela-ftp/shared';
import type { CommandRegistry } from 'vela-kit/commands';
import { logger } from 'vela-kit/logger';
import { z } from 'zod';
import { suspendedShortcutWindows, type CommandContext, type ShortcutManager } from '../commands';
import { defaultSiteManagerPath, parseSiteManager } from '../import/filezilla';
import type { KnownHostsRepository } from '../storage/repositories/KnownHostsRepository';
import type { BookmarksRepository, PathHistoryRepository, ProjectsRepository } from '../storage/repositories/ProjectsRepository';
import type { SettingsRepository } from '../storage/repositories/SettingsRepository';
import type { SitesRepository } from '../storage/repositories/SitesRepository';
import { broadcast, handle } from './handle';

export interface OrganizeIpcDeps {
  sites: SitesRepository;
  projects: ProjectsRepository;
  bookmarks: BookmarksRepository;
  history: PathHistoryRepository;
  knownHosts: KnownHostsRepository;
  settings: SettingsRepository;
  registry: CommandRegistry<CommandContext, CommandCategory>;
  shortcuts: ShortcutManager;
}

export class InvalidShortcutRequestError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'InvalidShortcutRequestError';
  }
}

export function registerOrganizeHandlers(deps: OrganizeIpcDeps): void {
  const { sites, projects, bookmarks, history, knownHosts, settings, registry, shortcuts } = deps;
  const projectsChanged = () => broadcast(IPC_EVENTS.PROJECTS_CHANGED, null);
  const sitesChanged = () => broadcast(IPC_EVENTS.SITES_CHANGED, null);
  const bookmarksChanged = () => broadcast(IPC_EVENTS.BOOKMARKS_CHANGED, null);

  // ── Proyectos ───────────────────────────────────────────────────────────
  handle(IPC_CHANNELS.PROJECTS_LIST, null, () => projects.list());
  handle(IPC_CHANNELS.PROJECTS_CREATE, projectInputSchema, (input) => {
    const project = projects.create(input);
    projectsChanged();
    return project;
  });
  handle(IPC_CHANNELS.PROJECTS_UPDATE, projectUpdateInputSchema, ({ id, ...patch }) => {
    const project = projects.update(id, patch);
    projectsChanged();
    return project;
  });
  handle(IPC_CHANNELS.PROJECTS_DELETE, projectIdInputSchema, ({ id }) => {
    projects.delete(id);
    projectsChanged();
    sitesChanged();
    return null;
  });
  handle(IPC_CHANNELS.PROJECTS_MOVE, projectMoveInputSchema, ({ id, beforeId, afterId }) => {
    const project = projects.move(id, beforeId, afterId);
    projectsChanged();
    return project;
  });
  handle(IPC_CHANNELS.SITES_RELOCATE, siteRelocateInputSchema, ({ id, projectId, beforeId, afterId }) => {
    if (projectId) projects.get(projectId);
    const site = sites.relocate(id, projectId, beforeId, afterId);
    sitesChanged();
    return site;
  });

  // ── Marcadores e historial ──────────────────────────────────────────────
  handle(IPC_CHANNELS.BOOKMARKS_LIST, null, () => bookmarks.list());
  handle(IPC_CHANNELS.BOOKMARKS_CREATE, bookmarkInputSchema, (input) => {
    sites.get(input.siteId);
    const bookmark = bookmarks.create(input);
    bookmarksChanged();
    return bookmark;
  });
  handle(IPC_CHANNELS.BOOKMARKS_UPDATE, bookmarkUpdateInputSchema, ({ id, ...patch }) => {
    const bookmark = bookmarks.update(id, patch);
    bookmarksChanged();
    return bookmark;
  });
  handle(IPC_CHANNELS.BOOKMARKS_DELETE, bookmarkIdInputSchema, ({ id }) => {
    bookmarks.delete(id);
    bookmarksChanged();
    return null;
  });
  handle(IPC_CHANNELS.HISTORY_LIST, siteHistoryInputSchema, ({ siteId, limit }) => history.list(siteId, limit));

  // ── Huellas guardadas ──────────────────────────────────────────────────
  handle(IPC_CHANNELS.KNOWN_HOSTS_LIST, null, () => knownHosts.list());
  handle(
    IPC_CHANNELS.KNOWN_HOSTS_REMOVE,
    z.object({ host: z.string().min(1).max(255), port: z.number().int().min(1).max(65535), fingerprint: z.string().min(1).max(200) }),
    ({ host, port, fingerprint }) => {
      knownHosts.remove(host, port, fingerprint);
      return null;
    },
  );

  // ── Comandos y atajos ───────────────────────────────────────────────────
  handle(IPC_CHANNELS.COMMANDS_LIST, null, () => shortcuts.list());
  handle(IPC_CHANNELS.COMMANDS_EXECUTE, commandExecuteInputSchema, async ({ id }, event) => {
    const windowId = BrowserWindow.fromWebContents(event.sender)?.id ?? null;
    await registry.execute(id, { windowId });
    return null;
  });
  handle(IPC_CHANNELS.SHORTCUTS_SET, shortcutSetInputSchema, ({ commandId, combo }) => {
    const verdict = shortcuts.validate(commandId, combo);
    if (!verdict.ok) throw new InvalidShortcutRequestError(verdict.reason);
    const custom = { ...settings.get('shortcuts:custom') };
    const command = registry.get(commandId);
    // Volver al atajo por defecto no se guarda como personalizado.
    if (combo !== null && combo === (command?.defaultShortcut ?? null)) delete custom[commandId];
    else custom[commandId] = verdict.combo;
    settings.set('shortcuts:custom', custom);
    shortcuts.rebuild();
    return shortcuts.list();
  });
  handle(IPC_CHANNELS.SHORTCUTS_SUSPEND, z.object({ suspended: z.boolean() }), ({ suspended }, event) => {
    const windowId = BrowserWindow.fromWebContents(event.sender)?.id;
    if (windowId === undefined) return null;
    if (suspended) suspendedShortcutWindows.add(windowId);
    else suspendedShortcutWindows.delete(windowId);
    return null;
  });
  handle(IPC_CHANNELS.SHORTCUTS_RESET, null, () => {
    settings.set('shortcuts:custom', {});
    shortcuts.rebuild();
    return shortcuts.list();
  });

  // ── Importar FileZilla ──────────────────────────────────────────────────
  const readSiteManager = async (path: string) => parseSiteManager(await readFile(path, 'utf8'));

  handle(IPC_CHANNELS.IMPORT_FILEZILLA_PREVIEW, filezillaPreviewInputSchema, async ({ path }): Promise<FileZillaPreview> => {
    const file = path ?? defaultSiteManagerPath();
    const parsed = await readSiteManager(file);
    return { path: file, sites: parsed.servers.map((s) => s.site), skipped: parsed.skipped };
  });

  handle(IPC_CHANNELS.IMPORT_FILEZILLA_APPLY, filezillaApplyInputSchema, async ({ path, keys }) => {
    const parsed = await readSiteManager(path);
    const wanted = new Set(keys);
    const projectIds = new Map(projects.list().map((p) => [p.name, p.id]));
    let created = 0;
    for (const { site, password } of parsed.servers) {
      if (!wanted.has(site.key)) continue;
      let projectId: string | null = null;
      if (site.projectName) {
        projectId = projectIds.get(site.projectName) ?? null;
        if (!projectId) {
          projectId = projects.create({ name: site.projectName, color: null }).id;
          projectIds.set(site.projectName, projectId);
        }
      }
      sites.create({
        name: site.name,
        protocol: site.protocol,
        host: site.host,
        port: site.port,
        username: site.username,
        auth: site.auth,
        keyPath: site.keyPath,
        initialRemotePath: site.remotePath,
        initialLocalPath: site.localPath,
        maxConnections: 2,
        notes: site.notes,
        projectId,
        password: site.auth === 'password' ? password : null,
        passphrase: null,
      });
      created++;
    }
    logger.info(`[import] ${created} sitios importados de FileZilla`);
    projectsChanged();
    sitesChanged();
    return { created };
  });
}

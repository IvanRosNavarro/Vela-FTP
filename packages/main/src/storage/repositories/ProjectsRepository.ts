import type { DatabaseSync } from 'node:sqlite';
import { generateKeyBetween } from 'fractional-indexing';
import { v7 as uuidv7 } from 'uuid';
import type { Bookmark, BookmarkInput, PathVisit, Project, ProjectInput } from '@vela-ftp/shared';
import { NotFoundError } from 'vela-kit/ipc';

interface ProjectRow {
  id: string;
  name: string;
  color: string | null;
  position: string;
  collapsed: number;
  created_at: number;
  updated_at: number;
}

const toProject = (r: ProjectRow): Project => ({
  id: r.id,
  name: r.name,
  color: r.color,
  position: r.position,
  collapsed: r.collapsed === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export class ProjectsRepository {
  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => number = Date.now,
  ) {}

  list(): Project[] {
    return (this.db.prepare('SELECT * FROM projects ORDER BY position COLLATE BINARY').all() as unknown as ProjectRow[]).map(toProject);
  }

  get(id: string): Project {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
    if (!row) throw new NotFoundError('project', id);
    return toProject(row);
  }

  create(input: ProjectInput): Project {
    const id = uuidv7();
    const last = this.db.prepare('SELECT position FROM projects ORDER BY position COLLATE BINARY DESC LIMIT 1').get() as
      | { position: string }
      | undefined;
    const now = this.now();
    this.db
      .prepare('INSERT INTO projects (id, name, color, position, collapsed, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)')
      .run(id, input.name, input.color, generateKeyBetween(last?.position ?? null, null), now, now);
    return this.get(id);
  }

  update(id: string, patch: { name?: string | undefined; color?: string | null | undefined; collapsed?: boolean | undefined }): Project {
    const current = this.get(id);
    this.db
      .prepare('UPDATE projects SET name = ?, color = ?, collapsed = ?, updated_at = ? WHERE id = ?')
      .run(
        patch.name ?? current.name,
        patch.color === undefined ? current.color : patch.color,
        (patch.collapsed ?? current.collapsed) ? 1 : 0,
        this.now(),
        id,
      );
    return this.get(id);
  }

  /** Sus sitios quedan sin proyecto (ON DELETE SET NULL). */
  delete(id: string): void {
    this.get(id);
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }

  move(id: string, beforeId: string | null, afterId: string | null): Project {
    const before = beforeId ? this.get(beforeId).position : null;
    const after = afterId ? this.get(afterId).position : null;
    this.db.prepare('UPDATE projects SET position = ?, updated_at = ? WHERE id = ?').run(generateKeyBetween(before, after), this.now(), id);
    return this.get(id);
  }
}

interface BookmarkRow {
  id: string;
  site_id: string;
  name: string;
  remote_path: string;
  local_path: string | null;
  position: string;
  created_at: number;
  updated_at: number;
}

const toBookmark = (r: BookmarkRow): Bookmark => ({
  id: r.id,
  siteId: r.site_id,
  name: r.name,
  remotePath: r.remote_path,
  localPath: r.local_path,
  position: r.position,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export class BookmarksRepository {
  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => number = Date.now,
  ) {}

  list(): Bookmark[] {
    return (
      this.db.prepare('SELECT * FROM bookmarks ORDER BY site_id, position COLLATE BINARY').all() as unknown as BookmarkRow[]
    ).map(toBookmark);
  }

  get(id: string): Bookmark {
    const row = this.db.prepare('SELECT * FROM bookmarks WHERE id = ?').get(id) as BookmarkRow | undefined;
    if (!row) throw new NotFoundError('bookmark', id);
    return toBookmark(row);
  }

  create(input: BookmarkInput): Bookmark {
    const id = uuidv7();
    const last = this.db
      .prepare('SELECT position FROM bookmarks WHERE site_id = ? ORDER BY position COLLATE BINARY DESC LIMIT 1')
      .get(input.siteId) as { position: string } | undefined;
    const now = this.now();
    this.db
      .prepare(
        'INSERT INTO bookmarks (id, site_id, name, remote_path, local_path, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, input.siteId, input.name, input.remotePath, input.localPath, generateKeyBetween(last?.position ?? null, null), now, now);
    return this.get(id);
  }

  update(id: string, patch: { name?: string | undefined; localPath?: string | null | undefined }): Bookmark {
    const current = this.get(id);
    this.db
      .prepare('UPDATE bookmarks SET name = ?, local_path = ?, updated_at = ? WHERE id = ?')
      .run(patch.name ?? current.name, patch.localPath === undefined ? current.localPath : patch.localPath, this.now(), id);
    return this.get(id);
  }

  delete(id: string): void {
    this.get(id);
    this.db.prepare('DELETE FROM bookmarks WHERE id = ?').run(id);
  }
}

const HISTORY_PER_SITE = 200;

export class PathHistoryRepository {
  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => number = Date.now,
  ) {}

  /** Registra una visita y recorta el historial del sitio a las más recientes. */
  record(siteId: string, path: string): void {
    this.db
      .prepare(
        `INSERT INTO path_history (site_id, path, visited_at) VALUES (?, ?, ?)
         ON CONFLICT(site_id, path) DO UPDATE SET visited_at = excluded.visited_at`,
      )
      .run(siteId, path, this.now());
    this.db
      .prepare(
        `DELETE FROM path_history WHERE site_id = ? AND path NOT IN (
           SELECT path FROM path_history WHERE site_id = ? ORDER BY visited_at DESC LIMIT ?)`,
      )
      .run(siteId, siteId, HISTORY_PER_SITE);
  }

  list(siteId: string, limit: number): PathVisit[] {
    return (
      this.db
        .prepare('SELECT path, visited_at FROM path_history WHERE site_id = ? ORDER BY visited_at DESC LIMIT ?')
        .all(siteId, limit) as Array<{ path: string; visited_at: number }>
    ).map((r) => ({ path: r.path, visitedAt: r.visited_at }));
  }
}

-- 004-projects: proyectos que agrupan sitios, marcadores de carpeta e
-- historial de rutas remotas visitadas.

CREATE TABLE projects (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  color TEXT,
  position TEXT NOT NULL,
  collapsed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Borrar un proyecto no borra sus sitios: quedan sin proyecto.
ALTER TABLE sites ADD COLUMN project_id TEXT REFERENCES projects (id) ON DELETE SET NULL;

CREATE INDEX idx_sites_project ON sites (project_id, position);

CREATE TABLE bookmarks (
  id TEXT PRIMARY KEY NOT NULL,
  site_id TEXT NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  remote_path TEXT NOT NULL,
  -- Carpeta local emparejada: al abrir el marcador, el panel local va ahí.
  local_path TEXT,
  position TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_bookmarks_site ON bookmarks (site_id, position);

CREATE TABLE path_history (
  site_id TEXT NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  visited_at INTEGER NOT NULL,
  PRIMARY KEY (site_id, path)
);

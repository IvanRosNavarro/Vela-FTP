-- 001-init: metadatos de la aplicación y ajustes globales.

CREATE TABLE app_metadata (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

-- value guarda JSON; updated_at en ms epoch (lo necesitará el sync de Fase 4).
CREATE TABLE settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

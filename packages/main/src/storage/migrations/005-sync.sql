-- Sincronización (Fase 4). El estado propio vive en `app_metadata` bajo claves
-- `sync:*`: no pasa por el IPC de ajustes, que el renderer puede escribir.

-- Cambios que no se pudieron enviar (sin red o sin sesión). `data_json` nulo
-- significa borrado.
CREATE TABLE sync_pending (
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  data_json TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (entity_type, entity_id)
);

-- Las huellas aceptadas también viajan, y el last-write-wins necesita fecha.
ALTER TABLE known_hosts ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
UPDATE known_hosts SET updated_at = added_at;

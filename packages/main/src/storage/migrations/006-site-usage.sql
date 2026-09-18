-- Cuántas veces se ha conectado cada sitio desde este equipo, para ofrecer en
-- la conexión rápida los que de verdad se usan.
--
-- Va en su propia tabla y no en `sites`: es uso de esta máquina, no debe viajar
-- por la sincronización ni tocar el `updated_at` del sitio (que decide quién
-- gana en el last-write-wins).
CREATE TABLE site_usage (
  site_id TEXT PRIMARY KEY NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
  uses INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER NOT NULL
);

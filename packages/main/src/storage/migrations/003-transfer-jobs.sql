-- 003-transfer-jobs: trabajos de la cola sin terminar, para recuperarlos al
-- reabrir la app. Los completados, saltados y cancelados no se guardan.

CREATE TABLE transfer_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  site_id TEXT NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('upload', 'download')),
  local_path TEXT NOT NULL,
  remote_path TEXT NOT NULL,
  is_directory INTEGER NOT NULL,
  conflict_policy TEXT NOT NULL,
  status TEXT NOT NULL,
  size INTEGER,
  transferred INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

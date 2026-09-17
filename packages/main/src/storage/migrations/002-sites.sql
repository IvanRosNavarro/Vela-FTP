-- 002-sites: sitios guardados, sus secretos cifrados y huellas de confianza.

CREATE TABLE sites (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  protocol TEXT NOT NULL CHECK (protocol IN ('ftp', 'ftps', 'ftps-implicit', 'sftp')),
  host TEXT NOT NULL,
  port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
  username TEXT NOT NULL DEFAULT '',
  auth TEXT NOT NULL CHECK (auth IN ('password', 'key', 'agent', 'anonymous')),
  key_path TEXT,
  initial_remote_path TEXT,
  initial_local_path TEXT,
  max_connections INTEGER NOT NULL DEFAULT 2 CHECK (max_connections BETWEEN 1 AND 10),
  notes TEXT NOT NULL DEFAULT '',
  position TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_sites_position ON sites (position);

-- Cifrado a nivel aplicación (SecretStore): nunca texto plano en disco.
CREATE TABLE site_secrets (
  site_id TEXT NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('password', 'passphrase')),
  ciphertext BLOB NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (site_id, kind)
);

-- Claves de host SSH (`SHA256:…`) y certificados TLS (`tls:…`) aceptados.
CREATE TABLE known_hosts (
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,
  key_type TEXT,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (host, port, fingerprint)
);

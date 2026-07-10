-- PET-Digital NR-33 v1.1.1
-- Ajusta perfis de login para: admin, gestor, verificador e operacional.
-- Use esta migration se sua tabela app_users ainda foi criada com perfis antigos
-- como supervisor/entrante/vigia.

PRAGMA foreign_keys=off;

CREATE TABLE IF NOT EXISTS app_users_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  matricula TEXT NOT NULL UNIQUE,
  email TEXT UNIQUE,
  role TEXT NOT NULL DEFAULT 'operacional' CHECK (
    role IN ('admin', 'gestor', 'verificador', 'operacional')
  ),
  unit TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'active', 'suspended', 'disabled')
  ),
  password_hash TEXT,
  password_salt TEXT,
  password_alg TEXT DEFAULT 'PBKDF2-SHA256',
  must_change_password INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT,
  last_login_at TEXT
);

INSERT OR IGNORE INTO app_users_new (
  id, name, matricula, email, role, unit, status,
  password_hash, password_salt, password_alg, must_change_password,
  created_at, updated_at, last_login_at
)
SELECT
  id,
  name,
  matricula,
  email,
  CASE
    WHEN role IN ('admin', 'gestor', 'verificador', 'operacional') THEN role
    ELSE 'operacional'
  END,
  unit,
  status,
  password_hash,
  password_salt,
  password_alg,
  must_change_password,
  created_at,
  updated_at,
  last_login_at
FROM app_users;

DROP TABLE app_users;
ALTER TABLE app_users_new RENAME TO app_users;

CREATE INDEX IF NOT EXISTS idx_app_users_matricula
ON app_users(matricula);

PRAGMA foreign_keys=on;

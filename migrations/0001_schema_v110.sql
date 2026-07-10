-- PET-Digital NR-33 v1.1.1
-- Schema completo para Cloudflare D1.
-- Não armazena PDF, JSON, fotos ou assinaturas desenhadas.

CREATE TABLE IF NOT EXISTS app_users (
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

CREATE TABLE IF NOT EXISTS device_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_label TEXT NOT NULL,
  public_key_jwk TEXT NOT NULL,
  public_key_hash TEXT NOT NULL UNIQUE,
  algorithm TEXT NOT NULL DEFAULT 'ECDSA-P256-SHA256',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'active', 'revoked', 'lost')
  ),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  approved_by TEXT,
  approved_at TEXT,
  revoked_by TEXT,
  revoked_at TEXT,
  revoke_reason TEXT,
  last_used_at TEXT,
  FOREIGN KEY (user_id) REFERENCES app_users(id),
  FOREIGN KEY (approved_by) REFERENCES app_users(id),
  FOREIGN KEY (revoked_by) REFERENCES app_users(id)
);

CREATE TABLE IF NOT EXISTS pet_records (
  id TEXT PRIMARY KEY,
  numero_pet TEXT NOT NULL UNIQUE,
  created_by_user_id TEXT NOT NULL,
  signing_key_id TEXT NOT NULL,
  validation_profile TEXT NOT NULL DEFAULT 'PET-DIGITAL-NR33-v1',
  schema_version TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  pdf_hash TEXT,
  json_hash TEXT,
  pdf_proof_hash TEXT,
  pet_signature_b64 TEXT NOT NULL,
  pdf_proof_signature_b64 TEXT,
  client_generated_at TEXT,
  server_received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  client_timezone TEXT,
  ip_address TEXT,
  user_agent TEXT,
  geo_lat REAL,
  geo_lng REAL,
  geo_accuracy_m REAL,
  status TEXT NOT NULL DEFAULT 'accepted' CHECK (
    status IN ('accepted', 'invalid', 'cancelled')
  ),
  notes TEXT,
  FOREIGN KEY (created_by_user_id) REFERENCES app_users(id),
  FOREIGN KEY (signing_key_id) REFERENCES device_keys(id),
  CHECK (length(payload_hash) = 64),
  CHECK (pdf_hash IS NULL OR length(pdf_hash) = 64),
  CHECK (json_hash IS NULL OR length(json_hash) = 64),
  CHECK (pdf_proof_hash IS NULL OR length(pdf_proof_hash) = 64)
);

CREATE TABLE IF NOT EXISTS pet_participant_hashes (
  id TEXT PRIMARY KEY,
  pet_record_id TEXT NOT NULL,
  participant_role TEXT NOT NULL CHECK (
    participant_role IN ('supervisor', 'entrante', 'vigia')
  ),
  name TEXT NOT NULL,
  matricula TEXT NOT NULL,
  photo_hash TEXT,
  signature_image_hash TEXT,
  signed_at_client TEXT,
  FOREIGN KEY (pet_record_id) REFERENCES pet_records(id),
  CHECK (photo_hash IS NULL OR length(photo_hash) = 64),
  CHECK (signature_image_hash IS NULL OR length(signature_image_hash) = 64)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  session_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  ip_address TEXT,
  user_agent TEXT,
  FOREIGN KEY (user_id) REFERENCES app_users(id)
);

CREATE TABLE IF NOT EXISTS signature_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  key_id TEXT,
  purpose TEXT NOT NULL CHECK (
    purpose IN ('register_device', 'sign_pet', 'validate_key')
  ),
  nonce TEXT NOT NULL UNIQUE,
  payload_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  ip_address TEXT,
  user_agent TEXT,
  FOREIGN KEY (user_id) REFERENCES app_users(id),
  FOREIGN KEY (key_id) REFERENCES device_keys(id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  result TEXT NOT NULL DEFAULT 'success' CHECK (
    result IN ('success', 'failure', 'blocked')
  ),
  ip_address TEXT,
  user_agent TEXT,
  detail_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (actor_user_id) REFERENCES app_users(id)
);

CREATE INDEX IF NOT EXISTS idx_app_users_matricula ON app_users(matricula);
CREATE INDEX IF NOT EXISTS idx_device_keys_user ON device_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_device_keys_hash ON device_keys(public_key_hash);
CREATE INDEX IF NOT EXISTS idx_pet_records_numero ON pet_records(numero_pet);
CREATE INDEX IF NOT EXISTS idx_pet_records_user ON pet_records(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_pet_records_hash ON pet_records(payload_hash);
CREATE INDEX IF NOT EXISTS idx_pet_participants_pet ON pet_participant_hashes(pet_record_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_signature_challenges_nonce ON signature_challenges(nonce);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);

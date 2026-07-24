-- PET-Digital NR-33 v1.1.5
-- Execute uma única vez no D1 antes de publicar o Worker v1.1.5.

-- Controle de tentativas de login por identificadores opacos de matrícula e IP.
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  scope_key TEXT PRIMARY KEY,
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  window_started_at TEXT NOT NULL,
  blocked_until TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_blocked_until
ON auth_rate_limits(blocked_until);

-- Quantidade esperada de participantes gravada junto ao registro principal.
-- A contagem é conferida após o batch e durante a validação oficial.
ALTER TABLE pet_records ADD COLUMN participant_count INTEGER NOT NULL DEFAULT 0;

UPDATE pet_records
SET participant_count = (
  SELECT COUNT(*)
  FROM pet_participant_hashes p
  WHERE p.pet_record_id = pet_records.id
);

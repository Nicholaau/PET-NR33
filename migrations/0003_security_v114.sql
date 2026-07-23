-- PET-Digital NR-33 v1.1.4
-- Correções de segurança e idempotência.
-- Execute UMA VEZ no console SQL do D1 antes de publicar o Worker v1.1.4.

ALTER TABLE pet_records ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pet_records_idempotency
ON pet_records(idempotency_key)
WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pet_records_exact_validation
ON pet_records(numero_pet, payload_hash, pdf_hash, json_hash, created_by_user_id);

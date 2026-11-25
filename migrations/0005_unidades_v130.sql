-- PET-Digital NR-33 v1.3.0
-- Unidades padronizadas, unidade da PET e dados de exibição do registro.
-- Execute UMA VEZ no console SQL do D1 antes de publicar o Worker v1.3.0.
-- Não apaga nada: o campo de texto antigo app_users.unit continua existindo e é usado
-- apenas para o mapeamento inicial (aba Gestão → Unidades → Cadastros antigos).

-- Lista oficial de unidades, equipes e núcleos. Não há exclusão: só desativação.
CREATE TABLE IF NOT EXISTS units (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'unidade' CHECK (type IN ('unidade', 'equipe', 'nucleo')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT,
  updated_at TEXT
);

-- Unidade de cada usuário.
ALTER TABLE app_users ADD COLUMN unit_id TEXT REFERENCES units(id);

-- Unidade da PET, gravada pelo servidor a partir do emissor, e dados mínimos para a lista.
ALTER TABLE pet_records ADD COLUMN unit_id TEXT REFERENCES units(id);
ALTER TABLE pet_records ADD COLUMN unit_name TEXT;
ALTER TABLE pet_records ADD COLUMN pet_date TEXT;
ALTER TABLE pet_records ADD COLUMN pet_local TEXT;
ALTER TABLE pet_records ADD COLUMN pet_trabalho TEXT;
ALTER TABLE pet_records ADD COLUMN pet_supervisor TEXT;

-- Navegador/aparelho que fez o pedido de autorização (para mostrar "Android · Chrome").
ALTER TABLE device_keys ADD COLUMN request_user_agent TEXT;

CREATE INDEX IF NOT EXISTS idx_app_users_unit ON app_users(unit_id);
CREATE INDEX IF NOT EXISTS idx_pet_records_unit ON pet_records(unit_id, server_received_at);
CREATE INDEX IF NOT EXISTS idx_pet_records_received ON pet_records(server_received_at);
CREATE INDEX IF NOT EXISTS idx_device_keys_status ON device_keys(status, created_at);

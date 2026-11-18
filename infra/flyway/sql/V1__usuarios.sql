-- users-service: contas de usuário e consentimento da LGPD.
--
-- Todas as migrations deste projeto usam IF NOT EXISTS de propósito: o banco da
-- nuvem já existia antes do Flyway (as tabelas eram criadas pelos serviços).
-- O Flyway o adota com baseline na versão 0 e roda a V1 em diante, então cada
-- migration precisa ser inofensiva onde a tabela já existe.

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(190) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'ROLE_CUSTOMER',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- LGPD: prova do consentimento (quando e qual versão da política) e marca de
-- conta anonimizada (direito de eliminação). Contas antigas ficam com nulo.
ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_version VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS anonymized_at TIMESTAMP WITH TIME ZONE;

-- Migração 002 — painel de admin v2 (dashboard, relatórios, controle de envio).
-- Roda UMA vez num banco que já existe (criado com o schema.sql antigo):
--   npx wrangler d1 execute santinos-db --remote --file=./migrations/002_painel_v2.sql
-- Rodar de novo dá erro "duplicate column name" — é inofensivo, só significa
-- que já foi aplicada.

ALTER TABLE pedidos ADD COLUMN pagamento_criado_em TEXT;
ALTER TABLE pedidos ADD COLUMN status_detail TEXT;
ALTER TABLE pedidos ADD COLUMN cep TEXT;
ALTER TABLE pedidos ADD COLUMN frete_rotulo TEXT;
ALTER TABLE pedidos ADD COLUMN liquido_centavos INTEGER;
ALTER TABLE pedidos ADD COLUMN taxa_centavos INTEGER;
ALTER TABLE pedidos ADD COLUMN metodo_pagamento TEXT;
ALTER TABLE pedidos ADD COLUMN tipo_pagamento TEXT;
ALTER TABLE pedidos ADD COLUMN parcelas INTEGER;
ALTER TABLE pedidos ADD COLUMN pago_em TEXT;
ALTER TABLE pedidos ADD COLUMN status_envio TEXT NOT NULL DEFAULT 'novo';
ALTER TABLE pedidos ADD COLUMN rastreio TEXT;
ALTER TABLE pedidos ADD COLUMN enviado_em TEXT;
ALTER TABLE pedidos ADD COLUMN obs TEXT;
CREATE INDEX IF NOT EXISTS idx_pedidos_criado ON pedidos (criado_em);

ALTER TABLE cupons ADD COLUMN descricao TEXT;
ALTER TABLE cupons ADD COLUMN expira_em TEXT;
ALTER TABLE cupons ADD COLUMN max_usos INTEGER;
ALTER TABLE cupons ADD COLUMN min_subtotal_centavos INTEGER;

CREATE TABLE IF NOT EXISTS config (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_falhas (
  ip TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_falhas_ip ON admin_falhas (ip, ts);

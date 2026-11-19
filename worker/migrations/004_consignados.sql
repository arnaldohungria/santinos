-- Migração 004 — consignação: comércios (pontos de venda) e movimentos (entrega, acerto, recolhimento).
-- Roda UMA vez, ANTES do `wrangler deploy` do Worker que contém consignados.js:
--   npx wrangler d1 execute santinos-db --remote --file=./migrations/004_consignados.sql
-- É segura para rodar de novo (CREATE ... IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS consig_pontos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,                   -- nome do comércio
  tipo TEXT,                            -- açougue, empório, restaurante...
  responsavel TEXT,                     -- com quem o Arnaldo fala
  whatsapp TEXT,
  documento TEXT,                       -- CNPJ/CPF do comércio (opcional, sai no comprovante)
  endereco TEXT,
  cidade TEXT,
  preco_repasse_centavos INTEGER NOT NULL DEFAULT 1400, -- quanto o comércio paga por frasco vendido
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'pausado', 'encerrado')),
  obs TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS consig_movimentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ponto_id INTEGER NOT NULL REFERENCES consig_pontos (id),
  tipo TEXT NOT NULL CHECK (tipo IN ('entrega', 'acerto', 'recolhimento')),
  data TEXT NOT NULL,                   -- YYYY-MM-DD (dia da visita)
  itens_json TEXT NOT NULL,             -- {"suave":4,...} entrega = deixados; acerto = VENDIDOS; recolhimento = retirados
  contagem_json TEXT,                   -- acerto: o que sobrou na prateleira, como foi contado
  preco_centavos INTEGER,               -- acerto: preço de repasse usado no cálculo
  valor_centavos INTEGER,               -- acerto: total que o comércio deve
  pago INTEGER NOT NULL DEFAULT 0,      -- acerto: 1 = recebido
  pago_em TEXT,                         -- YYYY-MM-DD
  forma_pagamento TEXT,                 -- pix, dinheiro, outro
  motivo TEXT,                          -- recolhimento: devolvido, quebrado, vencido, outro
  obs TEXT,
  criado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_consig_mov_ponto ON consig_movimentos (ponto_id, data, id);

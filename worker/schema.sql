-- Santino's — schema do banco D1 (pedidos aprovados + cupons de desconto).
-- Rodar uma vez, depois de criar o banco:
--   npx wrangler d1 execute santinos-db --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS pedidos (
  external_reference TEXT PRIMARY KEY,  -- gerado em criarPreferencia (ex: SNT-XXXXX)
  mp_payment_id TEXT,                   -- id do pagamento no Mercado Pago
  status TEXT NOT NULL,                 -- approved, pending, rejected, etc.
  nome TEXT,
  email TEXT,
  whatsapp TEXT,
  cpf TEXT,
  endereco_json TEXT,                   -- objeto endereço, serializado
  itens_json TEXT,                      -- [{id, qtd}, ...], serializado
  subtotal_centavos INTEGER,
  frete_centavos INTEGER,
  desconto_centavos INTEGER DEFAULT 0,
  cupom TEXT,
  total_centavos INTEGER,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cupons (
  codigo TEXT PRIMARY KEY,              -- sempre maiúsculo
  tipo TEXT NOT NULL CHECK (tipo IN ('percentual', 'fixo')),
  valor INTEGER NOT NULL,               -- % (percentual) ou CENTAVOS (fixo)
  ativo INTEGER NOT NULL DEFAULT 1,     -- 0 = desativado, sem precisar apagar
  criado_em TEXT NOT NULL
);

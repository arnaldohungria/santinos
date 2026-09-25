-- Santino's — schema do banco D1 (instalação NOVA, do zero).
-- Rodar uma vez, depois de criar o banco:
--   npx wrangler d1 execute santinos-db --remote --file=./schema.sql
--
-- (Avaliações de produtos: banco existente roda migrations/003_avaliacoes.sql.)
--
-- Banco que JÁ existe (criado com a versão anterior deste arquivo)? Não rode
-- este arquivo de novo — rode a migração:
--   npx wrangler d1 execute santinos-db --remote --file=./migrations/002_painel_v2.sql

CREATE TABLE IF NOT EXISTS pedidos (
  external_reference TEXT PRIMARY KEY,  -- gerado em criarPreferencia (ex: SNT-XXXXX)
  mp_payment_id TEXT,                   -- id do pagamento (o mais relevante) no Mercado Pago
  pagamento_criado_em TEXT,             -- quando esse pagamento foi criado no MP (ISO UTC)
  status TEXT NOT NULL,                 -- approved, pending, in_process, rejected, cancelled, refunded...
  status_detail TEXT,                   -- motivo detalhado do MP (ex: cc_rejected_insufficient_amount)
  nome TEXT,
  email TEXT,
  whatsapp TEXT,
  cpf TEXT,
  cep TEXT,
  endereco_json TEXT,                   -- {logradouro, numero, complemento, bairro, cidade, uf}
  itens_json TEXT,                      -- [{id, qtd}, ...]
  subtotal_centavos INTEGER,            -- soma dos produtos, antes do desconto
  frete_centavos INTEGER,
  frete_rotulo TEXT,                    -- transportadora/serviço escolhido
  desconto_centavos INTEGER DEFAULT 0,
  cupom TEXT,
  total_centavos INTEGER,               -- o que o cliente pagou (produtos + frete - desconto)
  liquido_centavos INTEGER,             -- o que sobra pro vendedor depois das taxas do MP
  taxa_centavos INTEGER,                -- taxas cobradas pelo Mercado Pago
  metodo_pagamento TEXT,                -- pix, visa, master, ...
  tipo_pagamento TEXT,                  -- credit_card, debit_card, bank_transfer (pix), ticket (boleto)
  parcelas INTEGER,
  pago_em TEXT,                         -- quando foi aprovado (ISO UTC)
  status_envio TEXT NOT NULL DEFAULT 'novo',  -- novo | separado | enviado | entregue
  rastreio TEXT,
  enviado_em TEXT,
  obs TEXT,                             -- anotação interna
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pedidos_criado ON pedidos (criado_em);

CREATE TABLE IF NOT EXISTS cupons (
  codigo TEXT PRIMARY KEY,              -- sempre maiúsculo
  tipo TEXT NOT NULL CHECK (tipo IN ('percentual', 'fixo')),
  valor INTEGER NOT NULL,               -- % (percentual) ou CENTAVOS (fixo)
  ativo INTEGER NOT NULL DEFAULT 1,     -- 0 = desativado, sem precisar apagar
  descricao TEXT,                       -- anotação interna (ex: "campanha Instagram")
  expira_em TEXT,                       -- YYYY-MM-DD (vale até o fim desse dia) ou NULL
  max_usos INTEGER,                     -- NULL = ilimitado
  min_subtotal_centavos INTEGER,        -- NULL = sem pedido mínimo
  criado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS config (
  chave TEXT PRIMARY KEY,               -- custo_suave, custo_embalagem, meta_mensal...
  valor TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_falhas (
  ip TEXT NOT NULL,                     -- tentativas de login erradas (limite por IP)
  ts INTEGER NOT NULL                   -- epoch em milissegundos
);
CREATE INDEX IF NOT EXISTS idx_admin_falhas_ip ON admin_falhas (ip, ts);

CREATE TABLE IF NOT EXISTS avaliacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produto TEXT NOT NULL,                -- id do produto (suave, defumado, extra-forte)
  pedido_ref TEXT NOT NULL,             -- pedido que comprovou a compra (SNT-XXXX); o e-mail NÃO é guardado aqui
  nota INTEGER NOT NULL CHECK (nota BETWEEN 1 AND 5),
  comentario TEXT,
  nome TEXT NOT NULL,                   -- nome exibido no site (o cliente escolhe; sugerido: só o primeiro nome)
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovada', 'oculta')),
  resposta TEXT,                        -- resposta pública da loja (opcional)
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  UNIQUE (pedido_ref, produto)          -- uma avaliação por produto em cada pedido
);
CREATE INDEX IF NOT EXISTS idx_avaliacoes_produto ON avaliacoes (produto, status, criado_em);

-- Migração 003 — avaliações de produtos (nota de 1 a 5 + comentário, só de quem comprou).
-- Roda UMA vez, ANTES do `wrangler deploy` do Worker que contém avaliacoes.js:
--   npx wrangler d1 execute santinos-db --remote --file=./migrations/003_avaliacoes.sql
-- É segura para rodar de novo (CREATE ... IF NOT EXISTS).

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

# 2026-09-25 — Avaliações de produtos (nota 1–5 + comentário)

## O quê / por quê
Pedido do Arnaldo: clientes avaliarem os molhos com estrelas e comentário. Decisões dele (perguntadas em 2026-09-25):
1. **Só quem comprou avalia** (selo "Compra verificada"). Evita avaliação falsa (risco CDC/CONAR) e dá credibilidade.
2. **Ele aprova antes de publicar** (toda avaliação nasce "pendente").

## Como funciona
- **Cliente:** página `avaliar.html?pedido=SNT-XXXX&produto=suave` (link vem na mensagem de "pedido enviado" do painel; também dá para abrir pela página do produto → "Avaliar este produto").
  Informa nota, comentário (opcional, ≤ 600), nome exibido (≤ 40), **nº do pedido + e-mail da compra**.
- **Worker confere no banco** (`worker/src/avaliacoes.js`): pedido existe, e-mail bate, pagamento `approved`, `status_envio` é `enviado`/`entregue`, e o produto está no pedido.
  Uma avaliação por produto por pedido (UNIQUE). Erros de "não achei" usam **mensagem genérica** (não revela se o pedido existe). O e-mail **não é gravado** na tabela `avaliacoes`.
- **Publicação:** painel → aba **Avaliações** (selo com nº de pendentes): Aprovar e publicar / Ocultar / Recusar / Responder (resposta pública) / Apagar. Nada aparece no site antes de aprovar.
- **Site:** página do produto ganha resumo (média, barras por nota) + lista + resposta da loja; home e cabeçalho do produto mostram "★ 4,8 (12 avaliações)". Tudo montado com `textContent` (nunca `innerHTML` com dado de avaliação).
  Se o Worker não tiver a funcionalidade ainda, **as seções ficam ocultas** (deploy seguro em qualquer ordem).
- `pedido.html` agora mostra **"Número do seu pedido: SNT-…"** (o cliente precisa dele para avaliar).
- Mensagem de WhatsApp "pedido enviado" (drawer do painel) passou a incluir o link de avaliação.
- `privacidade.html`: novo item sobre avaliações (nota/comentário/nome são publicados; pedido e e-mail só conferem a compra).

## Arquivos
- Novos: `avaliar.html`, `avaliacoes.js` (site), `worker/src/avaliacoes.js`, `worker/migrations/003_avaliacoes.sql`, `admin/views/avaliacoes.js`, `worker/test/*.test.mjs`.
- Alterados: `worker/src/index.js` (rotas `POST /avaliar`, `GET /avaliacoes`, limite `RL_AVALIAR`), `worker/src/admin.js` (`/admin/avaliacoes`, `/admin/avaliacoes/moderar`), `worker/schema.sql`, `worker/wrangler.toml` (`RL_AVALIAR`, 5/min por IP),
  `admin/app.js|state.js|drawer.js|admin.css`, `style.css`, `loja.js`, 3 páginas de produto, `index.html`, `privacidade.html`.
- Tabela nova `avaliacoes` (D1). API pública: `GET /avaliacoes?produto=suave` (aprovadas + média + distribuição) e `GET /avaliacoes` (resumo por produto).

## Como publicar (ordem importa)
1. Merge na `main` → o site publica sozinho (as seções de avaliação continuam ocultas até o Worker novo entrar).
2. Arnaldo, no PowerShell (pasta `worker` do clone): `git pull` → **migração ANTES do deploy**:
   `npx wrangler d1 execute santinos-db --remote --file=./migrations/003_avaliacoes.sql` → `npx wrangler deploy`.
   (Sem a migração o Worker novo responde 500 em `/avaliar` e no painel de avaliações; checkout/webhook não usam a tabela nova.)

## Como testar
- Automático, sem Cloudflare: `node worker/test/avaliacoes.test.mjs` e `node worker/test/checkout.test.mjs` (D1 falso em `node:sqlite`).
- Manual em produção: fazer uma compra de teste, marcar o pedido como "enviado" no painel, abrir o link `avaliar.html?pedido=…`, enviar, aprovar na aba Avaliações e ver na página do produto.

## Como reverter
`git revert` do PR (o site volta ao anterior). A tabela `avaliacoes` pode ficar no banco sem efeito.

## Riscos aceitos / pendências
- A leitura pública (`GET /avaliacoes`) não tem limite de requisições nem cache (workers.dev não permite Cache API); cada visita a página de produto faz 2 consultas leves ao D1.
- Só o e-mail + nº do pedido comprovam a compra (quem souber os dois pode avaliar). Aceitável: passa por aprovação manual.
- Sem dados estruturados (JSON-LD `aggregateRating`) para o Google mostrar estrelas na busca — próximo passo possível quando houver avaliações reais.
- Sem e-mail automático pedindo avaliação (o convite vai pelo WhatsApp, botão do painel).
- Cliente não consegue editar a própria avaliação (só o Arnaldo oculta/apaga).

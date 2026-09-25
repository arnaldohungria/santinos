# Santino's — contexto do projeto (LEIA ANTES DE ALTERAR QUALQUER COISA)

Documento vivo. Última atualização: **2026-09-25**.

## Regras de trabalho (definidas pelo Arnaldo em 2026-09-24)

1. **Antes de qualquer alteração:** `git pull` no repositório e ler este arquivo + as notas mais recentes de
   `historico/`. O Arnaldo mexe no projeto de mais de um computador, então o repositório é a fonte da verdade —
   nunca confiar só na memória de uma sessão anterior.
2. **Depois de qualquer alteração:** criar uma nota em `historico/AAAA-MM-DD-assunto.md` (o que mudou, por quê,
   como testar/reverter, o que ficou pendente) e, se o estado do projeto mudou, atualizar este arquivo.
   A nota vai no mesmo PR da alteração.
3. **Fluxo de código:** branch → commit → push → `gh pr create` → merge na `main`. Merge na `main` **publica o site
   na Vercel na hora**. (O Worker da Cloudflare NÃO publica sozinho: o Arnaldo roda `wrangler deploy`.)
4. **Nunca escrever segredos aqui** (tokens, senhas, `INTERNAL_SHARED_SECRET`, `ADMIN_PASSWORD`). Só nomes de
   variáveis e onde configurar.
5. Esta pasta (`docs/`) não deve ser servida pelo site — ver `.vercelignore`.

## O que é

Loja online da marca de molhos de pimenta **Santino's** (Itapetininga-SP; Suave, Defumado e Extra Forte, frasco
de 60 ml, R$ 19,90 cada). Dono: Arnaldo Hungria. Site: <https://www.santinos.com.br> (o domínio sem `www` redireciona).

## Arquitetura

```
Cliente ──> Site estático (Vercel, repo arnaldohungria/santinos, branch main, sem build)
              │  loja.js: carrinho (localStorage) e checkout
              ▼
        Cloudflare Worker "santinos-checkout"  (conta arnaldo@live.jp)
        https://santinos-checkout.santinos.workers.dev
              │  /calcular-frete ─────> Vercel Function api/melhor-envio.js ──> Melhor Envio (cotação)
              │  /validar-cupom, /criar-preferencia ──> Mercado Pago Checkout Pro
              │  /webhook <── Mercado Pago (pagamento) ──> grava pedido no D1
              │  /admin/*  (Basic Auth) <── painel admin.html
              ▼
        D1 "santinos-db" (id 20fefdbd-c5ac-46a7-889d-16a5bce7bd6b): pedidos, cupons, config, admin_falhas
```

| Peça | Onde | Detalhe |
|---|---|---|
| Site | Vercel (projeto com domínio auxiliar `santinos-sage.vercel.app`) | HTML/CSS/JS puro. **Links de página levam `.html`** (`/suave` dá 404) |
| Frete real | `api/melhor-envio.js` (Vercel) | Só cotação (`shipping-calculate`). Vars na Vercel: `MELHOR_ENVIO_TOKEN`, `ORIGEM_CEP` (18208672), `INTERNAL_SHARED_SECRET` |
| Worker | `worker/` | Secrets: `MP_ACCESS_TOKEN`, `INTERNAL_SHARED_SECRET` (igual ao da Vercel), `ADMIN_PASSWORD`. Vars em `worker/wrangler.toml` |
| Pagamento | Mercado Pago Checkout Pro | Pix, cartão, boleto; redireciona pro MP e volta em `pedido.html` |
| Painel | `admin.html` + `admin/` | Dashboard, pedidos, clientes, cupons, relatórios, config. Usuário `admin` |
| Meta Pixel | `pixel.js` | ID `1066393226136565`; eventos ViewContent/AddToCart/InitiateCheckout/Purchase em `loja.js` |
| Catálogo Meta | `catalogo.csv` → <https://www.santinos.com.br/catalogo.csv> | IDs `suave`/`defumado`/`extra-forte` = `content_ids` do Pixel |
| Instagram | Behold.so (feed `pq4swuZKZCYr2UfelzGh`) | Galeria na home (`initInstagram` em `loja.js`) |

Conta de anúncios Meta: `920054342570415` (conjunto de dados/Pixel "Santinos").

## Onde está cada coisa

- `loja.js` — **config no topo** (produtos e preços em centavos, faixa de CEP de Itapetininga, `workerUrl`,
  `beholdFeedId`), carrinho, checkout (ViaCEP, opções de frete, cupom), retorno do pagamento, eventos do Pixel.
- `worker/src/index.js` — checkout (frete, cupom, preferência do MP, webhook). `admin.js` (API do painel, login com
  bloqueio), `pedidos.js` (grava/sincroniza pagamentos), `cupons.js` (regras), `catalogo.js` (**preços — cópia-verdade**), `util.js`.
- `worker/schema.sql` (banco novo) e `worker/migrations/` (banco existente — rodar **antes** do deploy).
- `admin/` — módulos ES do painel (`app.js` casca, `views/*` telas, `dados.js` regras, `charts.js`, `relatorios-def.js`, `impressao.js`).
- `worker/README.md` — documentação técnica detalhada (rotas, cupons, webhook, painel).

## Regras e armadilhas que já custaram tempo

- **Preço existe em dois lugares:** `loja.js` (só exibe) e `worker/src/catalogo.js` (é o que cobra). Mudou preço → mudar os dois **e** `catalogo.csv`.
- **Deploy do Worker:** `git pull` → (se houver migração nova) `npx wrangler d1 execute santinos-db --remote --file=./migrations/<arquivo>.sql`
  → `npx wrangler deploy`. Migração **antes** do deploy, senão o webhook falha e pedidos se perdem.
- No PowerShell do Arnaldo, sempre entrar antes na pasta `worker` do clone dele (no notebook: `C:\Users\arnal\santinos-site\worker`).
  PowerShell aberto em `C:\Windows\System32` faz o wrangler falhar com EPERM.
- **Token/secret com "•" (bolinha de máscara)** colado no lugar do valor real dá erro de `ByteString ... 8226` — foi a causa raiz do
  problema de frete (que parecia bloqueio da Cloudflare). Copiar o valor do campo sem máscara.
- O Worker chama o proxy de frete pelo domínio `*.vercel.app` (`FRETE_PROXY_URL`), não pelo `santinos.com.br`.
- CSS: o atributo `[hidden]` só funciona porque `style.css` tem `[hidden]{display:none!important}` (classes com `display:flex` o anulavam).
- **Dados de pedido são não confiáveis** (vêm do cliente): no painel tudo passa pela tag `html` (escapa por padrão) e o CSV neutraliza fórmulas.
- Desconto de cupom vai ao Mercado Pago como item de valor **negativo**; há fallback automático (item único já descontado se o MP recusar).
- Plano grátis do Workers limita CPU/consultas: sincronização é paginada (30 por vez) e lotes de envio têm no máx. 40.
- `wrangler d1 ... --local` dá "internal error" em Windows neste ambiente; para testar o Worker sem conta usei um servidor Node
  com `node:sqlite` fazendo de D1 (não está no repo).

## Estado atual (2026-09-24)

- **No ar e funcionando:** loja completa (carrinho, checkout, frete real com escolha de transportadora, cupons, Pix/cartão/boleto),
  Meta Pixel, painel admin v2 (Worker v2 deployado e banco migrado em 2026-09-21), catálogo em `catalogo.csv`. **Já houve pedido real.**
- **Em andamento (Arnaldo, no Meta Business Suite):** importar o catálogo — Commerce Manager → Adicionar itens → **Arquivo de dados** →
  feed agendado diário com a URL do `catalogo.csv`, moeda BRL. Perfil do WhatsApp/Instagram sendo personalizado.

## Segurança e e-mail (2026-09-25 — ver `historico/2026-09-25-teste-de-seguranca.md` e `historico/2026-09-25-email-do-dominio.md`)

- `vercel.json` aplica CSP e demais cabeçalhos. **Se adicionar serviço externo novo (script, fonte, API, iframe), liberar o domínio na CSP** ou ele será bloqueado.
- `.vercelignore` mantém `docs/` e `worker/` fora do site público.
- Rotas públicas do Worker têm limite por IP (`[[ratelimits]]` no `wrangler.toml`; exige wrangler ≥ 4.36).
- **E-mail:** `contato@santinos.com.br` roda no Zoho Mail (plano grátis, só webmail/app). MX, SPF, DKIM e DMARC estão no DNS da Vercel.
  Só pode haver **um** registro SPF; DMARC está em `p=none`.

## Pendências

1. **Verificação do domínio `santinos.com.br` no Meta** — precisa da meta-tag `facebook-domain-verification` (o Arnaldo gera em
   Configurações do negócio → Segurança da marca → Domínios → Meta-tag e passa; colocar no `<head>` do `index.html`).
2. ~~Testar pedido com cupom~~ — **feito em 2026-09-25** (compra real com cupom aprovada; desconto aceito pelo MP e pedido correto no painel).
3. Arnaldo preencher **custos** (frascos e embalagem) e a meta em Painel → Configurações, para o lucro estimado aparecer.
4. Páginas legais com lacunas (CNPJ, endereço, datas, comarca).
5. E-mail de aviso de pedido novo (`NOTIFY_EMAIL` existe como variável, **não implementado**; já existe a caixa `contato@`, falta um serviço de envio).
6. API de Conversões do Meta (só o Pixel de navegador está ativo).
7. Estoque (o catálogo marca tudo como "em stock"; não há controle).
8. Peso/caixa reais para calibrar `PACOTES` do frete (hoje é estimativa; frasco cheio arredondado pra 150 g).
9. Regularização de rótulo/produção (ANVISA, NF) — o Arnaldo situou pra 2027.

## Histórico de PRs (todos mergeados em `main`)

| PR | Data | O quê |
|---|---|---|
| #1 | 28/08 | Carrinho e checkout via Mercado Pago |
| #2 | 28/08 | Ajustes de conteúdo + galeria do Instagram (Behold) |
| #3 | 28/08 | Página por produto + resumos na home |
| #4–#5 | 04/09 | Frete real via Melhor Envio; cliente escolhe a transportadora |
| #6 | 04/09 | Worker em produção + blindagem contra erro cru |
| #7–#9, #11, #13–#15 | 04/09 | Diagnóstico temporário do frete (removido no #16) |
| #10, #12, #16 | 04/09 | Cotação movida pro proxy na Vercel; limpeza do debug |
| #17–#18 | 04/09 | Meta Pixel + eventos de e-commerce; ativado com o ID |
| #19 | 17/09 | Cupons de desconto no checkout |
| #20–#22 | 17/09 | Painel admin v1 + banco D1; ajuste de botão |
| #23 | 18/09 | Painel admin v2 (dashboard, pedidos completos, clientes, cupons avançados, relatórios) |
| #24 | 21/09 | Planilha de catálogo pro Meta |
| #25 | 24/09 | Contexto do projeto no repositório (`docs/contexto`) |
| #26 | 25/09 | Teste de segurança + correções (cabeçalhos, limite de taxa, saneamento) |
| #27–#29 | 25/09 | Notas de contexto: e-mail do domínio (Zoho), verificação do Worker em produção, teste de compra com cupom |
| #25 | 24/09 | Contexto do projeto no repositório (`docs/contexto`) |
| #26 | 25/09 | Teste de segurança + correções (cabeçalhos, limite de taxa, saneamento) |

Notas detalhadas por alteração: pasta [`historico/`](historico/) (a partir de 2026-09-24).

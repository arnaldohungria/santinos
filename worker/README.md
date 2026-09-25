# Santino's — Worker de checkout

Backend mínimo do checkout: recebe o carrinho do site, **revalida preço e frete no
servidor**, cota o frete real via **Melhor Envio**, cria a preferência no
**Mercado Pago Checkout Pro** e devolve o link de pagamento. O webhook grava
os pedidos num banco **D1** (que também guarda cupons e configurações) — tudo
administrável pelo painel `admin.html` do site (dashboard, pedidos, clientes,
cupons, relatórios).

Código: `src/index.js` (checkout), `src/admin.js` (painel), `src/pedidos.js`
(gravação de pedidos + sincronização com o Mercado Pago), `src/cupons.js`
(regras de cupom), `src/catalogo.js` (preços), `src/util.js`.

Hospedado no **Cloudflare Workers** (free tier). Mesmo padrão do projeto AcademiaPlus.

## Rotas

| Método | Rota | O que faz |
|---|---|---|
| GET | `/health` | teste de vida |
| POST | `/calcular-frete` | corpo `{ cep, uf, itens }` → `{ opcoes: [...] }` — cotação em tempo real, chamada pelo checkout enquanto o cliente digita o CEP |
| POST | `/validar-cupom` | corpo `{ cupom, itens }` → `{ valido, codigo, descontoCentavos }` — confere o cupom em tempo real, chamado quando o cliente clica "Aplicar" no checkout |
| POST | `/criar-preferencia` | corpo `{ itens, frete:{cep,uf}, cupom, comprador }` → `{ init_point }` |
| POST | `/webhook` | notificação de pagamento do Mercado Pago — consulta o pagamento e grava/atualiza o pedido em D1 |
| GET | `/admin/ping` | (Basic Auth) confere a senha |
| GET | `/admin/pedidos` | (Basic Auth) lista os pedidos gravados (até 5.000), mais recentes primeiro |
| POST | `/admin/pedidos/atualizar` | (Basic Auth) corpo `{ atualizacoes: [{ ref, status_envio?, rastreio?, obs? }] }` (até 40) |
| GET/POST/DELETE | `/admin/cupons` | (Basic Auth) lista (com uso/desconto/receita), cria/edita (upsert), liga/desliga `{codigo, ativo}` ou apaga |
| GET/POST | `/admin/config` | (Basic Auth) custos por produto, embalagem e meta mensal |
| POST | `/admin/sincronizar` | (Basic Auth) corpo `{ dias, offset }` — busca pagamentos no Mercado Pago e grava (30 por chamada; devolve `proximo`) |

## Configuração

Pré-requisito: conta no Cloudflare **da Santino's** (não reaproveitar a de outro
projeto do Arnaldo — DojoPass, AcademiaPlus etc. têm contas próprias) e
`wrangler` logado nela (`npx wrangler login`).

```bash
cd worker
npm install            # instala o wrangler (devDependency)

# Access Token de PRODUÇÃO do Mercado Pago (painel de desenvolvedor da conta Santino's):
npx wrangler secret put MP_ACCESS_TOKEN

# Segredo compartilhado com o proxy de frete da Vercel (api/melhor-envio.js) —
# mesmo valor cadastrado lá em INTERNAL_SHARED_SECRET:
npx wrangler secret put INTERNAL_SHARED_SECRET

# Senha do painel /admin.html (usuário fixo "admin"):
npx wrangler secret put ADMIN_PASSWORD

# Banco D1 — só na primeira vez (cria o banco e devolve um database_id pra
# colar em [[d1_databases]] no wrangler.toml, no lugar de "COLAR-AQUI..."):
npx wrangler d1 create santinos-db
npx wrangler d1 execute santinos-db --remote --file=./schema.sql

# Deploy
npx wrangler deploy
```

### Atualizando um banco que já existe (migrações)

Quando o `schema.sql` ganha colunas/tabelas novas, o banco em produção precisa
da migração **ANTES** do `wrangler deploy` (senão o código novo tenta gravar em
colunas que ainda não existem e o webhook falha):

```bash
npx wrangler d1 execute santinos-db --remote --file=./migrations/002_painel_v2.sql
npx wrangler deploy
```

Rodar a mesma migração duas vezes dá erro `duplicate column name` — é inofensivo,
só significa que já foi aplicada. Depois do deploy, abra o painel → Configurações
→ **Sincronizar** pra preencher endereço/taxas/forma de pagamento dos pedidos
antigos.

O deploy imprime a URL pública (algo como
`https://santinos-checkout.SEU-SUBDOMINIO.workers.dev`).
Copie essa URL para `LOJA_CONFIG.workerUrl` no arquivo `loja.js` do site.

### Variáveis (já em `wrangler.toml`, ajuste se o domínio mudar)

- `SITE_URL` — base do site, usada nas `back_urls` de retorno (`/pedido.html`)
  e para achar o proxy de frete (`SITE_URL + /api/melhor-envio`).
- `ALLOWED_ORIGIN` — origem liberada no CORS (igual ao `SITE_URL`).
- `NOTIFY_EMAIL` — (opcional, ainda não usado) e-mail para aviso de pedido.

O `MELHOR_ENVIO_TOKEN` e o `ORIGEM_CEP` **não ficam mais neste Worker** — veja
"Como funciona o frete" abaixo.

### Teste local

```bash
npx wrangler dev
# em outro terminal:
curl http://localhost:8787/health
```

Para testar `/criar-preferencia` e `/calcular-frete` localmente, crie `worker/.dev.vars` com:

```
MP_ACCESS_TOKEN=APP_USR-...conta-de-teste-ou-producao...
INTERNAL_SHARED_SECRET=...mesmo valor da Vercel...
```

(esse arquivo está no `.gitignore`). Como o `/calcular-frete` local chama o
proxy em `SITE_URL` (produção, na Vercel), a cotação real funciona mesmo
testando o Worker localmente.

## Como funciona o frete

1. **Itapetininga** (faixa de CEP) → grátis, sempre — sem chamar API nenhuma.
2. Fora disso → cota em tempo real no **Melhor Envio** (`/shipment/calculate`,
   rota gratuita, não gera etiqueta nem mexe em saldo) usando a caixa da tabela
   `PACOTES` (peso/dimensões por quantidade de frascos) e devolve até 5 opções
   (mais barata primeiro) pro cliente escolher.
3. Se a chamada falhar (API fora do ar, token não configurado, CEP não
   atendido) → cai na **tabela fixa por região** (`FRETE_REGIOES`) como rede de
   segurança, marcada como "(estimado)".

`PACOTES` foi calibrado com o frasco de 60 ml cheio ≈ 150 g (arredondado pra
cima) informado pelo Arnaldo — ainda é estimativa de caixa/plástico bolha, não
pesagem real. Calibrar quando ele pesar uma caixa de verdade.

**Por que a cotação passa pela Vercel:** chamando o Melhor Envio diretamente
DAQUI (Cloudflare Worker), a API dele devolve `401 Unauthenticated` mesmo com
o token certo — as duas APIs ficam atrás da Cloudflare, e a proteção do lado
do Melhor Envio parece bloquear tráfego Worker-a-Worker. A chamada real ao
Melhor Envio foi movida pra `api/melhor-envio.js` na raiz do site (Vercel
Serverless Function) — o mesmo fetch, de lá, funciona normalmente. Esse Worker
só chama esse proxy e faz o resto (filtrar, ordenar, revalidar preço) como
antes. O proxy é protegido por `INTERNAL_SHARED_SECRET` (header
`x-internal-secret`) pra ninguém de fora conseguir consumir a cota de
cotações do Melhor Envio.

`FRETE_PROXY_URL` aponta pro domínio `*.vercel.app` que a Vercel atribui ao
projeto, não pro `santinos.com.br` customizado — funciona nos dois, mas o
`*.vercel.app` foi o endereço usado durante o diagnóstico e ficou assim.

**Nota de diagnóstico (histórico):** logo depois de criar o proxy, ele voltava
`502` sempre que o pedido continha um pacote de verdade (erro genérico, sem
detalhe). A causa real não era Cloudflare nem Vercel — era o valor salvo em
`MELHOR_ENVIO_TOKEN` na Vercel, que continha caracteres de mascaramento (um
"•" de campo de senha) em vez do token de verdade, provavelmente colado sem
querer de algum lugar que mostrava o token oculto. `fetch()` não consegue
montar o header `Authorization` com esse caractere e lança uma exceção, que a
Vercel devolve como 502. Corrigido gerando um token novo e colando direto do
painel do Melhor Envio.

**Segurança:** o token do Melhor Envio (configurado na Vercel, não aqui) só
tem o escopo `shipping-calculate` (cotação, sem custo). Nunca é chamado
`shipping-generate` / `shipping-checkout` / `shipping-cancel` — geração de
etiqueta e pagamento de frete continuam manuais, no painel do Melhor Envio.

## Como funcionam os cupons

Cupons ficam na tabela D1 `cupons` (ver `schema.sql`) — sem código nem deploy pra
criar/editar/desativar: é tudo pela aba "Cupons" do painel. Reutilizáveis
(qualquer cliente pode usar o mesmo código), com regras opcionais: **validade**
(`expira_em`, vale até o fim do dia em Brasília), **limite de usos** (`max_usos`,
conta pedidos que não foram recusados/cancelados/reembolsados) e **pedido mínimo**
(`min_subtotal_centavos`). Pra desativar sem perder o histórico, o painel marca
`ativo = 0`.

Dois tipos: `percentual` (`valor` = % do subtotal) ou `fixo` (`valor` em CENTAVOS).
O desconto nunca passa do subtotal e é sempre recalculado no servidor em cima do
carrinho de verdade — o que o cliente vê no checkout é só uma prévia via
`/validar-cupom`; o `/criar-preferencia` confere tudo de novo e, se o cupom não
valer mais (expirou, esgotou…), **recusa o pedido com o motivo** em vez de cobrar
um total diferente do que o cliente viu.

O desconto entra na preferência como um item `unit_price` negativo ("Cupom X"),
com a rede de segurança descrita em "Como o webhook grava os pedidos".

## Como funciona o painel de admin (`admin.html` + `admin/`)

Login por senha única (`ADMIN_PASSWORD`, usuário fixo `"admin"`) via **HTTP Basic
Auth**: a tela testa a senha em `/admin/ping` e guarda o header só no
`sessionStorage` da aba (some ao fechar). Depois de **8 senhas erradas** seguidas,
o IP fica bloqueado por 15 minutos (tabela `admin_falhas`); a comparação da
senha é em tempo constante.

Telas: **Dashboard** (faturamento com comparação ao período anterior, ticket,
lucro estimado, meta do mês, gráficos por dia/produto/estado/forma de
pagamento/dia da semana/hora), **Pedidos** (busca, filtros, seleção em lote,
detalhes completos com endereço/contato/itens/taxas, controle de envio e
rastreio, etiquetas pra imprimir, CSV), **Clientes** (agrupados por CPF, VIP/
recorrente, WhatsApp), **Cupons** (validade, limite de usos, pedido mínimo,
desempenho), **Relatórios** (8 tipos, CSV pro Excel e impressão/PDF) e
**Configurações** (custos, meta, sincronização com o Mercado Pago, backup).

O painel é uma página estática (sobe pra Vercel junto com o site); a única
proteção real é a senha checada aqui no Worker — a URL em si não é secreta. Todo
dado de pedido é tratado como **não confiável** na tela (escapado; nada de
`innerHTML` cru) e o CSV neutraliza fórmulas (`=`, `+`, `-`, `@`).

**Lucro estimado** = produtos (já com desconto) − custo dos frascos − embalagem −
taxas do Mercado Pago; o frete cobrado é tratado como repasse da etiqueta. Só
aparece depois de informar os custos em Configurações.

## Como o webhook grava os pedidos

O Mercado Pago manda `{ type: "payment", data: { id } }` pro `/webhook` a cada
mudança de status. O Worker responde `200` rápido (se falhar, o Mercado Pago
reenvia) e consulta `GET /v1/payments/{id}` pra pegar o pagamento completo
(status, valores, taxas, líquido, forma, parcelas + o `metadata`), gravando em D1
(`INSERT ... ON CONFLICT DO UPDATE`, pela `external_reference`).

O `metadata` (nome, e-mail, CPF, WhatsApp, endereço, itens, frete escolhido, cupom)
vem do que `criarPreferencia` mandou ao Mercado Pago na hora de gerar o link.

**Várias tentativas de pagamento no mesmo pedido** (ex.: cartão recusado e depois
Pix aprovado): a linha só troca de pagamento se for a mesma tentativa, uma
aprovada, ou uma mais recente enquanto o pedido ainda não estiver pago — um aviso
atrasado de tentativa antiga nunca "rebaixa" um pedido já pago. O controle de
envio (situação, rastreio, observações) nunca é sobrescrito por webhook/sincronização.

**Sincronizar** (`/admin/sincronizar`) faz a mesma gravação em lote a partir da
busca de pagamentos do Mercado Pago (só `external_reference` começando com
`SNT-`; outros projetos da mesma conta ficam de fora).

**Cupom no Mercado Pago:** o desconto entra como item de valor negativo. Se o
Mercado Pago recusar isso, o Worker refaz a preferência automaticamente com um
item único já descontado (o cliente paga o mesmo total).

## Pendências (v2)

- Enviar e-mail de aviso (`NOTIFY_EMAIL`) quando um pedido é aprovado.
- Plano grátis do Workers limita CPU a 10 ms por requisição: com milhares de
  pedidos, a listagem do painel pode estourar — aí vale o plano pago ($5/mês) ou
  paginar `/admin/pedidos`.
- Manter `PRECOS`, `FRETE_REGIOES` e `PACOTES` em `src/index.js` **iguais**
  (preço/frete) ou coerentes (pacotes) com o `loja.js`.
- Automatizar a compra da etiqueta no Melhor Envio depois do pagamento aprovado
  (hoje é manual — fora do escopo deste Worker de propósito).

## Avaliações de produtos

- `POST /avaliar` (público, limite `RL_AVALIAR`): corpo `{produto, nota, pedido, email, nome, comentario}`. Confere no banco se o pedido existe, o e-mail bate, o pagamento está `approved` e o pedido já foi `enviado`/`entregue` e contém o produto. Grava como `pendente`.
- `GET /avaliacoes?produto=suave` (público): só avaliações `aprovada`, com média e distribuição. Sem `produto`: resumo de todos.
- Painel: `GET|DELETE /admin/avaliacoes`, `POST /admin/avaliacoes/moderar` (`{id, status?, resposta?}`).
- Tabela `avaliacoes` — migração `migrations/003_avaliacoes.sql` (rodar antes do deploy).
- Testes: `node worker/test/avaliacoes.test.mjs`.

# Santino's — Worker de checkout

Backend mínimo do checkout: recebe o carrinho do site, **revalida preço e frete no
servidor**, cota o frete real via **Melhor Envio**, cria a preferência no
**Mercado Pago Checkout Pro** e devolve o link de pagamento. O webhook grava
os pedidos aprovados num banco **D1**, que também guarda os cupons de
desconto — ambos administráveis pelo painel `admin.html` do site.

Hospedado no **Cloudflare Workers** (free tier). Mesmo padrão do projeto AcademiaPlus.

## Rotas

| Método | Rota | O que faz |
|---|---|---|
| GET | `/health` | teste de vida |
| POST | `/calcular-frete` | corpo `{ cep, uf, itens }` → `{ opcoes: [...] }` — cotação em tempo real, chamada pelo checkout enquanto o cliente digita o CEP |
| POST | `/validar-cupom` | corpo `{ cupom, itens }` → `{ valido, codigo, descontoCentavos }` — confere o cupom em tempo real, chamado quando o cliente clica "Aplicar" no checkout |
| POST | `/criar-preferencia` | corpo `{ itens, frete:{cep,uf}, cupom, comprador }` → `{ init_point }` |
| POST | `/webhook` | notificação de pagamento do Mercado Pago — consulta o pagamento e grava/atualiza o pedido em D1 |
| GET | `/admin/pedidos` | (Basic Auth) lista os pedidos gravados, mais recentes primeiro |
| GET/POST/DELETE | `/admin/cupons` | (Basic Auth) lista, cria/edita (upsert) ou apaga um cupom |

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

Cupons ficam na tabela D1 `cupons` (ver `schema.sql`) — sem código nem deploy
pra criar/editar/desativar, é tudo pelo painel `admin.html` do site (aba
"Cupons"). Reutilizáveis (qualquer cliente pode usar o mesmo código quantas
vezes quiser) — não é uso único, não tem limite de vezes usado nem data de
expiração automática (pra desativar sem apagar o histórico, o painel só marca
`ativo = 0`).

Dois tipos: `percentual` (`valor` = % do subtotal) ou `fixo` (`valor` em
CENTAVOS, abatido direto). O desconto nunca passa do subtotal (não gera valor
negativo) e é sempre recalculado no servidor em cima do carrinho de verdade —
o valor que o cliente vê no checkout é só uma prévia via `/validar-cupom`; o
`/criar-preferencia` confere tudo de novo antes de mandar pro Mercado Pago.

O desconto entra na preferência como um item `unit_price` negativo
("Cupom X"), ao lado dos produtos e do frete.

## Como funciona o painel de admin (`admin.html`)

Login por senha única (`ADMIN_PASSWORD`, usuário fixo `"admin"`) via **HTTP
Basic Auth** — sem sessão/cookie no servidor: a página testa a senha contra
`/admin/pedidos` e, se der certo, guarda o header `Authorization` no
`sessionStorage` do navegador (some ao fechar a aba) e manda ele em toda
chamada `/admin/*` daí em diante.

- **Pedidos**: lista o que o webhook gravou em D1 (cliente, itens, total,
  cupom usado, status) — mais recente primeiro, até 300 registros.
- **Cupons**: criar, editar (reenviar o mesmo código com valor novo
  sobrescreve), ativar/desativar e apagar — tudo direto na tela, sem tocar em
  código.

O painel é uma página estática comum (`admin.html`, sobe pra Vercel junto com
o resto do site) — a única proteção real é a senha checada no Worker; a URL
em si não é secreta. Sem `ADMIN_PASSWORD` configurado no Worker, o painel
nunca deixa ninguém entrar (inclusive o Arnaldo).

## Como o webhook grava os pedidos

O Mercado Pago manda `{ type: "payment", data: { id } }` pro `/webhook` a
cada mudança de status. O Worker sempre responde `200` rápido (se falhar, o
Mercado Pago reenvia depois) e, em paralelo, consulta
`GET /v1/payments/{id}` pra pegar os dados completos do pagamento (status,
valor, metadata) e grava em D1 (`INSERT ... ON CONFLICT DO UPDATE`, pela
`external_reference` — reenvios do mesmo webhook só atualizam o status, não
duplicam a linha).

Os dados do pedido (nome, e-mail, endereço, itens, cupom) vêm do `metadata`
que `criarPreferencia` já manda pro Mercado Pago na hora de gerar o link de
pagamento — o webhook não recebe isso de novo do cliente, só busca de volta o
que já tinha sido enviado.

## Pendências (v2)

- Enviar e-mail de aviso (`NOTIFY_EMAIL`) quando um pedido é aprovado.
- Manter `PRECOS`, `FRETE_REGIOES` e `PACOTES` em `src/index.js` **iguais**
  (preço/frete) ou coerentes (pacotes) com o `loja.js`.
- Automatizar a compra da etiqueta no Melhor Envio depois do pagamento aprovado
  (hoje é manual — fora do escopo deste Worker de propósito).

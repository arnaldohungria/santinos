# Santino's — Worker de checkout

Backend mínimo do checkout: recebe o carrinho do site, **revalida preço e frete no
servidor**, cota o frete real via **Melhor Envio**, cria a preferência no
**Mercado Pago Checkout Pro** e devolve o link de pagamento. Também recebe o
webhook de confirmação do Mercado Pago.

Hospedado no **Cloudflare Workers** (free tier). Mesmo padrão do projeto AcademiaPlus.

## Rotas

| Método | Rota | O que faz |
|---|---|---|
| GET | `/health` | teste de vida |
| POST | `/calcular-frete` | corpo `{ cep, uf, itens }` → `{ opcoes: [...] }` — cotação em tempo real, chamada pelo checkout enquanto o cliente digita o CEP |
| POST | `/criar-preferencia` | corpo `{ itens, frete:{cep,uf}, comprador }` → `{ init_point }` |
| POST | `/webhook` | notificação de pagamento do Mercado Pago (hoje só loga e responde 200) |

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

## Pendências (v2)

- `/webhook`: consultar `GET /v1/payments/{id}`, checar `status === "approved"`,
  enviar e-mail de aviso e registrar o pedido (KV, D1 ou planilha).
- Manter `PRECOS`, `FRETE_REGIOES` e `PACOTES` em `src/index.js` **iguais**
  (preço/frete) ou coerentes (pacotes) com o `loja.js`.
- Automatizar a compra da etiqueta no Melhor Envio depois do pagamento aprovado
  (hoje é manual — fora do escopo deste Worker de propósito).

# Santino's — Worker de checkout

Backend mínimo do checkout: recebe o carrinho do site, **revalida preço e frete no
servidor**, cria a preferência no **Mercado Pago Checkout Pro** e devolve o link de
pagamento. Também recebe o webhook de confirmação do Mercado Pago.

Hospedado no **Cloudflare Workers** (free tier). Mesmo padrão do projeto AcademiaPlus.

## Rotas

| Método | Rota | O que faz |
|---|---|---|
| GET | `/health` | teste de vida |
| POST | `/criar-preferencia` | corpo `{ itens, frete:{cep,uf}, comprador }` → `{ init_point }` |
| POST | `/webhook` | notificação de pagamento do Mercado Pago (hoje só loga e responde 200) |

## Configuração

Pré-requisito: conta no Cloudflare e `wrangler` logado (`npx wrangler login`).

```bash
cd worker
npm install            # instala o wrangler (devDependency)

# Access Token de PRODUÇÃO do Mercado Pago (painel de desenvolvedor da conta Santino's):
npx wrangler secret put MP_ACCESS_TOKEN

# Deploy
npx wrangler deploy
```

O deploy imprime a URL pública (algo como
`https://santinos-checkout.SEU-SUBDOMINIO.workers.dev`).
Copie essa URL para `LOJA_CONFIG.workerUrl` no arquivo `loja.js` do site.

### Variáveis (já em `wrangler.toml`, ajuste se o domínio mudar)

- `SITE_URL` — base do site, usada nas `back_urls` de retorno (`/pedido.html`).
- `ALLOWED_ORIGIN` — origem liberada no CORS (igual ao `SITE_URL`).
- `NOTIFY_EMAIL` — (opcional, ainda não usado) e-mail para aviso de pedido.

### Teste local

```bash
npx wrangler dev
# em outro terminal:
curl http://localhost:8787/health
```

Para testar `/criar-preferencia` localmente, crie `worker/.dev.vars` com:

```
MP_ACCESS_TOKEN=APP_USR-...conta-de-teste-ou-producao...
```

(esse arquivo está no `.gitignore`).

## Pendências (v2)

- `/webhook`: consultar `GET /v1/payments/{id}`, checar `status === "approved"`,
  enviar e-mail de aviso e registrar o pedido (KV, D1 ou planilha).
- Trocar o frete fixo por cálculo real (Melhor Envio) — depende de peso e caixas.
- Manter `PRECOS` e `FRETE_REGIOES` em `src/index.js` **iguais** aos do `loja.js`.

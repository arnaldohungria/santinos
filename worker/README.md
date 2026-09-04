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
| POST | `/calcular-frete` | corpo `{ cep, uf, itens }` → `{ valor, rotulo }` — cotação em tempo real, chamada pelo checkout enquanto o cliente digita o CEP |
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

# Token do Melhor Envio (Configurações -> Integrações -> Gerar Token, escopo shipping-calculate):
npx wrangler secret put MELHOR_ENVIO_TOKEN

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
- `ORIGEM_CEP` — CEP de onde os pedidos saem (Itapetininga). **Confira antes do
  deploy** — está com um CEP de Itapetininga só como placeholder válido, troque
  pelo CEP real do endereço de envio.

### Teste local

```bash
npx wrangler dev
# em outro terminal:
curl http://localhost:8787/health
```

Para testar `/criar-preferencia` e `/calcular-frete` localmente, crie `worker/.dev.vars` com:

```
MP_ACCESS_TOKEN=APP_USR-...conta-de-teste-ou-producao...
MELHOR_ENVIO_TOKEN=...token do Melhor Envio...
```

(esse arquivo está no `.gitignore`).

## Como funciona o frete

1. **Itapetininga** (faixa de CEP) → grátis, sempre — sem chamar API nenhuma.
2. Fora disso → cota em tempo real no **Melhor Envio** (`/shipment/calculate`,
   rota gratuita, não gera etiqueta nem mexe em saldo) usando a caixa da tabela
   `PACOTES` (peso/dimensões por quantidade de frascos) e devolve a **opção mais
   barata** entre as transportadoras retornadas.
3. Se a chamada falhar (API fora do ar, token não configurado, CEP não
   atendido) → cai na **tabela fixa por região** (`FRETE_REGIOES`) como rede de
   segurança, marcada como "(estimado)".

`PACOTES` foi calibrado com o frasco de 60 ml cheio ≈ 150 g (arredondado pra
cima) informado pelo Arnaldo — ainda é estimativa de caixa/plástico bolha, não
pesagem real. Calibrar quando ele pesar uma caixa de verdade.

**Segurança:** o Worker só usa o escopo `shipping-calculate` do token do
Melhor Envio (cotação, sem custo). Nunca chama `shipping-generate` /
`shipping-checkout` / `shipping-cancel` — geração de etiqueta e pagamento de
frete continuam manuais, no painel do Melhor Envio.

## Pendências (v2)

- `/webhook`: consultar `GET /v1/payments/{id}`, checar `status === "approved"`,
  enviar e-mail de aviso e registrar o pedido (KV, D1 ou planilha).
- Manter `PRECOS`, `FRETE_REGIOES` e `PACOTES` em `src/index.js` **iguais**
  (preço/frete) ou coerentes (pacotes) com o `loja.js`.
- Automatizar a compra da etiqueta no Melhor Envio depois do pagamento aprovado
  (hoje é manual — fora do escopo deste Worker de propósito).

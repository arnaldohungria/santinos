# 2026-09-25 — Teste de segurança completo + correções

## Por quê
O Arnaldo vai começar a divulgar o site (tráfego pago) e pediu um teste de segurança completo antes.

## Como foi testado
Testes **não destrutivos** contra produção (nenhum pagamento; só leituras e requisições que deveriam ser recusadas) + revisão do código.
Cobertura: cabeçalhos HTTP, arquivos expostos, autenticação do painel e do proxy de frete, CORS, webhook falso, adulteração de preço/quantidade/id,
injeção (SQL/XSS), enumeração de cupom, limite de taxa, e-mail/DNS do domínio, escape no painel.
(O script usado não fica no repo; para repetir: chamar `/criar-preferencia`, `/validar-cupom`, `/webhook` e `/admin/*` como descrito abaixo.)

## O que já estava bom (confirmado)
- Preço é do servidor: campos `preco`/`unit_price`/`total` mandados pelo cliente são ignorados (pedido de R$ 19,90 ficou R$ 19,90).
- Quantidade <1, >99, texto, `1e9`, null → 400. `1.9` vira 1.
- `/admin/*` sem senha → 401 (todas as rotas); senha errada → 401 (bloqueio 8 falhas/15 min por IP, comparação em tempo constante).
- Proxy de frete sem segredo → 403; GET → 405.
- CORS só libera `https://www.santinos.com.br`.
- SQL injection em cupom: recusado (consultas parametrizadas). Nomes/endereços com `<script>`/`<img onerror>`: o painel escapa (verificado com a tag `html`).
- `.git`, `.env`, `package.json`, `docs/` → 404. HTTP→HTTPS e apex→www redirecionam. HSTS já ativo.
- Webhook falso é inofensivo: o Worker sempre reconsulta o pagamento no Mercado Pago pelo id.

## Achados e correções (este PR)
| # | Gravidade | Achado | Correção |
|---|---|---|---|
| 1 | Média | Sem limite de requisições: 60 tentativas de cupom em 0,5 s, todas respondidas (dá para adivinhar cupom; `/calcular-frete` gasta a cota do Melhor Envio) | Binding `ratelimits` no `wrangler.toml` (cupom 10/min, frete 20/min, pedido 10/min por IP) + 429 no Worker. **Precisa `wrangler deploy` (wrangler ≥ 4.36).** Sem o binding o Worker funciona, só não limita |
| 2 | Média | Site sem cabeçalhos de segurança (CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy) | `vercel.json` |
| 3 | Baixa | Pasta `worker/` (código, `wrangler.toml`, schema) era servida publicamente (200). Sem segredos, mas ajuda reconhecimento | `.vercelignore` agora também ignora `worker/` |
| 4 | Baixa | `id` de item `constructor`/`__proto__`/`toString` passava na checagem (subtotal virava NaN; o MP recusava e o cupom voltava `descontoCentavos: null`) | `PRECOS` sem protótipo (`catalogo.js`) + `PRECOS[it?.id]`; itens lixo → 400 |
| 5 | Baixa | Webhook interpolava `data.id` na URL do MP sem validar | Só aceita 1–20 dígitos |
| 6 | Baixa | `whatsapp` numérico no corpo → 500; dados do comprador sem limite de tamanho/forma | `sanearComprador()` (texto, tamanhos máximos, endereço só com chaves esperadas); máx. 20 linhas no carrinho |
| 7 | Baixa | `loja.js` colocava `rotulo`/`id` do frete e dados do Instagram (Behold) em `innerHTML` sem escape | `esc()` + `urlHttps()` |
| 8 | Baixa | `pedido.html?status=sucesso&ref=qualquer` disparava evento Purchase do Pixel sem pagamento (poluía os dados dos anúncios) | Purchase só se `ref` da URL = `ref` do pedido criado naquele navegador |

## Achados que NÃO são código (ação do Arnaldo)
- **O domínio não tem registros de e-mail** (sem MX/SPF/DKIM/DMARC). `contato@santinos.com.br` aparece no site e nas páginas legais, mas **não recebe e-mail**;
  e qualquer um pode forjar e-mails "de" @santinos.com.br. Solução: criar caixa (Zoho grátis, Google Workspace, ou encaminhamento por Cloudflare Email Routing/ImprovMX) e
  depois cadastrar SPF+DKIM+DMARC no DNS da Vercel. Até lá, trocar o e-mail exibido pelo WhatsApp.
- Confirmar que a senha do painel (`ADMIN_PASSWORD`) é longa (≥ 16 caracteres) — o bloqueio é por IP, então senha fraca ainda é o elo frágil.
- Ativar verificação em duas etapas nas contas: Vercel, GitHub, Cloudflare, Mercado Pago, Melhor Envio, Meta.

## Riscos aceitos / pendentes
- Cupom é contado só depois do webhook (`max_usos` tem uma janela de corrida mínima).
- API de Conversões do Meta ainda não existe; o Pixel de navegador pode ser poluído por quem quiser (o item 8 reduz, não elimina).
- Painel (`admin.html`) fica no mesmo domínio da loja: um XSS na loja poderia ler a sessão do painel. Mitigado por CSP + escape; se crescer, mover o painel para subdomínio.
- CSP usa `style-src 'unsafe-inline'` (há `style=` inline nas páginas) e `img-src https:` (imagens do Instagram vêm de CDNs variáveis).

## Como reverter
`git revert` do PR. O bloco `[[ratelimits]]` do `wrangler.toml` pode ser apagado sem efeito colateral.

## Deploy
Site: automático no merge (Vercel). Worker: o Arnaldo roda `git pull` → `npx wrangler deploy` (não há migração de banco nesta alteração).

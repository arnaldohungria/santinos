# 2026-09-25 — E-mail profissional no domínio (Zoho Mail grátis)

## Por quê
O teste de segurança (ver `2026-09-25-teste-de-seguranca.md`) mostrou que `santinos.com.br` não tinha nenhum registro de e-mail:
`contato@santinos.com.br` (exibido no site e nas páginas legais) não recebia nada e o domínio podia ser forjado em e-mails.

## O que foi feito (tudo fora do repositório — Zoho e DNS na Vercel; nenhum código mudou)
- Conta **Zoho Mail, plano grátis** (cadastro em `mail.zoho.com/signup?type=org&plan=free`; o plano grátis não aparece na tela normal de preços).
  Limites: até 5 usuários, 5 GB por usuário, **só webmail + app de celular (sem IMAP/POP)**, sem cartão. Região da conta: EUA.
- Usuário criado: `contato@santinos.com.br` (dono: Arnaldo).
- Registros no DNS da Vercel (Domains → santinos.com.br → DNS Records), conferidos com `nslookup` contra 8.8.8.8:

| Tipo | Nome | Valor |
|---|---|---|
| TXT | @ | `zoho-verification=zb39013625.zmverify.zoho.com` (verificação de propriedade) |
| MX | @ | `mx.zoho.com` (prioridade 10), `mx2.zoho.com` (20), `mx3.zoho.com` (50) |
| TXT | @ | `v=spf1 include:zohomail.com ~all` — **só pode existir um SPF por domínio** |
| TXT | zmail._domainkey | DKIM `v=DKIM1; k=rsa; p=...` (chave pública gerada pelo Zoho; ativado no Admin Console) |
| TXT | _dmarc | `v=DMARC1; p=none; rua=mailto:contato@santinos.com.br` |

- Teste: e-mail do Gmail para `contato@santinos.com.br` chegou; DKIM ativo.

## Como conferir / manter
- `nslookup -type=MX santinos.com.br 8.8.8.8` deve listar os 3 servidores do Zoho.
- DMARC está em `p=none` (só monitora). Depois de algumas semanas sem problemas nos relatórios, endurecer para `p=quarantine`.
- Se um dia enviar e-mail por outro serviço (ex.: aviso de pedido via Worker, newsletter), **incluir o serviço no SPF** (editar o registro existente, não criar outro) e configurar o DKIM dele.
- Nenhuma senha aqui: a conta do Zoho é do Arnaldo (ative a verificação em duas etapas).

## Como reverter
Apagar esses registros na Vercel (o e-mail para de funcionar) e a conta no Zoho.

## Pendências relacionadas
- Aviso de pedido novo por e-mail (`NOTIFY_EMAIL` do Worker, não implementado): agora existe uma caixa para receber; para o Worker enviar precisaria de um serviço de envio (ex.: Zoho SMTP ou Cloudflare Email Service) — decidir.
- Como o plano grátis não tem IMAP, não dá para ler `contato@` no Gmail/Outlook; só pelo webmail ou app do Zoho. Se incomodar: encaminhamento automático para o Gmail nas configurações do Zoho.

# 2026-09-24 — Contexto do projeto passa a viver no repositório

## Por quê
O Arnaldo trabalha em mais de um computador. Até aqui o histórico do projeto ficava só na memória das sessões do
Claude (por máquina) e na conversa — o que arrisca uma sessão ignorar mudanças feitas em outro lugar. Regras novas, definidas por ele:
sessão dedicada só a assuntos da Santino's; **ler o contexto do repositório antes de qualquer alteração**; **criar um arquivo de
contexto a cada alteração** e salvá-lo no repositório.

## O que mudou
- Nova pasta `docs/contexto/`:
  - `00-LEIA-PRIMEIRO.md` — regras de trabalho, arquitetura, onde está cada coisa, armadilhas, estado atual, pendências, histórico de PRs.
  - `historico/` — uma nota por alteração (esta é a primeira).
- `.vercelignore` com `docs/` para as notas **não** ficarem públicas no site.
- `README.md` da raiz: seção "O que ainda falta para vender de verdade" estava defasada (itens já feitos) — trocada por um apontamento
  para `docs/contexto/`.

## Como conferir
- `https://www.santinos.com.br/docs/contexto/00-LEIA-PRIMEIRO.md` deve dar 404 depois do deploy da Vercel.
- O site, checkout e painel não foram tocados.

## Como reverter
Apagar `docs/`, `.vercelignore` e restaurar o README anterior (`git revert` do PR). Nenhum efeito em produção.

## Pendências herdadas (ver 00-LEIA-PRIMEIRO.md)
Verificação de domínio no Meta (aguarda a meta-tag do Arnaldo), importação do feed do catálogo (em andamento), teste de cupom até o MP,
custos no painel.

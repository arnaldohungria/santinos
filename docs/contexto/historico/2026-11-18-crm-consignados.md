# 2026-11-18 — CRM de consignados no painel

## Por quê
O Arnaldo vai colocar os molhos em consignação no comércio de Itapetininga (expositores de MDF), e depois nas cidades
vizinhas. O comerciante **só paga o que vendeu**, a R$ 14 por frasco, e vende ao consumidor por R$ 19,90.
Ele pediu um "CRM" no painel para cadastrar os comércios e acompanhar o histórico. Combinado com ele: só ele usa,
pelo computador; **acerto a cada 30 dias**; botão para **gerar comprovante**.

## O que mudou
- **Aba nova "Consignados"** no painel (`admin/views/consignados.js`):
  - Resumo: frascos nos comércios, a receber, vendidos no mês e comércios ativos. Aviso quando um comércio passa
    de 30 dias sem acerto (contando do último acerto ou, se não houver, da primeira entrega).
  - Lista com busca e filtro por situação (ativo / pausado / encerrado): na prateleira, a receber, último acerto, giro por mês.
  - **Ficha do comércio**: dados (tipo, responsável, WhatsApp, CNPJ/CPF, endereço, preço de repasse), situação agora
    e histórico. Ações:
    - **Registrar entrega**: quantos frascos de cada sabor ficaram.
    - **Fazer acerto**: digita quanto **sobrou**; a tela mostra na hora os vendidos e o valor. Dá para registrar a
      **reposição** e o **pagamento** (Pix, dinheiro ou outro) na mesma visita.
    - **Recolher**: devolvido, quebrado, vencido ou outro.
    - **Marcar recebido / desmarcar** um acerto; **Desfazer** o último movimento; **Comprovante** de cada movimento.
  - **Comprovante** (`admin/impressao.js`, `imprimirComprovante`): cabeçalho com CNPJ e WhatsApp da Santino's, dados
    do comércio, tabela do acerto (havia / sobrou / vendidos / preço / valor), reposição, estoque que fica, regra da
    consignação e linhas de assinatura. Abre a impressão do navegador (dá para salvar em PDF).
- **Worker** (`worker/src/consignados.js`, rotas `/admin/consignados*` em `admin.js`). O estoque nunca é gravado: é
  sempre entregas − vendidos − recolhidos. O acerto calcula os vendidos no servidor e guarda o preço da época (mudar o
  preço do comércio não altera acertos antigos). Só o último movimento pode ser desfeito; comércio com histórico não se
  apaga (muda para "encerrado").
- **Banco:** tabelas `consig_pontos` e `consig_movimentos` — `worker/migrations/004_consignados.sql` (e `schema.sql`).
- Testes: `node worker/test/consignados.test.mjs` (35 verificações). Os testes antigos continuam passando.

## Como publicar (o Arnaldo roda; o merge na `main` só publica a tela)
No PowerShell, **na pasta `worker` do clone**:
```
git pull
npx wrangler d1 execute santinos-db --remote --file=./migrations/004_consignados.sql
npx wrangler deploy
```
Migração **antes** do deploy. Até o deploy, a aba mostra o aviso "rode a migração 004 e o deploy".

## Publicado
18/11/2026: migração 004 aplicada no D1 remoto (3 consultas) e Worker publicado pelo Arnaldo (versão `1205b6f9`). Conferido: `/health` 200 e `/admin/consignados` sem senha → 401.

## Como testar
Painel → Consignados → Novo comércio → Registrar entrega → Fazer acerto (preencher o que sobrou) → Comprovante.
Conferido em 18/11 com um Worker local (D1 falso): números, comprovante, pagamento, desfazer e tela de 375 px.

## Como reverter
`git revert` do PR. As tabelas novas podem ficar no banco (não atrapalham nada).

## Pendências / ideias
- Relatório de consignação na aba Relatórios (vendas por comércio/mês) e CSV.
- Lote/validade por entrega, se a regularização pedir.
- Aviso de acerto por WhatsApp (link pronto com a mensagem).

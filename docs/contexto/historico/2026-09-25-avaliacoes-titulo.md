# 2026-09-25 — Texto da seção de avaliações

## O quê
Pedido do Arnaldo (vendo a seção vazia em produção): a área de avaliações das páginas de produto passa a ter o título **"Avaliações de quem já comprou:"**.
Enquanto não há avaliação publicada, a seção mostra **só o título** (antes: texto "Ainda não há avaliações…", botão "Avaliar este produto" e nota de rodapé — removidos nesse estado).

## Detalhes
- `suave.html`, `defumado.html`, `extra-forte.html`: novo `<h2>`.
- `avaliacoes.js`: estado sem avaliações não cria mais parágrafo/botão/nota. Com avaliações publicadas, nada mudou (resumo, lista, botão "Avaliar este produto" e nota "Só quem comprou pode avaliar…").
- Sem o botão no estado vazio, o caminho para avaliar é o link enviado no WhatsApp (mensagem "pedido enviado" do painel) e o botão que aparece quando já existe alguma avaliação.
- Correção de comunicação: o Claude havia dito que a seção ficaria escondida sem avaliações; na verdade ela só fica oculta enquanto o Worker não tem a funcionalidade (antes do deploy). Com o Worker novo, a seção aparece (agora só com o título).
- Decisão registrada: **não criar avaliações/depoimentos fictícios** (publicidade enganosa — CDC art. 37; e o selo "Compra verificada" ficaria falso). Alternativas conversadas: compras reais de amigos com cupom, convite no envio, depoimentos autorizados em seção separada "Quem provou", Instagram, micro-influenciadores com #publi.

## Como reverter
`git revert` do PR.

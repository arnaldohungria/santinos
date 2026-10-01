# 2026-10-01 — Foto do card indica que abre a página do molho

## Pedido
O Arnaldo achou que só "Ver detalhes" abria a página do molho e pediu que a foto também abrisse.

## Situação encontrada
A foto **já era link** desde o PR #35 (`a.produto-art` → `suave.html` etc.), testado com clique real em produção. Ele provavelmente viu a versão
anterior da página em cache. Mas nada na foto mostrava que era clicável.

## O que mudou
- Selo **"Ver detalhes →"** sobre a foto de cada card (`span.produto-art-cta` dentro do link, `index.html`), no canto superior direito (área vazia da foto).
- Celular/touch (`hover: none`): sempre visível. Computador (`hover: hover`): aparece ao passar o mouse. Menor em telas ≤ 640 px para não encostar na tampa.
- O link "Ver detalhes" embaixo da descrição continua.

## Como reverter
`git revert` do PR.

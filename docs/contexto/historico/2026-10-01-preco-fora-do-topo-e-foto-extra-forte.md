# 2026-10-01 — Preço fora do topo e fundo da foto do Extra Forte

## Pedidos do Arnaldo (após ver o refino visual do PR #35)
1. **Não mostrar o preço no topo da home.** Removida a linha "R$ 19,90 cada · frasco de vidro de 60 ml" do hero (`index.html`) e o CSS `.hero-preco`.
   O preço continua nos cards de produto, nas páginas de produto e no carrinho. (Com isso some o risco anotado no PR #35 sobre "cada" com preços diferentes.)
2. **Fundo da foto do Extra Forte diferente das outras** ("erro meu", disse ele — a foto foi produzida com fundo cinza-amarronzado, as do Suave e Defumado são pretas
   com uma luz quente no chão). Corrigido no **próprio arquivo** `extra-forte.jpg` (vale para home, página do produto, carrinho, catálogo do Meta, prévia de link):
   - detecção do frasco (vermelho saturado ou claro) → maior região conectada → silhueta preenchida por linha + 2 px, borda suavizada;
   - tudo fora da silhueta vira preto puro, e foi acrescentada uma luz quente no chão sob o frasco, como nas outras duas fotos;
   - mesmo tamanho (1254×1254) e enquadramento. O original fica no histórico do git (commit anterior a este PR).
   - Script usado (PowerShell + C#) ficou fora do repo; se precisar repetir com outra foto, pedir ao Claude.
- Removido o `filter: brightness/contrast` que disfarçava essa foto no topo da home; `og-image.jpg` regerada com a foto nova.

## Atenção
- O catálogo do Meta (`catalogo.csv`) aponta para `extra-forte.jpg`; o Meta atualiza a imagem na próxima leitura do feed (diária).
- Se o Arnaldo trocar a foto por uma nova sessão de fotos, manter **fundo preto** para combinar com as outras.

## Como reverter
`git revert` do PR (volta a foto e a linha de preço).

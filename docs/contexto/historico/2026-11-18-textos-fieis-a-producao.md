# 2026-11-18 — Textos do site alinhados com a produção real

## Por quê
O Arnaldo explicou ao Claude como os molhos são feitos (detalhes ficam fora deste repositório, que é **público**:
é segredo da receita). Algumas frases do site não batiam com a produção e poderiam ser lidas como publicidade
enganosa (CDC art. 37), mesmo critério usado em 25/09 para não publicar avaliações fictícias:

- O Defumado **não leva Habanero Chocolate**.
- Os molhos **não passam por fermentação** (o topo da home dizia "fermentada devagar").
- O Suave **não é um blend de várias pimentas**: é um molho de pimenta temperado com condimentos.
- "Receitas originais" passou a ser **"receitas próprias"**. O "Original Recipes" do logo continua, porque faz parte da marca.

## O que mudou
- `index.html`: frase do topo (sem "fermentada devagar"); resumo do Defumado no card; "Receitas próprias" na faixa de benefícios, na citação e nos números da história.
- `defumado.html`: título, descrição (meta e Open Graph), texto "Sobre o Defumado" e ficha técnica, sem Habanero.
- `suave.html`: descrição (meta e Open Graph), texto e ficha técnica, sem "blend de pimentas".
- `catalogo.csv` (catálogo do Meta): descrições do Suave e do Defumado. O Meta atualiza na próxima leitura diária do feed.
- O Extra Forte não mudou: ele leva Carolina Reaper de verdade.

Fora do repositório, no mesmo dia: o portfólio impresso para os comércios (A5, modelo "Noite") recebeu as mesmas correções.

## Regra daqui em diante
Texto de produto só com o que a receita tem de fato. **Antes de citar pimenta, processo (fermentação, defumação em
lenha etc.) ou ingrediente, confirmar com o Arnaldo.**

## Pendências
- **Rótulos (Canva):** lista de ingredientes completa e sódio recalculado. O sódio do rótulo atual (120 mg por 10 ml)
  está bem abaixo do valor calculado a partir dos ingredientes (~285 a 335 mg). A forma de declarar o ingrediente
  de defumação ainda está em decisão com o Arnaldo.
- Fotos de produto: o rótulo que aparece nas fotos (branco, com letras deformadas e "50ml" no Suave) não é o rótulo real (bege).

## Como conferir
Abrir a home, `defumado.html` e `suave.html`: não pode aparecer "Habanero", "fermentada" nem "blend de pimentas".

## Como reverter
`git revert` do PR.

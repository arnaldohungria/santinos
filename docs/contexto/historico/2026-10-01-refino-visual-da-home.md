# 2026-10-01 — Refino visual da home (+ correção do Pixel na CSP)

## Por quê
Pedido do Arnaldo: "a funcionalidade está boa, veja se consegue melhorar a parte estética". O tráfego pago (Meta) cai quase todo no celular,
e a primeira tela do celular não mostrava nenhum molho — só texto.

## O que mudou
- **Topo (hero):** duas colunas no desktop — texto à esquerda, os três frascos à direita (as próprias fotos `suave.jpg`, `defumado.jpg`, `extra-forte.jpg`
  recortadas em retrato). No celular os frascos aparecem logo abaixo do botão, ainda na primeira tela. Linha nova "R$ 19,90 cada · frasco de vidro de 60 ml"
  (o preço vem de `data-preco-de="suave"`, preenchido pelo `loja.js`).
  - Truque técnico: as fotos têm fundo escuro; o link de cada frasco usa `mix-blend-mode: lighten`, e o `.hero` **precisa** ter `background` próprio
    (com `isolation: isolate`, sem fundo próprio a mesclagem não tem com o que se fundir e aparecem retângulos pretos). A foto do Extra Forte tem fundo mais claro e leva `filter: brightness/contrast`.
- **Faixa de benefícios** logo abaixo do topo (fatos verdadeiros já existentes no sistema): envio para todo o Brasil; grátis em Itapetininga-SP em até 48h;
  Pix/cartão/boleto pelo Mercado Pago; receitas originais / frasco de vidro de 60 ml.
- **Nossa história:** primeiro parágrafo em destaque, frase final virou citação, logo levemente inclinado + três números (2021 / 3 receitas / 60 ml).
  Texto mantido, só com correção de digitação: "até **os** paladares", "equil**í**brio", "gastron**ô**mica".
- **Produtos:** foto ocupa o topo do card, nome e foto viram link para a página do produto, preço e botão alinhados entre os três cards,
  marcador "Ardência ··· Leve/Moderada/Extra Forte" (também nas páginas de produto). Subtítulo "Mesmo preço, ardências diferentes — escolha a sua."
- **Instagram:** botão "Seguir" no cabeçalho da seção. **Contato:** caixa com WhatsApp em destaque, e-mail e Instagram.
- **Global (`style.css`):** títulos com `line-height: 1.05` e `text-wrap: balance` (antes herdavam 1.6 e ficavam com vão enorme entre linhas);
  margem lateral de 20 px no celular; rótulo das seções "Nossa história"/"Contato" volta à cor brasa (estava cinza e grande por causa de regra de `<p>`).
- **Entrada suave das seções** ao rolar (`script.js`, classe `.revelar`): só com JS e sem "reduzir movimento" no aparelho; sem JS tudo aparece.
- **Prévia de link (Open Graph):** `og-image.jpg` (1200×630, gerada em Chrome headless a partir de um HTML temporário que não ficou no repo) na home;
  páginas de produto usam a foto do produto. Também `theme-color` (barra do navegador no celular na cor do site).
- **Correção (não estética) — CSP x Meta Pixel:** a CSP do PR #26 bloqueava os envios do Pixel feitos por formulário + iframe para `www.facebook.com`
  (`form-action 'self'` e `frame-src 'none'`). Agora: `form-action 'self' https://www.facebook.com` e `frame-src https://www.facebook.com`.
  `frame-ancestors 'none'` continua (ninguém consegue embutir o site). Pode ter havido perda de parte dos eventos do Pixel entre 25/09 e esta data.

## Como conferir
- Celular (375 px): primeira tela mostra título, botão e os três frascos; nenhuma página estoura a largura (conferido em home, produtos, checkout, pedido, avaliar, termos).
- Carrinho continua funcionando (testado: "Adicionar" no card abre a gaveta com o item).
- Prévia de link: colar `https://www.santinos.com.br` numa conversa do WhatsApp (o WhatsApp guarda cache; link já compartilhado antes pode demorar a mostrar a imagem).
  O Facebook tem o "Depurador de compartilhamento" para forçar a atualização.

## Riscos / pendências
- O texto "R$ 19,90 cada" pressupõe os três molhos com o mesmo preço. **Se um dia os preços forem diferentes, trocar por "a partir de"** (o valor vem do Suave).
- A faixa de benefícios repete regras do sistema (entrega grátis só em Itapetininga, em até 48h). Se a regra mudar no Worker, atualizar o texto em `index.html`.
- Painel (`admin.html`) não foi tocado (usa `admin/admin.css`).

## Como reverter
`git revert` do PR.

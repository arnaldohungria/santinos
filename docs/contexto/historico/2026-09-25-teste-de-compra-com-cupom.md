# 2026-09-25 — Teste de compra real com cupom confirmado

## O quê
O Arnaldo fez uma compra de teste com um amigo (Eurico), com pagamento real e **cupom de desconto**. Resultado informado por ele:
o Mercado Pago aceitou o desconto e cobrou o valor com desconto, e o pedido apareceu no painel corretamente.

## O que isso confirma
- O desconto de cupom enviado ao Mercado Pago como item de valor **negativo** funciona (pelo menos com o cupom testado). O fallback (item único já descontado)
  continua no código como rede de segurança, mas não foi necessário nesse teste.
- Fluxo completo validado ponta a ponta: carrinho → frete → cupom → Mercado Pago → webhook → pedido no painel.

## Mudança de estado
- Pendência "testar pedido com cupom até a tela do Mercado Pago" **concluída** (removida do 00-LEIA-PRIMEIRO).
- Nenhum código alterado.

## Ainda por validar no mundo real
- Despacho de ponta a ponta: comprar a etiqueta no Melhor Envio, embalar, postar e lançar o rastreio no painel.
- Medidas e peso reais da caixa montada (para calibrar `PACOTES` em `worker/src/index.js`).
- Se o pedido de teste foi enviado ou estornado (dinheiro real no Mercado Pago do Arnaldo).

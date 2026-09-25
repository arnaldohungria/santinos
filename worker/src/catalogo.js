// Preços em CENTAVOS. Manter IGUAL ao loja.js. Preço atual: R$ 19,90 (2026-08).
// É a CÓPIA-VERDADE: o site (loja.js) tem os mesmos números só pra exibir; aqui
// é o que efetivamente cobra. O painel de admin também lê os nomes daqui.
// Sem protótipo de propósito: PRECOS["constructor"] / ["__proto__"] devolvem undefined
// (com objeto comum devolveriam funções/objetos e o subtotal virava NaN).
export const PRECOS = Object.assign(Object.create(null), {
  "suave":       { nome: "Santino's Suave",       preco: 1990 },
  "defumado":    { nome: "Santino's Defumado",    preco: 1990 },
  "extra-forte": { nome: "Santino's Extra Forte", preco: 1990 },
});

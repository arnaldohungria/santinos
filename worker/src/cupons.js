import { hojeBrasilia } from "./util.js";

const STATUS_QUE_NAO_CONTAM = "('rejected','cancelled','refunded','charged_back')";

function brl(centavos) {
  return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Confere um código de cupom contra a tabela D1 "cupons" e calcula o desconto
// (em CENTAVOS) pro subtotal informado. Devolve:
//   { ok: true, codigo, tipo, valor, descontoCentavos }
//   { ok: false, motivo }   (motivo já vem em texto pro cliente ler)
// Regras: precisa existir e estar ativo; respeita validade (expira_em, vale
// até o fim do dia em Brasília), limite de usos (max_usos, conta pedidos que
// não foram recusados/cancelados/estornados) e pedido mínimo. Nunca deixa o
// desconto passar do subtotal (não gera valor negativo).
export async function validarCupom(env, codigoBruto, subtotal) {
  const codigo = String(codigoBruto || "").trim().toUpperCase();
  if (!codigo || !env.DB) return { ok: false, motivo: "Cupom inválido." };

  const c = await env.DB.prepare(
    "SELECT tipo, valor, ativo, expira_em, max_usos, min_subtotal_centavos FROM cupons WHERE codigo = ?1"
  )
    .bind(codigo)
    .first();
  if (!c || !c.ativo) return { ok: false, motivo: "Cupom inválido." };

  if (c.expira_em && hojeBrasilia() > c.expira_em) {
    return { ok: false, motivo: "Este cupom expirou." };
  }
  if (c.min_subtotal_centavos && subtotal < c.min_subtotal_centavos) {
    return { ok: false, motivo: `Este cupom vale para pedidos a partir de ${brl(c.min_subtotal_centavos)}.` };
  }
  if (c.max_usos) {
    const uso = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM pedidos WHERE cupom = ?1 AND status NOT IN ${STATUS_QUE_NAO_CONTAM}`
    )
      .bind(codigo)
      .first();
    if (uso && uso.n >= c.max_usos) return { ok: false, motivo: "Este cupom atingiu o limite de usos." };
  }

  const bruto = c.tipo === "percentual" ? Math.round((subtotal * c.valor) / 100) : c.valor;
  const descontoCentavos = Math.max(0, Math.min(bruto, subtotal));
  return { ok: true, codigo, tipo: c.tipo, valor: c.valor, descontoCentavos };
}

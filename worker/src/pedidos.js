import { normalizarData } from "./util.js";

function numOuNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function emCentavos(v) {
  const n = numOuNull(v);
  return n === null ? null : Math.round(n * 100);
}

function textoOuNull(v, max = 200) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

// Quando o pagamento tem mais de uma tentativa pro mesmo pedido (ex: cartão
// recusado e depois Pix aprovado), a mesma linha em "pedidos" só troca de
// pagamento se a nova tentativa for a MESMA, ou for aprovada, ou for mais
// recente do que a que já está gravada E a gravada ainda não estiver
// aprovada. Assim um aviso atrasado de uma tentativa antiga nunca "rebaixa"
// um pedido que já foi pago.
const ACEITAR =
  "(pedidos.mp_payment_id = excluded.mp_payment_id" +
  " OR excluded.status = 'approved'" +
  " OR (pedidos.status <> 'approved'" +
  "     AND COALESCE(excluded.pagamento_criado_em, '') >= COALESCE(pedidos.pagamento_criado_em, '')))";

const DO_PAGAMENTO = (col) => `${col} = CASE WHEN ${ACEITAR} THEN excluded.${col} ELSE pedidos.${col} END`;
const DO_DADO = (col) => `${col} = COALESCE(excluded.${col}, pedidos.${col})`;

const SQL_UPSERT = `
INSERT INTO pedidos (
  external_reference, mp_payment_id, pagamento_criado_em, status, status_detail,
  nome, email, whatsapp, cpf, cep, endereco_json, itens_json,
  subtotal_centavos, frete_centavos, frete_rotulo, desconto_centavos, cupom,
  total_centavos, liquido_centavos, taxa_centavos,
  metodo_pagamento, tipo_pagamento, parcelas, pago_em,
  criado_em, atualizado_em
) VALUES (
  ?1, ?2, ?3, ?4, ?5,
  ?6, ?7, ?8, ?9, ?10, ?11, ?12,
  ?13, ?14, ?15, ?16, ?17,
  ?18, ?19, ?20,
  ?21, ?22, ?23, ?24,
  ?25, ?26
)
ON CONFLICT(external_reference) DO UPDATE SET
  ${["mp_payment_id", "pagamento_criado_em", "status", "status_detail", "total_centavos", "liquido_centavos",
     "taxa_centavos", "metodo_pagamento", "tipo_pagamento", "parcelas", "pago_em"].map(DO_PAGAMENTO).join(",\n  ")},
  ${["nome", "email", "whatsapp", "cpf", "cep", "endereco_json", "itens_json", "subtotal_centavos",
     "frete_centavos", "frete_rotulo", "desconto_centavos", "cupom"].map(DO_DADO).join(",\n  ")},
  criado_em = MIN(pedidos.criado_em, excluded.criado_em),
  atualizado_em = excluded.atualizado_em
`;

// Monta o statement (ainda não executado) que grava/atualiza um pedido a
// partir do objeto de pagamento que a API do Mercado Pago devolve. Os dados
// do cliente/pedido vêm do `metadata` que criarPreferencia manda pro MP; os
// dados financeiros (taxas, líquido, método) vêm do próprio pagamento.
export function statementSalvarPedido(env, pg) {
  const m = pg.metadata || {};
  const agora = new Date().toISOString();

  let endereco = m.endereco;
  if (typeof endereco === "string") {
    try { endereco = JSON.parse(endereco); } catch { endereco = null; }
  }
  const itens = Array.isArray(m.itens)
    ? m.itens
        .map((i) => ({ id: textoOuNull(i && i.id, 40), qtd: Math.floor(numOuNull(i && i.qtd) || 0) }))
        .filter((i) => i.id && i.qtd > 0)
    : null;

  const taxas = Array.isArray(pg.fee_details)
    ? pg.fee_details.filter((f) => f && f.fee_payer !== "payer").reduce((s, f) => s + (numOuNull(f.amount) || 0), 0)
    : null;

  const criadoPg = normalizarData(pg.date_created);

  return env.DB.prepare(SQL_UPSERT).bind(
    pg.external_reference || `mp-${pg.id}`,
    String(pg.id || ""),
    criadoPg,
    pg.status || "desconhecido",
    textoOuNull(pg.status_detail, 80),
    textoOuNull(m.nome, 120),
    textoOuNull(m.email || (pg.payer && pg.payer.email), 120),
    textoOuNull(m.whatsapp, 30),
    textoOuNull(m.cpf, 20),
    textoOuNull(m.cep, 12),
    endereco && typeof endereco === "object" ? JSON.stringify(endereco) : null,
    itens && itens.length ? JSON.stringify(itens) : null,
    numOuNull(m.subtotal_centavos),
    numOuNull(m.frete_centavos),
    textoOuNull(m.frete_rotulo, 120),
    numOuNull(m.desconto_centavos),
    textoOuNull(m.cupom, 40),
    emCentavos(pg.transaction_amount),
    emCentavos(pg.transaction_details && pg.transaction_details.net_received_amount),
    taxas === null ? null : Math.round(taxas * 100),
    textoOuNull(pg.payment_method_id, 40),
    textoOuNull(pg.payment_type_id, 40),
    numOuNull(pg.installments),
    normalizarData(pg.date_approved),
    criadoPg || agora,
    agora
  );
}

export async function salvarPedido(env, pg) {
  if (!env.DB) return;
  await statementSalvarPedido(env, pg).run();
}

// Puxa uma "página" de pagamentos recentes direto do Mercado Pago e grava
// todos os que são pedidos da loja (external_reference começando com "SNT-";
// a conta do MP pode ter pagamentos de outros projetos, que ficam de fora).
// Serve pra recuperar pedidos que o webhook perdeu e pra preencher dados novos
// em pedidos antigos. Devolve `proximo` (offset da próxima página) ou null.
const PAGINA_SYNC = 30;

export async function sincronizarPagamentos(env, { dias, offset }) {
  const d = Math.min(Math.max(Math.floor(Number(dias) || 30), 1), 365);
  const off = Math.max(Math.floor(Number(offset) || 0), 0);

  const url = new URL("https://api.mercadopago.com/v1/payments/search");
  url.searchParams.set("sort", "date_created");
  url.searchParams.set("criteria", "desc");
  url.searchParams.set("range", "date_created");
  url.searchParams.set("begin_date", `NOW-${d}DAYS`);
  url.searchParams.set("end_date", "NOW");
  url.searchParams.set("limit", String(PAGINA_SYNC));
  url.searchParams.set("offset", String(off));

  const r = await fetch(url, { headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` } });
  if (!r.ok) {
    const corpo = await r.text().catch(() => "");
    throw new Error(`Mercado Pago respondeu ${r.status}: ${corpo.slice(0, 200)}`);
  }
  const data = await r.json();
  const todos = Array.isArray(data.results) ? data.results : [];
  const nossos = todos
    .filter((p) => typeof p.external_reference === "string" && p.external_reference.startsWith("SNT-"))
    .sort((a, b) => String(a.date_created).localeCompare(String(b.date_created)));

  if (nossos.length) await env.DB.batch(nossos.map((p) => statementSalvarPedido(env, p)));

  const total = numOuNull(data.paging && data.paging.total) ?? todos.length;
  return {
    processados: nossos.length,
    ignorados: todos.length - nossos.length,
    total,
    proximo: off + PAGINA_SYNC < total ? off + PAGINA_SYNC : null,
  };
}

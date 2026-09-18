/* Painel Santino's — regras de negócio e agregações sobre os pedidos.
 * Tudo aqui é função pura sobre a lista de pedidos (sem DOM, sem rede).
 */
import { diaBRT, horaBRT, dowDe, addDias, diffDias, listaDias, primeiroDiaDoMes, ultimoDiaDoMes } from "./util.js";

/* ---------------- rótulos ---------------- */

// Status do pagamento (Mercado Pago). Cores de status são reservadas: sempre
// vão com ícone + texto, nunca só a cor.
export const PGTO = {
  approved: { rot: "Pago", cls: "ok", ic: "check" },
  authorized: { rot: "Autorizado", cls: "warn", ic: "clock" },
  pending: { rot: "Aguardando", cls: "warn", ic: "clock" },
  in_process: { rot: "Em análise", cls: "warn", ic: "clock" },
  in_mediation: { rot: "Em disputa", cls: "grave", ic: "alert" },
  rejected: { rot: "Recusado", cls: "bad", ic: "xcircle" },
  cancelled: { rot: "Cancelado", cls: "bad", ic: "xcircle" },
  refunded: { rot: "Reembolsado", cls: "grave", ic: "undo" },
  charged_back: { rot: "Chargeback", cls: "bad", ic: "alert" },
};
export const pgtoInfo = (s) => PGTO[s] || { rot: s || "—", cls: "neutro", ic: "clock" };

export const ENVIO = {
  novo: { rot: "A enviar", cls: "warn", ic: "box" },
  separado: { rot: "Separado", cls: "neutro", ic: "box" },
  enviado: { rot: "Enviado", cls: "neutro-forte", ic: "truck" },
  entregue: { rot: "Entregue", cls: "ok", ic: "check" },
};

const DETALHE = {
  accredited: "Pagamento aprovado",
  pending_waiting_payment: "Aguardando o cliente pagar (Pix/boleto)",
  pending_waiting_transfer: "Aguardando a transferência do Pix",
  pending_contingency: "Em processamento",
  pending_review_manual: "Em revisão manual do Mercado Pago",
  expired: "Expirou sem pagamento",
  cc_rejected_insufficient_amount: "Cartão sem limite/saldo",
  cc_rejected_bad_filled_card_number: "Número do cartão incorreto",
  cc_rejected_bad_filled_date: "Validade do cartão incorreta",
  cc_rejected_bad_filled_security_code: "Código de segurança incorreto",
  cc_rejected_bad_filled_other: "Dados do cartão incorretos",
  cc_rejected_high_risk: "Recusado por segurança (antifraude)",
  cc_rejected_call_for_authorize: "Banco pediu autorização do cliente",
  cc_rejected_card_disabled: "Cartão desabilitado",
  cc_rejected_duplicated_payment: "Pagamento duplicado",
  cc_rejected_max_attempts: "Muitas tentativas com o cartão",
  cc_rejected_other_reason: "Recusado pelo banco emissor",
  by_collector: "Cancelado pelo vendedor",
  by_payer: "Cancelado pelo cliente",
  refunded: "Reembolsado",
  bpmpg_activity: "Reembolsado",
  partially_refunded: "Reembolso parcial",
};
export const detalheStatus = (d) => (d ? DETALHE[d] || d : "");

export function nomeMetodo(p) {
  const t = p.tipo_pagamento, m = p.metodo_pagamento;
  if (t === "bank_transfer" || m === "pix") return "Pix";
  if (t === "credit_card") return "Cartão de crédito";
  if (t === "debit_card") return "Cartão de débito";
  if (t === "ticket") return "Boleto";
  if (t === "account_money") return "Saldo Mercado Pago";
  return t || "—";
}
const BANDEIRAS = { visa: "Visa", master: "Mastercard", elo: "Elo", amex: "Amex", hipercard: "Hipercard", debvisa: "Visa", debmaster: "Mastercard", debelo: "Elo" };
export function detalheMetodo(p) {
  const partes = [nomeMetodo(p)];
  if ((p.tipo_pagamento === "credit_card" || p.tipo_pagamento === "debit_card") && p.metodo_pagamento) {
    partes.push(BANDEIRAS[p.metodo_pagamento] || p.metodo_pagamento);
  }
  if (p.tipo_pagamento === "credit_card" && p.parcelas > 1) partes.push(`${p.parcelas}x`);
  return partes.join(" · ");
}

/* ---------------- enriquecimento ---------------- */

const semAcento = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const normalizar = semAcento;
const soDigitos = (s) => String(s || "").replace(/\D/g, "");

function chaveCliente(p) {
  const cpf = soDigitos(p.cpf);
  if (cpf.length === 11) return `cpf:${cpf}`;
  if (p.email) return `email:${String(p.email).toLowerCase()}`;
  const tel = soDigitos(p.whatsapp);
  if (tel) return `tel:${tel}`;
  return `ref:${p.external_reference}`;
}

export function temCustos(config) {
  return Object.entries(config || {}).some(([k, v]) => k.startsWith("custo_") && v > 0);
}

// Acrescenta campos derivados (prefixo "_") a cada pedido. Chamar de novo
// sempre que os pedidos OU as configurações de custo mudarem.
export function preparar(pedidos, config = {}) {
  for (const p of pedidos) {
    const e = p.endereco && typeof p.endereco === "object" ? p.endereco : {};
    const itens = Array.isArray(p.itens) ? p.itens : [];
    p._pago = p.status === "approved";
    const quando = p._pago && p.pago_em ? p.pago_em : p.criado_em;
    p._data = diaBRT(quando);
    p._hora = horaBRT(quando);
    p._dow = dowDe(p._data);
    p._uf = String(e.uf || "").toUpperCase() || "—";
    p._cidade = e.cidade || "—";
    p._itens = itens;
    p._qtd = itens.reduce((s, i) => s + (i.qtd || 0), 0);
    p._total = p.total_centavos || 0;
    p._frete = p.frete_centavos || 0;
    p._desconto = p.desconto_centavos || 0;
    p._subtotal = p.subtotal_centavos ?? Math.max(0, p._total - p._frete + p._desconto);
    p._taxa = p.taxa_centavos || 0;
    p._liquido = p.liquido_centavos || Math.max(0, p._total - p._taxa);
    const custoProdutos = itens.reduce((s, i) => s + (config[`custo_${i.id}`] || 0) * (i.qtd || 0), 0);
    p._custo = custoProdutos + (config.custo_embalagem || 0);
    p._lucro = p._subtotal - p._desconto - p._custo - p._taxa;
    p._cliente = chaveCliente(p);
    p._busca = semAcento(
      [p.external_reference, p.nome, p.email, p.cpf, p.whatsapp, p.cupom, p.rastreio, p.mp_payment_id, e.cidade, e.bairro, e.logradouro, p.cep].join(" ")
    );
    p._digitos = soDigitos([p.cpf, p.whatsapp, p.cep].join(" "));
  }
  return pedidos;
}

/* ---------------- períodos ---------------- */

export const PRESETS = [
  ["hoje", "Hoje"], ["ontem", "Ontem"], ["7d", "7 dias"], ["30d", "30 dias"], ["90d", "90 dias"],
  ["mes", "Este mês"], ["mesAnt", "Mês passado"], ["tudo", "Tudo"],
];

export function resolverPeriodo(tipo, hoje, custom, menorData) {
  switch (tipo) {
    case "hoje": return { tipo, de: hoje, ate: hoje, rotulo: "Hoje" };
    case "ontem": { const d = addDias(hoje, -1); return { tipo, de: d, ate: d, rotulo: "Ontem" }; }
    case "7d": return { tipo, de: addDias(hoje, -6), ate: hoje, rotulo: "Últimos 7 dias" };
    case "30d": return { tipo, de: addDias(hoje, -29), ate: hoje, rotulo: "Últimos 30 dias" };
    case "90d": return { tipo, de: addDias(hoje, -89), ate: hoje, rotulo: "Últimos 90 dias" };
    case "mes": return { tipo, de: primeiroDiaDoMes(hoje), ate: hoje, rotulo: "Este mês" };
    case "mesAnt": {
      const fim = addDias(primeiroDiaDoMes(hoje), -1);
      return { tipo, de: primeiroDiaDoMes(fim), ate: fim, rotulo: "Mês passado" };
    }
    case "tudo": return { tipo, de: menorData || hoje, ate: hoje, rotulo: "Todo o período" };
    default: {
      const de = (custom && custom.de) || addDias(hoje, -29);
      const ate = (custom && custom.ate) || hoje;
      return { tipo: "custom", de: de <= ate ? de : ate, ate: de <= ate ? ate : de, rotulo: "Período personalizado" };
    }
  }
}

// Período imediatamente anterior, do mesmo tamanho (ou o mês anterior, pra "Este mês").
export function periodoAnterior(p) {
  if (p.tipo === "tudo") return null;
  if (p.tipo === "mes") {
    const fimAnt = addDias(p.de, -1);
    const deAnt = primeiroDiaDoMes(fimAnt);
    const n = diffDias(p.de, p.ate);
    const ateAnt = addDias(deAnt, n);
    return { de: deAnt, ate: ateAnt <= fimAnt ? ateAnt : fimAnt };
  }
  if (p.tipo === "mesAnt") {
    const fimAnt = addDias(p.de, -1);
    return { de: primeiroDiaDoMes(fimAnt), ate: fimAnt };
  }
  const n = diffDias(p.de, p.ate) + 1;
  return { de: addDias(p.de, -n), ate: addDias(p.de, -1) };
}

export const noPeriodo = (lista, de, ate) => lista.filter((p) => p._data >= de && p._data <= ate);

/* ---------------- agregações ---------------- */

const PENDENTES = new Set(["pending", "in_process", "authorized"]);

export function resumir(lista) {
  const r = {
    pedidos: 0, receita: 0, subtotal: 0, desconto: 0, frete: 0, taxa: 0, liquido: 0, itens: 0, custo: 0, lucro: 0,
    pendentes: 0, pendentesValor: 0, recusados: 0, reembolsados: 0, reembolsadosValor: 0, comCupom: 0,
    total: lista.length,
  };
  for (const p of lista) {
    if (p._pago) {
      r.pedidos++; r.receita += p._total; r.subtotal += p._subtotal; r.desconto += p._desconto; r.frete += p._frete;
      r.taxa += p._taxa; r.liquido += p._liquido; r.itens += p._qtd; r.custo += p._custo; r.lucro += p._lucro;
      if (p.cupom) r.comCupom++;
    } else if (PENDENTES.has(p.status)) { r.pendentes++; r.pendentesValor += p._total; }
    else if (p.status === "refunded" || p.status === "charged_back") { r.reembolsados++; r.reembolsadosValor += p._total; }
    else r.recusados++;
  }
  r.ticket = r.pedidos ? r.receita / r.pedidos : 0;
  const base = r.subtotal - r.desconto;
  r.margem = base > 0 ? r.lucro / base : 0;
  return r;
}

export function delta(atual, anterior) {
  if (!anterior) return atual ? { novo: true } : null;
  return { pct: (atual - anterior) / anterior };
}

export function serieDiaria(lista, de, ate) {
  const mapa = new Map(listaDias(de, ate).map((d) => [d, { dia: d, receita: 0, pedidos: 0, itens: 0, desconto: 0, frete: 0, taxa: 0, liquido: 0 }]));
  for (const p of lista) {
    if (!p._pago) continue;
    const x = mapa.get(p._data);
    if (!x) continue;
    x.receita += p._total; x.pedidos++; x.itens += p._qtd; x.desconto += p._desconto; x.frete += p._frete; x.taxa += p._taxa; x.liquido += p._liquido;
  }
  return [...mapa.values()];
}

export function porProduto(lista, produtos) {
  const m = {};
  for (const p of lista) {
    if (!p._pago) continue;
    for (const i of p._itens) {
      const x = (m[i.id] ||= { id: i.id, nome: (produtos[i.id] && produtos[i.id].nome) || i.id, qtd: 0, receita: 0, pedidos: 0 });
      x.qtd += i.qtd || 0;
      x.receita += (i.qtd || 0) * ((produtos[i.id] && produtos[i.id].preco) || 0);
      x.pedidos++;
    }
  }
  return Object.values(m).sort((a, b) => b.qtd - a.qtd);
}

function agruparPor(lista, chaveFn) {
  const m = new Map();
  for (const p of lista) {
    if (!p._pago) continue;
    const k = chaveFn(p);
    const x = m.get(k) || { chave: k, pedidos: 0, receita: 0, itens: 0 };
    x.pedidos++; x.receita += p._total; x.itens += p._qtd;
    m.set(k, x);
  }
  return [...m.values()].sort((a, b) => b.receita - a.receita);
}
export const porUF = (lista) => agruparPor(lista, (p) => p._uf);
export const porCidade = (lista) => agruparPor(lista, (p) => `${p._cidade}|${p._uf}`);
export const porMetodo = (lista) => agruparPor(lista, nomeMetodo);
export function porDiaSemana(lista) {
  const v = Array.from({ length: 7 }, () => ({ pedidos: 0, receita: 0 }));
  for (const p of lista) if (p._pago) { v[p._dow].pedidos++; v[p._dow].receita += p._total; }
  return v;
}
export function porHora(lista) {
  const v = Array.from({ length: 24 }, () => ({ pedidos: 0, receita: 0 }));
  for (const p of lista) if (p._pago) { v[p._hora].pedidos++; v[p._hora].receita += p._total; }
  return v;
}
export function porCupom(lista) {
  const m = new Map();
  for (const p of lista) {
    if (!p._pago || !p.cupom) continue;
    const x = m.get(p.cupom) || { cupom: p.cupom, pedidos: 0, desconto: 0, receita: 0 };
    x.pedidos++; x.desconto += p._desconto; x.receita += p._total;
    m.set(p.cupom, x);
  }
  return [...m.values()].sort((a, b) => b.pedidos - a.pedidos);
}

/* ---------------- clientes ---------------- */

export const LIMITE_VIP_CENTAVOS = 20000;

export function agruparClientes(pedidos) {
  const m = new Map();
  for (const p of pedidos) {
    let c = m.get(p._cliente);
    if (!c) {
      c = { key: p._cliente, nome: p.nome, email: p.email, whatsapp: p.whatsapp, cpf: p.cpf, cidade: p._cidade, uf: p._uf, pedidos: [], pagos: 0, gasto: 0, primeiro: null, ultimo: null };
      m.set(p._cliente, c);
    }
    c.pedidos.push(p);
    if (p._pago) {
      c.pagos++; c.gasto += p._total;
      if (!c.primeiro || p._data < c.primeiro) c.primeiro = p._data;
      if (!c.ultimo || p._data > c.ultimo) c.ultimo = p._data;
      c.ultimoIso = !c.ultimoIso || (p.pago_em || p.criado_em) > c.ultimoIso ? p.pago_em || p.criado_em : c.ultimoIso;
    }
  }
  const lista = [...m.values()];
  for (const c of lista) {
    c.ticket = c.pagos ? c.gasto / c.pagos : 0;
    c.vip = c.gasto >= LIMITE_VIP_CENTAVOS || c.pagos >= 3;
    c.recorrente = c.pagos >= 2;
  }
  return lista.sort((a, b) => b.gasto - a.gasto);
}

/* ---------------- cupom: situação ---------------- */

export function situacaoCupom(c, hoje) {
  if (!c.ativo) return { cls: "neutro", rot: "Desativado" };
  if (c.expira_em && c.expira_em < hoje) return { cls: "bad", rot: "Expirado" };
  if (c.max_usos && c.usos >= c.max_usos) return { cls: "grave", rot: "Esgotado" };
  return { cls: "ok", rot: "Ativo" };
}

/* ---------------- endereço ---------------- */

export function enderecoLinhas(p) {
  const e = p.endereco && typeof p.endereco === "object" ? p.endereco : null;
  if (!e) return [];
  const rua = [e.logradouro, e.numero].filter(Boolean).join(", ");
  return [
    [rua, e.complemento].filter(Boolean).join(" — "),
    e.bairro,
    [e.cidade, e.uf].filter(Boolean).join(" / "),
  ].filter(Boolean);
}

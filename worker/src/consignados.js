// Consignação: comércios que vendem os molhos na prateleira e só pagam o que venderam.
//
// Regras (definidas pelo Arnaldo em 2026-11-18):
//   - Só ele usa (painel, Basic Auth). Acerto a cada 30 dias (o aviso de atraso fica no painel).
//   - ENTREGA: frascos deixados no comércio. ACERTO: ele conta o que SOBROU; o Worker calcula
//     vendidos = estoque atual − sobra e o valor (vendidos × preço de repasse do comércio).
//     RECOLHIMENTO: frascos retirados (devolvidos, quebrados, vencidos).
//   - O estoque de cada comércio nunca é gravado: é sempre a soma dos movimentos.
//   - Só o ÚLTIMO movimento de um comércio pode ser desfeito (os anteriores entram na conta dos seguintes).
//
// Os textos (nome, endereço, observações) são digitados pelo próprio Arnaldo, mas mesmo assim são
// limitados aqui e escapados no painel (tag `html`).

import { PRECOS } from "./catalogo.js";
import { hojeBrasilia } from "./util.js";

const PRODUTOS = Object.keys(PRECOS);
const STATUS_PONTO = ["ativo", "pausado", "encerrado"];
const FORMAS = ["pix", "dinheiro", "outro"];
const MOTIVOS = ["devolvido", "quebrado", "vencido", "outro"];
const MAX_QTD = 10000;
const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;

const r = (status, corpo) => ({ status, corpo });

function texto(v, max) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, " ").trim();
  return s ? s.slice(0, max) : null;
}

function parseJson(t, padrao) {
  if (!t) return padrao;
  try {
    return JSON.parse(t);
  } catch {
    return padrao;
  }
}

// {"suave": 3, ...} → só produtos conhecidos, inteiros de 0 a MAX_QTD; null se algum valor for inválido.
function lerItens(obj) {
  const out = {};
  if (obj === null || obj === undefined) return out;
  if (typeof obj !== "object" || Array.isArray(obj)) return null;
  for (const [id, v] of Object.entries(obj)) {
    if (!PRODUTOS.includes(id)) return null;
    if (v === "" || v === null || v === undefined) continue;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > MAX_QTD) return null;
    if (n > 0) out[id] = n;
  }
  return out;
}

const total = (itens) => Object.values(itens).reduce((s, n) => s + n, 0);

function dataValida(v) {
  const d = texto(v, 10) || hojeBrasilia();
  if (!RE_DATA.test(d) || Number.isNaN(Date.parse(d + "T12:00:00Z"))) return null;
  if (d > hojeBrasilia()) return null; // sem data no futuro
  return d;
}

async function lerPonto(env, id) {
  return env.DB.prepare("SELECT * FROM consig_pontos WHERE id = ?1").bind(id).first();
}

// Estoque atual de um comércio: entregas − vendidos − recolhidos, por produto.
async function estoque(env, pontoId) {
  const { results } = await env.DB.prepare("SELECT tipo, itens_json FROM consig_movimentos WHERE ponto_id = ?1")
    .bind(pontoId)
    .all();
  const e = Object.fromEntries(PRODUTOS.map((id) => [id, 0]));
  for (const m of results) {
    const sinal = m.tipo === "entrega" ? 1 : -1;
    for (const [id, n] of Object.entries(parseJson(m.itens_json, {}))) if (id in e) e[id] += sinal * n;
  }
  return e;
}

/* ------------------------------------------------------------------ */

export async function listar(env) {
  const [{ results: pontos }, { results: movs }] = await Promise.all([
    env.DB.prepare("SELECT * FROM consig_pontos ORDER BY nome COLLATE NOCASE").all(),
    env.DB.prepare("SELECT * FROM consig_movimentos ORDER BY data, id").all(),
  ]);
  const movimentos = movs.map(({ itens_json, contagem_json, ...m }) => ({
    ...m,
    itens: parseJson(itens_json, {}),
    contagem: parseJson(contagem_json, null),
  }));
  return r(200, { pontos, movimentos, produtos: PRECOS });
}

export async function salvarPonto(b, env) {
  if (!b || typeof b !== "object") return r(400, { erro: "JSON inválido." });
  const nome = texto(b.nome, 80);
  if (!nome) return r(400, { erro: "Informe o nome do comércio." });
  const status = b.status === undefined ? "ativo" : b.status;
  if (!STATUS_PONTO.includes(status)) return r(400, { erro: "Situação inválida." });
  const preco = b.preco_repasse_centavos === undefined || b.preco_repasse_centavos === null ? 1400 : Number(b.preco_repasse_centavos);
  if (!Number.isInteger(preco) || preco < 1 || preco > 1000000) return r(400, { erro: "Preço de repasse inválido." });

  const campos = [
    nome,
    texto(b.tipo, 40),
    texto(b.responsavel, 60),
    texto(b.whatsapp, 30),
    texto(b.documento, 30),
    texto(b.endereco, 160),
    texto(b.cidade, 60),
    preco,
    status,
    texto(b.obs, 1000),
  ];
  const agora = new Date().toISOString();

  if (b.id !== undefined && b.id !== null) {
    const id = Number(b.id);
    if (!Number.isInteger(id) || !(await lerPonto(env, id))) return r(404, { erro: "Comércio não encontrado." });
    await env.DB.prepare(
      `UPDATE consig_pontos SET nome = ?1, tipo = ?2, responsavel = ?3, whatsapp = ?4, documento = ?5, endereco = ?6,
         cidade = ?7, preco_repasse_centavos = ?8, status = ?9, obs = ?10, atualizado_em = ?11 WHERE id = ?12`
    )
      .bind(...campos, agora, id)
      .run();
    return r(200, { ok: true, id });
  }

  await env.DB.prepare(
    `INSERT INTO consig_pontos (nome, tipo, responsavel, whatsapp, documento, endereco, cidade, preco_repasse_centavos,
       status, obs, criado_em, atualizado_em) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)`
  )
    .bind(...campos, agora)
    .run();
  const novo = await env.DB.prepare("SELECT id FROM consig_pontos WHERE criado_em = ?1 AND nome = ?2 ORDER BY id DESC")
    .bind(agora, nome)
    .first();
  return r(200, { ok: true, id: novo && novo.id });
}

export async function apagarPonto(url, env) {
  const id = Number(url.searchParams.get("id"));
  if (!Number.isInteger(id)) return r(400, { erro: "Comércio inválido." });
  const mov = await env.DB.prepare("SELECT COUNT(*) AS n FROM consig_movimentos WHERE ponto_id = ?1").bind(id).first();
  if (mov && mov.n > 0) {
    return r(409, { erro: "Este comércio já tem histórico. Em vez de apagar, mude a situação para \"encerrado\"." });
  }
  await env.DB.prepare("DELETE FROM consig_pontos WHERE id = ?1").bind(id).run();
  return r(200, { ok: true });
}

// Corpo: { ponto_id, tipo, data?, obs?,
//          entrega:      itens {produto: qtd deixada}
//          acerto:       sobra {produto: qtd contada}, reposicao? {produto: qtd}, pago?, forma_pagamento?
//          recolhimento: itens {produto: qtd retirada}, motivo }
export async function registrarMovimento(b, env) {
  if (!b || typeof b !== "object") return r(400, { erro: "JSON inválido." });
  const pontoId = Number(b.ponto_id);
  const ponto = Number.isInteger(pontoId) ? await lerPonto(env, pontoId) : null;
  if (!ponto) return r(404, { erro: "Comércio não encontrado." });
  const data = dataValida(b.data);
  if (!data) return r(400, { erro: "Data inválida (use uma data de hoje ou anterior)." });
  const obs = texto(b.obs, 500);
  const agora = new Date().toISOString();
  const inserir = (tipo, itens, extra = {}) =>
    env.DB.prepare(
      `INSERT INTO consig_movimentos (ponto_id, tipo, data, itens_json, contagem_json, preco_centavos, valor_centavos,
         pago, pago_em, forma_pagamento, motivo, obs, criado_em) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`
    ).bind(
      pontoId,
      tipo,
      data,
      JSON.stringify(itens),
      extra.contagem ? JSON.stringify(extra.contagem) : null,
      extra.preco ?? null,
      extra.valor ?? null,
      extra.pago ? 1 : 0,
      extra.pago ? data : null,
      extra.forma ?? null,
      extra.motivo ?? null,
      obs,
      agora
    );

  if (b.tipo === "entrega") {
    const itens = lerItens(b.itens);
    if (!itens) return r(400, { erro: "Quantidades inválidas." });
    if (!total(itens)) return r(400, { erro: "Informe quantos frascos foram deixados." });
    await inserir("entrega", itens).run();
    return r(200, { ok: true });
  }

  const atual = await estoque(env, pontoId);

  if (b.tipo === "recolhimento") {
    const itens = lerItens(b.itens);
    if (!itens) return r(400, { erro: "Quantidades inválidas." });
    if (!total(itens)) return r(400, { erro: "Informe quantos frascos foram retirados." });
    const motivo = MOTIVOS.includes(b.motivo) ? b.motivo : null;
    if (!motivo) return r(400, { erro: "Informe o motivo do recolhimento." });
    for (const [id, n] of Object.entries(itens)) {
      if (n > atual[id]) return r(400, { erro: `Não dá para retirar ${n} de ${PRECOS[id].nome}: só há ${atual[id]} lá.` });
    }
    await inserir("recolhimento", itens, { motivo }).run();
    return r(200, { ok: true });
  }

  if (b.tipo === "acerto") {
    const sobra = lerItens(b.sobra);
    const repo = lerItens(b.reposicao);
    if (!sobra || !repo) return r(400, { erro: "Quantidades inválidas." });
    if (!total(atual)) return r(400, { erro: "Não há frascos neste comércio para acertar." });
    const vendidos = {};
    const contagem = {};
    for (const id of PRODUTOS) {
      const s = sobra[id] || 0;
      if (s > atual[id]) return r(400, { erro: `Sobra de ${PRECOS[id].nome} (${s}) maior do que havia lá (${atual[id]}).` });
      if (atual[id] > 0) contagem[id] = s;
      if (atual[id] - s > 0) vendidos[id] = atual[id] - s;
    }
    const preco = ponto.preco_repasse_centavos;
    const valor = total(vendidos) * preco;
    const forma = FORMAS.includes(b.forma_pagamento) ? b.forma_pagamento : null;
    const pago = b.pago === true && valor > 0;
    const stmts = [inserir("acerto", vendidos, { contagem, preco, valor, pago, forma: pago ? forma : null })];
    if (total(repo)) stmts.push(inserir("entrega", repo));
    await env.DB.batch(stmts);
    return r(200, { ok: true, vendidos, valor_centavos: valor });
  }

  return r(400, { erro: "Tipo de movimento inválido." });
}

// Marca (ou desmarca) um acerto como recebido. Corpo: { id, pago, forma_pagamento?, data? }
export async function marcarPago(b, env) {
  if (!b || typeof b !== "object") return r(400, { erro: "JSON inválido." });
  const id = Number(b.id);
  const m = Number.isInteger(id) ? await env.DB.prepare("SELECT * FROM consig_movimentos WHERE id = ?1").bind(id).first() : null;
  if (!m || m.tipo !== "acerto") return r(404, { erro: "Acerto não encontrado." });
  if (b.pago === false) {
    await env.DB.prepare("UPDATE consig_movimentos SET pago = 0, pago_em = NULL, forma_pagamento = NULL WHERE id = ?1").bind(id).run();
    return r(200, { ok: true });
  }
  const data = dataValida(b.data);
  if (!data) return r(400, { erro: "Data inválida." });
  const forma = FORMAS.includes(b.forma_pagamento) ? b.forma_pagamento : null;
  await env.DB.prepare("UPDATE consig_movimentos SET pago = 1, pago_em = ?1, forma_pagamento = ?2 WHERE id = ?3")
    .bind(data, forma, id)
    .run();
  return r(200, { ok: true });
}

export async function desfazerMovimento(url, env) {
  const id = Number(url.searchParams.get("id"));
  const m = Number.isInteger(id) ? await env.DB.prepare("SELECT id, ponto_id FROM consig_movimentos WHERE id = ?1").bind(id).first() : null;
  if (!m) return r(404, { erro: "Movimento não encontrado." });
  const ultimo = await env.DB.prepare("SELECT MAX(id) AS id FROM consig_movimentos WHERE ponto_id = ?1").bind(m.ponto_id).first();
  if (!ultimo || ultimo.id !== id) return r(409, { erro: "Só dá para desfazer o último movimento deste comércio." });
  await env.DB.prepare("DELETE FROM consig_movimentos WHERE id = ?1").bind(id).run();
  return r(200, { ok: true });
}

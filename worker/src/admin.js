import { json } from "./util.js";
import { PRECOS } from "./catalogo.js";
import { sincronizarPagamentos } from "./pedidos.js";
import { listarParaAdmin, moderar, apagar as apagarAvaliacao } from "./avaliacoes.js";

const STATUS_ENVIO = ["novo", "separado", "enviado", "entregue"];
const LIMITE_LISTA = 5000; // pedidos por chamada — sobra muito pra uma loja desse porte
const LIMITE_ATUALIZACOES = 40; // por chamada (limite de consultas D1 por invocação no plano grátis)
const JANELA_FALHAS_MS = 15 * 60 * 1000;
const MAX_FALHAS = 8;

const resp = (dados, status, env, extra) =>
  json(dados, status, env, { "Cache-Control": "no-store", ...(extra || {}) });

/* ------------------------------------------------------------------ */
/* Autenticação: Basic Auth (usuário "admin") + limite de tentativas   */
/* ------------------------------------------------------------------ */

const enc = new TextEncoder();

async function igualSeguro(a, b) {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

function credenciais(req) {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Basic ")) return null;
  try {
    const texto = new TextDecoder().decode(Uint8Array.from(atob(auth.slice(6)), (c) => c.charCodeAt(0)));
    const i = texto.indexOf(":");
    if (i < 0) return null;
    return { usuario: texto.slice(0, i), senha: texto.slice(i + 1) };
  } catch {
    return null;
  }
}

// Devolve null se a requisição está autorizada, ou a Response de erro.
async function autenticar(req, env) {
  const naoAutorizado = () => resp({ erro: "Não autorizado." }, 401, env);

  if (!env.ADMIN_PASSWORD || !env.DB) return naoAutorizado();

  const ip = req.headers.get("CF-Connecting-IP") || "desconhecido";
  const agora = Date.now();

  // Trava por IP: muitas senhas erradas seguidas bloqueiam até a senha certa.
  const falhas = await env.DB.prepare("SELECT COUNT(*) AS n FROM admin_falhas WHERE ip = ?1 AND ts > ?2")
    .bind(ip, agora - JANELA_FALHAS_MS)
    .first();
  if (falhas && falhas.n >= MAX_FALHAS) {
    return resp({ erro: "Muitas tentativas. Aguarde 15 minutos." }, 429, env, { "Retry-After": "900" });
  }

  const c = credenciais(req);
  const ok = c && (await igualSeguro(c.usuario, "admin")) && (await igualSeguro(c.senha, env.ADMIN_PASSWORD));
  if (ok) return null;

  await env.DB.batch([
    env.DB.prepare("INSERT INTO admin_falhas (ip, ts) VALUES (?1, ?2)").bind(ip, agora),
    env.DB.prepare("DELETE FROM admin_falhas WHERE ts < ?1").bind(agora - 24 * 3600 * 1000),
  ]);
  return naoAutorizado();
}

/* ------------------------------------------------------------------ */
/* Validação de entrada                                                */
/* ------------------------------------------------------------------ */

function inteiroOuNull(v, min, max) {
  if (v === null || v === undefined || v === "") return null;
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < min || n > max) return undefined; // undefined = inválido
  return n;
}

function textoOuNull(v, max) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

async function corpoJson(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Pedidos                                                             */
/* ------------------------------------------------------------------ */

function parseJson(texto, padrao) {
  if (!texto) return padrao;
  try {
    return JSON.parse(texto);
  } catch {
    return padrao;
  }
}

async function listarPedidos(env) {
  const { results } = await env.DB.prepare("SELECT * FROM pedidos ORDER BY criado_em DESC LIMIT ?1")
    .bind(LIMITE_LISTA)
    .all();
  const pedidos = results.map(({ endereco_json, itens_json, ...resto }) => ({
    ...resto,
    endereco: parseJson(endereco_json, null),
    itens: parseJson(itens_json, []),
  }));
  return resp({ pedidos }, 200, env);
}

// Atualiza controle de envio / rastreio / observação de um ou mais pedidos.
async function atualizarPedidos(req, env) {
  const body = await corpoJson(req);
  const lista = body && Array.isArray(body.atualizacoes) ? body.atualizacoes : null;
  if (!lista || !lista.length) return resp({ erro: "Nada para atualizar." }, 400, env);
  if (lista.length > LIMITE_ATUALIZACOES) {
    return resp({ erro: `No máximo ${LIMITE_ATUALIZACOES} pedidos por vez.` }, 400, env);
  }

  const agora = new Date().toISOString();
  const stmts = [];
  for (const a of lista) {
    const ref = textoOuNull(a && a.ref, 60);
    if (!ref) return resp({ erro: "Pedido sem referência." }, 400, env);

    const sets = ["atualizado_em = ?"];
    const binds = [agora];

    if (a.status_envio !== undefined) {
      if (!STATUS_ENVIO.includes(a.status_envio)) return resp({ erro: "Status de envio inválido." }, 400, env);
      sets.push("status_envio = ?");
      binds.push(a.status_envio);
      if (a.status_envio === "enviado" || a.status_envio === "entregue") {
        sets.push("enviado_em = COALESCE(enviado_em, ?)");
        binds.push(agora);
      }
      if (a.status_envio === "novo" || a.status_envio === "separado") sets.push("enviado_em = NULL");
    }
    if (a.rastreio !== undefined) {
      sets.push("rastreio = ?");
      binds.push(textoOuNull(a.rastreio, 60));
    }
    if (a.obs !== undefined) {
      sets.push("obs = ?");
      binds.push(textoOuNull(a.obs, 1000));
    }
    stmts.push(env.DB.prepare(`UPDATE pedidos SET ${sets.join(", ")} WHERE external_reference = ?`).bind(...binds, ref));
  }
  await env.DB.batch(stmts);
  return resp({ ok: true, atualizados: stmts.length }, 200, env);
}

/* ------------------------------------------------------------------ */
/* Cupons                                                              */
/* ------------------------------------------------------------------ */

async function listarCupons(env) {
  const { results: cupons } = await env.DB.prepare("SELECT * FROM cupons ORDER BY criado_em DESC").all();
  const { results: uso } = await env.DB.prepare(
    `SELECT cupom,
            SUM(CASE WHEN status NOT IN ('rejected','cancelled','refunded','charged_back') THEN 1 ELSE 0 END) AS usos,
            SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS aprovados,
            SUM(CASE WHEN status = 'approved' THEN COALESCE(desconto_centavos, 0) ELSE 0 END) AS desconto_centavos,
            SUM(CASE WHEN status = 'approved' THEN COALESCE(total_centavos, 0) ELSE 0 END) AS receita_centavos
       FROM pedidos WHERE cupom IS NOT NULL GROUP BY cupom`
  ).all();
  const porCupom = Object.fromEntries(uso.map((u) => [u.cupom, u]));
  return resp(
    {
      cupons: cupons.map((c) => ({
        ...c,
        usos: (porCupom[c.codigo] && porCupom[c.codigo].usos) || 0,
        aprovados: (porCupom[c.codigo] && porCupom[c.codigo].aprovados) || 0,
        desconto_centavos: (porCupom[c.codigo] && porCupom[c.codigo].desconto_centavos) || 0,
        receita_centavos: (porCupom[c.codigo] && porCupom[c.codigo].receita_centavos) || 0,
      })),
    },
    200,
    env
  );
}

async function salvarCupom(req, env) {
  const b = await corpoJson(req);
  if (!b) return resp({ erro: "JSON inválido." }, 400, env);

  const codigo = String(b.codigo || "").trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,30}$/.test(codigo)) {
    return resp({ erro: "Código: de 3 a 30 caracteres (letras, números, - ou _)." }, 400, env);
  }

  // Só ligar/desligar: {codigo, ativo} — não mexe nos outros campos.
  const chaves = Object.keys(b);
  if (typeof b.ativo === "boolean" && chaves.every((k) => k === "codigo" || k === "ativo")) {
    const r = await env.DB.prepare("UPDATE cupons SET ativo = ?1 WHERE codigo = ?2").bind(b.ativo ? 1 : 0, codigo).run();
    if (!r.meta.changes) return resp({ erro: "Cupom não encontrado." }, 404, env);
    return resp({ ok: true }, 200, env);
  }

  const tipo = b.tipo === "fixo" ? "fixo" : "percentual";
  const valor = inteiroOuNull(b.valor, 1, tipo === "percentual" ? 100 : 1000000);
  if (valor === null || valor === undefined) {
    return resp({ erro: tipo === "percentual" ? "O percentual precisa estar entre 1 e 100." : "Valor inválido." }, 400, env);
  }

  let expiraEm = textoOuNull(b.expira_em, 10);
  if (expiraEm && !/^\d{4}-\d{2}-\d{2}$/.test(expiraEm)) return resp({ erro: "Validade inválida." }, 400, env);

  const maxUsos = inteiroOuNull(b.max_usos, 1, 1000000);
  if (maxUsos === undefined) return resp({ erro: "Limite de usos inválido." }, 400, env);
  const minSubtotal = inteiroOuNull(b.min_subtotal_centavos, 0, 100000000);
  if (minSubtotal === undefined) return resp({ erro: "Pedido mínimo inválido." }, 400, env);

  await env.DB.prepare(
    `INSERT INTO cupons (codigo, tipo, valor, ativo, descricao, expira_em, max_usos, min_subtotal_centavos, criado_em)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
     ON CONFLICT(codigo) DO UPDATE SET
       tipo = excluded.tipo, valor = excluded.valor, ativo = excluded.ativo, descricao = excluded.descricao,
       expira_em = excluded.expira_em, max_usos = excluded.max_usos,
       min_subtotal_centavos = excluded.min_subtotal_centavos`
  )
    .bind(
      codigo,
      tipo,
      valor,
      b.ativo === false ? 0 : 1,
      textoOuNull(b.descricao, 120),
      expiraEm,
      maxUsos,
      minSubtotal || null,
      new Date().toISOString()
    )
    .run();
  return resp({ ok: true }, 200, env);
}

async function apagarCupom(url, env) {
  const codigo = String(url.searchParams.get("codigo") || "").trim().toUpperCase();
  if (!codigo) return resp({ erro: "Código é obrigatório." }, 400, env);
  await env.DB.prepare("DELETE FROM cupons WHERE codigo = ?1").bind(codigo).run();
  return resp({ ok: true }, 200, env);
}

/* ------------------------------------------------------------------ */
/* Configurações (custos e meta)                                       */
/* ------------------------------------------------------------------ */

const CHAVES_CONFIG = [...Object.keys(PRECOS).map((id) => `custo_${id}`), "custo_embalagem", "meta_mensal"];

async function lerConfig(env) {
  const { results } = await env.DB.prepare("SELECT chave, valor FROM config").all();
  const config = {};
  for (const r of results) if (CHAVES_CONFIG.includes(r.chave)) config[r.chave] = Number(r.valor);
  return resp({ config, produtos: PRECOS }, 200, env);
}

async function salvarConfig(req, env) {
  const b = await corpoJson(req);
  if (!b || typeof b.config !== "object" || !b.config) return resp({ erro: "JSON inválido." }, 400, env);

  const stmts = [];
  for (const [chave, valor] of Object.entries(b.config)) {
    if (!CHAVES_CONFIG.includes(chave)) return resp({ erro: `Configuração desconhecida: ${chave}` }, 400, env);
    const n = inteiroOuNull(valor, 0, 1000000000);
    if (n === undefined) return resp({ erro: `Valor inválido em ${chave}.` }, 400, env);
    stmts.push(
      n === null
        ? env.DB.prepare("DELETE FROM config WHERE chave = ?1").bind(chave)
        : env.DB.prepare(
            "INSERT INTO config (chave, valor) VALUES (?1, ?2) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor"
          ).bind(chave, String(n))
    );
  }
  if (stmts.length) await env.DB.batch(stmts);
  return resp({ ok: true }, 200, env);
}

/* ------------------------------------------------------------------ */
/* Sincronização com o Mercado Pago                                    */
/* ------------------------------------------------------------------ */

async function sincronizar(req, env) {
  if (!env.MP_ACCESS_TOKEN) return resp({ erro: "MP_ACCESS_TOKEN não configurado no Worker." }, 501, env);
  const b = (await corpoJson(req)) || {};
  try {
    return resp(await sincronizarPagamentos(env, { dias: b.dias, offset: b.offset }), 200, env);
  } catch (e) {
    console.log("admin: falha ao sincronizar:", e && e.message ? e.message : e);
    return resp({ erro: "Não consegui consultar o Mercado Pago agora.", detalhe: String((e && e.message) || e) }, 502, env);
  }
}

/* ------------------------------------------------------------------ */
/* Roteador — devolve null se a rota não é /admin/*                    */
/* ------------------------------------------------------------------ */

export async function handleAdmin(req, env, url) {
  if (!url.pathname.startsWith("/admin/")) return null;

  const negado = await autenticar(req, env);
  if (negado) return negado;

  const { pathname: p } = url;
  const m = req.method;

  if (p === "/admin/ping" && m === "GET") return resp({ ok: true }, 200, env);
  if (p === "/admin/pedidos" && m === "GET") return listarPedidos(env);
  if (p === "/admin/pedidos/atualizar" && m === "POST") return atualizarPedidos(req, env);
  if (p === "/admin/cupons") {
    if (m === "GET") return listarCupons(env);
    if (m === "POST") return salvarCupom(req, env);
    if (m === "DELETE") return apagarCupom(url, env);
  }
  if (p === "/admin/config") {
    if (m === "GET") return lerConfig(env);
    if (m === "POST") return salvarConfig(req, env);
  }
  if (p === "/admin/sincronizar" && m === "POST") return sincronizar(req, env);
  if (p === "/admin/avaliacoes" && m === "GET") return resp(await listarParaAdmin(env), 200, env);
  if (p === "/admin/avaliacoes" && m === "DELETE") {
    const r = await apagarAvaliacao(url, env);
    return resp(r.corpo, r.status, env);
  }
  if (p === "/admin/avaliacoes/moderar" && m === "POST") {
    const r = await moderar(await corpoJson(req), env);
    return resp(r.corpo, r.status, env);
  }

  return resp({ erro: "Rota não encontrada." }, 404, env);
}

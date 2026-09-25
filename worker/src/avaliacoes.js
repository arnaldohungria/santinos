// Avaliações de produtos (nota 1–5 + comentário).
//
// Regras (definidas pelo Arnaldo em 2026-09-25):
//   - SÓ QUEM COMPROU avalia: o cliente informa nº do pedido + e-mail da compra e o
//     Worker confere no banco (pedido pago, já enviado, com aquele produto).
//   - Toda avaliação nasce "pendente" e só aparece no site depois que o Arnaldo aprova no painel.
//   - Uma avaliação por produto em cada pedido (UNIQUE no banco).
//
// SEGURANÇA: nome/comentário vêm do público (não confiáveis). Aqui só são validados e
// limitados em tamanho; quem exibe (site: textContent; painel: tag `html`) escapa.
// O e-mail informado serve só pra conferir a compra — NÃO é gravado na tabela de avaliações.

import { json } from "./util.js";
import { PRECOS } from "./catalogo.js";

const RE_PEDIDO = /^SNT-[A-Z0-9]{3,16}$/;
const RE_EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}$/;
const STATUS_MODERACAO = ["pendente", "aprovada", "oculta"];
const MAX_COMENTARIO = 600;
const MAX_NOME = 40;
const MAX_RESPOSTA = 600;
const LIMITE_PUBLICO = 30;
const LIMITE_ADMIN = 1000;

const ENVIADO = ["enviado", "entregue"];

// Tira caracteres de controle e espaços repetidos; corta no tamanho máximo.
function limpar(v, max, { quebraDeLinha = false } = {}) {
  if (typeof v !== "string") return "";
  let s = v.replace(quebraDeLinha ? /[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, " ");
  s = quebraDeLinha ? s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n") : s.replace(/\s+/g, " ");
  return s.trim().slice(0, max);
}

const resp = (dados, status, env, extra) => json(dados, status, env, extra);

function parseItens(texto) {
  try {
    const l = JSON.parse(texto);
    return Array.isArray(l) ? l : [];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Público: enviar avaliação                                           */
/* ------------------------------------------------------------------ */

export async function enviarAvaliacao(req, env) {
  if (!env.DB) return resp({ erro: "Avaliações indisponíveis no momento." }, 503, env);

  let b;
  try {
    b = await req.json();
  } catch {
    return resp({ erro: "JSON inválido." }, 400, env);
  }
  if (!b || typeof b !== "object") return resp({ erro: "JSON inválido." }, 400, env);

  const produto = typeof b.produto === "string" ? b.produto : "";
  if (!PRECOS[produto]) return resp({ erro: "Escolha o produto que você quer avaliar." }, 400, env);

  const nota = Number(b.nota);
  if (!Number.isInteger(nota) || nota < 1 || nota > 5) return resp({ erro: "Escolha uma nota de 1 a 5 estrelas." }, 400, env);

  const pedido = limpar(b.pedido, 30).toUpperCase();
  const email = limpar(b.email, 320).toLowerCase();
  if (!RE_PEDIDO.test(pedido)) return resp({ erro: "Número do pedido inválido. Ele começa com SNT- (ex.: SNT-ABC123)." }, 400, env);
  if (!RE_EMAIL.test(email)) return resp({ erro: "E-mail inválido." }, 400, env);

  const nome = limpar(b.nome, MAX_NOME);
  if (nome.length < 2) return resp({ erro: "Informe como você quer aparecer (ex.: seu primeiro nome)." }, 400, env);
  const comentario = limpar(b.comentario, MAX_COMENTARIO, { quebraDeLinha: true });

  // Confere a compra. Mensagem genérica quando os dados não batem (não revela se o pedido existe).
  const NAO_ACHOU = "Não encontramos uma compra com esses dados. Confira o número do pedido e o e-mail usado na compra.";
  const p = await env.DB.prepare(
    "SELECT email, status, status_envio, itens_json FROM pedidos WHERE external_reference = ?1"
  )
    .bind(pedido)
    .first();
  if (!p || String(p.email || "").trim().toLowerCase() !== email) return resp({ erro: NAO_ACHOU }, 403, env);
  if (p.status !== "approved") return resp({ erro: "Este pedido ainda não teve o pagamento aprovado." }, 403, env);
  if (!parseItens(p.itens_json).some((i) => i && i.id === produto)) return resp({ erro: NAO_ACHOU }, 403, env);
  if (!ENVIADO.includes(p.status_envio)) {
    return resp({ erro: "Seu pedido ainda não foi enviado. Assim que ele sair, você poderá avaliar." }, 403, env);
  }

  const agora = new Date().toISOString();
  const r = await env.DB.prepare(
    `INSERT INTO avaliacoes (produto, pedido_ref, nota, comentario, nome, status, criado_em, atualizado_em)
     VALUES (?1, ?2, ?3, ?4, ?5, 'pendente', ?6, ?6)
     ON CONFLICT(pedido_ref, produto) DO NOTHING`
  )
    .bind(produto, pedido, nota, comentario || null, nome, agora)
    .run();
  if (!r.meta || !r.meta.changes) return resp({ erro: "Você já avaliou este produto neste pedido. Obrigado!" }, 409, env);

  return resp({ ok: true, mensagem: "Recebemos a sua avaliação! Ela aparece no site depois que a gente conferir." }, 200, env);
}

/* ------------------------------------------------------------------ */
/* Público: ler avaliações aprovadas                                   */
/* ------------------------------------------------------------------ */

const arred1 = (x) => Math.round(x * 10) / 10;

function resumir(linhas) {
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let total = 0;
  let soma = 0;
  for (const l of linhas) {
    dist[l.nota] = l.n;
    total += l.n;
    soma += l.nota * l.n;
  }
  return { media: total ? arred1(soma / total) : 0, total, distribuicao: dist };
}

export async function listarPublicas(url, env) {
  const cache = { "Cache-Control": "public, max-age=60" };
  if (!env.DB) return resp({ erro: "Avaliações indisponíveis no momento." }, 503, env);

  const produto = url.searchParams.get("produto");
  if (produto) {
    if (!PRECOS[produto]) return resp({ erro: "Produto desconhecido." }, 404, env);
    const { results: dist } = await env.DB.prepare(
      "SELECT nota, COUNT(*) AS n FROM avaliacoes WHERE produto = ?1 AND status = 'aprovada' GROUP BY nota"
    )
      .bind(produto)
      .all();
    const { results: itens } = await env.DB.prepare(
      `SELECT nome, nota, comentario, resposta, criado_em FROM avaliacoes
        WHERE produto = ?1 AND status = 'aprovada' ORDER BY criado_em DESC LIMIT ?2`
    )
      .bind(produto, LIMITE_PUBLICO)
      .all();
    return resp(
      {
        produto,
        ...resumir(dist),
        itens: itens.map((i) => ({
          nome: i.nome,
          nota: i.nota,
          comentario: i.comentario || "",
          resposta: i.resposta || "",
          data: String(i.criado_em || "").slice(0, 10),
        })),
      },
      200,
      env,
      cache
    );
  }

  const { results } = await env.DB.prepare(
    "SELECT produto, nota, COUNT(*) AS n FROM avaliacoes WHERE status = 'aprovada' GROUP BY produto, nota"
  ).all();
  const porProduto = {};
  for (const id of Object.keys(PRECOS)) porProduto[id] = [];
  for (const r of results) if (porProduto[r.produto]) porProduto[r.produto].push({ nota: r.nota, n: r.n });
  const resumo = {};
  for (const [id, linhas] of Object.entries(porProduto)) {
    const { media, total } = resumir(linhas);
    resumo[id] = { media, total };
  }
  return resp({ resumo }, 200, env, cache);
}

/* ------------------------------------------------------------------ */
/* Admin (chamadas já autenticadas por admin.js)                       */
/* ------------------------------------------------------------------ */

export async function listarParaAdmin(env) {
  const { results } = await env.DB.prepare("SELECT * FROM avaliacoes ORDER BY criado_em DESC LIMIT ?1")
    .bind(LIMITE_ADMIN)
    .all();
  return { avaliacoes: results };
}

// Aprova/oculta/volta a pendente e/ou grava a resposta pública. { id, status?, resposta? }
export async function moderar(b, env) {
  const id = Math.floor(Number(b && b.id));
  if (!Number.isFinite(id) || id < 1) return { status: 400, corpo: { erro: "Avaliação inválida." } };

  const sets = [];
  const binds = [];
  if (b.status !== undefined) {
    if (!STATUS_MODERACAO.includes(b.status)) return { status: 400, corpo: { erro: "Status inválido." } };
    sets.push(`status = ?${binds.length + 1}`);
    binds.push(b.status);
  }
  if (b.resposta !== undefined) {
    const t = b.resposta === null ? "" : limpar(String(b.resposta), MAX_RESPOSTA, { quebraDeLinha: true });
    sets.push(`resposta = ?${binds.length + 1}`);
    binds.push(t || null);
  }
  if (!sets.length) return { status: 400, corpo: { erro: "Nada para atualizar." } };

  sets.push(`atualizado_em = ?${binds.length + 1}`);
  binds.push(new Date().toISOString());
  binds.push(id);
  const r = await env.DB.prepare(`UPDATE avaliacoes SET ${sets.join(", ")} WHERE id = ?${binds.length}`)
    .bind(...binds)
    .run();
  if (!r.meta || !r.meta.changes) return { status: 404, corpo: { erro: "Avaliação não encontrada." } };
  return { status: 200, corpo: { ok: true } };
}

export async function apagar(url, env) {
  const id = Math.floor(Number(url.searchParams.get("id")));
  if (!Number.isFinite(id) || id < 1) return { status: 400, corpo: { erro: "Avaliação inválida." } };
  await env.DB.prepare("DELETE FROM avaliacoes WHERE id = ?1").bind(id).run();
  return { status: 200, corpo: { ok: true } };
}

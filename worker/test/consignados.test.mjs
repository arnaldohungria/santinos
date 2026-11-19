// Teste da API de consignação do Worker, SEM Cloudflare: usa um D1 falso em SQLite (node:sqlite).
// Rodar (Node 22.5+; sem instalar nada):  node worker/test/consignados.test.mjs
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { timingSafeEqual } from "node:crypto";
Object.defineProperty(globalThis.crypto.subtle, "timingSafeEqual", { value: (a, b) => timingSafeEqual(Buffer.from(a), Buffer.from(b)) });
const raiz = new URL("../", import.meta.url); // worker/

function criarD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(fs.readFileSync(new URL("schema.sql", raiz), "utf8"));
  const stmt = (sql, params = []) => ({
    bind: (...p) => stmt(sql, p),
    first: async () => db.prepare(sql).get(...params) || null,
    all: async () => ({ results: db.prepare(sql).all(...params) }),
    run: async () => { const r = db.prepare(sql).run(...params); return { meta: { changes: Number(r.changes) } }; },
    _exec: () => db.prepare(sql).run(...params),
  });
  return { db, prepare: (sql) => stmt(sql), batch: async (l) => l.map((s) => s._exec()) };
}

const { default: worker } = await import(new URL("src/index.js", raiz));
const DB = criarD1();
const env = { DB, ADMIN_PASSWORD: "senha-de-teste-123", ALLOWED_ORIGIN: "https://www.santinos.com.br" };
const auth = "Basic " + Buffer.from("admin:senha-de-teste-123").toString("base64");
async function chama(metodo, rota, corpo, semAuth) {
  const h = { "content-type": "application/json", "CF-Connecting-IP": "8.8.8.8" };
  if (!semAuth) h.Authorization = auth;
  const r = await worker.fetch(new Request("https://w.test" + rota, { method: metodo, headers: h, body: corpo === undefined ? undefined : JSON.stringify(corpo) }), env);
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { s: r.status, j };
}
let falhas = 0;
const ok = (nome, cond, det) => { if (!cond) falhas++; console.log(cond ? "PASSOU" : "FALHOU", "-", nome, cond ? "" : "→ " + JSON.stringify(det)); };
const estoqueDe = async (id) => {
  const { j } = await chama("GET", "/admin/consignados");
  const e = { suave: 0, defumado: 0, "extra-forte": 0 };
  for (const m of j.movimentos.filter((x) => x.ponto_id === id)) for (const [p, n] of Object.entries(m.itens)) e[p] += (m.tipo === "entrega" ? 1 : -1) * n;
  return e;
};

let r = await chama("GET", "/admin/consignados", undefined, true);
ok("sem senha → 401", r.s === 401, r);
r = await chama("GET", "/admin/consignados");
ok("lista vazia → 200 com produtos", r.s === 200 && r.j.pontos.length === 0 && r.j.produtos.defumado, r);

r = await chama("POST", "/admin/consignados/ponto", { nome: "  " });
ok("comércio sem nome → 400", r.s === 400, r);
r = await chama("POST", "/admin/consignados/ponto", { nome: "Açougue Boi Bom", tipo: "Açougue", whatsapp: "(15) 99999-0000", cidade: "Itapetininga" });
ok("cria comércio → 200 com id", r.s === 200 && Number.isInteger(r.j.id), r);
const A = r.j.id;
r = await chama("POST", "/admin/consignados/ponto", { nome: "Empório X", preco_repasse_centavos: 0 });
ok("preço de repasse 0 → 400", r.s === 400, r);
r = await chama("POST", "/admin/consignados/ponto", { nome: "Empório X", status: "sumido" });
ok("situação inválida → 400", r.s === 400, r);
r = await chama("POST", "/admin/consignados/ponto", { nome: "Empório Central", preco_repasse_centavos: 1300 });
const B = r.j.id;
r = await chama("GET", "/admin/consignados");
ok("preço padrão de repasse = R$ 14", r.j.pontos.find((p) => p.id === A).preco_repasse_centavos === 1400, r.j.pontos);

r = await chama("POST", "/admin/consignados/movimento", { ponto_id: A, tipo: "entrega", itens: { suave: 2, defumado: 6, "extra-forte": 4 } });
ok("entrega → 200", r.s === 200, r);
r = await chama("POST", "/admin/consignados/movimento", { ponto_id: A, tipo: "entrega", itens: {} });
ok("entrega sem frascos → 400", r.s === 400, r);
r = await chama("POST", "/admin/consignados/movimento", { ponto_id: A, tipo: "entrega", itens: { constructor: 1 } });
ok("produto inválido → 400", r.s === 400, r);
r = await chama("POST", "/admin/consignados/movimento", { ponto_id: A, tipo: "entrega", itens: { suave: -1 } });
ok("quantidade negativa → 400", r.s === 400, r);
r = await chama("POST", "/admin/consignados/movimento", { ponto_id: A, tipo: "entrega", itens: { suave: 1.5 } });
ok("quantidade fracionada → 400", r.s === 400, r);
r = await chama("POST", "/admin/consignados/movimento", { ponto_id: A, tipo: "entrega", data: "2099-01-01", itens: { suave: 1 } });
ok("data no futuro → 400", r.s === 400, r);
r = await chama("POST", "/admin/consignados/movimento", { ponto_id: 999, tipo: "entrega", itens: { suave: 1 } });
ok("comércio inexistente → 404", r.s === 404, r);
ok("estoque após entrega", JSON.stringify(await estoqueDe(A)) === JSON.stringify({ suave: 2, defumado: 6, "extra-forte": 4 }));

r = await chama("POST", "/admin/consignados/movimento", { ponto_id: A, tipo: "acerto", sobra: { defumado: 7 } });
ok("sobra maior que o estoque → 400", r.s === 400 && /maior/.test(r.j.erro), r);
r = await chama("POST", "/admin/consignados/movimento", { ponto_id: A, tipo: "acerto", sobra: { suave: 2, defumado: 1, "extra-forte": 3 }, reposicao: { defumado: 5 }, pago: true, forma_pagamento: "pix" });
ok("acerto: vendidos = estoque − sobra; valor = vendidos × R$ 14", r.s === 200 && r.j.valor_centavos === 6 * 1400 && r.j.vendidos.defumado === 5 && r.j.vendidos["extra-forte"] === 1 && !r.j.vendidos.suave, r);
ok("estoque após acerto + reposição", JSON.stringify(await estoqueDe(A)) === JSON.stringify({ suave: 2, defumado: 6, "extra-forte": 3 }));
r = await chama("GET", "/admin/consignados");
const acerto = r.j.movimentos.find((m) => m.tipo === "acerto");
ok("acerto gravado como pago via Pix, com a contagem", acerto.pago === 1 && acerto.forma_pagamento === "pix" && acerto.contagem.defumado === 1, acerto);

r = await chama("POST", "/admin/consignados/movimento", { ponto_id: A, tipo: "recolhimento", itens: { suave: 1 } });
ok("recolhimento sem motivo → 400", r.s === 400, r);
r = await chama("POST", "/admin/consignados/movimento", { ponto_id: A, tipo: "recolhimento", itens: { suave: 5 }, motivo: "vencido" });
ok("recolher mais do que há → 400", r.s === 400, r);
r = await chama("POST", "/admin/consignados/movimento", { ponto_id: A, tipo: "recolhimento", itens: { suave: 1 }, motivo: "quebrado" });
ok("recolhimento → 200", r.s === 200, r);

r = await chama("POST", "/admin/consignados/movimento", { ponto_id: B, tipo: "acerto", sobra: {} });
ok("acerto em comércio sem frascos → 400", r.s === 400, r);
await chama("POST", "/admin/consignados/movimento", { ponto_id: B, tipo: "entrega", itens: { defumado: 3 } });
r = await chama("POST", "/admin/consignados/movimento", { ponto_id: B, tipo: "acerto", sobra: { defumado: 1 } });
ok("acerto usa o preço do comércio (R$ 13)", r.j.valor_centavos === 2 * 1300, r);
r = await chama("GET", "/admin/consignados");
const acertoB = r.j.movimentos.filter((m) => m.ponto_id === B && m.tipo === "acerto").pop();
ok("acerto sem pagamento fica em aberto", acertoB.pago === 0, acertoB);
r = await chama("POST", "/admin/consignados/pagar", { id: acertoB.id, pago: true, forma_pagamento: "dinheiro" });
ok("marcar como pago → 200", r.s === 200, r);
r = await chama("POST", "/admin/consignados/pagar", { id: acerto.id - 100, pago: true });
ok("pagar movimento inexistente → 404", r.s === 404, r);

r = await chama("GET", "/admin/consignados");
const movsA = r.j.movimentos.filter((m) => m.ponto_id === A);
r = await chama("DELETE", `/admin/consignados/movimento?id=${movsA[0].id}`);
ok("desfazer movimento antigo → 409", r.s === 409, r);
r = await chama("DELETE", `/admin/consignados/movimento?id=${movsA[movsA.length - 1].id}`);
ok("desfazer o último → 200", r.s === 200, r);
ok("estoque volta após desfazer o recolhimento", (await estoqueDe(A)).suave === 2);

r = await chama("DELETE", `/admin/consignados/ponto?id=${A}`);
ok("apagar comércio com histórico → 409", r.s === 409, r);
r = await chama("POST", "/admin/consignados/ponto", { nome: "Teste <script>alert(1)</script>" });
r = await chama("DELETE", `/admin/consignados/ponto?id=${r.j.id}`);
ok("apagar comércio sem histórico → 200", r.s === 200, r);
r = await chama("POST", "/admin/consignados/ponto", { id: A, nome: "Açougue Boi Bom", status: "pausado", preco_repasse_centavos: 1500 });
ok("editar comércio → 200", r.s === 200, r);
r = await chama("GET", "/admin/consignados");
const pA = r.j.pontos.find((p) => p.id === A);
ok("edição gravada", pA.status === "pausado" && pA.preco_repasse_centavos === 1500, pA);
const acertoA = r.j.movimentos.find((m) => m.id === acerto.id);
ok("acerto antigo mantém o preço da época (R$ 14)", acertoA.preco_centavos === 1400, acertoA);

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);

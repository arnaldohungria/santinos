// Teste da API de avaliações do Worker, SEM Cloudflare e SEM Mercado Pago: usa um D1 falso em SQLite (node:sqlite).
// Rodar (Node 22.5+; sem instalar nada):  node worker/test/avaliacoes.test.mjs
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { timingSafeEqual } from "node:crypto";
// Na Cloudflare existe crypto.subtle.timingSafeEqual; no Node não — substituto só para o teste.
Object.defineProperty(globalThis.crypto.subtle, "timingSafeEqual", { value: (a, b) => timingSafeEqual(Buffer.from(a), Buffer.from(b)) });
const raiz = new URL("../", import.meta.url); // worker/

export function criarD1() {
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
let limiteOk = true;
const env = {
  DB, ADMIN_PASSWORD: "senha-de-teste-123", ALLOWED_ORIGIN: "https://www.santinos.com.br",
  RL_AVALIAR: { limit: async () => ({ success: limiteOk }) },
};
const auth = "Basic " + Buffer.from("admin:senha-de-teste-123").toString("base64");
async function chama(metodo, rota, corpo, admin) {
  const h = { "content-type": "application/json", "CF-Connecting-IP": "9.9.9.9" };
  if (admin) h.Authorization = auth;
  const r = await worker.fetch(new Request("https://w.test" + rota, { method: metodo, headers: h, body: corpo === undefined ? undefined : JSON.stringify(corpo) }), env);
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { s: r.status, j, h: r.headers };
}
let falhas = 0;
const ok = (nome, cond, det) => { if (!cond) falhas++; console.log(cond ? "PASSOU" : "FALHOU", "-", nome, cond ? "" : "→ " + JSON.stringify(det)); };

// pedidos de teste
const ins = (ref, email, status, envio, itens) => DB.db.prepare(
  "INSERT INTO pedidos (external_reference,status,email,itens_json,status_envio,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?)"
).run(ref, status, email, JSON.stringify(itens), envio, "2026-09-25T10:00:00Z", "2026-09-25T10:00:00Z");
ins("SNT-AAA111", "Ana@Exemplo.com", "approved", "enviado", [{ id: "suave", qtd: 2 }, { id: "defumado", qtd: 1 }]);
ins("SNT-BBB222", "bia@exemplo.com", "approved", "novo", [{ id: "suave", qtd: 1 }]);
ins("SNT-CCC333", "caio@exemplo.com", "pending", "novo", [{ id: "suave", qtd: 1 }]);
ins("SNT-DDD444", "dani@exemplo.com", "approved", "entregue", [{ id: "extra-forte", qtd: 1 }]);

const base = { pedido: "snt-aaa111", email: " ANA@exemplo.com ", produto: "suave", nota: 5, comentario: "Muito bom!\n\nCombina com tudo.", nome: "Ana" };

let r = await chama("POST", "/avaliar", base);
ok("compra verificada (pedido em minúsculas, e-mail com maiúsculas/espaços) → 200", r.s === 200 && r.j.ok, r);
r = await chama("POST", "/avaliar", base);
ok("segunda avaliação do mesmo produto no mesmo pedido → 409", r.s === 409, r);
r = await chama("POST", "/avaliar", { ...base, produto: "defumado", nota: 4 });
ok("outro produto do mesmo pedido → 200", r.s === 200, r);
r = await chama("POST", "/avaliar", { ...base, produto: "extra-forte" });
ok("produto que NÃO está no pedido → 403 genérico", r.s === 403 && /Não encontramos/.test(r.j.erro), r);
r = await chama("POST", "/avaliar", { ...base, email: "outro@exemplo.com" });
ok("e-mail errado → 403 genérico", r.s === 403 && /Não encontramos/.test(r.j.erro), r);
r = await chama("POST", "/avaliar", { ...base, pedido: "SNT-ZZZ999" });
ok("pedido inexistente → 403 com a MESMA mensagem (não revela se existe)", r.s === 403 && /Não encontramos/.test(r.j.erro), r);
r = await chama("POST", "/avaliar", { ...base, pedido: "SNT-BBB222", email: "bia@exemplo.com" });
ok("pedido ainda não enviado → 403 'ainda não foi enviado'", r.s === 403 && /não foi enviado/.test(r.j.erro), r);
r = await chama("POST", "/avaliar", { ...base, pedido: "SNT-BBB222", email: "errado@x.com" });
ok("pedido não enviado + e-mail errado → NÃO revela o estado", r.s === 403 && /Não encontramos/.test(r.j.erro), r);
r = await chama("POST", "/avaliar", { ...base, pedido: "SNT-CCC333", email: "caio@exemplo.com" });
ok("pagamento pendente → 403", r.s === 403 && /pagamento/.test(r.j.erro), r);
r = await chama("POST", "/avaliar", { ...base, pedido: "SNT-DDD444", email: "dani@exemplo.com", produto: "extra-forte", nota: 2, comentario: "", nome: "Dani" });
ok("pedido entregue, sem comentário → 200", r.s === 200, r);
for (const [n, campo] of [["nota 0", { nota: 0 }], ["nota 6", { nota: 6 }], ["nota 3.5", { nota: 3.5 }], ["nota texto", { nota: "cinco" }], ["produto inválido", { produto: "constructor" }], ["produto __proto__", { produto: "__proto__" }], ["pedido mal formado", { pedido: "'; DROP TABLE pedidos;--" }], ["e-mail inválido", { email: "sem-arroba" }], ["nome vazio", { nome: " " }]]) {
  r = await chama("POST", "/avaliar", { ...base, ...campo });
  ok("entrada inválida: " + n + " → 400", r.s === 400, r);
}
r = await chama("POST", "/avaliar", "nao-json"); // corpo string vira JSON string
ok("corpo que não é objeto → 400", r.s === 400, r);
ok("tabela pedidos continua existindo (sem SQL injection)", DB.db.prepare("SELECT COUNT(*) n FROM pedidos").get().n === 4);
ok("e-mail NÃO foi gravado em avaliacoes", !JSON.stringify(DB.db.prepare("SELECT * FROM avaliacoes").all()).includes("exemplo.com"));

// XSS/tamanhos ficam como TEXTO (escape é de quem exibe) e são cortados
ins("SNT-EEE555", "eva@exemplo.com", "approved", "enviado", [{ id: "suave", qtd: 1 }]);
r = await chama("POST", "/avaliar", { pedido: "SNT-EEE555", email: "eva@exemplo.com", produto: "suave", nota: 1, nome: "<img src=x onerror=alert(1)>".repeat(5), comentario: "<script>alert(1)</script>" + "x".repeat(2000) });
const eva = DB.db.prepare("SELECT * FROM avaliacoes WHERE pedido_ref='SNT-EEE555'").get();
ok("nome cortado em 40 e comentário em 600", eva && eva.nome.length <= 40 && eva.comentario.length <= 600, eva && [eva.nome.length, eva.comentario.length]);

// Nada aparece no público antes de aprovar
r = await chama("GET", "/avaliacoes?produto=suave");
ok("antes de aprovar: público não vê nada", r.s === 200 && r.j.total === 0 && r.j.itens.length === 0, r);
r = await chama("GET", "/admin/avaliacoes");
ok("admin sem senha → 401", r.s === 401, r.s);
r = await chama("GET", "/admin/avaliacoes", undefined, true);
ok("admin vê as 4 pendentes", r.s === 200 && r.j.avaliacoes.length === 4 && r.j.avaliacoes.every((a) => a.status === "pendente"), r.j.avaliacoes && r.j.avaliacoes.length);
const idAna = r.j.avaliacoes.find((a) => a.pedido_ref === "SNT-AAA111" && a.produto === "suave").id;
const idDani = r.j.avaliacoes.find((a) => a.pedido_ref === "SNT-DDD444").id;
const idEva = r.j.avaliacoes.find((a) => a.pedido_ref === "SNT-EEE555").id;
r = await chama("POST", "/admin/avaliacoes/moderar", { id: idAna, status: "aprovada" });
ok("moderar sem senha → 401", r.s === 401, r.s);
r = await chama("POST", "/admin/avaliacoes/moderar", { id: idAna, status: "aprovada", resposta: "Obrigado, Ana! 🌶️" }, true);
ok("aprovar + responder → 200", r.s === 200, r);
r = await chama("POST", "/admin/avaliacoes/moderar", { id: idDani, status: "aprovada" }, true);
r = await chama("POST", "/admin/avaliacoes/moderar", { id: idEva, status: "oculta" }, true);
r = await chama("POST", "/admin/avaliacoes/moderar", { id: idAna, status: "qualquer" }, true);
ok("status inválido → 400", r.s === 400, r);
r = await chama("POST", "/admin/avaliacoes/moderar", { id: 99999, status: "aprovada" }, true);
ok("id inexistente → 404", r.s === 404, r);

r = await chama("GET", "/avaliacoes?produto=suave");
ok("público vê só a aprovada da Ana (a da Eva está oculta)", r.j.total === 1 && r.j.media === 5 && r.j.itens.length === 1 && r.j.itens[0].nome === "Ana" && r.j.itens[0].resposta.startsWith("Obrigado"), r.j);
ok("resposta pública NÃO expõe pedido/e-mail", !JSON.stringify(r.j).includes("SNT-") && !JSON.stringify(r.j).includes("@"), r.j);
ok("cabeçalho de cache público de 60s", /max-age=60/.test(r.h.get("cache-control") || ""), r.h.get("cache-control"));
r = await chama("GET", "/avaliacoes");
ok("resumo geral: suave 5,0 (1), extra-forte 2,0 (1), defumado 0 (0)", r.j.resumo.suave.media === 5 && r.j.resumo.suave.total === 1 && r.j.resumo["extra-forte"].media === 2 && r.j.resumo.defumado.total === 0, r.j);
r = await chama("GET", "/avaliacoes?produto=constructor");
ok("produto inválido na leitura → 404", r.s === 404, r);

limiteOk = false;
r = await chama("POST", "/avaliar", base);
ok("limite de requisições estourado → 429", r.s === 429, r);
limiteOk = true;

r = await chama("DELETE", `/admin/avaliacoes?id=${idEva}`, undefined, true);
ok("apagar avaliação → 200 e some do banco", r.s === 200 && !DB.db.prepare("SELECT 1 FROM avaliacoes WHERE id=?").get(idEva), r);
console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTODOS OS TESTES PASSARAM");

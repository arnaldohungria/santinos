// Teste local do checkout do Worker com Mercado Pago falso e limitador de taxa falso (sem rede, sem Cloudflare).
// Rodar:  node worker/test/checkout.test.mjs
const raiz = new URL("../src/", import.meta.url);
const chamadasMP = [];
globalThis.fetch = async (url, init) => {
  chamadasMP.push(String(url));
  if (String(url).includes("/checkout/preferences")) {
    const p = JSON.parse(init.body);
    if (p.items.some((i) => typeof i.unit_price !== "number" || Number.isNaN(i.unit_price))) {
      return new Response(JSON.stringify({ message: "items.0.unit_price must be a number" }), { status: 400 });
    }
    globalThis.ultimaPref = p;
    return new Response(JSON.stringify({ init_point: "https://mp/x", id: "pref1" }), { status: 200 });
  }
  return new Response("{}", { status: 404 });
};
const { default: worker } = await import(new URL("index.js", raiz));
let n = 0;
const env = {
  MP_ACCESS_TOKEN: "x", ALLOWED_ORIGIN: "https://www.santinos.com.br", SITE_URL: "https://www.santinos.com.br",
  RL_CUPOM: { limit: async () => ({ success: ++n <= 3 }) },
};
const chama = async (rota, corpo, metodo = "POST") => {
  const r = await worker.fetch(new Request("https://w.test" + rota, { method: metodo, headers: { "content-type": "application/json", "CF-Connecting-IP": "1.2.3.4" }, body: metodo === "POST" ? JSON.stringify(corpo) : undefined }), env);
  return [r.status, (await r.text()).slice(0, 160)];
};
const F = { cep: "18200000", uf: "SP", opcaoId: "itapetininga" };
const ok = { nome: "A", email: "a@b.c", cpf: "1", whatsapp: "15", endereco: {} };
const teste = (nome, cond) => console.log(cond ? "PASSOU" : "FALHOU", "-", nome);

let r = await chama("/criar-preferencia", { itens: [{ id: "suave", qtd: 1, preco: 1 }], frete: F, comprador: ok });
teste("preço adulterado ignorado (total 1990)", r[0] === 200 && r[1].includes('"total_centavos":1990'));
r = await chama("/criar-preferencia", { itens: [{ id: "constructor", qtd: 1 }], frete: F, comprador: ok });
teste("id 'constructor' → 400 (antes: 502 do MP)", r[0] === 400);
r = await chama("/criar-preferencia", { itens: [{ id: "__proto__", qtd: 1 }], frete: F, comprador: ok });
teste("id '__proto__' → 400", r[0] === 400);
r = await chama("/criar-preferencia", { itens: [null, 5, "x"], frete: F, comprador: ok });
teste("itens lixo → 400 sem quebrar", r[0] === 400);
r = await chama("/criar-preferencia", { itens: Array.from({ length: 21 }, () => ({ id: "suave", qtd: 1 })), frete: F, comprador: ok });
teste("carrinho com 21 linhas → 400", r[0] === 400);
r = await chama("/criar-preferencia", { itens: [{ id: "suave", qtd: 1 }], frete: F, comprador: { ...ok, whatsapp: 15999999999 } });
teste("whatsapp numérico → 200 (antes: 500)", r[0] === 200);
r = await chama("/criar-preferencia", { itens: [{ id: "suave", qtd: 1 }], frete: F, comprador: { nome: "x".repeat(500), endereco: "string", email: { a: 1 } } });
teste("comprador malformado → 200 e saneado", r[0] === 200 && globalThis.ultimaPref.metadata.nome.length === 80 && globalThis.ultimaPref.metadata.endereco === null);
r = await chama("/criar-preferencia", { itens: [{ id: "suave", qtd: 1 }], frete: F, comprador: { ...ok, endereco: { logradouro: "<script>alert(1)</script>", extra: "x" } } });
teste("endereço só aceita chaves esperadas", globalThis.ultimaPref.metadata.endereco.extra === undefined && globalThis.ultimaPref.metadata.endereco.logradouro.includes("<script>"));
r = await chama("/calcular-frete", { itens: [{ id: "constructor", qtd: 1 }], cep: "18200000", uf: "SP" });
teste("frete com id 'constructor' não quebra", r[0] === 200);

chamadasMP.length = 0;
for (const id of ["../../users/me", "123/../x", "abc", "1234567", ""]) await chama("/webhook", { type: "payment", data: { id } });
teste("webhook: ids maliciosos não geram chamada ao MP", chamadasMP.filter((u) => u.includes("/v1/payments")).length === 1 && chamadasMP.some((u) => u.endsWith("/v1/payments/1234567")));

n = 0;
const st = [];
for (let i = 0; i < 6; i++) st.push((await chama("/validar-cupom", { itens: [{ id: "suave", qtd: 1 }], cupom: "X" + i }))[0]);
teste("limite de cupom: 3 passam, resto 429 → " + st.join(","), st.slice(0, 3).every((s) => s !== 429) && st.slice(3).every((s) => s === 429));
delete env.RL_CUPOM;
r = await chama("/validar-cupom", { itens: [{ id: "suave", qtd: 1 }], cupom: "X" });
teste("sem binding de limite, segue funcionando", r[0] !== 429 && r[0] !== 500);

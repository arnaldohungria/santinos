/* Santino's — Worker de checkout (Mercado Pago Checkout Pro)
 *
 * Endpoints:
 *   GET  /health              -> teste de vida
 *   POST /criar-preferencia   -> recebe o carrinho, valida no servidor, cria a
 *                                preferência no Mercado Pago e devolve { init_point }
 *   POST /webhook             -> recebe a notificação de pagamento do Mercado Pago
 *
 * Secrets/vars (wrangler secret put / wrangler.toml [vars]):
 *   MP_ACCESS_TOKEN  (secret)  Access Token de PRODUÇÃO do Mercado Pago
 *   SITE_URL         (var)     ex: https://www.santinos.com.br
 *   ALLOWED_ORIGIN   (var)     origem liberada no CORS (mesmo valor de SITE_URL)
 *   NOTIFY_EMAIL     (var)     (opcional) e-mail para aviso de pedido — TODO
 *
 * ATENÇÃO: a tabela PRECOS e a lógica de frete abaixo são a CÓPIA-VERDADE.
 * O arquivo loja.js do site tem os mesmos números só para exibir. Se mudar
 * preço/frete, mude nos DOIS lugares. Aqui é o que efetivamente cobra.
 */

// Preços em CENTAVOS. >>> PLACEHOLDER — manter igual ao loja.js <<<
const PRECOS = {
  "suave":       { nome: "Santino's Suave",       preco: 2990 },
  "defumado":    { nome: "Santino's Defumado",    preco: 3490 },
  "extra-forte": { nome: "Santino's Extra Forte", preco: 3990 },
};

// Frete fixo por região, em CENTAVOS. >>> PLACEHOLDER <<<
const FRETE_REGIOES = {
  "Sudeste": 1500,
  "Sul": 2200,
  "Centro-Oeste": 2500,
  "Nordeste": 3000,
  "Norte": 3800,
};

const ITAPETININGA = { min: 18200000, max: 18219999 };
const FRETE_GRATIS_ACIMA = null; // centavos ou null

const UF_REGIAO = {
  AC: "Norte", AP: "Norte", AM: "Norte", PA: "Norte", RO: "Norte", RR: "Norte", TO: "Norte",
  AL: "Nordeste", BA: "Nordeste", CE: "Nordeste", MA: "Nordeste", PB: "Nordeste",
  PE: "Nordeste", PI: "Nordeste", RN: "Nordeste", SE: "Nordeste",
  DF: "Centro-Oeste", GO: "Centro-Oeste", MT: "Centro-Oeste", MS: "Centro-Oeste",
  ES: "Sudeste", MG: "Sudeste", RJ: "Sudeste", SP: "Sudeste",
  PR: "Sul", RS: "Sul", SC: "Sul",
};

function cors(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(data, status, env) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json", ...cors(env) },
  });
}

function calcularFrete(cepDigitos, uf, subtotal) {
  const cepNum = parseInt(cepDigitos, 10);
  if (Number.isFinite(cepNum) && cepNum >= ITAPETININGA.min && cepNum <= ITAPETININGA.max) {
    return { valor: 0, rotulo: "Entrega local em Itapetininga" };
  }
  if (FRETE_GRATIS_ACIMA != null && subtotal >= FRETE_GRATIS_ACIMA) {
    return { valor: 0, rotulo: "Frete grátis" };
  }
  const regiao = UF_REGIAO[(uf || "").toUpperCase()];
  if (!regiao || FRETE_REGIOES[regiao] == null) return null;
  return { valor: FRETE_REGIOES[regiao], rotulo: `Frete — ${regiao}` };
}

async function criarPreferencia(req, env) {
  if (!env.MP_ACCESS_TOKEN) {
    return json({ erro: "MP_ACCESS_TOKEN não configurado no Worker." }, 501, env);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ erro: "JSON inválido." }, 400, env);
  }

  const itensReq = Array.isArray(body.itens) ? body.itens : [];
  if (itensReq.length === 0) return json({ erro: "Carrinho vazio." }, 400, env);

  // Revalida itens e recalcula subtotal pelo servidor (ignora qualquer preço vindo do cliente).
  const itensMP = [];
  let subtotal = 0;
  for (const it of itensReq) {
    const prod = PRECOS[it.id];
    const qtd = Math.floor(Number(it.qtd));
    if (!prod || !Number.isFinite(qtd) || qtd < 1 || qtd > 99) {
      return json({ erro: `Item inválido: ${it.id}` }, 400, env);
    }
    subtotal += prod.preco * qtd;
    itensMP.push({
      id: it.id,
      title: prod.nome,
      quantity: qtd,
      currency_id: "BRL",
      unit_price: prod.preco / 100,
    });
  }

  const cep = String(body?.frete?.cep || "").replace(/\D/g, "");
  const uf = String(body?.frete?.uf || "");
  const frete = calcularFrete(cep, uf, subtotal);
  if (!frete) return json({ erro: "Frete indisponível para o CEP informado." }, 400, env);
  if (frete.valor > 0) {
    itensMP.push({
      id: "frete",
      title: frete.rotulo,
      quantity: 1,
      currency_id: "BRL",
      unit_price: frete.valor / 100,
    });
  }

  const c = body.comprador || {};
  const externalRef = "SNT-" + Date.now().toString(36).toUpperCase();
  const site = (env.SITE_URL || "https://www.santinos.com.br").replace(/\/$/, "");

  const preference = {
    items: itensMP,
    payer: {
      name: (c.nome || "").slice(0, 80),
      email: c.email || undefined,
      identification: c.cpf ? { type: "CPF", number: String(c.cpf).replace(/\D/g, "") } : undefined,
    },
    back_urls: {
      success: `${site}/pedido.html?status=sucesso&ref=${externalRef}`,
      pending: `${site}/pedido.html?status=pendente&ref=${externalRef}`,
      failure: `${site}/pedido.html?status=falha&ref=${externalRef}`,
    },
    auto_return: "approved",
    statement_descriptor: "SANTINOS",
    external_reference: externalRef,
    notification_url: new URL("/webhook", req.url).toString(),
    metadata: {
      cep,
      uf,
      endereco: c.endereco || null,
      whatsapp: (c.whatsapp || "").replace(/\D/g, ""),
      subtotal_centavos: subtotal,
      frete_centavos: frete.valor,
    },
  };

  const r = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`,
    },
    body: JSON.stringify(preference),
  });

  const data = await r.json();
  if (!r.ok) {
    return json({ erro: "Mercado Pago recusou a preferência.", detalhe: data }, 502, env);
  }

  return json(
    {
      init_point: data.init_point,
      preference_id: data.id,
      external_reference: externalRef,
      total_centavos: subtotal + frete.valor,
    },
    200,
    env
  );
}

async function webhook(req, env) {
  // O Mercado Pago manda { type, data: { id } } (ou querystring ?type=&data.id=).
  // Aqui só confirmamos recebimento rápido (200). O processamento real vem depois:
  // consultar o pagamento, e, se approved, notificar o Arnaldo / registrar o pedido.
  let payload = {};
  try {
    payload = await req.json();
  } catch {
    /* pode vir vazio */
  }
  const url = new URL(req.url);
  const tipo = payload.type || url.searchParams.get("type");
  const id = payload?.data?.id || url.searchParams.get("data.id");

  // TODO: if (tipo === "payment" && id) { consultar GET /v1/payments/{id} com o token,
  //       checar status === "approved", enviar e-mail para NOTIFY_EMAIL e persistir. }
  console.log("webhook MP recebido:", tipo, id);

  return new Response("ok", { status: 200 });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(env) });
    }

    if (url.pathname === "/health") {
      return json({ ok: true, servico: "santinos-checkout" }, 200, env);
    }

    if (url.pathname === "/criar-preferencia" && req.method === "POST") {
      return criarPreferencia(req, env);
    }

    if (url.pathname === "/webhook") {
      return webhook(req, env);
    }

    return json({ erro: "Rota não encontrada." }, 404, env);
  },
};

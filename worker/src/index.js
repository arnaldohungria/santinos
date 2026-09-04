/* Santino's — Worker de checkout (Mercado Pago Checkout Pro + frete Melhor Envio)
 *
 * Endpoints:
 *   GET  /health              -> teste de vida
 *   POST /calcular-frete      -> recebe { cep, uf, itens }, devolve { opcoes: [...] }
 *                                (várias cotações reais via Melhor Envio, mais barata
 *                                primeiro; cai pra tabela fixa se a API não responder)
 *   POST /criar-preferencia   -> recebe o carrinho + a opção de frete escolhida
 *                                (frete.opcaoId), revalida tudo no servidor e cria a
 *                                preferência no Mercado Pago
 *   POST /webhook             -> recebe a notificação de pagamento do Mercado Pago
 *
 * Secrets/vars (wrangler secret put / wrangler.toml [vars]):
 *   MP_ACCESS_TOKEN        (secret)  Access Token de PRODUÇÃO do Mercado Pago
 *   INTERNAL_SHARED_SECRET (secret)  mesmo valor configurado na Vercel (api/melhor-envio.js);
 *                                    autentica a chamada Worker -> proxy de frete
 *   SITE_URL               (var)     ex: https://www.santinos.com.br — também usado
 *                                    pra achar o proxy de frete (SITE_URL + /api/melhor-envio)
 *   ALLOWED_ORIGIN         (var)     origem liberada no CORS (mesmo valor de SITE_URL)
 *   NOTIFY_EMAIL           (var)     (opcional) e-mail para aviso de pedido — TODO
 *
 * A cotação real do Melhor Envio NÃO é chamada direto daqui — veja o
 * comentário em cotarMelhorEnvio() abaixo. O token do Melhor Envio e o
 * ORIGEM_CEP agora ficam configurados na Vercel (api/melhor-envio.js), não
 * mais neste Worker.
 *
 * ATENÇÃO: a tabela PRECOS e a lógica de frete abaixo são a CÓPIA-VERDADE.
 * O arquivo loja.js do site tem os mesmos números só para exibir/estimar. Se
 * mudar preço/frete, mude nos DOIS lugares. Aqui é o que efetivamente cobra.
 */

// Preços em CENTAVOS. Manter IGUAL ao loja.js. Preço atual: R$ 19,90 (2026-08).
const PRECOS = {
  "suave":       { nome: "Santino's Suave",       preco: 1990 },
  "defumado":    { nome: "Santino's Defumado",    preco: 1990 },
  "extra-forte": { nome: "Santino's Extra Forte", preco: 1990 },
};

// Frete fixo por região, em CENTAVOS — usado só como FALLBACK se o Melhor
// Envio não responder (API fora do ar, sem token configurado, CEP não
// atendido pelas transportadoras cotadas). >>> ainda placeholder <<<
const FRETE_REGIOES = {
  "Sudeste": 1500,
  "Sul": 2200,
  "Centro-Oeste": 2500,
  "Nordeste": 3000,
  "Norte": 3800,
};

const ITAPETININGA = { min: 18200000, max: 18219999 };
const FRETE_GRATIS_ACIMA = null; // centavos ou null

// Nomes de serviço que indicam retirada em ponto físico (não entrega em
// domicílio) — usado só pra rotular a opção com clareza pro cliente, nunca
// pra excluí-la: quem decide é o cliente, escolhendo entre as opções.
const RETIRADA_REGEX = /(ponto|locker|agência|agencia|retirada|caixa\s*postal)/i;

// Caixa de envio por quantidade total de frascos no pedido — cm e kg.
// Frasco de 60ml cheio ≈ 150g (arredondado pra cima de propósito).
// >>> estimativa do Arnaldo, calibrar quando ele pesar uma caixa real <<<
const PACOTES = [
  { max: 1, altura: 8,  largura: 8,  comprimento: 16, peso: 0.25 },
  { max: 2, altura: 8,  largura: 12, comprimento: 16, peso: 0.45 },
  { max: 3, altura: 8,  largura: 16, comprimento: 16, peso: 0.65 },
  { max: 6, altura: 12, largura: 16, comprimento: 20, peso: 1.25 },
];

function escolherPacote(qtdTotal) {
  const base = PACOTES.find((p) => qtdTotal <= p.max) || PACOTES[PACOTES.length - 1];
  if (qtdTotal <= 6) return base;
  // pedido maior que o maior kit calculado: extrapola o peso, mantém a caixa maior
  const extra = qtdTotal - 6;
  return { ...base, peso: +(base.peso + extra * 0.2).toFixed(2) };
}

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

// Cotação real via Melhor Envio — via proxy na Vercel (api/melhor-envio.js).
// Motivo do proxy: chamando o Melhor Envio direto DAQUI (Worker), a API dele
// devolve 401 mesmo com o token certo — provavelmente as duas APIs ficam
// atrás da Cloudflare e a proteção do Melhor Envio bloqueia tráfego
// Worker-a-Worker. Chamando a mesma requisição a partir da Vercel (onde o
// site já está hospedado), funciona normalmente. O proxy só repassa a
// cotação bruta; toda a lógica de filtro/ordenação continua aqui.
async function cotarMelhorEnvio(env, cepDestino, pacote, debug) {
  if (!env.SITE_URL) {
    const msg = "SITE_URL não configurado — usando fallback.";
    console.log("Melhor Envio:", msg);
    if (debug) debug.motivo = msg;
    return null;
  }
  if (!env.INTERNAL_SHARED_SECRET) {
    const msg = "INTERNAL_SHARED_SECRET não configurado — usando fallback.";
    console.log("Melhor Envio:", msg);
    if (debug) debug.motivo = msg;
    return null;
  }
  try {
    const proxyUrl = env.SITE_URL.replace(/\/$/, "") + "/api/melhor-envio";
    const r = await fetch(proxyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": env.INTERNAL_SHARED_SECRET,
      },
      body: JSON.stringify({
        cepDestino,
        pacote: {
          altura: pacote.altura,
          largura: pacote.largura,
          comprimento: pacote.comprimento,
          peso: pacote.peso,
        },
      }),
    });
    if (!r.ok) {
      const corpo = await r.text().catch(() => "");
      const headersObj = {};
      r.headers.forEach((v, k) => { headersObj[k] = v; });
      const msg = `Proxy Vercel respondeu ${r.status} — usando fallback. Corpo: ${corpo.slice(0, 300)}`;
      console.log("Melhor Envio:", msg, JSON.stringify(headersObj));
      if (debug) {
        debug.motivo = msg;
        debug.statusText = r.statusText;
        debug.headersResposta = headersObj;
        debug.proxyUrl = proxyUrl;
      }
      return null;
    }
    const cotacoes = await r.json();
    if (!Array.isArray(cotacoes)) {
      const msg = "resposta não é uma lista — usando fallback: " + JSON.stringify(cotacoes).slice(0, 300);
      console.log("Melhor Envio:", msg);
      if (debug) debug.motivo = msg;
      return null;
    }

    const validas = cotacoes
      .filter((c) => c && !c.error && c.price)
      .map((c) => {
        const rotulo = `${c.company?.name || ""} ${c.name || ""}`.trim();
        return {
          id: String(c.id),
          valor: Math.round(parseFloat(c.price) * 100),
          rotulo,
          prazo: Number.isFinite(c.delivery_time) ? c.delivery_time : null,
          retirada: RETIRADA_REGEX.test(rotulo),
        };
      })
      .filter((c) => Number.isFinite(c.valor) && c.valor > 0)
      .sort((a, b) => a.valor - b.valor)
      .slice(0, 5);

    if (!validas.length) {
      const msg = "nenhuma cotação válida devolvida — usando fallback: " + JSON.stringify(cotacoes).slice(0, 300);
      console.log("Melhor Envio:", msg);
      if (debug) debug.motivo = msg;
    }
    return validas.length ? validas : null;
  } catch (e) {
    const msg = "exceção na chamada — usando fallback: " + (e?.message || e);
    console.log("Melhor Envio:", msg);
    if (debug) debug.motivo = msg;
    return null; // API fora do ar / erro de rede -> quem chamou cai no fallback
  }
}

// Orquestrador: Itapetininga grátis -> frete grátis por valor -> cotações
// reais (Melhor Envio, várias opções) -> fallback pra tabela fixa por região
// se a cotação falhar. Sempre devolve uma LISTA (1 item nos casos fixos).
// `debug`, se passado, recebe o motivo do fallback (diagnóstico temporário).
async function calcularOpcoesFrete(env, cepDigitos, uf, subtotal, qtdTotal, debug) {
  const cepNum = parseInt(cepDigitos, 10);
  if (Number.isFinite(cepNum) && cepNum >= ITAPETININGA.min && cepNum <= ITAPETININGA.max) {
    return [
      {
        id: "itapetininga",
        valor: 0,
        rotulo: "Entrega local em Itapetininga — grátis, em até 48h",
        prazo: 2,
        retirada: false,
      },
    ];
  }
  if (FRETE_GRATIS_ACIMA != null && subtotal >= FRETE_GRATIS_ACIMA) {
    return [{ id: "gratis-valor", valor: 0, rotulo: "Frete grátis", prazo: null, retirada: false }];
  }

  const pacote = escolherPacote(Math.max(1, qtdTotal || 1));
  const reais = await cotarMelhorEnvio(env, cepDigitos, pacote, debug);
  if (reais) return reais;

  const regiao = UF_REGIAO[(uf || "").toUpperCase()];
  if (!regiao || FRETE_REGIOES[regiao] == null) return null;
  return [
    {
      id: `fallback-${regiao}`,
      valor: FRETE_REGIOES[regiao],
      rotulo: `Frete — ${regiao} (estimado)`,
      prazo: null,
      retirada: false,
    },
  ];
}

// POST /calcular-frete — cotação em tempo real pro checkout (antes de pagar).
async function calcularFreteEndpoint(req, env) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ erro: "JSON inválido." }, 400, env);
  }

  const itensReq = Array.isArray(body.itens) ? body.itens : [];
  let subtotal = 0;
  let qtdTotal = 0;
  for (const it of itensReq) {
    const prod = PRECOS[it.id];
    const qtd = Math.floor(Number(it.qtd));
    if (!prod || !Number.isFinite(qtd) || qtd < 1) continue;
    subtotal += prod.preco * qtd;
    qtdTotal += qtd;
  }

  const cep = String(body.cep || "").replace(/\D/g, "");
  const uf = String(body.uf || "");
  if (cep.length !== 8) return json({ erro: "CEP inválido." }, 400, env);

  // TODO(temporário): _debug ajuda a diagnosticar por que caiu no fallback.
  // Tirar depois que o Melhor Envio estiver 100% confirmado em produção.
  const debug = {};
  const opcoes = await calcularOpcoesFrete(env, cep, uf, subtotal, qtdTotal || 1, debug);
  if (!opcoes) return json({ erro: "Frete indisponível para este CEP.", _debug: debug }, 400, env);
  return json({ opcoes, _debug: debug.motivo ? debug : undefined }, 200, env);
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
  let qtdTotal = 0;
  for (const it of itensReq) {
    const prod = PRECOS[it.id];
    const qtd = Math.floor(Number(it.qtd));
    if (!prod || !Number.isFinite(qtd) || qtd < 1 || qtd > 99) {
      return json({ erro: `Item inválido: ${it.id}` }, 400, env);
    }
    subtotal += prod.preco * qtd;
    qtdTotal += qtd;
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
  const opcaoId = String(body?.frete?.opcaoId || "");

  // Recotação FRESCA no servidor (nunca confia no valor que o cliente mandou).
  // Se a opção que o cliente escolheu ainda existir na cotação nova, usa o
  // preço dela; se sumiu (preço mudou, transportadora saiu do ar), usa a mais
  // barata disponível agora em vez de travar o checkout.
  const opcoes = await calcularOpcoesFrete(env, cep, uf, subtotal, qtdTotal);
  if (!opcoes) return json({ erro: "Frete indisponível para o CEP informado." }, 400, env);
  const frete = opcoes.find((o) => o.id === opcaoId) || opcoes[0];
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

  // O Mercado Pago normalmente responde JSON, mas token inválido/expirado,
  // erro de rede ou um bloqueio no meio do caminho pode devolver HTML — sem
  // isso aqui, r.json() lança uma exceção não tratada e o Cloudflare mostra
  // a página de erro genérica pro cliente em vez de uma mensagem decente.
  let data;
  try {
    data = await r.json();
  } catch {
    return json({ erro: "Mercado Pago não respondeu como esperado. Tente novamente." }, 502, env);
  }
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
    try {
      return await handleRequest(req, env);
    } catch (e) {
      // Rede de segurança: qualquer exceção não prevista aqui dentro (bug,
      // API externa se comportando de forma inesperada, etc.) vira uma
      // resposta JSON decente em vez da página de erro genérica da
      // Cloudflare — o cliente nunca deveria ver isso no checkout.
      console.log("erro não tratado:", e?.stack || e);
      return json({ erro: "Erro interno no Worker. Tente novamente em instantes." }, 500, env);
    }
  },
};

async function handleRequest(req, env) {
  const url = new URL(req.url);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors(env) });
  }

  if (url.pathname === "/health") {
    return json({ ok: true, servico: "santinos-checkout" }, 200, env);
  }

  if (url.pathname === "/calcular-frete" && req.method === "POST") {
    return calcularFreteEndpoint(req, env);
  }

  if (url.pathname === "/criar-preferencia" && req.method === "POST") {
    return criarPreferencia(req, env);
  }

  if (url.pathname === "/webhook") {
    return webhook(req, env);
  }

  return json({ erro: "Rota não encontrada." }, 404, env);
}

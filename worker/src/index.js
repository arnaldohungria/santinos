/* Santino's — Worker de checkout (Mercado Pago Checkout Pro + frete Melhor Envio)
 *
 * Endpoints:
 *   GET  /health              -> teste de vida
 *   POST /calcular-frete      -> recebe { cep, uf, itens }, devolve { opcoes: [...] }
 *                                (várias cotações reais via Melhor Envio, mais barata
 *                                primeiro; cai pra tabela fixa se a API não responder)
 *   POST /validar-cupom       -> recebe { cupom, itens }, devolve { valido, tipo, valor,
 *                                descontoCentavos, mensagem } — cotação do desconto em
 *                                tempo real pro checkout, antes de pagar
 *   POST /criar-preferencia   -> recebe o carrinho + a opção de frete escolhida
 *                                (frete.opcaoId) + o cupom (opcional), revalida tudo no
 *                                servidor e cria a preferência no Mercado Pago
 *   POST /webhook             -> recebe a notificação de pagamento do Mercado Pago;
 *                                se aprovado, consulta o pagamento e grava em D1 (pedidos)
 *   GET  /admin/pedidos       -> (autenticado) lista os pedidos gravados
 *   GET|POST|DELETE /admin/cupons -> (autenticado) lista/cria-edita/apaga cupons
 *
 * Secrets/vars (wrangler secret put / wrangler.toml [vars]):
 *   MP_ACCESS_TOKEN        (secret)  Access Token de PRODUÇÃO do Mercado Pago
 *   INTERNAL_SHARED_SECRET (secret)  mesmo valor configurado na Vercel (api/melhor-envio.js);
 *                                    autentica a chamada Worker -> proxy de frete
 *   ADMIN_PASSWORD         (secret)  senha do painel de admin (Basic Auth, usuário "admin")
 *   SITE_URL               (var)     ex: https://www.santinos.com.br — também usado
 *                                    pra achar o proxy de frete (SITE_URL + /api/melhor-envio)
 *   ALLOWED_ORIGIN         (var)     origem liberada no CORS (mesmo valor de SITE_URL)
 *   NOTIFY_EMAIL           (var)     (opcional) e-mail para aviso de pedido — TODO
 *   DB                     (binding D1, wrangler.toml)  banco com as tabelas
 *                                    "pedidos" e "cupons" — ver worker/schema.sql
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

// Cupons de desconto ficam na tabela D1 "cupons" (ver validarCupom() e
// worker/schema.sql), editáveis pelo painel de admin — não são mais uma
// constante fixa aqui no código.

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
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
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
//
// Usa FRETE_PROXY_URL (o domínio *.vercel.app do projeto), não SITE_URL
// (www.santinos.com.br) — ver README para o porquê.
async function cotarMelhorEnvio(env, cepDestino, pacote) {
  if (!env.FRETE_PROXY_URL) {
    console.log("Melhor Envio: FRETE_PROXY_URL não configurado — usando fallback.");
    return null;
  }
  if (!env.INTERNAL_SHARED_SECRET) {
    console.log("Melhor Envio: INTERNAL_SHARED_SECRET não configurado — usando fallback.");
    return null;
  }
  try {
    const proxyUrl = env.FRETE_PROXY_URL.replace(/\/$/, "") + "/api/melhor-envio";
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
      console.log(`Melhor Envio: proxy Vercel respondeu ${r.status} — usando fallback. Corpo: ${corpo.slice(0, 300)}`);
      return null;
    }
    const cotacoes = await r.json();
    if (!Array.isArray(cotacoes)) {
      console.log("Melhor Envio: resposta não é uma lista — usando fallback:", JSON.stringify(cotacoes).slice(0, 300));
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
      console.log("Melhor Envio: nenhuma cotação válida devolvida — usando fallback:", JSON.stringify(cotacoes).slice(0, 300));
    }
    return validas.length ? validas : null;
  } catch (e) {
    console.log("Melhor Envio: exceção na chamada — usando fallback:", e?.message || e);
    return null; // API fora do ar / erro de rede -> quem chamou cai no fallback
  }
}

// Orquestrador: Itapetininga grátis -> frete grátis por valor -> cotações
// reais (Melhor Envio, várias opções) -> fallback pra tabela fixa por região
// se a cotação falhar. Sempre devolve uma LISTA (1 item nos casos fixos).
async function calcularOpcoesFrete(env, cepDigitos, uf, subtotal, qtdTotal) {
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
  const reais = await cotarMelhorEnvio(env, cepDigitos, pacote);
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

  const opcoes = await calcularOpcoesFrete(env, cep, uf, subtotal, qtdTotal || 1);
  if (!opcoes) return json({ erro: "Frete indisponível para este CEP." }, 400, env);
  return json({ opcoes }, 200, env);
}

// Confere um código de cupom contra a tabela D1 "cupons" (só considera
// ativo=1) e calcula o desconto (em CENTAVOS) pro subtotal informado. Nunca
// deixa o desconto passar do subtotal (não gera valor negativo). Devolve
// null se o código não existir, estiver desativado, ou não houver banco.
async function validarCupom(env, codigoBruto, subtotal) {
  const codigo = String(codigoBruto || "").trim().toUpperCase();
  if (!codigo || !env.DB) return null;
  const row = await env.DB.prepare("SELECT tipo, valor FROM cupons WHERE codigo = ?1 AND ativo = 1")
    .bind(codigo)
    .first();
  if (!row) return null;
  const bruto = row.tipo === "percentual" ? Math.round((subtotal * row.valor) / 100) : row.valor;
  const descontoCentavos = Math.max(0, Math.min(bruto, subtotal));
  return { codigo, tipo: row.tipo, valor: row.valor, descontoCentavos };
}

// POST /validar-cupom — confere o cupom em tempo real pro checkout, antes de pagar.
async function validarCupomEndpoint(req, env) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ erro: "JSON inválido." }, 400, env);
  }

  const itensReq = Array.isArray(body.itens) ? body.itens : [];
  let subtotal = 0;
  for (const it of itensReq) {
    const prod = PRECOS[it.id];
    const qtd = Math.floor(Number(it.qtd));
    if (!prod || !Number.isFinite(qtd) || qtd < 1) continue;
    subtotal += prod.preco * qtd;
  }

  const resultado = await validarCupom(env, body.cupom, subtotal);
  if (!resultado) return json({ valido: false, mensagem: "Cupom inválido." }, 200, env);
  return json({ valido: true, ...resultado }, 200, env);
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

  // Recotação FRESCA do cupom também — mesmo motivo do frete: nunca confia
  // no desconto que o cliente mandou, sempre recalcula contra o subtotal
  // real de novo aqui.
  const cupom = body.cupom ? await validarCupom(env, body.cupom, subtotal) : null;
  if (cupom && cupom.descontoCentavos > 0) {
    itensMP.push({
      id: "desconto",
      title: `Cupom ${cupom.codigo}`,
      quantity: 1,
      currency_id: "BRL",
      unit_price: -(cupom.descontoCentavos / 100),
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
      nome: c.nome || null,
      email: c.email || null,
      cpf: c.cpf ? String(c.cpf).replace(/\D/g, "") : null,
      whatsapp: (c.whatsapp || "").replace(/\D/g, ""),
      itens: itensReq.map((it) => ({ id: it.id, qtd: Math.floor(Number(it.qtd)) })),
      subtotal_centavos: subtotal,
      frete_centavos: frete.valor,
      cupom: cupom ? cupom.codigo : null,
      desconto_centavos: cupom ? cupom.descontoCentavos : 0,
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
      total_centavos: subtotal + frete.valor - (cupom ? cupom.descontoCentavos : 0),
    },
    200,
    env
  );
}

// Grava/atualiza um pedido na tabela D1 "pedidos" a partir do objeto de
// pagamento que a API do Mercado Pago devolve. Upsert por external_reference
// (é a nossa referência única, gerada em criarPreferencia) — assim, se o
// Mercado Pago reenviar o mesmo webhook (ele faz isso), só atualiza o status
// em vez de duplicar a linha.
async function salvarPedido(env, pagamento) {
  if (!env.DB) return;
  const m = pagamento.metadata || {};
  const ref = pagamento.external_reference || `mp-${pagamento.id}`;
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO pedidos (
       external_reference, mp_payment_id, status, nome, email, whatsapp, cpf,
       endereco_json, itens_json, subtotal_centavos, frete_centavos,
       desconto_centavos, cupom, total_centavos, criado_em, atualizado_em
     ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?15)
     ON CONFLICT(external_reference) DO UPDATE SET
       mp_payment_id = excluded.mp_payment_id,
       status = excluded.status,
       atualizado_em = excluded.atualizado_em`
  )
    .bind(
      ref,
      String(pagamento.id || ""),
      pagamento.status || "desconhecido",
      m.nome || null,
      m.email || pagamento.payer?.email || null,
      m.whatsapp || null,
      m.cpf || null,
      JSON.stringify(m.endereco || null),
      JSON.stringify(m.itens || []),
      Number.isFinite(m.subtotal_centavos) ? m.subtotal_centavos : null,
      Number.isFinite(m.frete_centavos) ? m.frete_centavos : null,
      Number.isFinite(m.desconto_centavos) ? m.desconto_centavos : 0,
      m.cupom || null,
      Number.isFinite(pagamento.transaction_amount) ? Math.round(pagamento.transaction_amount * 100) : null,
      agora
    )
    .run();
}

async function webhook(req, env) {
  // O Mercado Pago manda { type, data: { id } } (ou querystring ?type=&data.id=).
  // Sempre respondemos 200 rápido (se demorar ou falhar, o Mercado Pago
  // reenvia depois) — qualquer erro no processamento abaixo só fica no log.
  let payload = {};
  try {
    payload = await req.json();
  } catch {
    /* pode vir vazio */
  }
  const url = new URL(req.url);
  const tipo = payload.type || url.searchParams.get("type");
  const id = payload?.data?.id || url.searchParams.get("data.id");
  console.log("webhook MP recebido:", tipo, id);

  if (tipo === "payment" && id && env.MP_ACCESS_TOKEN) {
    try {
      const r = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, {
        headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` },
      });
      if (r.ok) {
        const pagamento = await r.json();
        await salvarPedido(env, pagamento);
      } else {
        console.log("webhook: falha ao consultar pagamento", r.status);
      }
    } catch (e) {
      console.log("webhook: erro ao processar pagamento:", e?.message || e);
    }
  }

  // TODO: notificar o Arnaldo por e-mail (NOTIFY_EMAIL) quando status === "approved".
  return new Response("ok", { status: 200 });
}

// Confere o header "Authorization: Basic usuario:senha" contra ADMIN_PASSWORD
// (usuário fixo "admin"). Sem ADMIN_PASSWORD configurado, ninguém entra.
function adminAutorizado(req, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Basic ")) return false;
  try {
    const [usuario, senha] = atob(auth.slice(6)).split(":");
    return usuario === "admin" && senha === env.ADMIN_PASSWORD;
  } catch {
    return false;
  }
}

function naoAutorizado(env) {
  return new Response(JSON.stringify({ erro: "Não autorizado." }), {
    status: 401,
    headers: { "Content-Type": "application/json", "WWW-Authenticate": 'Basic realm="admin"', ...cors(env) },
  });
}

// GET /admin/pedidos — lista os pedidos mais recentes.
async function adminPedidos(req, env) {
  if (!adminAutorizado(req, env)) return naoAutorizado(env);
  if (!env.DB) return json({ erro: "Banco de dados não configurado." }, 500, env);
  const { results } = await env.DB.prepare(
    "SELECT * FROM pedidos ORDER BY criado_em DESC LIMIT 300"
  ).all();
  const pedidos = results.map((p) => ({
    ...p,
    endereco: p.endereco_json ? JSON.parse(p.endereco_json) : null,
    itens: p.itens_json ? JSON.parse(p.itens_json) : [],
    endereco_json: undefined,
    itens_json: undefined,
  }));
  return json({ pedidos }, 200, env);
}

// GET|POST|DELETE /admin/cupons — lista, cria/edita (upsert) ou apaga cupons.
async function adminCupons(req, env) {
  if (!adminAutorizado(req, env)) return naoAutorizado(env);
  if (!env.DB) return json({ erro: "Banco de dados não configurado." }, 500, env);

  if (req.method === "GET") {
    const { results } = await env.DB.prepare("SELECT * FROM cupons ORDER BY criado_em DESC").all();
    return json({ cupons: results }, 200, env);
  }

  if (req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch {
      return json({ erro: "JSON inválido." }, 400, env);
    }
    const codigo = String(body.codigo || "").trim().toUpperCase();
    const tipo = body.tipo === "fixo" ? "fixo" : "percentual";
    const valor = Math.max(0, Math.floor(Number(body.valor) || 0));
    const ativo = body.ativo === false ? 0 : 1;
    if (!codigo || !valor) return json({ erro: "Código e valor são obrigatórios." }, 400, env);
    await env.DB.prepare(
      `INSERT INTO cupons (codigo, tipo, valor, ativo, criado_em) VALUES (?1,?2,?3,?4,?5)
       ON CONFLICT(codigo) DO UPDATE SET tipo = excluded.tipo, valor = excluded.valor, ativo = excluded.ativo`
    )
      .bind(codigo, tipo, valor, ativo, new Date().toISOString())
      .run();
    return json({ ok: true }, 200, env);
  }

  if (req.method === "DELETE") {
    const codigo = String(new URL(req.url).searchParams.get("codigo") || "").trim().toUpperCase();
    if (!codigo) return json({ erro: "Código é obrigatório." }, 400, env);
    await env.DB.prepare("DELETE FROM cupons WHERE codigo = ?1").bind(codigo).run();
    return json({ ok: true }, 200, env);
  }

  return json({ erro: "Método não permitido." }, 405, env);
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

  if (url.pathname === "/validar-cupom" && req.method === "POST") {
    return validarCupomEndpoint(req, env);
  }

  if (url.pathname === "/criar-preferencia" && req.method === "POST") {
    return criarPreferencia(req, env);
  }

  if (url.pathname === "/webhook") {
    return webhook(req, env);
  }

  if (url.pathname === "/admin/pedidos" && req.method === "GET") {
    return adminPedidos(req, env);
  }

  if (url.pathname === "/admin/cupons") {
    return adminCupons(req, env);
  }

  return json({ erro: "Rota não encontrada." }, 404, env);
}

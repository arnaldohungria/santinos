// Helpers compartilhados entre o checkout (index.js) e o painel (admin.js).

export function cors(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "600",
  };
}

export function json(data, status, env, extraHeaders) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json", ...cors(env), ...(extraHeaders || {}) },
  });
}

// Normaliza qualquer data que o Mercado Pago devolva (ex: "2026-09-17T14:04:48.000-04:00")
// pra ISO em UTC ("...Z"), que ordena certo como texto no banco.
export function normalizarData(valor) {
  if (!valor) return null;
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// "Hoje" no fuso de Brasília (YYYY-MM-DD), pra validade de cupom.
export function hojeBrasilia() {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

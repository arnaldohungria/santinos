/* Painel Santino's — estado compartilhado e acesso ao Worker. */

// Em localhost o painel conversa com o Worker de teste local; em produção, com o Worker real.
export const WORKER_URL = ["localhost", "127.0.0.1"].includes(location.hostname)
  ? "http://localhost:8787"
  : "https://santinos-checkout.santinos.workers.dev";

const CHAVE_AUTH = "santinos_admin_auth";
const CHAVE_PERIODO = "santinos_admin_periodo";

export const S = {
  pedidos: [],
  cupons: [],
  config: {},
  produtos: {},
  aba: "dashboard",
  periodo: { tipo: "30d", custom: null },
  carregadoEm: null,
  sel: new Set(), // pedidos marcados na lista (referências)
  pedidosUI: { q: "", pgto: "", envio: "", uf: "", metodo: "", cupom: "", campo: "_data", dir: "desc", pagina: 1, porPagina: 25 },
  clientesUI: { q: "", seg: "compraram", campo: "gasto", dir: "desc", pagina: 1, porPagina: 25 },
  relatorioUI: { tipo: "vendas" },
};

/* ---------------- sessão (Basic Auth guardado só na aba) ---------------- */

// btoa só aceita Latin-1; senhas com acento/emoji precisam passar por UTF-8.
function base64Utf8(texto) {
  const bytes = new TextEncoder().encode(texto);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export const sessao = {
  tem() { try { return !!sessionStorage.getItem(CHAVE_AUTH); } catch { return false; } },
  header() { try { const v = sessionStorage.getItem(CHAVE_AUTH); return v ? { Authorization: "Basic " + v } : {}; } catch { return {}; } },
  salvar(senha) { try { sessionStorage.setItem(CHAVE_AUTH, base64Utf8("admin:" + senha)); } catch { /* aba privada */ } },
  limpar() { try { sessionStorage.removeItem(CHAVE_AUTH); } catch { /* nada */ } },
};

export function lerPeriodoSalvo() {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE_PERIODO) || "null");
    if (v && typeof v.tipo === "string") S.periodo = { tipo: v.tipo, custom: v.custom || null };
  } catch { /* usa o padrão */ }
}
export function salvarPeriodo() {
  try { localStorage.setItem(CHAVE_PERIODO, JSON.stringify(S.periodo)); } catch { /* nada */ }
}

/* ---------------- chamadas ao Worker ---------------- */

export async function api(caminho, opcoes = {}) {
  const r = await fetch(WORKER_URL + caminho, {
    ...opcoes,
    headers: { ...sessao.header(), ...(opcoes.body ? { "Content-Type": "application/json" } : {}), ...(opcoes.headers || {}) },
  });
  let corpo = null;
  try { corpo = await r.json(); } catch { /* resposta sem JSON */ }
  if (r.status === 401) {
    sessao.limpar();
    document.dispatchEvent(new CustomEvent("admin:sair", { detail: "Sessão expirada. Entre de novo." }));
  }
  if (!r.ok) {
    const e = new Error((corpo && corpo.erro) || `Erro ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return corpo;
}

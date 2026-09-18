/* Painel Santino's — utilitários compartilhados.
 *
 * SEGURANÇA: os dados dos pedidos (nome, endereço, observações…) vêm de
 * clientes e NUNCA são confiáveis. Todo HTML é montado com a tag `html`,
 * que escapa qualquer valor interpolado por padrão. Só `raw()` (ou um
 * outro `html`` ` aninhado) passa sem escape.
 */

const MAPA_ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => MAPA_ESC[c]);

class Raw {
  constructor(s) { this.s = s; }
}
export const raw = (s) => new Raw(String(s));

export function render(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join("");
  if (v === null || v === undefined || v === false) return "";
  return esc(v);
}
export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => { out += render(v) + strings[i + 1]; });
  return new Raw(out);
}
export const setHTML = (el, conteudo) => { el.innerHTML = render(conteudo); };

/* ---------------- ícones (traço simples, herdam a cor do texto) ---------------- */

const ICONES = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  pedidos: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  clientes: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.5 3.3-5.5 6.5-5.5s5.9 2 6.5 5.5"/><circle cx="17.5" cy="9" r="2.5"/><path d="M17 14.5c2.500.2 4.200 1.900 4.700 4.500"/>',
  cupons: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V4h9l8.600 8.600a2 2 0 0 1 0 2.800z"/><circle cx="7.500" cy="8.500" r="1.300"/>',
  relatorios: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M8 13h8M8 17h8M8 9h3"/>',
  config: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.900-3M4 5v4h4"/><path d="M4 13a8 8 0 0 0 14.900 3M20 19v-4h-4"/>',
  download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
  print: '<path d="M7 9V3h10v6M7 17H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2"/><rect x="7" y="14" width="10" height="7"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
  whatsapp: '<path d="M3 21l1.600-5A8.500 8.500 0 1 1 8 19.400z"/><path d="M9 9.500c.3 2.600 2.900 4.900 5.500 5.500l1.200-1.300-2.200-1-.9.900c-1-.5-1.900-1.400-2.400-2.400l.9-.9-1-2.200z"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  search: '<circle cx="11" cy="11" r="6.500"/><path d="M16 16l4.500 4.500"/>',
  check: '<path d="M5 12.500l4.500 4.500L19 7"/>',
  clock: '<circle cx="12" cy="12" r="8.500"/><path d="M12 7.500V12l3 2"/>',
  xcircle: '<circle cx="12" cy="12" r="8.500"/><path d="M9 9l6 6M15 9l-6 6"/>',
  truck: '<path d="M3 6h11v10H3zM14 9h4l3 3v4h-7z"/><circle cx="7" cy="18" r="1.800"/><circle cx="17" cy="18" r="1.800"/>',
  box: '<path d="M4 8l8-4 8 4v9l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v9"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  undo: '<path d="M9 14L4 9l5-5M4 9h9a6 6 0 0 1 0 12h-3"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h0"/>',
  edit: '<path d="M4 20h4L19 9a2.800 2.800 0 0 0-4-4L4 16z"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  pin: '<path d="M12 21s7-6.200 7-12a7 7 0 0 0-14 0c0 5.800 7 12 7 12z"/><circle cx="12" cy="9" r="2.500"/>',
  card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>',
  star: '<path d="M12 3l2.800 5.700 6.200.9-4.500 4.400 1.100 6.200L12 17.200 6.400 20.200l1.100-6.200L3 9.600l6.200-.9z"/>',
};
export function icone(nome, tam = 16) {
  return raw(`<svg class="ic" width="${tam}" height="${tam}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[nome] || ""}</svg>`);
}

/* ---------------- números e moeda ---------------- */

const fmtMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const fmtInt = new Intl.NumberFormat("pt-BR");
export const brl = (centavos) => fmtMoeda.format((centavos || 0) / 100);
export const num = (n) => fmtInt.format(n || 0);
export const pct = (x, casas = 1) => `${(x * 100).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;

// "1.234,50" | "12,5" | "12.50" | "12" → centavos (inteiro) ou null se vazio/inválido
export function parseBRL(texto) {
  let t = String(texto ?? "").replace(/[^\d.,-]/g, "").trim();
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/\.\d{1,2}$/.test(t)) t = t; // ponto decimal
  else t = t.replace(/\./g, "");
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}
export const centavosParaInput = (c) => (c === null || c === undefined ? "" : (c / 100).toFixed(2).replace(".", ","));

export function fmtTel(v) {
  const d = String(v || "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return String(v || "");
}
export function fmtCPF(v) {
  const d = String(v || "").replace(/\D/g, "");
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : String(v || "");
}
export function fmtCEP(v) {
  const d = String(v || "").replace(/\D/g, "");
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : String(v || "");
}
export function waLink(tel, texto) {
  let d = String(tel || "").replace(/\D/g, "");
  if (d.length < 10) return null;
  if (d.length <= 11) d = "55" + d;
  return `https://wa.me/${d}${texto ? "?text=" + encodeURIComponent(texto) : ""}`;
}

/* ---------------- datas (sempre no fuso de Brasília) ---------------- */

export const TZ = "America/Sao_Paulo";
const fmtDia = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }); // → 2026-09-18
const fmtHora = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "numeric", hour12: false });
const fmtDataHora = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export const diaBRT = (iso) => (iso ? fmtDia.format(new Date(iso)) : "");
export const horaBRT = (iso) => (Number(fmtHora.format(new Date(iso))) % 24);
export const hojeBRT = () => fmtDia.format(new Date());
const fmtCurta = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
export const dataHoraCurta = (iso) => (iso ? fmtCurta.format(new Date(iso)).replace(",", "") : "—");
export const dataHoraBR = (iso) => (iso ? fmtDataHora.format(new Date(iso)).replace(",", "") : "—");
export function dataBR(ymd) {
  if (!ymd) return "—";
  const [a, m, d] = ymd.split("-");
  return `${d}/${m}/${a}`;
}
export const diaMes = (ymd) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
const paraUTC = (ymd) => new Date(`${ymd}T12:00:00Z`);
export const dowDe = (ymd) => paraUTC(ymd).getUTCDay();
export function addDias(ymd, n) {
  const d = paraUTC(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const diffDias = (a, b) => Math.round((paraUTC(b) - paraUTC(a)) / 86400000); // b - a
export function listaDias(de, ate) {
  const out = [];
  for (let d = de; d <= ate; d = addDias(d, 1)) out.push(d);
  return out;
}
export function primeiroDiaDoMes(ymd) { return ymd.slice(0, 8) + "01"; }
export function ultimoDiaDoMes(ymd) {
  const [a, m] = ymd.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}
export const NOME_MES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export const NOME_DOW = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

export function haQuanto(iso) {
  if (!iso) return "—";
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `há ${d} ${d === 1 ? "dia" : "dias"}`;
  const m = Math.floor(d / 30);
  return `há ${m} ${m === 1 ? "mês" : "meses"}`;
}

/* ---------------- CSV / download / clipboard ---------------- */

// CSV pro Excel em português: separador ";", decimal com vírgula, BOM UTF-8.
// Textos que começam com = + - @ ganham um apóstrofo (evita "injeção de
// fórmula": um cliente que digitou =HYPERLINK(...) no nome não vira código
// dentro da planilha do Arnaldo).
export function csv(cabecalho, linhas) {
  const celula = (v) => {
    if (v === null || v === undefined) return "";
    if (typeof v === "number") return String(v).replace(".", ",");
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [cabecalho, ...linhas].map((l) => l.map(celula).join(";")).join("\r\n");
}
export function baixar(nome, conteudo, mime = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([conteudo], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export async function copiar(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = texto;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { /* sem permissão */ }
    ta.remove();
    return ok;
  }
}

/* ---------------- toast ---------------- */

export function toast(msg, tipo = "info", ms = 3600) {
  const box = document.getElementById("toasts");
  if (!box) return;
  const el = document.createElement("div");
  el.className = `toast toast-${tipo}`;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => { el.classList.add("saindo"); setTimeout(() => el.remove(), 250); }, ms);
}

export const debounce = (fn, ms = 200) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

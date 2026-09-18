/* Painel Santino's — pequenos componentes de interface (retornam html seguro). */
import { html, icone, pct } from "./util.js";
import { pgtoInfo, ENVIO } from "./dados.js";

export function pill(info) {
  return html`<span class="pill pill-${info.cls}">${icone(info.ic, 13)}<span>${info.rot}</span></span>`;
}
export const pillPgto = (p) => pill(pgtoInfo(p.status));
export function pillEnvio(p) {
  if (!p._pago) return html`<span class="muted">—</span>`;
  return pill(ENVIO[p.status_envio] || ENVIO.novo);
}

// Variação vs período anterior. Cor + seta + texto (nunca só a cor).
export function chipDelta(d, textoBase = "vs período anterior") {
  if (!d) return html`<span class="delta delta-neutro">sem base de comparação</span>`;
  if (d.novo) return html`<span class="delta delta-up">${icone("up", 13)}<b>novo</b><span class="delta-base">${textoBase}</span></span>`;
  const sobe = d.pct >= 0;
  return html`<span class="delta ${sobe ? "delta-up" : "delta-down"}">${icone(sobe ? "up" : "down", 13)}<b>${pct(Math.abs(d.pct))}</b><span class="delta-base">${textoBase}</span></span>`;
}

export function botao(rotulo, { icon, cls = "", acao, attrs = {} } = {}) {
  const extra = Object.entries(attrs).map(([k, v]) => html` data-${k}="${v}"`);
  return html`<button type="button" class="btn ${cls}" data-acao="${acao}"${extra}>${icon ? icone(icon, 15) : ""}<span>${rotulo}</span></button>`;
}

export function vazio(titulo, texto, icon = "box") {
  return html`<div class="vazio">${icone(icon, 30)}<strong>${titulo}</strong><p>${texto}</p></div>`;
}

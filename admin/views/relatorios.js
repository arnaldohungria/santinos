/* Painel Santino's — central de relatórios (tela, CSV pro Excel, impressão/PDF). */
import { S } from "../state.js";
import { html, setHTML, icone, num, dataBR, csv, baixar, toast } from "../util.js";
import { RELATORIOS, gerar } from "../relatorios-def.js";
import { imprimirRelatorio } from "../impressao.js";
import { vazio } from "../comp.js";

const LIMITE_PREVIA = 200;

export default function relatoriosView(ctx) {
  let el = null;
  let atual = null;

  function dados() {
    return { pedidos: ctx.pedidosPeriodo(), todos: S.pedidos, periodo: ctx.periodo(), produtos: S.produtos, config: S.config, cupons: S.cupons };
  }

  function esqueleto() {
    setHTML(el, html`
      <div class="grade-relatorios">
        <nav class="rel-lista" aria-label="Tipos de relatório">
          ${RELATORIOS.map((r) => html`<button type="button" class="rel-item ${S.relatorioUI.tipo === r.id ? "ativo" : ""}" data-rel="${r.id}">
            <span class="rel-ic">${icone(r.icone, 18)}</span><span><strong>${r.nome}</strong><small>${r.desc}</small></span></button>`)}
        </nav>
        <section class="card rel-previa"><div id="relPrevia"></div></section>
      </div>`);
  }

  function previa() {
    const per = ctx.periodo();
    atual = gerar(S.relatorioUI.tipo, dados());
    const info = RELATORIOS.find((r) => r.id === atual.id);
    const cls = (i) => (atual.numericas.includes(i) ? "num" : "");
    const mostradas = atual.linhas.slice(0, LIMITE_PREVIA);
    const periodoTxt = atual.id === "envio" ? "Situação atual (sem filtro de período)" : `${dataBR(per.de)} a ${dataBR(per.ate)}`;
    setHTML(el.querySelector("#relPrevia"), html`
      <header class="card-cab"><div class="card-tit"><h3>${atual.titulo}</h3><p class="card-sub">${periodoTxt} · ${num(atual.linhas.length)} ${atual.linhas.length === 1 ? "linha" : "linhas"}</p></div>
        <div class="gv-acoes">
          <button type="button" class="btn btn-sec" data-acao="imprimir">${icone("print", 15)}<span>Imprimir / PDF</span></button>
          <button type="button" class="btn btn-prim" data-acao="csv">${icone("download", 15)}<span>Baixar CSV (Excel)</span></button>
        </div></header>
      ${atual.nota ? html`<p class="nota nota-topo">${atual.nota}</p>` : ""}
      ${atual.linhas.length
        ? html`<div class="tabela-scroll rel-tabela"><table class="tabela tabela-compacta">
            <thead><tr>${atual.colunas.map((c, i) => html`<th class="${cls(i)}">${c}</th>`)}</tr></thead>
            <tbody>${mostradas.map((l) => html`<tr>${l.exibir.map((c, i) => html`<td class="${cls(i)}">${c}</td>`)}</tr>`)}
              ${atual.totais ? html`<tr class="totais">${atual.totais.exibir.map((c, i) => html`<td class="${cls(i)}">${c ?? ""}</td>`)}</tr>` : ""}</tbody></table></div>
          ${atual.linhas.length > LIMITE_PREVIA ? html`<p class="nota">Mostrando as primeiras ${LIMITE_PREVIA} de ${num(atual.linhas.length)} linhas — o CSV e a impressão trazem todas.</p>` : ""}`
        : vazio("Nada para mostrar", "Não há dados para este relatório no período escolhido.", info.icone)}`);
  }

  return {
    titulo: "Relatórios",
    usaPeriodo: true,
    montar(container) {
      el = container;
      esqueleto();
      previa();
      el.addEventListener("click", (ev) => {
        const r = ev.target.closest("[data-rel]");
        if (r) { S.relatorioUI.tipo = r.dataset.rel; esqueleto(); return previa(); }
        const a = ev.target.closest("[data-acao]");
        if (!a || !atual) return;
        if (a.dataset.acao === "csv") {
          baixar(atual.arquivo, csv(atual.colunas, atual.linhas.map((l) => l.csv).concat(atual.totais ? [atual.totais.csv] : [])));
          toast("Relatório baixado.", "ok");
        } else if (a.dataset.acao === "imprimir") {
          const per = ctx.periodo();
          imprimirRelatorio(atual, atual.id === "envio" ? "Situação atual" : `${dataBR(per.de)} a ${dataBR(per.ate)}`);
        }
      });
    },
    atualizar() { if (el) previa(); },
  };
}

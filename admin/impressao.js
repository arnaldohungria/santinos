/* Painel Santino's — impressão (etiquetas de envio e relatórios).
 * O conteúdo é montado num #printArea escondido; o CSS de impressão esconde
 * todo o resto da página. Dá pra "Salvar como PDF" na janela de impressão.
 */
import { html, setHTML, dataHoraBR, fmtTel, fmtCEP } from "./util.js";
import { enderecoLinhas } from "./dados.js";

const REMETENTE = "Santino's — Molhos de Pimenta · Itapetininga/SP · CEP 18208-672";

function imprimir(conteudo, titulo) {
  const area = document.getElementById("printArea");
  setHTML(area, conteudo);
  const tituloAntes = document.title;
  document.title = titulo;
  document.body.classList.add("imprimindo");
  const limpar = () => {
    document.body.classList.remove("imprimindo");
    document.title = tituloAntes;
    area.replaceChildren();
    window.removeEventListener("afterprint", limpar);
  };
  window.addEventListener("afterprint", limpar);
  window.print();
}

export function imprimirEtiquetas(pedidos, produtos) {
  const nomeProduto = (id) => (produtos[id] && produtos[id].nome) || id;
  const etiquetas = pedidos.map((p) => {
    const linhas = enderecoLinhas(p);
    const conteudo = (p._itens || []).map((i) => `${i.qtd}× ${nomeProduto(i.id)}`).join(" · ");
    return html`<div class="etiqueta">
      <div class="et-topo"><strong>DESTINATÁRIO</strong><span>${p.external_reference}</span></div>
      <div class="et-nome">${p.nome || "—"}</div>
      ${linhas.map((l) => html`<div class="et-linha">${l}</div>`)}
      <div class="et-cep">CEP ${fmtCEP(p.cep) || "—"}</div>
      ${p.whatsapp ? html`<div class="et-linha">Tel: ${fmtTel(p.whatsapp)}</div>` : ""}
      <div class="et-conteudo"><strong>Conteúdo:</strong> ${conteudo || "—"}</div>
      <div class="et-remetente">Remetente: ${REMETENTE}</div>
    </div>`;
  });
  imprimir(html`<div class="etiquetas">${etiquetas}</div>`, `Etiquetas — ${pedidos.length} pedido(s)`);
}

export function imprimirRelatorio(rel, periodoTxt) {
  const cls = (i) => (rel.numericas && rel.numericas.includes(i) ? "num" : "");
  const cab = rel.colunas.map((c, i) => html`<th class="${cls(i)}">${c}</th>`);
  const corpo = rel.linhas.map((l) => html`<tr>${l.exibir.map((c, i) => html`<td class="${cls(i)}">${c}</td>`)}</tr>`);
  const totais = rel.totais
    ? html`<tr class="totais">${rel.totais.exibir.map((c, i) => html`<td class="${cls(i)}">${c ?? ""}</td>`)}</tr>`
    : "";
  imprimir(
    html`<div class="rel-print">
      <div class="rel-cab"><div><strong class="rel-marca">Santino's</strong><span>Molhos de pimenta artesanais</span></div>
        <div class="rel-meta"><div>${periodoTxt}</div><div>Gerado em ${dataHoraBR(new Date().toISOString())}</div></div></div>
      <h1>${rel.titulo}</h1>
      ${rel.nota ? html`<p class="rel-nota">${rel.nota}</p>` : ""}
      <table><thead><tr>${cab}</tr></thead><tbody>${corpo}${totais}</tbody></table>
    </div>`,
    `${rel.titulo} — Santino's`
  );
}

/* Painel Santino's — impressão (etiquetas de envio e relatórios).
 * O conteúdo é montado num #printArea escondido; o CSS de impressão esconde
 * todo o resto da página. Dá pra "Salvar como PDF" na janela de impressão.
 */
import { html, setHTML, dataHoraBR, fmtTel, fmtCEP, brl, num, dataBR } from "./util.js";
import { enderecoLinhas } from "./dados.js";

const REMETENTE = "Santino's — Molhos de Pimenta · Itapetininga/SP · CEP 18208-672";
const EMPRESA = "Santino's — Molhos de pimenta artesanais · CNPJ 69.399.259/0001-53 · Itapetininga/SP · WhatsApp (15) 99856-9761";

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

// Comprovante de consignação (entrega, acerto — com a reposição da mesma visita — ou recolhimento).
// `grupo` = movimentos gravados juntos; cada um traz _antes/_depois (estoque) calculados pela tela.
export function imprimirComprovante({ ponto, grupo, produtos, ids, nomeCurto }) {
  const acerto = grupo.find((m) => m.tipo === "acerto");
  const entrega = grupo.find((m) => m.tipo === "entrega");
  const recolh = grupo.find((m) => m.tipo === "recolhimento");
  const principal = acerto || recolh || entrega;
  const depois = grupo[grupo.length - 1]._depois;
  const totalDepois = ids.reduce((s, id) => s + (depois[id] || 0), 0);
  const titulo = acerto ? "Acerto de consignação" : recolh ? "Recolhimento de consignação" : "Entrega em consignação";
  const precoVenda = produtos[ids[0]] && produtos[ids[0]].preco;
  const n = (v) => (v ? num(v) : "0");
  const motivo = recolh && { devolvido: "devolvidos", quebrado: "quebrados", vencido: "vencidos", outro: "outro motivo" }[recolh.motivo];

  const tabAcerto = acerto
    ? html`<h2>Acerto</h2><table><thead><tr><th>Sabor</th><th class="num">Havia</th><th class="num">Sobrou</th><th class="num">Vendidos</th><th class="num">Preço</th><th class="num">Valor</th></tr></thead>
      <tbody>${ids.map((id) => {
        const havia = acerto._antes[id] || 0, vend = acerto.itens[id] || 0;
        return html`<tr><td>${nomeCurto(id)}</td><td class="num">${n(havia)}</td><td class="num">${n(havia - vend)}</td><td class="num">${n(vend)}</td><td class="num">${brl(acerto.preco_centavos)}</td><td class="num">${brl(vend * acerto.preco_centavos)}</td></tr>`;
      })}
      <tr class="totais"><td colspan="3">Total</td><td class="num">${n(ids.reduce((s, id) => s + (acerto.itens[id] || 0), 0))}</td><td></td><td class="num">${brl(acerto.valor_centavos)}</td></tr></tbody></table>
      <p class="comp-pgto">${acerto.valor_centavos
        ? acerto.pago ? html`<strong>Pago</strong> em ${dataBR(acerto.pago_em)}${acerto.forma_pagamento ? ` (${{ pix: "Pix", dinheiro: "dinheiro", outro: "outro" }[acerto.forma_pagamento]})` : ""}.` : html`<strong>Valor a pagar: ${brl(acerto.valor_centavos)}</strong>`
        : "Nenhum frasco vendido neste período."}</p>`
    : "";
  const tabSimples = (m, rot, col) => html`<h2>${rot}</h2><table><thead><tr><th>Sabor</th><th class="num">${col}</th></tr></thead>
    <tbody>${ids.map((id) => html`<tr><td>${nomeCurto(id)}</td><td class="num">${n(m.itens[id])}</td></tr>`)}
    <tr class="totais"><td>Total</td><td class="num">${n(ids.reduce((s, id) => s + (m.itens[id] || 0), 0))}</td></tr></tbody></table>`;

  imprimir(
    html`<div class="comp-print">
      <div class="rel-cab"><div><strong class="rel-marca">Santino's</strong><span>${EMPRESA}</span></div>
        <div class="rel-meta"><div><strong>${titulo}</strong></div><div>Nº ${principal.id} · ${dataBR(principal.data)}</div></div></div>
      <div class="comp-cliente">
        <div><span>Comércio</span><strong>${ponto.nome}</strong></div>
        ${ponto.documento ? html`<div><span>CNPJ/CPF</span><strong>${ponto.documento}</strong></div>` : ""}
        ${ponto.responsavel ? html`<div><span>Responsável</span><strong>${ponto.responsavel}</strong></div>` : ""}
        ${ponto.endereco || ponto.cidade ? html`<div><span>Endereço</span><strong>${[ponto.endereco, ponto.cidade].filter(Boolean).join(" — ")}</strong></div>` : ""}
      </div>
      ${tabAcerto}
      ${recolh ? tabSimples(recolh, `Frascos retirados (${motivo})`, "Retirados") : ""}
      ${entrega ? tabSimples(entrega, acerto ? "Reposição (deixados nesta visita)" : "Frascos deixados", "Quantidade") : ""}
      <p class="comp-estoque"><strong>Ficam na prateleira após esta visita: ${n(totalDepois)} ${totalDepois === 1 ? "frasco" : "frascos"}</strong> (${ids.map((id) => `${nomeCurto(id)} ${n(depois[id])}`).join(" · ")}).</p>
      ${grupo.some((m) => m.obs) ? html`<p class="rel-nota">Observações: ${[...new Set(grupo.filter((m) => m.obs).map((m) => m.obs))].join(" · ")}</p>` : ""}
      <p class="comp-regra">Consignação: os frascos continuam sendo da Santino's até serem vendidos. O comércio paga apenas os frascos vendidos, a ${brl(ponto.preco_repasse_centavos)} cada${precoVenda ? `, com preço de venda ao consumidor de ${brl(precoVenda)}` : ""}. Os acertos são feitos a cada 30 dias.</p>
      <div class="comp-assin"><div><span></span>Santino's</div><div><span></span>${ponto.nome} (nome e assinatura)</div></div>
      <p class="comp-rodape">Gerado em ${dataHoraBR(new Date().toISOString())}</p>
    </div>`,
    `${titulo} ${principal.id} — ${ponto.nome}`
  );
}

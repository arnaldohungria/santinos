/* Painel Santino's — clientes (agrupados por CPF/e-mail/telefone). */
import { S } from "../state.js";
import { html, raw, setHTML, icone, brl, num, dataBR, fmtTel, fmtCPF, waLink, haQuanto, toast, csv, baixar, debounce, hojeBRT } from "../util.js";
import { agruparClientes, normalizar } from "../dados.js";
import { vazio } from "../comp.js";

const SEGMENTOS = [
  ["compraram", "Compraram"],
  ["recorrentes", "Recorrentes (2+)"],
  ["vip", "VIP"],
  ["sempagto", "Sem pagamento aprovado"],
  ["todos", "Todos"],
];

function perfil(c) {
  if (c.vip) return html`<span class="pill pill-ok">${icone("star", 13)}<span>VIP</span></span>`;
  if (c.recorrente) return html`<span class="pill pill-neutro-forte"><span>Recorrente</span></span>`;
  if (c.pagos === 1) return html`<span class="pill pill-neutro"><span>1ª compra</span></span>`;
  return html`<span class="pill pill-warn"><span>Sem compra paga</span></span>`;
}

export default function clientesView(ctx) {
  let el = null;
  let todos = [];

  function filtrar() {
    const u = S.clientesUI;
    todos = agruparClientes(S.pedidos);
    let l = todos;
    if (u.seg === "compraram") l = l.filter((c) => c.pagos > 0);
    else if (u.seg === "recorrentes") l = l.filter((c) => c.recorrente);
    else if (u.seg === "vip") l = l.filter((c) => c.vip);
    else if (u.seg === "sempagto") l = l.filter((c) => c.pagos === 0);
    if (u.q.trim()) {
      const q = normalizar(u.q.trim());
      const dig = u.q.replace(/\D/g, "");
      l = l.filter((c) => normalizar([c.nome, c.email, c.cidade, c.uf].join(" ")).includes(q) || (dig.length >= 4 && (String(c.cpf || "") + String(c.whatsapp || "")).replace(/\D/g, "").includes(dig)));
    }
    const dir = u.dir === "asc" ? 1 : -1;
    const chave = { gasto: (c) => c.gasto, pedidos: (c) => c.pagos, ultimo: (c) => c.ultimoIso || "", nome: (c) => normalizar(c.nome), ticket: (c) => c.ticket }[u.campo] || ((c) => c.gasto);
    return [...l].sort((a, b) => { const x = chave(a), y = chave(b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
  }

  function esqueleto() {
    const u = S.clientesUI;
    todos = agruparClientes(S.pedidos);
    const cont = {
      compraram: todos.filter((c) => c.pagos > 0).length,
      recorrentes: todos.filter((c) => c.recorrente).length,
      vip: todos.filter((c) => c.vip).length,
      sempagto: todos.filter((c) => c.pagos === 0).length,
      todos: todos.length,
    };
    setHTML(el, html`
      <div class="toolbar">
        <label class="busca">${icone("search", 16)}<input type="search" id="cliBusca" placeholder="Buscar por nome, e-mail, CPF, telefone, cidade…" value="${u.q}" autocomplete="off"></label>
        <div class="seg" role="group" aria-label="Segmento">
          ${SEGMENTOS.map(([k, rot]) => html`<button type="button" class="seg-btn ${u.seg === k ? "ativo" : ""}" data-seg="${k}" aria-pressed="${u.seg === k}">${rot} <span class="seg-n">${num(cont[k])}</span></button>`)}
        </div>
        <button type="button" class="btn btn-sec" data-acao="exportar">${icone("download", 15)}<span>Exportar CSV</span></button>
      </div>
      <p class="nota">Clientes são reconhecidos pelo CPF (ou e-mail/telefone, se faltar). VIP = gastou ${brl(20000)}+ ou comprou 3+ vezes. "Sem pagamento aprovado" são quem tentou comprar mas não pagou — bons contatos pra retomar.</p>
      <div class="resumo-lista" id="cliResumo"></div>
      <section class="card card-tabela"><div id="cliTabela"></div></section>
      <div class="paginacao" id="cliPag"></div>`);
  }

  function lista() {
    const u = S.clientesUI;
    const l = filtrar();
    const paginas = Math.max(1, Math.ceil(l.length / u.porPagina));
    if (u.pagina > paginas) u.pagina = paginas;
    const pag = l.slice((u.pagina - 1) * u.porPagina, u.pagina * u.porPagina);
    const gasto = l.reduce((s, c) => s + c.gasto, 0);
    setHTML(el.querySelector("#cliResumo"), html`<strong>${num(l.length)}</strong> ${l.length === 1 ? "cliente" : "clientes"} · <strong>${brl(gasto)}</strong> em compras pagas`);

    const tab = el.querySelector("#cliTabela");
    if (!l.length) {
      setHTML(tab, vazio("Nenhum cliente neste filtro", "Tente outro segmento ou limpe a busca.", "clientes"));
      el.querySelector("#cliPag").replaceChildren();
      return;
    }
    const seta = (c) => (u.campo === c ? (u.dir === "asc" ? " ▲" : " ▼") : "");
    setHTML(tab, html`<div class="tabela-scroll"><table class="tabela tabela-lista">
      <thead><tr>
        <th><button type="button" class="th-ord" data-ordem="nome">Cliente${seta("nome")}</button></th>
        <th>WhatsApp</th><th>Local</th>
        <th class="num"><button type="button" class="th-ord" data-ordem="pedidos">Pedidos${seta("pedidos")}</button></th>
        <th class="num"><button type="button" class="th-ord" data-ordem="gasto">Total gasto${seta("gasto")}</button></th>
        <th class="num"><button type="button" class="th-ord" data-ordem="ticket">Ticket${seta("ticket")}</button></th>
        <th><button type="button" class="th-ord" data-ordem="ultimo">Última compra${seta("ultimo")}</button></th>
        <th>Perfil</th>
      </tr></thead>
      <tbody>${pag.map((c) => {
        const wa = waLink(c.whatsapp, `Olá, ${String(c.nome || "").split(" ")[0]}! Aqui é da Santino's.`);
        return html`<tr class="clicavel" data-chave="${c.key}">
          <td class="col-cli">${c.nome || "—"}<small>${c.email || ""}</small></td>
          <td class="nowrap">${c.whatsapp ? html`${fmtTel(c.whatsapp)} ${wa ? html`<a class="link-ic" href="${wa}" target="_blank" rel="noopener" title="Abrir conversa no WhatsApp" aria-label="Abrir conversa no WhatsApp">${icone("whatsapp", 14)}</a>` : ""}` : "—"}</td>
          <td class="nowrap">${c.cidade}${c.uf !== "—" ? ` / ${c.uf}` : ""}</td>
          <td class="num">${num(c.pagos)}</td>
          <td class="num nowrap"><strong>${brl(c.gasto)}</strong></td>
          <td class="num nowrap">${c.pagos ? brl(c.ticket) : "—"}</td>
          <td class="nowrap">${c.ultimo ? html`${dataBR(c.ultimo)}<small>${haQuanto(c.ultimoIso)}</small>` : "—"}</td>
          <td>${perfil(c)}</td></tr>`;
      })}</tbody></table></div>`);
    setHTML(el.querySelector("#cliPag"), paginas > 1 ? html`
      <button type="button" class="btn btn-sec" data-pag="-1" ${u.pagina <= 1 ? raw("disabled") : ""}>‹ Anterior</button>
      <span>Página ${u.pagina} de ${paginas}</span>
      <button type="button" class="btn btn-sec" data-pag="1" ${u.pagina >= paginas ? raw("disabled") : ""}>Próxima ›</button>` : "");
  }

  function ligarBusca() {
    const u = S.clientesUI;
    el.querySelector("#cliBusca").addEventListener("input", debounce((ev) => { u.q = ev.target.value; u.pagina = 1; lista(); }, 180));
  }

  return {
    titulo: "Clientes",
    usaPeriodo: false,
    montar(container) {
      el = container;
      const u = S.clientesUI;
      esqueleto();
      ligarBusca();
      lista();
      el.addEventListener("click", (ev) => {
        const alvo = ev.target;
        const seg = alvo.closest("[data-seg]");
        if (seg) { u.seg = seg.dataset.seg; u.pagina = 1; esqueleto(); ligarBusca(); return lista(); }
        const ord = alvo.closest("[data-ordem]");
        if (ord) {
          const c = ord.dataset.ordem;
          u.dir = u.campo === c ? (u.dir === "asc" ? "desc" : "asc") : c === "nome" ? "asc" : "desc";
          u.campo = c;
          return lista();
        }
        const pag = alvo.closest("[data-pag]");
        if (pag) { u.pagina += Number(pag.dataset.pag); lista(); return el.scrollIntoView({ block: "start" }); }
        const a = alvo.closest("[data-acao='exportar']");
        if (a) {
          const l = filtrar();
          const cab = ["Cliente", "E-mail", "WhatsApp", "CPF", "Cidade", "UF", "Pedidos pagos", "Total gasto", "Ticket médio", "Primeira compra", "Última compra", "Perfil"];
          const linhas = l.map((c) => [c.nome || "", c.email || "", fmtTel(c.whatsapp), fmtCPF(c.cpf), c.cidade, c.uf, c.pagos, c.gasto / 100, Math.round(c.ticket) / 100, c.primeiro ? dataBR(c.primeiro) : "", c.ultimo ? dataBR(c.ultimo) : "", c.vip ? "VIP" : c.recorrente ? "Recorrente" : c.pagos === 1 ? "1a compra" : "Sem compra paga"]);
          baixar(`santinos-clientes-${hojeBRT()}.csv`, csv(cab, linhas));
          return toast(`${l.length} clientes exportados.`, "ok");
        }
        const linha = alvo.closest("tr[data-chave]");
        if (linha && !alvo.closest("a, button")) ctx.abrirCliente(linha.dataset.chave);
      });
    },
    atualizar() {
      if (!el) return;
      if (document.activeElement && document.activeElement.id === "cliBusca") return lista();
      esqueleto(); ligarBusca(); lista();
    },
  };
}

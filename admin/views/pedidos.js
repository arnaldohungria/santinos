/* Painel Santino's — lista de pedidos: busca, filtros, seleção em lote, exportação. */
import { S, api } from "../state.js";
import { html, raw, setHTML, icone, brl, num, dataHoraBR, dataHoraCurta, toast, csv, baixar, debounce } from "../util.js";
import { normalizar, nomeMetodo, pgtoInfo } from "../dados.js";
import { pillPgto, pillEnvio, vazio } from "../comp.js";
import { imprimirEtiquetas } from "../impressao.js";
import { gerar } from "../relatorios-def.js";

const FILTRO_PGTO = {
  approved: ["approved"],
  pending: ["pending", "in_process", "authorized"],
  rejected: ["rejected", "cancelled"],
  refunded: ["refunded", "charged_back"],
};
const chaveData = (p) => (p._pago && p.pago_em ? p.pago_em : p.criado_em) || "";
const ORDENADORES = {
  _data: (p) => chaveData(p),
  _total: (p) => p._total,
  nome: (p) => normalizar(p.nome),
};
const nomeCurto = (id) => ((S.produtos[id] && S.produtos[id].nome) || id).replace("Santino's ", "");

export default function pedidosView(ctx) {
  let el = null;

  function filtrar() {
    const u = S.pedidosUI;
    let l = ctx.pedidosPeriodo();
    if (u.q.trim()) {
      const q = normalizar(u.q.trim());
      const dig = u.q.replace(/\D/g, "");
      l = l.filter((p) => p._busca.includes(q) || (dig.length >= 4 && p._digitos.includes(dig)));
    }
    if (u.pgto) l = l.filter((p) => FILTRO_PGTO[u.pgto].includes(p.status));
    if (u.envio) l = l.filter((p) => p._pago && (p.status_envio || "novo") === u.envio);
    if (u.uf) l = l.filter((p) => p._uf === u.uf);
    if (u.metodo) l = l.filter((p) => nomeMetodo(p) === u.metodo);
    if (u.cupom === "com") l = l.filter((p) => p.cupom);
    if (u.cupom === "sem") l = l.filter((p) => !p.cupom);
    const f = ORDENADORES[u.campo] || ORDENADORES._data;
    const dir = u.dir === "asc" ? 1 : -1;
    return [...l].sort((a, b) => {
      const x = f(a), y = f(b);
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
  }

  function montarEsqueleto() {
    const u = S.pedidosUI;
    const todosPeriodo = ctx.pedidosPeriodo();
    const ufs = [...new Set(todosPeriodo.map((p) => p._uf))].filter((x) => x !== "—").sort();
    const metodos = [...new Set(todosPeriodo.filter((p) => p.tipo_pagamento).map(nomeMetodo))].sort();
    const opt = (v, rot, atual) => html`<option value="${v}" ${v === atual ? raw("selected") : ""}>${rot}</option>`;
    setHTML(el, html`
      <div class="toolbar">
        <label class="busca">${icone("search", 16)}<input type="search" id="pedBusca" placeholder="Buscar por nome, e-mail, CPF, cidade, pedido, rastreio…" value="${u.q}" autocomplete="off"></label>
        <select id="fPgto" aria-label="Pagamento">
          ${opt("", "Todos os pagamentos", u.pgto)}${opt("approved", "Pagos", u.pgto)}${opt("pending", "Aguardando pagamento", u.pgto)}${opt("rejected", "Recusados / cancelados", u.pgto)}${opt("refunded", "Reembolsados", u.pgto)}
        </select>
        <select id="fEnvio" aria-label="Envio">
          ${opt("", "Todos os envios", u.envio)}${opt("novo", "A enviar", u.envio)}${opt("separado", "Separados", u.envio)}${opt("enviado", "Enviados", u.envio)}${opt("entregue", "Entregues", u.envio)}
        </select>
        <select id="fUf" aria-label="Estado">${opt("", "Todos os estados", u.uf)}${ufs.map((x) => opt(x, x, u.uf))}</select>
        <select id="fMetodo" aria-label="Forma de pagamento">${opt("", "Todas as formas", u.metodo)}${metodos.map((x) => opt(x, x, u.metodo))}</select>
        <select id="fCupom" aria-label="Cupom">${opt("", "Com ou sem cupom", u.cupom)}${opt("com", "Com cupom", u.cupom)}${opt("sem", "Sem cupom", u.cupom)}</select>
        <button type="button" class="btn btn-sec" data-acao="limpar-filtros">Limpar</button>
        <button type="button" class="btn btn-sec" data-acao="exportar">${icone("download", 15)}<span>Exportar CSV</span></button>
      </div>
      <div class="resumo-lista" id="pedResumo"></div>
      <div class="barra-sel" id="pedSel" hidden></div>
      <section class="card card-tabela"><div id="pedTabela"></div></section>
      <div class="paginacao" id="pedPag"></div>`);
  }

  function desenharLista() {
    const u = S.pedidosUI;
    const lista = filtrar();
    const paginas = Math.max(1, Math.ceil(lista.length / u.porPagina));
    if (u.pagina > paginas) u.pagina = paginas;
    const ini = (u.pagina - 1) * u.porPagina;
    const pagina = lista.slice(ini, ini + u.porPagina);
    const pagos = lista.filter((p) => p._pago);
    const soma = pagos.reduce((s, p) => s + p._total, 0);

    setHTML(el.querySelector("#pedResumo"), html`<strong>${num(lista.length)}</strong> ${lista.length === 1 ? "pedido" : "pedidos"}
      ${pagos.length ? html` · <strong>${num(pagos.length)}</strong> ${pagos.length === 1 ? "pago" : "pagos"} somando <strong>${brl(soma)}</strong>` : ""}`);

    const tabela = el.querySelector("#pedTabela");
    if (!lista.length) {
      setHTML(tabela, vazio("Nenhum pedido encontrado", S.pedidos.length ? "Tente outro período ou limpe os filtros." : "Assim que houver pedidos, eles aparecem aqui.", "pedidos"));
      el.querySelector("#pedPag").replaceChildren();
      desenharSelecao();
      return;
    }

    const seta = (campo) => (u.campo === campo ? (u.dir === "asc" ? " ▲" : " ▼") : "");
    const todosMarcados = pagina.length && pagina.every((p) => S.sel.has(p.external_reference));
    const linhas = pagina.map((p) => {
      const marcado = S.sel.has(p.external_reference);
      const itens = p._itens.length ? p._itens.map((i) => `${i.qtd}× ${nomeCurto(i.id)}`).join(", ") : "—";
      return html`<tr class="clicavel ${marcado ? "sel" : ""}" data-ref="${p.external_reference}">
        <td class="col-chk"><input type="checkbox" data-sel="${p.external_reference}" ${marcado ? raw("checked") : ""} aria-label="Selecionar ${p.external_reference}"></td>
        <td><code>${p.external_reference}</code></td>
        <td class="nowrap" title="${dataHoraBR(chaveData(p))}">${dataHoraCurta(chaveData(p))}</td>
        <td class="col-cli">${p.nome || "—"}<small>${p.email || ""}</small></td>
        <td class="nowrap">${p._cidade}${p._uf !== "—" ? ` / ${p._uf}` : ""}</td>
        <td class="col-itens">${itens}</td>
        <td class="num nowrap"><strong>${brl(p._total)}</strong>${p.cupom ? html`<small>cupom ${p.cupom}</small>` : ""}</td>
        <td>${pillPgto(p)}</td>
        <td>${pillEnvio(p)}</td>
      </tr>`;
    });
    setHTML(tabela, html`<div class="tabela-scroll"><table class="tabela tabela-lista">
      <thead><tr>
        <th class="col-chk"><input type="checkbox" data-sel-pagina ${todosMarcados ? raw("checked") : ""} aria-label="Selecionar todos da página"></th>
        <th>Pedido</th>
        <th><button type="button" class="th-ord" data-ordem="_data">Data${seta("_data")}</button></th>
        <th><button type="button" class="th-ord" data-ordem="nome">Cliente${seta("nome")}</button></th>
        <th>Destino</th><th>Itens</th>
        <th class="num"><button type="button" class="th-ord" data-ordem="_total">Total${seta("_total")}</button></th>
        <th>Pagamento</th><th>Envio</th>
      </tr></thead>
      <tbody>${linhas}</tbody></table></div>`);

    setHTML(el.querySelector("#pedPag"), paginas > 1 ? html`
      <button type="button" class="btn btn-sec" data-pag="-1" ${u.pagina <= 1 ? raw("disabled") : ""}>‹ Anterior</button>
      <span>Página ${u.pagina} de ${paginas}</span>
      <button type="button" class="btn btn-sec" data-pag="1" ${u.pagina >= paginas ? raw("disabled") : ""}>Próxima ›</button>` : "");
    desenharSelecao();
  }

  function desenharSelecao() {
    const barra = el.querySelector("#pedSel");
    const n = S.sel.size;
    barra.hidden = n === 0;
    if (!n) return;
    setHTML(barra, html`<strong>${n}</strong> ${n === 1 ? "selecionado" : "selecionados"}
      <button type="button" class="btn btn-sec" data-acao="lote" data-para="separado">${icone("box", 15)}<span>Marcar como separado</span></button>
      <button type="button" class="btn btn-sec" data-acao="lote" data-para="enviado">${icone("truck", 15)}<span>Marcar como enviado</span></button>
      <button type="button" class="btn btn-sec" data-acao="etiquetas">${icone("print", 15)}<span>Imprimir etiquetas</span></button>
      <button type="button" class="link-btn" data-acao="limpar-sel">Limpar seleção</button>`);
  }

  async function atualizarLote(para) {
    const alvos = [...S.sel].map((r) => S.pedidos.find((p) => p.external_reference === r)).filter((p) => p && p._pago);
    const ignorados = S.sel.size - alvos.length;
    if (!alvos.length) return toast("Só pedidos pagos podem mudar de situação de envio.", "erro");
    try {
      for (let i = 0; i < alvos.length; i += 40) {
        const grupo = alvos.slice(i, i + 40);
        await api("/admin/pedidos/atualizar", { method: "POST", body: JSON.stringify({ atualizacoes: grupo.map((p) => ({ ref: p.external_reference, status_envio: para })) }) });
        for (const p of grupo) {
          p.status_envio = para;
          p.enviado_em = para === "enviado" ? p.enviado_em || new Date().toISOString() : null;
        }
      }
      S.sel.clear();
      toast(`${alvos.length} ${alvos.length === 1 ? "pedido atualizado" : "pedidos atualizados"}${ignorados ? ` (${ignorados} não pago${ignorados > 1 ? "s" : ""} ignorado${ignorados > 1 ? "s" : ""})` : ""}.`, "ok");
      ctx.aoMudarPedidos();
    } catch (e) {
      toast(e.message || "Não consegui atualizar.", "erro");
    }
  }

  function ligarEventos() {
    const u = S.pedidosUI;
    ligarBusca();

    el.addEventListener("click", (ev) => {
      const alvo = ev.target;
      const ord = alvo.closest("[data-ordem]");
      if (ord) {
        const campo = ord.dataset.ordem;
        u.dir = u.campo === campo ? (u.dir === "asc" ? "desc" : "asc") : campo === "nome" ? "asc" : "desc";
        u.campo = campo;
        return desenharLista();
      }
      const pag = alvo.closest("[data-pag]");
      if (pag) { u.pagina += Number(pag.dataset.pag); desenharLista(); return el.scrollIntoView({ block: "start" }); }
      if (alvo.matches("[data-sel]")) {
        alvo.checked ? S.sel.add(alvo.dataset.sel) : S.sel.delete(alvo.dataset.sel);
        alvo.closest("tr").classList.toggle("sel", alvo.checked);
        return desenharSelecao();
      }
      if (alvo.matches("[data-sel-pagina]")) {
        const refs = [...el.querySelectorAll("[data-sel]")].map((c) => c.dataset.sel);
        refs.forEach((r) => (alvo.checked ? S.sel.add(r) : S.sel.delete(r)));
        return desenharLista();
      }
      const a = alvo.closest("[data-acao]");
      if (a) {
        const acao = a.dataset.acao;
        if (acao === "limpar-filtros") { Object.assign(u, { q: "", pgto: "", envio: "", uf: "", metodo: "", cupom: "", pagina: 1 }); montarEsqueleto(); ligarBusca(); return desenharLista(); }
        if (acao === "limpar-sel") { S.sel.clear(); return desenharLista(); }
        if (acao === "lote") return atualizarLote(a.dataset.para);
        if (acao === "etiquetas") {
          const alvos = [...S.sel].map((r) => S.pedidos.find((p) => p.external_reference === r)).filter(Boolean);
          return imprimirEtiquetas(alvos, S.produtos);
        }
        if (acao === "exportar") {
          const lista = filtrar();
          const per = ctx.periodo();
          const rel = gerar("vendas", { pedidos: lista, todos: S.pedidos, periodo: per, produtos: S.produtos, config: S.config, cupons: S.cupons });
          baixar(rel.arquivo, csv(rel.colunas, rel.linhas.map((l) => l.csv)));
          return toast(`${lista.length} pedidos exportados.`, "ok");
        }
        return; // outras ações ("abrir-cliente" etc.) ficam pro tratador global
      }
      const linha = alvo.closest("tr[data-ref]");
      if (linha && !alvo.closest("a, button, input")) ctx.abrirPedido(linha.dataset.ref);
    });
  }
  function ligarBusca() {
    const u = S.pedidosUI;
    el.querySelector("#pedBusca").addEventListener("input", debounce((ev) => { u.q = ev.target.value; u.pagina = 1; desenharLista(); }, 180));
    for (const [id, campo] of [["#fPgto", "pgto"], ["#fEnvio", "envio"], ["#fUf", "uf"], ["#fMetodo", "metodo"], ["#fCupom", "cupom"]]) {
      el.querySelector(id).addEventListener("change", (ev) => { u[campo] = ev.target.value; u.pagina = 1; desenharLista(); });
    }
  }

  return {
    titulo: "Pedidos",
    usaPeriodo: true,
    montar(container) {
      el = container;
      montarEsqueleto();
      ligarEventos();
      desenharLista();
    },
    // dados ou período mudaram: refaz só a lista (a busca digitada e o foco são preservados)
    atualizar() { if (el) desenharLista(); },
    // período mudou: as opções dos filtros (UF/forma) dependem dele
    aoMudarPeriodo() {
      if (!el) return;
      const foco = document.activeElement && document.activeElement.id;
      montarEsqueleto();
      ligarBusca();
      desenharLista();
      if (foco) { const x = el.querySelector(`#${foco}`); if (x) x.focus(); }
    },
  };
}

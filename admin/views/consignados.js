/* Painel Santino's — consignação: comércios, entregas, acertos, recolhimentos e comprovantes.
 * O estoque de cada comércio não é gravado: é a soma dos movimentos (entregas − vendidos − recolhidos).
 */
import { api } from "../state.js";
import { html, raw, setHTML, icone, brl, num, dataBR, hojeBRT, diffDias, addDias, parseBRL, centavosParaInput, toast, fmtTel, waLink, debounce } from "../util.js";
import { normalizar } from "../dados.js";
import { pill, vazio } from "../comp.js";
import { imprimirComprovante } from "../impressao.js";

const DIAS_ACERTO = 30; // combinado com o Arnaldo em 2026-11-18
const SITUACAO = {
  ativo: { cls: "ok", rot: "Ativo", ic: "check" },
  pausado: { cls: "neutro", rot: "Pausado", ic: "clock" },
  encerrado: { cls: "neutro-forte", rot: "Encerrado", ic: "xcircle" },
};
const TIPO_MOV = { entrega: "Entrega", acerto: "Acerto", recolhimento: "Recolhimento" };
const MOTIVOS = [["devolvido", "Devolvido"], ["quebrado", "Quebrado"], ["vencido", "Vencido"], ["outro", "Outro"]];
const FORMAS = [["pix", "Pix"], ["dinheiro", "Dinheiro"], ["outro", "Outro"]];
const FILTROS = [["ativo", "Ativos"], ["pausado", "Pausados"], ["encerrado", "Encerrados"], ["todos", "Todos"]];

const soma = (o) => Object.values(o || {}).reduce((s, n) => s + (n || 0), 0);

/* ---------------- cálculos ---------------- */

// Percorre os movimentos em ordem e devolve, por comércio, o estoque e os números do painel.
// Cada movimento ganha _antes/_depois (estoque antes e depois dele), usados no comprovante.
function calcular(pontos, movimentos, ids) {
  const hoje = hojeBRT();
  const mesAtual = hoje.slice(0, 7);
  const por = new Map(pontos.map((p) => [p.id, {
    estoque: Object.fromEntries(ids.map((id) => [id, 0])), movs: [], aReceber: 0, vendidos: 0, vendidosMes: 0, valorMes: 0,
    primeiraEntrega: null, ultimoAcerto: null,
  }]));
  for (const m of movimentos) {
    const c = por.get(m.ponto_id);
    if (!c) continue;
    m._antes = { ...c.estoque };
    const sinal = m.tipo === "entrega" ? 1 : -1;
    for (const [id, n] of Object.entries(m.itens || {})) c.estoque[id] = (c.estoque[id] || 0) + sinal * n;
    m._depois = { ...c.estoque };
    if (m.tipo === "entrega" && !c.primeiraEntrega) c.primeiraEntrega = m.data;
    if (m.tipo === "acerto") {
      const v = soma(m.itens);
      c.vendidos += v;
      c.ultimoAcerto = m.data;
      if (!m.pago) c.aReceber += m.valor_centavos || 0;
      if (m.data.slice(0, 7) === mesAtual) { c.vendidosMes += v; c.valorMes += m.valor_centavos || 0; }
    }
    c.movs.push(m);
  }
  for (const p of pontos) {
    const c = por.get(p.id);
    c.naPrateleira = soma(c.estoque);
    const base = c.ultimoAcerto || c.primeiraEntrega;
    c.diasSemAcerto = base ? diffDias(base, hoje) : null;
    c.proximoAcerto = base ? addDias(base, DIAS_ACERTO) : null;
    c.atrasado = p.status === "ativo" && c.naPrateleira > 0 && c.diasSemAcerto !== null && c.diasSemAcerto > DIAS_ACERTO;
    const meses = c.primeiraEntrega ? Math.max(1, diffDias(c.primeiraEntrega, hoje) / 30) : null;
    c.giro = meses ? c.vendidos / meses : null;
    p._c = c;
  }
  return pontos;
}

/* ---------------- tela ---------------- */

export default function consignadosView() {
  let el = null;
  let pontos = [];
  let movimentos = [];
  let produtos = {};
  let ids = [];
  const ui = { q: "", filtro: "ativo", ficha: null, form: null, pagando: null }; // form: novo | editar | entrega | acerto | recolhimento

  const nomeCurto = (id) => ((produtos[id] && produtos[id].nome) || id).replace(/^Santino's\s+/, "");
  const pontoAtual = () => pontos.find((p) => p.id === ui.ficha);

  async function carregar() {
    const d = await api("/admin/consignados");
    produtos = d.produtos || {};
    ids = Object.keys(produtos);
    movimentos = d.movimentos || [];
    pontos = calcular(d.pontos || [], movimentos, ids);
  }

  function desenhar() {
    if (ui.ficha && pontoAtual()) desenharFicha();
    else { ui.ficha = null; desenharLista(); }
  }

  /* ----- lista de comércios ----- */

  function filtrados() {
    let l = ui.filtro === "todos" ? pontos : pontos.filter((p) => p.status === ui.filtro);
    if (ui.q.trim()) {
      const q = normalizar(ui.q.trim());
      l = l.filter((p) => normalizar([p.nome, p.tipo, p.cidade, p.responsavel, p.endereco].join(" ")).includes(q));
    }
    return l;
  }

  function linhaAcerto(c) {
    if (!c.primeiraEntrega) return html`<span class="muted">sem entregas</span>`;
    const quando = c.ultimoAcerto ? html`${dataBR(c.ultimoAcerto)}<small>há ${num(c.diasSemAcerto)} ${c.diasSemAcerto === 1 ? "dia" : "dias"}</small>` : html`<span class="muted">nenhum ainda</span><small>1ª entrega há ${num(c.diasSemAcerto)} dias</small>`;
    return c.atrasado ? html`${quando}<small>${pill({ cls: "warn", rot: "acerto atrasado", ic: "alert" })}</small>` : quando;
  }

  function tabelaPontos(l) {
    if (!pontos.length) return vazio("Nenhum comércio ainda", "Cadastre o primeiro em \"Novo comércio\" e registre a entrega dos frascos.", "pin");
    if (!l.length) return vazio("Nenhum comércio neste filtro", "Tente outro filtro ou limpe a busca.", "pin");
    return html`<div class="tabela-scroll"><table class="tabela tabela-lista">
      <thead><tr><th>Comércio</th><th class="num">Na prateleira</th><th class="num">A receber</th><th>Último acerto</th><th class="num">Giro / mês</th><th>Situação</th><th></th></tr></thead>
      <tbody>${l.map((p) => {
        const c = p._c;
        return html`<tr class="clicavel" data-acao="abrir" data-id="${p.id}">
          <td class="col-cli"><strong>${p.nome}</strong><small>${[p.tipo, p.cidade].filter(Boolean).join(" · ")}</small></td>
          <td class="num">${num(c.naPrateleira)}</td>
          <td class="num nowrap">${c.aReceber ? html`<strong>${brl(c.aReceber)}</strong>` : "—"}</td>
          <td class="col-cli">${linhaAcerto(c)}</td>
          <td class="num">${c.giro === null ? "—" : c.giro.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</td>
          <td>${pill(SITUACAO[p.status] || SITUACAO.ativo)}</td>
          <td><button type="button" class="link-btn" data-acao="abrir" data-id="${p.id}">Abrir</button></td></tr>`;
      })}</tbody></table></div>`;
  }

  function desenharLista() {
    const ativos = pontos.filter((p) => p.status === "ativo");
    const naRua = pontos.reduce((s, p) => s + p._c.naPrateleira, 0);
    const aReceber = pontos.reduce((s, p) => s + p._c.aReceber, 0);
    const vendMes = pontos.reduce((s, p) => s + p._c.vendidosMes, 0);
    const valorMes = pontos.reduce((s, p) => s + p._c.valorMes, 0);
    const atrasados = pontos.filter((p) => p._c.atrasado);
    const cont = Object.fromEntries(FILTROS.map(([k]) => [k, k === "todos" ? pontos.length : pontos.filter((p) => p.status === k).length]));
    const l = filtrados();
    setHTML(el, html`
      ${atrasados.length ? html`<div class="alerta alerta-warn">${icone("clock", 18)}<span><strong>${atrasados.length}</strong> ${atrasados.length === 1 ? "comércio está" : "comércios estão"} há mais de ${DIAS_ACERTO} dias sem acerto: ${atrasados.map((p) => p.nome).join(", ")}.</span></div>` : ""}
      <div class="kpis consig-kpis">
        <div class="kpi"><div class="kpi-rot">Frascos nos comércios</div><div class="kpi-val">${num(naRua)}</div><div class="kpi-rod">em ${num(pontos.filter((p) => p._c.naPrateleira > 0).length)} ${pontos.filter((p) => p._c.naPrateleira > 0).length === 1 ? "comércio" : "comércios"}</div></div>
        <div class="kpi"><div class="kpi-rot">A receber</div><div class="kpi-val">${brl(aReceber)}</div><div class="kpi-rod">acertos ainda não pagos</div></div>
        <div class="kpi"><div class="kpi-rot">Vendidos no mês</div><div class="kpi-val">${num(vendMes)}</div><div class="kpi-rod">${brl(valorMes)} em acertos deste mês</div></div>
        <div class="kpi"><div class="kpi-rot">Comércios ativos</div><div class="kpi-val">${num(ativos.length)}</div><div class="kpi-rod">acerto a cada ${DIAS_ACERTO} dias</div></div>
      </div>
      <div class="toolbar consig-toolbar">
        <label class="busca">${icone("search", 16)}<input type="search" id="conBusca" placeholder="Buscar por nome, tipo, cidade…" value="${ui.q}" autocomplete="off"></label>
        <div class="seg" role="group" aria-label="Situação">
          ${FILTROS.map(([k, rot]) => html`<button type="button" class="seg-btn ${ui.filtro === k ? "ativo" : ""}" data-filtro="${k}" aria-pressed="${ui.filtro === k}">${rot} <span class="seg-n">${num(cont[k])}</span></button>`)}
        </div>
        <button type="button" class="btn btn-prim" data-acao="novo">${icone("plus", 15)}<span>Novo comércio</span></button>
      </div>
      ${ui.form === "novo" ? formPonto(null) : ""}
      <section class="card card-tabela"><div id="conTabela">${tabelaPontos(l)}</div></section>`);
  }

  /* ----- formulários ----- */

  function formPonto(p) {
    const v = (k) => (p && p[k]) || "";
    return html`<section class="card"><header class="card-cab"><div class="card-tit"><h3>${p ? "Editar dados do comércio" : "Novo comércio"}</h3>
        <p class="card-sub">Só o nome é obrigatório. O preço de repasse é quanto o comércio te paga por frasco vendido.</p></div>
        <button type="button" class="btn-mini" data-acao="fechar-form">Cancelar</button></header>
      <form class="card-corpo grade-form" id="formPonto" autocomplete="off">
        <label class="ocupa-2">Nome do comércio<input name="nome" maxlength="80" required value="${v("nome")}" placeholder="Ex.: Açougue Boi Bom"></label>
        <label>Tipo <span class="opt">(opcional)</span><input name="tipo" maxlength="40" list="conTipos" value="${v("tipo")}" placeholder="Açougue, empório…"></label>
        <label>Responsável <span class="opt">(opcional)</span><input name="responsavel" maxlength="60" value="${v("responsavel")}"></label>
        <label>WhatsApp <span class="opt">(opcional)</span><input name="whatsapp" maxlength="30" inputmode="tel" value="${v("whatsapp")}" placeholder="(15) 99999-9999"></label>
        <label>CNPJ/CPF <span class="opt">(opcional)</span><input name="documento" maxlength="30" value="${v("documento")}"></label>
        <label class="ocupa-2">Endereço <span class="opt">(opcional)</span><input name="endereco" maxlength="160" value="${v("endereco")}"></label>
        <label>Cidade <span class="opt">(opcional)</span><input name="cidade" maxlength="60" value="${p ? v("cidade") : "Itapetininga"}"></label>
        <label>Preço de repasse (R$)<input name="preco" inputmode="decimal" required value="${centavosParaInput(p ? p.preco_repasse_centavos : 1400)}"></label>
        ${p ? html`<label>Situação<select name="status">${Object.entries(SITUACAO).map(([k, s]) => html`<option value="${k}" ${p.status === k ? raw("selected") : ""}>${s.rot}</option>`)}</select></label>` : ""}
        <label class="ocupa-todos">Observações <span class="opt">(opcional)</span><textarea name="obs" maxlength="1000" rows="2">${v("obs")}</textarea></label>
        <datalist id="conTipos">${["Açougue", "Casa de carnes", "Empório", "Mercearia", "Adega", "Hamburgueria", "Restaurante", "Hortifrúti", "Mercado"].map((t) => html`<option value="${t}">`)}</datalist>
        <div class="ocupa-todos gv-acoes"><button type="submit" class="btn btn-prim">${icone("check", 15)}<span>${p ? "Salvar alterações" : "Cadastrar comércio"}</span></button>
          <span class="admin-msg" id="formMsg" role="status"></span></div>
      </form></section>`;
  }

  function campoQtd(id, { max, valor = "" } = {}) {
    return html`<input type="number" name="q_${id}" min="0" ${max !== undefined ? raw(`max="${max}"`) : ""} step="1" inputmode="numeric" value="${valor}" aria-label="${nomeCurto(id)}">`;
  }

  function formMovimento(p) {
    const c = p._c;
    const hoje = hojeBRT();
    const cab = (titulo, sub) => html`<header class="card-cab"><div class="card-tit"><h3>${titulo}</h3><p class="card-sub">${sub}</p></div>
      <button type="button" class="btn-mini" data-acao="fechar-form">Cancelar</button></header>`;
    const rodape = (rotulo) => html`<label>Observação <span class="opt">(opcional)</span><input name="obs" maxlength="500"></label>
      <div class="gv-acoes"><button type="submit" class="btn btn-prim">${icone("check", 15)}<span>${rotulo}</span></button><span class="admin-msg" id="formMsg" role="status"></span></div>`;
    const data = html`<label>Data da visita<input type="date" name="data" value="${hoje}" max="${hoje}" required></label>`;

    if (ui.form === "entrega") {
      return html`<section class="card">${cab("Registrar entrega", "Quantos frascos de cada sabor você deixou no comércio.")}
        <form class="card-corpo consig-form" id="formMov" data-tipo="entrega" autocomplete="off">
          ${data}
          <table class="tabela tabela-compacta consig-qtd"><thead><tr><th>Sabor</th><th class="num">Já havia</th><th class="num">Deixei agora</th></tr></thead>
            <tbody>${ids.map((id) => html`<tr><td>${nomeCurto(id)}</td><td class="num">${num(c.estoque[id])}</td><td class="num">${campoQtd(id)}</td></tr>`)}</tbody></table>
          ${rodape("Registrar entrega")}
        </form></section>`;
    }
    if (ui.form === "recolhimento") {
      return html`<section class="card">${cab("Recolher frascos", "Frascos que você trouxe de volta ou que foram perdidos (quebrados, vencidos).")}
        <form class="card-corpo consig-form" id="formMov" data-tipo="recolhimento" autocomplete="off">
          ${data}
          <label>Motivo<select name="motivo" required><option value="">Escolha…</option>${MOTIVOS.map(([k, r]) => html`<option value="${k}">${r}</option>`)}</select></label>
          <table class="tabela tabela-compacta consig-qtd"><thead><tr><th>Sabor</th><th class="num">Na prateleira</th><th class="num">Retirei</th></tr></thead>
            <tbody>${ids.map((id) => html`<tr><td>${nomeCurto(id)}</td><td class="num">${num(c.estoque[id])}</td><td class="num">${campoQtd(id, { max: c.estoque[id] })}</td></tr>`)}</tbody></table>
          ${rodape("Registrar recolhimento")}
        </form></section>`;
    }
    // acerto
    return html`<section class="card">${cab("Fazer acerto", `Conte quantos frascos SOBRARAM na prateleira. O painel calcula o que foi vendido e o valor (${brl(p.preco_repasse_centavos)} por frasco).`)}
      <form class="card-corpo consig-form" id="formMov" data-tipo="acerto" autocomplete="off">
        ${data}
        <table class="tabela tabela-compacta consig-qtd"><thead><tr><th>Sabor</th><th class="num">Havia</th><th class="num">Sobrou</th><th class="num">Vendidos</th><th class="num">Repor agora <span class="opt">(opcional)</span></th></tr></thead>
          <tbody>${ids.map((id) => html`<tr><td>${nomeCurto(id)}</td><td class="num">${num(c.estoque[id])}</td>
            <td class="num">${c.estoque[id] > 0 ? html`<input type="number" name="s_${id}" min="0" max="${c.estoque[id]}" step="1" inputmode="numeric" required aria-label="Sobrou de ${nomeCurto(id)}">` : html`<span class="muted">—</span>`}</td>
            <td class="num"><strong data-vend="${id}">—</strong></td><td class="num">${campoQtd(id)}</td></tr>`)}</tbody></table>
        <p class="consig-total" id="acertoTotal">Preencha o que sobrou de cada sabor.</p>
        <div class="consig-pgto">
          <label class="check"><input type="checkbox" name="pago"> Já recebi o pagamento</label>
          <label>Forma<select name="forma">${FORMAS.map(([k, r]) => html`<option value="${k}">${r}</option>`)}</select></label>
        </div>
        ${rodape("Registrar acerto")}
      </form></section>`;
  }

  function atualizarPreviaAcerto(form) {
    const p = pontoAtual();
    let vend = 0, faltando = 0;
    for (const id of ids) {
      const havia = p._c.estoque[id];
      const alvo = form.querySelector(`[data-vend="${id}"]`);
      if (!havia) { alvo.textContent = "—"; continue; }
      const campo = form.querySelector(`[name="s_${id}"]`);
      if (campo.value === "") { alvo.textContent = "—"; faltando++; continue; }
      const s = Number(campo.value);
      const v = Number.isInteger(s) && s >= 0 && s <= havia ? havia - s : null;
      alvo.textContent = v === null ? "?" : String(v);
      if (v !== null) vend += v;
    }
    form.querySelector("#acertoTotal").textContent = faltando
      ? "Preencha o que sobrou de cada sabor."
      : `Vendidos: ${num(vend)} ${vend === 1 ? "frasco" : "frascos"} × ${brl(p.preco_repasse_centavos)} = ${brl(vend * p.preco_repasse_centavos)} a receber.`;
  }

  /* ----- ficha do comércio ----- */

  function historico(p) {
    const movs = p._c.movs;
    if (!movs.length) return vazio("Nenhum movimento ainda", "Comece registrando a entrega dos frascos.", "box");
    const ultimoId = movs[movs.length - 1].id;
    const descr = (m) => {
      if (m.tipo === "acerto") return html`${pill({ cls: "neutro-forte", rot: "Acerto", ic: "check" })}<small>vendidos</small>`;
      if (m.tipo === "entrega") return html`${pill({ cls: "ok", rot: "Entrega", ic: "box" })}<small>deixados</small>`;
      return html`${pill({ cls: "warn", rot: "Recolhimento", ic: "undo" })}<small>${(MOTIVOS.find(([k]) => k === m.motivo) || [, ""])[1].toLowerCase()}</small>`;
    };
    const pgto = (m) => {
      if (m.tipo !== "acerto" || !m.valor_centavos) return html`<span class="muted">—</span>`;
      if (m.pago) return html`${pill({ cls: "ok", rot: "Recebido", ic: "check" })}<small>${dataBR(m.pago_em)}${m.forma_pagamento ? ` · ${(FORMAS.find(([k]) => k === m.forma_pagamento) || [, m.forma_pagamento])[1]}` : ""}</small>`;
      return pill({ cls: "warn", rot: "A receber", ic: "clock" });
    };
    return html`<div class="tabela-scroll"><table class="tabela tabela-lista consig-hist">
      <thead><tr><th>Data</th><th>Movimento</th>${ids.map((id) => html`<th class="num">${nomeCurto(id)}</th>`)}<th class="num">Valor</th><th>Pagamento</th><th></th></tr></thead>
      <tbody>${[...movs].reverse().map((m) => html`<tr>
        <td class="nowrap">${dataBR(m.data)}</td>
        <td class="col-cli">${descr(m)}${m.obs ? html`<small>${m.obs}</small>` : ""}</td>
        ${ids.map((id) => html`<td class="num">${m.itens[id] ? num(m.itens[id]) : html`<span class="muted">—</span>`}</td>`)}
        <td class="num nowrap">${m.tipo === "acerto" ? brl(m.valor_centavos || 0) : html`<span class="muted">—</span>`}</td>
        <td class="col-cli">${pgto(m)}</td>
        <td><div class="acoes-linha">
          <button type="button" class="link-btn" data-acao="comprovante" data-mov="${m.id}">${icone("print", 14)}Comprovante</button>
          ${m.tipo === "acerto" && m.valor_centavos ? (ui.pagando === m.id
            ? html`<span class="consig-pagar"><select id="formaPgto" aria-label="Forma de pagamento">${FORMAS.map(([k, r]) => html`<option value="${k}">${r}</option>`)}</select><button type="button" class="btn-mini" data-acao="confirmar-pago" data-mov="${m.id}">Confirmar</button><button type="button" class="link-btn" data-acao="cancelar-pago">Cancelar</button></span>`
            : html`<button type="button" class="link-btn" data-acao="${m.pago ? "desmarcar-pago" : "marcar-pago"}" data-mov="${m.id}">${m.pago ? "Desmarcar pago" : "Marcar recebido"}</button>`) : ""}
          ${m.id === ultimoId ? html`<button type="button" class="link-btn link-perigo" data-acao="desfazer" data-mov="${m.id}">${icone("undo", 14)}Desfazer</button>` : ""}
        </div></td></tr>`)}</tbody></table></div>`;
  }

  function desenharFicha() {
    const p = pontoAtual();
    const c = p._c;
    const wa = waLink(p.whatsapp);
    const proximo = c.proximoAcerto
      ? html`${dataBR(c.proximoAcerto)}${c.atrasado ? html` <span class="pill pill-warn">${icone("alert", 13)}<span>atrasado</span></span>` : ""}`
      : "—";
    setHTML(el, html`
      <div class="consig-topo">
        <button type="button" class="link-btn" data-acao="voltar">← Todos os comércios</button>
        <div class="consig-tit"><h2>${p.nome}</h2>${pill(SITUACAO[p.status] || SITUACAO.ativo)}</div>
        <div class="consig-acoes">
          <button type="button" class="btn btn-prim" data-acao="form" data-form="entrega">${icone("box", 15)}<span>Registrar entrega</span></button>
          <button type="button" class="btn btn-sec" data-acao="form" data-form="acerto" ${c.naPrateleira ? "" : raw("disabled")}>${icone("check", 15)}<span>Fazer acerto</span></button>
          <button type="button" class="btn btn-sec" data-acao="form" data-form="recolhimento" ${c.naPrateleira ? "" : raw("disabled")}>${icone("undo", 15)}<span>Recolher</span></button>
          <button type="button" class="btn btn-sec" data-acao="form" data-form="editar">${icone("edit", 15)}<span>Editar dados</span></button>
        </div>
      </div>
      ${c.atrasado ? html`<div class="alerta alerta-warn">${icone("clock", 18)}<span>Último acerto há <strong>${num(c.diasSemAcerto)} dias</strong>. O combinado é a cada ${DIAS_ACERTO} dias.</span></div>` : ""}
      ${ui.form === "editar" ? formPonto(p) : ui.form ? formMovimento(p) : ""}
      <div class="grade-2 consig-grade">
        <section class="card"><header class="card-cab"><div class="card-tit"><h3>Situação agora</h3></div></header>
          <div class="card-corpo"><div class="mini-kpis">
            <div><span>Na prateleira</span><strong>${num(c.naPrateleira)} ${c.naPrateleira === 1 ? "frasco" : "frascos"}</strong><small class="muted">${ids.map((id) => `${nomeCurto(id)} ${c.estoque[id]}`).join(" · ")}</small></div>
            <div><span>A receber</span><strong>${brl(c.aReceber)}</strong></div>
            <div><span>Vendidos (total)</span><strong>${num(c.vendidos)}</strong><small class="muted">giro: ${c.giro === null ? "—" : c.giro.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} por mês</small></div>
            <div><span>Próximo acerto</span><strong>${proximo}</strong><small class="muted">último: ${c.ultimoAcerto ? dataBR(c.ultimoAcerto) : "nenhum"}</small></div>
          </div></div></section>
        <section class="card"><header class="card-cab"><div class="card-tit"><h3>Dados do comércio</h3></div></header>
          <div class="card-corpo"><dl class="dl">
            <dt>Tipo</dt><dd>${p.tipo || "—"}</dd>
            <dt>Responsável</dt><dd>${p.responsavel || "—"}</dd>
            <dt>WhatsApp</dt><dd>${p.whatsapp ? (wa ? html`<a href="${wa}" target="_blank" rel="noopener">${fmtTel(p.whatsapp)}</a>` : p.whatsapp) : "—"}</dd>
            <dt>CNPJ/CPF</dt><dd>${p.documento || "—"}</dd>
            <dt>Endereço</dt><dd>${[p.endereco, p.cidade].filter(Boolean).join(" — ") || "—"}</dd>
            <dt>Preço de repasse</dt><dd><strong>${brl(p.preco_repasse_centavos)}</strong> por frasco vendido</dd>
            ${p.obs ? html`<dt>Observações</dt><dd class="pre">${p.obs}</dd>` : ""}
          </dl>
          ${pontos.length && !c.movs.length ? html`<p class="consig-apagar"><button type="button" class="link-btn link-perigo" data-acao="apagar-ponto">${icone("trash", 14)}Apagar comércio</button> <span class="muted">(só enquanto não tem histórico)</span></p>` : ""}
          </div></section>
      </div>
      <section class="card card-tabela"><header class="card-cab"><div class="card-tit"><h3>Histórico</h3>
        <p class="card-sub">Mais recentes primeiro. Só o último movimento pode ser desfeito. "Comprovante" abre a impressão (dá para salvar em PDF).</p></div></header>
        ${historico(p)}</section>`);
  }

  /* ----- ações ----- */

  async function recarregar() {
    await carregar();
    desenhar();
  }

  function erroForm(t) {
    const msg = el.querySelector("#formMsg");
    if (msg) { msg.className = "admin-msg erro"; msg.textContent = t; }
  }

  async function enviar(form, rota, corpo, sucesso) {
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      const d = await api(rota, { method: "POST", body: JSON.stringify(corpo) });
      ui.form = null;
      toast(sucesso, "ok");
      return d;
    } catch (e) {
      erroForm(e.message || "Não consegui salvar.");
      btn.disabled = false;
      return null;
    }
  }

  async function salvarPonto(form) {
    const f = new FormData(form);
    const preco = parseBRL(f.get("preco"));
    if (!preco) return erroForm("Informe o preço de repasse (ex.: 14,00).");
    const corpo = {
      nome: f.get("nome"), tipo: f.get("tipo"), responsavel: f.get("responsavel"), whatsapp: f.get("whatsapp"),
      documento: f.get("documento"), endereco: f.get("endereco"), cidade: f.get("cidade"), obs: f.get("obs"),
      preco_repasse_centavos: preco,
    };
    const p = ui.ficha ? pontoAtual() : null;
    if (p) { corpo.id = p.id; corpo.status = f.get("status"); }
    const d = await enviar(form, "/admin/consignados/ponto", corpo, p ? "Dados salvos." : `${String(corpo.nome).trim()} cadastrado.`);
    if (!d) return;
    if (!p && d.id) ui.ficha = d.id; // abre a ficha do comércio recém-criado
    await recarregar();
  }

  async function salvarMovimento(form) {
    const p = pontoAtual();
    const tipo = form.dataset.tipo;
    const f = new FormData(form);
    const ler = (pref) => Object.fromEntries(ids.map((id) => [id, f.get(pref + id) === null || f.get(pref + id) === "" ? 0 : Number(f.get(pref + id))]));
    const corpo = { ponto_id: p.id, tipo, data: f.get("data"), obs: f.get("obs") };
    let sucesso = "";
    if (tipo === "entrega") {
      corpo.itens = ler("q_");
      if (!soma(corpo.itens)) return erroForm("Informe quantos frascos você deixou.");
      sucesso = "Entrega registrada.";
    } else if (tipo === "recolhimento") {
      corpo.itens = ler("q_");
      corpo.motivo = f.get("motivo");
      if (!soma(corpo.itens)) return erroForm("Informe quantos frascos você retirou.");
      sucesso = "Recolhimento registrado.";
    } else {
      corpo.sobra = ler("s_");
      corpo.reposicao = ler("q_");
      corpo.pago = f.get("pago") === "on";
      corpo.forma_pagamento = f.get("forma");
      sucesso = "Acerto registrado. O comprovante está no histórico.";
    }
    if (await enviar(form, "/admin/consignados/movimento", corpo, sucesso)) await recarregar();
  }

  // Movimentos gravados juntos (acerto + reposição na mesma visita) saem no mesmo comprovante.
  function comprovante(movId) {
    const p = pontoAtual();
    const m = p._c.movs.find((x) => x.id === movId);
    if (!m) return;
    const grupo = p._c.movs.filter((x) => x.criado_em === m.criado_em);
    imprimirComprovante({ ponto: p, grupo, produtos, ids, nomeCurto });
  }

  return {
    titulo: "Consignados",
    usaPeriodo: false,
    async montar(container) {
      el = container;
      setHTML(el, html`<p class="muted">Carregando consignados…</p>`);
      try {
        await carregar();
      } catch (e) {
        setHTML(el, html`<div class="alerta alerta-bad">${icone("alert", 18)}<span>${e.status === 404 ? "O Worker ainda não tem a consignação. Rode a migração 004 e o deploy do Worker." : e.message || "Não consegui carregar os consignados."}</span></div>`);
        return;
      }
      desenhar();

      el.addEventListener("input", debounce((ev) => {
        if (ev.target.id === "conBusca") { ui.q = ev.target.value; setHTML(el.querySelector("#conTabela"), tabelaPontos(filtrados())); }
      }, 150));
      el.addEventListener("input", (ev) => {
        const form = ev.target.closest("#formMov");
        if (form && form.dataset.tipo === "acerto") atualizarPreviaAcerto(form);
      });
      el.addEventListener("submit", (ev) => {
        ev.preventDefault();
        if (ev.target.id === "formPonto") salvarPonto(ev.target);
        if (ev.target.id === "formMov") salvarMovimento(ev.target);
      });
      el.addEventListener("click", async (ev) => {
        const f = ev.target.closest("[data-filtro]");
        if (f) { ui.filtro = f.dataset.filtro; desenhar(); return; }
        const a = ev.target.closest("[data-acao]");
        if (!a || a.disabled) return;
        const movId = Number(a.dataset.mov);
        switch (a.dataset.acao) {
          case "abrir": ui.ficha = Number(a.dataset.id); ui.form = null; desenhar(); window.scrollTo(0, 0); break;
          case "voltar": ui.ficha = null; ui.form = null; desenhar(); break;
          case "novo": ui.form = "novo"; desenhar(); el.querySelector("[name=nome]").focus(); break;
          case "form": ui.form = a.dataset.form; desenhar(); { const c = el.querySelector("#formMov input:not([type=date]), #formPonto input"); if (c) c.focus(); } break;
          case "fechar-form": ui.form = null; desenhar(); break;
          case "comprovante": comprovante(movId); break;
          case "marcar-pago": ui.pagando = movId; desenhar(); break;
          case "cancelar-pago": ui.pagando = null; desenhar(); break;
          case "confirmar-pago": case "desmarcar-pago": {
            const pago = a.dataset.acao === "confirmar-pago";
            const sel = el.querySelector("#formaPgto");
            try {
              await api("/admin/consignados/pagar", { method: "POST", body: JSON.stringify({ id: movId, pago, forma_pagamento: pago && sel ? sel.value : null }) });
              ui.pagando = null;
              toast(pago ? "Acerto marcado como recebido." : "Pagamento desmarcado.", "ok");
              await recarregar();
            } catch (e) { toast(e.message, "erro"); }
            break;
          }
          case "desfazer":
            if (!confirm("Desfazer este movimento? Ele some do histórico e o estoque volta ao que era antes.")) break;
            try {
              await api(`/admin/consignados/movimento?id=${movId}`, { method: "DELETE" });
              toast("Movimento desfeito.", "ok");
              await recarregar();
            } catch (e) { toast(e.message, "erro"); }
            break;
          case "apagar-ponto": {
            const p = pontoAtual();
            if (!confirm(`Apagar ${p.nome}? Isso não pode ser desfeito.`)) break;
            try {
              await api(`/admin/consignados/ponto?id=${p.id}`, { method: "DELETE" });
              toast("Comércio apagado.", "ok");
              ui.ficha = null;
              await recarregar();
            } catch (e) { toast(e.message, "erro"); }
            break;
          }
        }
      });
    },
    atualizar() { /* os consignados vêm do servidor a cada abertura; nada a refazer com os pedidos */ },
  };
}

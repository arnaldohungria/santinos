/* Painel Santino's — casca do painel: login, navegação, filtro de período, carregamento e atualização automática. */
import { S, api, sessao, lerPeriodoSalvo, salvarPeriodo } from "./state.js";
import { html, setHTML, icone, toast, hojeBRT, brl, dataBR, haQuanto } from "./util.js";
import { preparar, resolverPeriodo, noPeriodo, PRESETS } from "./dados.js";
import { criarGaveta } from "./drawer.js";
import { esconderTip } from "./charts.js";
import dashboardView from "./views/dashboard.js";
import pedidosView from "./views/pedidos.js";
import clientesView from "./views/clientes.js";
import cuponsView from "./views/cupons.js";
import relatoriosView from "./views/relatorios.js";
import configView from "./views/config.js";

const ABAS = [
  ["dashboard", "Dashboard", "dashboard"],
  ["pedidos", "Pedidos", "pedidos"],
  ["clientes", "Clientes", "clientes"],
  ["cupons", "Cupons", "cupons"],
  ["relatorios", "Relatórios", "relatorios"],
  ["config", "Configurações", "config"],
];
const FABRICAS = { dashboard: dashboardView, pedidos: pedidosView, clientes: clientesView, cupons: cuponsView, relatorios: relatoriosView, config: configView };
const INTERVALO_ATUALIZACAO_MS = 45000;

const $ = (id) => document.getElementById(id);
const telaLogin = $("login"), telaApp = $("app"), view = $("view");
let viewAtual = null;
let gaveta = null;
let timer = null;
let tentandoLogin = false;
let assinaturaPedidos = "";

/* ---------------- contexto entregue às telas ---------------- */

const menorData = () => S.pedidos.reduce((m, p) => (p._data && (!m || p._data < m) ? p._data : m), null);

const ctx = {
  periodo: () => resolverPeriodo(S.periodo.tipo, hojeBRT(), S.periodo.custom, menorData()),
  pedidosPeriodo() { const p = ctx.periodo(); return noPeriodo(S.pedidos, p.de, p.ate); },
  abrirPedido: (ref) => gaveta.abrirPedido(ref),
  abrirCliente: (chave) => gaveta.abrirCliente(chave),
  navegar(aba, filtros) {
    if (aba === "pedidos" && filtros && (filtros.pgto || filtros.envio)) {
      Object.assign(S.pedidosUI, { pgto: filtros.pgto || "", envio: filtros.envio || "", q: "", uf: "", metodo: "", cupom: "", pagina: 1 });
      if (filtros.envio) { S.periodo = { tipo: "tudo", custom: S.periodo.custom }; salvarPeriodo(); } // pendências não podem sumir por causa do período
    }
    irPara(aba);
  },
  aoMudarPedidos() { atualizarBadge(); if (viewAtual && viewAtual.atualizar) viewAtual.atualizar(); },
  aoMudarConfig() { preparar(S.pedidos, S.config); if (viewAtual && viewAtual.atualizar) viewAtual.atualizar(); },
  recarregar: () => carregarTudo(),
  sair: (msg) => sair(msg),
  aoClicarAcao(ev) {
    const a = ev.target.closest("[data-acao]");
    if (!a) return;
    switch (a.dataset.acao) {
      case "abrir-pedido": ctx.abrirPedido(a.dataset.ref); break;
      case "abrir-cliente": ctx.abrirCliente(a.dataset.chave); break;
      case "ir": ctx.navegar(a.dataset.aba, { pgto: a.dataset.pgto, envio: a.dataset.envio }); break;
    }
  },
};

/* ---------------- login / sessão ---------------- */

function mostrarLogin(msg = "") {
  clearInterval(timer);
  if (gaveta) gaveta.fechar();
  telaApp.hidden = true;
  telaLogin.hidden = false;
  $("loginErro").textContent = msg;
  $("loginSenha").value = "";
  $("loginSenha").focus();
}

function sair(msg) {
  sessao.limpar();
  S.pedidos = []; S.cupons = []; S.config = {}; S.sel.clear();
  mostrarLogin(typeof msg === "string" ? msg : "");
}

async function tentarEntrar() {
  const senha = $("loginSenha").value;
  const erro = $("loginErro");
  if (!senha) return;
  const btn = $("loginEntrar");
  btn.disabled = true;
  tentandoLogin = true;
  sessao.salvar(senha);
  try {
    await api("/admin/ping");
    erro.textContent = "";
    await iniciar();
  } catch (e) {
    sessao.limpar();
    erro.textContent = e.status === 429 ? e.message : e.status === 401 ? "Senha incorreta." : "Não consegui falar com o servidor. Tente de novo.";
  }
  tentandoLogin = false;
  btn.disabled = false;
}

document.addEventListener("admin:sair", (ev) => { if (!tentandoLogin) sair(ev.detail); });
$("loginEntrar").addEventListener("click", tentarEntrar);
$("loginSenha").addEventListener("keydown", (e) => { if (e.key === "Enter") tentarEntrar(); });
$("btnSair").addEventListener("click", () => sair());

/* ---------------- dados ---------------- */

async function carregarTudo() {
  view.classList.add("carregando");
  $("btnAtualizar").classList.add("girando");
  try {
    const [p, c, cfg] = await Promise.all([
      api("/admin/pedidos"),
      api("/admin/cupons").catch(() => ({ cupons: [] })),
      api("/admin/config").catch(() => ({ config: {}, produtos: {} })),
    ]);
    S.pedidos = p.pedidos || [];
    S.cupons = c.cupons || [];
    S.config = cfg.config || {};
    S.produtos = cfg.produtos || {};
    preparar(S.pedidos, S.config);
    assinaturaPedidos = assinatura(S.pedidos);
    S.carregadoEm = Date.now();
    atualizarBadge();
    if (viewAtual && viewAtual.aoMudarPeriodo) viewAtual.aoMudarPeriodo();
    else if (viewAtual && viewAtual.atualizar) viewAtual.atualizar();
    gaveta.atualizar();
    atualizarCarimbo();
  } catch (e) {
    if (e.status !== 401) toast(e.message || "Não consegui carregar os dados.", "erro");
    throw e;
  } finally {
    view.classList.remove("carregando");
    $("btnAtualizar").classList.remove("girando");
  }
}

const assinatura = (l) => l.map((p) => `${p.external_reference}|${p.status}|${p.status_envio}|${p.atualizado_em}`).join(";");

// Atualização automática silenciosa: só mexe na tela se algo mudou de verdade.
async function atualizarSilencioso() {
  if (document.hidden || telaApp.hidden) return;
  try {
    const p = await api("/admin/pedidos");
    const novos = p.pedidos || [];
    const nova = assinatura(novos);
    if (nova === assinaturaPedidos) return atualizarCarimbo();
    const antes = new Map(S.pedidos.map((x) => [x.external_reference, x.status]));
    const recemPagos = novos.filter((x) => x.status === "approved" && antes.size && antes.get(x.external_reference) !== "approved");
    S.pedidos = novos;
    preparar(S.pedidos, S.config);
    assinaturaPedidos = nova;
    S.carregadoEm = Date.now();
    atualizarBadge();
    for (const x of recemPagos.slice(0, 3)) toast(`Novo pedido pago: ${x.nome || x.external_reference} — ${brl(x.total_centavos || 0)}`, "ok", 8000);
    if (viewAtual && viewAtual.atualizar) viewAtual.atualizar();
    gaveta.atualizar();
    atualizarCarimbo();
  } catch { /* falha de rede momentânea: tenta de novo no próximo ciclo */ }
}

function atualizarCarimbo() {
  $("carimbo").textContent = S.carregadoEm ? `Atualizado ${haQuanto(new Date(S.carregadoEm).toISOString())}` : "";
}

function atualizarBadge() {
  const n = S.pedidos.filter((p) => p._pago && (p.status_envio || "novo") === "novo").length;
  const b = document.querySelector('[data-aba="pedidos"] .nav-badge');
  if (b) { b.textContent = String(n); b.hidden = n === 0; }
  document.title = `${n ? `(${n}) ` : ""}Admin — Santino's`;
}

/* ---------------- navegação e filtro de período ---------------- */

function montarNav() {
  setHTML($("nav"), html`${ABAS.map(([id, rot, ic]) => html`<a href="#${id}" class="nav-item" data-aba="${id}">${icone(ic, 18)}<span>${rot}</span>${id === "pedidos" ? html`<span class="nav-badge" hidden></span>` : ""}</a>`)}`);
}

function marcarNav() {
  document.querySelectorAll(".nav-item").forEach((a) => {
    const ativo = a.dataset.aba === S.aba;
    a.classList.toggle("ativo", ativo);
    if (ativo) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
}

function desenharPeriodo() {
  const barra = $("barraPeriodo");
  barra.hidden = !(viewAtual && viewAtual.usaPeriodo);
  if (barra.hidden) return;
  const per = ctx.periodo();
  const tipo = S.periodo.tipo;
  setHTML(barra, html`
    <div class="seg" role="group" aria-label="Período">
      ${PRESETS.map(([k, rot]) => html`<button type="button" class="seg-btn ${tipo === k ? "ativo" : ""}" data-per="${k}" aria-pressed="${tipo === k}">${rot}</button>`)}
      <button type="button" class="seg-btn ${tipo === "custom" ? "ativo" : ""}" data-per="custom" aria-pressed="${tipo === "custom"}">Personalizado</button>
    </div>
    ${tipo === "custom" ? html`<span class="datas"><input type="date" id="perDe" value="${per.de}" max="${hojeBRT()}" aria-label="De"> <span>até</span> <input type="date" id="perAte" value="${per.ate}" max="${hojeBRT()}" aria-label="Até"></span>` : ""}
    <span class="periodo-txt">${per.de === per.ate ? dataBR(per.de) : `${dataBR(per.de)} a ${dataBR(per.ate)}`}</span>`);
}

function aplicarPeriodo() {
  salvarPeriodo();
  desenharPeriodo();
  if (viewAtual && viewAtual.aoMudarPeriodo) viewAtual.aoMudarPeriodo();
  else if (viewAtual && viewAtual.atualizar) viewAtual.atualizar();
}

$("barraPeriodo").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-per]");
  if (!b) return;
  const tipo = b.dataset.per;
  if (tipo === "custom" && !S.periodo.custom) { const p = ctx.periodo(); S.periodo.custom = { de: p.de, ate: p.ate }; }
  S.periodo = { tipo, custom: S.periodo.custom };
  aplicarPeriodo();
});
$("barraPeriodo").addEventListener("change", (ev) => {
  if (ev.target.id !== "perDe" && ev.target.id !== "perAte") return;
  const de = $("perDe").value, ate = $("perAte").value;
  if (!de || !ate) return;
  S.periodo = { tipo: "custom", custom: { de, ate } };
  aplicarPeriodo();
});

function irPara(aba) {
  if (!FABRICAS[aba]) aba = "dashboard";
  esconderTip();
  gaveta.fechar();
  document.body.classList.remove("menu-aberto");
  S.aba = aba;
  if (location.hash.slice(1) !== aba) history.replaceState(null, "", `#${aba}`);
  viewAtual = FABRICAS[aba](ctx);
  view.replaceChildren();
  const conteudo = document.createElement("div"); // contêiner novo por tela: os ouvintes de evento da tela anterior somem junto
  conteudo.className = "view-conteudo";
  view.appendChild(conteudo);
  $("titulo").textContent = viewAtual.titulo;
  marcarNav();
  desenharPeriodo();
  try {
    viewAtual.montar(conteudo);
  } catch (e) {
    console.error(e);
    setHTML(conteudo, html`<div class="alerta alerta-bad">${icone("alert", 18)}<span>Algo deu errado ao montar esta tela: ${e.message}</span></div>`);
  }
  window.scrollTo(0, 0);
}

window.addEventListener("hashchange", () => {
  const aba = location.hash.slice(1);
  if (!telaApp.hidden && aba !== S.aba && FABRICAS[aba]) irPara(aba);
});
$("btnMenu").addEventListener("click", () => document.body.classList.toggle("menu-aberto"));
$("navFundo").addEventListener("click", () => document.body.classList.remove("menu-aberto"));
$("nav").addEventListener("click", () => document.body.classList.remove("menu-aberto"));
$("btnAtualizar").addEventListener("click", () => carregarTudo().then(() => toast("Dados atualizados.", "ok", 1800)).catch(() => {}));

/* ---------------- início ---------------- */

async function iniciar() {
  lerPeriodoSalvo();
  telaLogin.hidden = true;
  telaApp.hidden = false;
  montarNav();
  view.replaceChildren(Object.assign(document.createElement("p"), { className: "muted carregando-msg", textContent: "Carregando seus dados…" }));
  try {
    await carregarTudo();
  } catch (e) {
    if (e.status !== 401) {
      setHTML(view, html`<div class="alerta alerta-bad">${icone("alert", 18)}<span>Não consegui carregar os dados agora. <button type="button" class="link-btn" id="tentarDeNovo">Tentar de novo</button></span></div>`);
      $("tentarDeNovo").addEventListener("click", () => iniciar());
    }
    return;
  }
  const abaHash = location.hash.slice(1);
  irPara(FABRICAS[abaHash] ? abaHash : "dashboard");
  clearInterval(timer);
  timer = setInterval(atualizarSilencioso, INTERVALO_ATUALIZACAO_MS);
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !telaApp.hidden && S.carregadoEm && Date.now() - S.carregadoEm > 20000) atualizarSilencioso();
});

gaveta = criarGaveta(ctx);

if (sessao.tem()) iniciar();
else mostrarLogin();

/* Painel Santino's — gaveta lateral: detalhes do pedido e do cliente. */
import { S, api } from "./state.js";
import { html, raw, setHTML, icone, brl, num, dataHoraBR, dataBR, fmtTel, fmtCPF, fmtCEP, waLink, copiar, toast, haQuanto } from "./util.js";
import { pgtoInfo, ENVIO, detalheStatus, detalheMetodo, enderecoLinhas, temCustos, agruparClientes } from "./dados.js";
import { pill, pillPgto, pillEnvio, vazio } from "./comp.js";
import { imprimirEtiquetas } from "./impressao.js";

const primeiroNome = (n) => String(n || "").trim().split(/\s+/)[0] || "";

export function criarGaveta(ctx) {
  const raiz = document.getElementById("drawer");
  const corpo = document.getElementById("drawerCorpo");
  const titulo = document.getElementById("drawerTitulo");
  const sub = document.getElementById("drawerSub");
  let atual = null; // { tipo: 'pedido'|'cliente', chave }
  let focoAntes = null;

  function fechar() {
    if (raiz.hidden) return;
    raiz.hidden = true;
    document.body.classList.remove("gaveta-aberta");
    atual = null;
    if (focoAntes && document.contains(focoAntes)) focoAntes.focus();
  }
  function abrirBase() {
    if (raiz.hidden) {
      focoAntes = document.activeElement;
      raiz.hidden = false;
      document.body.classList.add("gaveta-aberta");
      raiz.querySelector(".drawer-fechar").focus();
    }
  }

  /* ---------------- pedido ---------------- */

  function textoEndereco(p) {
    return [p.nome, ...enderecoLinhas(p), p.cep ? `CEP ${fmtCEP(p.cep)}` : ""].filter(Boolean).join("\n");
  }

  function secaoCliente(p) {
    const wa = waLink(p.whatsapp, `Olá, ${primeiroNome(p.nome)}! Aqui é da Santino's, sobre o seu pedido ${p.external_reference}.`);
    return html`<section class="gv-sec"><h4>${icone("clientes", 15)}Cliente</h4>
      <dl class="dl">
        <dt>Nome</dt><dd>${p.nome || "—"}</dd>
        <dt>E-mail</dt><dd>${p.email ? html`<a href="mailto:${p.email}">${p.email}</a>` : "—"}</dd>
        <dt>WhatsApp</dt><dd>${p.whatsapp
          ? html`${fmtTel(p.whatsapp)} ${wa ? html`<a class="link-ic" href="${wa}" target="_blank" rel="noopener">${icone("whatsapp", 14)}Abrir conversa</a>` : ""}`
          : "—"}</dd>
        <dt>CPF</dt><dd>${p.cpf ? html`${fmtCPF(p.cpf)} <button type="button" class="link-btn" data-acao="copiar" data-texto="${p.cpf}">copiar</button>` : "—"}</dd>
      </dl>
      ${p._cliente ? html`<button type="button" class="link-btn" data-acao="abrir-cliente" data-chave="${p._cliente}">Ver histórico deste cliente</button>` : ""}
    </section>`;
  }

  function secaoEntrega(p) {
    const linhas = enderecoLinhas(p);
    return html`<section class="gv-sec"><h4>${icone("pin", 15)}Entrega</h4>
      ${linhas.length
        ? html`<address class="endereco">${linhas.map((l) => html`<div>${l}</div>`)}${p.cep ? html`<div>CEP ${fmtCEP(p.cep)}</div>` : ""}</address>`
        : html`<p class="muted">Endereço não disponível neste pedido. Use "Sincronizar" em Configurações para buscar de novo no Mercado Pago.</p>`}
      <dl class="dl">
        <dt>Frete</dt><dd>${p.frete_rotulo || "—"} · <strong>${p._frete ? brl(p._frete) : "Grátis"}</strong></dd>
      </dl>
      <div class="gv-acoes">
        <button type="button" class="btn btn-sec" data-acao="copiar" data-texto="${textoEndereco(p)}">${icone("copy", 15)}<span>Copiar endereço</span></button>
        <button type="button" class="btn btn-sec" data-acao="etiqueta">${icone("print", 15)}<span>Imprimir etiqueta</span></button>
      </div>
    </section>`;
  }

  function secaoItens(p) {
    const linhas = p._itens.map((i) => {
      const prod = S.produtos[i.id];
      const unit = prod ? prod.preco : 0;
      return html`<tr><td>${prod ? prod.nome : i.id}</td><td class="num">${i.qtd}</td><td class="num">${brl(unit)}</td><td class="num">${brl(unit * i.qtd)}</td></tr>`;
    });
    return html`<section class="gv-sec"><h4>${icone("box", 15)}Itens</h4>
      <div class="tabela-scroll"><table class="tabela tabela-compacta">
        <thead><tr><th>Produto</th><th class="num">Qtd</th><th class="num">Unit.</th><th class="num">Subtotal</th></tr></thead>
        <tbody>${linhas.length ? linhas : html`<tr><td colspan="4" class="muted">Itens não disponíveis neste pedido.</td></tr>`}</tbody>
      </table></div>
      <dl class="dl dl-soma">
        <dt>Produtos</dt><dd>${brl(p._subtotal)}</dd>
        ${p._desconto ? html`<dt>Cupom ${p.cupom ? html`<code>${p.cupom}</code>` : ""}</dt><dd class="neg">−${brl(p._desconto)}</dd>` : ""}
        <dt>Frete</dt><dd>${p._frete ? brl(p._frete) : "Grátis"}</dd>
        <dt class="forte">Total pago</dt><dd class="forte">${brl(p._total)}</dd>
      </dl>
    </section>`;
  }

  function secaoPagamento(p) {
    const info = pgtoInfo(p.status);
    const mostraLucro = p._pago && temCustos(S.config);
    return html`<section class="gv-sec"><h4>${icone("card", 15)}Pagamento</h4>
      <dl class="dl">
        <dt>Status</dt><dd>${pill(info)} ${p.status_detail ? html`<span class="muted">${detalheStatus(p.status_detail)}</span>` : ""}</dd>
        <dt>Forma</dt><dd>${p.tipo_pagamento ? detalheMetodo(p) : "—"}</dd>
        <dt>Pago em</dt><dd>${p.pago_em ? dataHoraBR(p.pago_em) : "—"}</dd>
        ${p._pago ? html`
          <dt>Taxa Mercado Pago</dt><dd>${p._taxa ? html`−${brl(p._taxa)}` : "—"}</dd>
          <dt>Você recebe</dt><dd><strong>${brl(p._liquido)}</strong></dd>` : ""}
        ${mostraLucro ? html`<dt>Lucro estimado</dt><dd><strong class="${p._lucro >= 0 ? "pos" : "neg"}">${brl(p._lucro)}</strong> <span class="muted">(custos configurados)</span></dd>` : ""}
      </dl>
    </section>`;
  }

  function secaoEnvio(p) {
    if (!p._pago) {
      return html`<section class="gv-sec"><h4>${icone("truck", 15)}Envio</h4>
        <p class="muted">O controle de envio fica disponível quando o pagamento for aprovado.</p></section>`;
    }
    const situacao = p.status_envio || "novo";
    const opcoes = Object.entries(ENVIO).map(([k, v]) => html`<option value="${k}" ${k === situacao ? raw("selected") : ""}>${v.rot}</option>`);
    const nome = primeiroNome(p.nome);
    const msgEnvio = `Olá, ${nome}! Seu pedido ${p.external_reference} da Santino's foi enviado.${p.rastreio ? ` Código de rastreio: ${p.rastreio}.` : ""} Qualquer dúvida é só chamar!`;
    const wa = waLink(p.whatsapp, msgEnvio);
    return html`<section class="gv-sec"><h4>${icone("truck", 15)}Envio</h4>
      <form class="form-envio" data-form="envio">
        <label>Situação<select name="status_envio">${opcoes}</select></label>
        <label>Código de rastreio<input type="text" name="rastreio" maxlength="60" value="${p.rastreio || ""}" placeholder="Ex.: AB123456789BR" autocomplete="off"></label>
        <label>Observações internas<textarea name="obs" rows="3" maxlength="1000" placeholder="Anotações só suas (não aparecem para o cliente)">${p.obs || ""}</textarea></label>
        <div class="gv-acoes">
          <button type="submit" class="btn btn-prim">${icone("check", 15)}<span>Salvar</span></button>
          ${wa ? html`<a class="btn btn-sec" href="${wa}" target="_blank" rel="noopener">${icone("whatsapp", 15)}<span>Avisar cliente no WhatsApp</span></a>` : ""}
        </div>
      </form>
    </section>`;
  }

  function secaoHistorico(p) {
    const eventos = [
      [p.criado_em, "Pedido criado"],
      [p.pago_em, "Pagamento aprovado"],
      [p.enviado_em, p.status_envio === "entregue" ? "Enviado / entregue" : "Marcado como enviado"],
    ].filter(([d]) => d);
    return html`<section class="gv-sec"><h4>${icone("clock", 15)}Histórico</h4>
      <ol class="timeline">${eventos.map(([d, t]) => html`<li><time>${dataHoraBR(d)}</time><span>${t}</span></li>`)}</ol>
      <details class="tec"><summary>Detalhes técnicos</summary>
        <dl class="dl">
          <dt>Referência</dt><dd><code>${p.external_reference}</code></dd>
          <dt>ID do pagamento</dt><dd><code>${p.mp_payment_id || "—"}</code></dd>
          <dt>Atualizado</dt><dd>${dataHoraBR(p.atualizado_em)} (${haQuanto(p.atualizado_em)})</dd>
        </dl>
      </details>
    </section>`;
  }

  function desenharPedido(p) {
    titulo.textContent = `Pedido ${p.external_reference}`;
    setHTML(sub, html`${pillPgto(p)} ${pillEnvio(p)} <span class="muted">${dataHoraBR(p.criado_em)}</span>`);
    setHTML(corpo, html`${secaoCliente(p)}${secaoEntrega(p)}${secaoItens(p)}${secaoPagamento(p)}${secaoEnvio(p)}${secaoHistorico(p)}`);
  }

  function abrirPedido(ref) {
    const p = S.pedidos.find((x) => x.external_reference === ref);
    if (!p) return;
    abrirBase();
    atual = { tipo: "pedido", chave: ref };
    desenharPedido(p);
    corpo.scrollTop = 0;
  }

  /* ---------------- cliente ---------------- */

  function abrirCliente(chave) {
    const c = agruparClientes(S.pedidos).find((x) => x.key === chave);
    if (!c) return;
    abrirBase();
    atual = { tipo: "cliente", chave };
    const wa = waLink(c.whatsapp, `Olá, ${primeiroNome(c.nome)}! Aqui é da Santino's.`);
    titulo.textContent = c.nome || "Cliente";
    setHTML(sub, html`${c.vip ? html`<span class="pill pill-ok">${icone("star", 13)}<span>VIP</span></span>` : ""}${c.recorrente ? html`<span class="pill pill-neutro-forte"><span>Recorrente</span></span>` : ""}<span class="muted">${c.cidade}${c.uf !== "—" ? ` / ${c.uf}` : ""}</span>`);
    const linhas = c.pedidos.map(
      (p) => html`<tr class="clicavel" data-acao="abrir-pedido" data-ref="${p.external_reference}">
        <td>${dataBR(p._data)}</td><td><code>${p.external_reference}</code></td><td>${pillPgto(p)}</td><td class="num">${brl(p._total)}</td></tr>`
    );
    setHTML(corpo, html`
      <section class="gv-sec"><h4>${icone("clientes", 15)}Contato</h4>
        <dl class="dl">
          <dt>E-mail</dt><dd>${c.email ? html`<a href="mailto:${c.email}">${c.email}</a>` : "—"}</dd>
          <dt>WhatsApp</dt><dd>${c.whatsapp ? html`${fmtTel(c.whatsapp)} ${wa ? html`<a class="link-ic" href="${wa}" target="_blank" rel="noopener">${icone("whatsapp", 14)}Abrir conversa</a>` : ""}` : "—"}</dd>
          <dt>CPF</dt><dd>${c.cpf ? fmtCPF(c.cpf) : "—"}</dd>
        </dl>
      </section>
      <section class="gv-sec"><h4>${icone("dashboard", 15)}Resumo</h4>
        <div class="mini-kpis">
          <div><span>Pedidos pagos</span><strong>${num(c.pagos)}</strong></div>
          <div><span>Total gasto</span><strong>${brl(c.gasto)}</strong></div>
          <div><span>Ticket médio</span><strong>${brl(c.ticket)}</strong></div>
          <div><span>Última compra</span><strong>${c.ultimo ? dataBR(c.ultimo) : "—"}</strong></div>
        </div>
      </section>
      <section class="gv-sec"><h4>${icone("pedidos", 15)}Pedidos (${c.pedidos.length})</h4>
        <div class="tabela-scroll"><table class="tabela tabela-compacta">
          <thead><tr><th>Data</th><th>Pedido</th><th>Pagamento</th><th class="num">Total</th></tr></thead>
          <tbody>${linhas}</tbody></table></div>
      </section>`);
    corpo.scrollTop = 0;
  }

  /* ---------------- eventos ---------------- */

  raiz.addEventListener("click", async (ev) => {
    if (ev.target.closest("[data-fechar]")) return fechar();
    const el = ev.target.closest("[data-acao]");
    if (!el) return;
    const acao = el.dataset.acao;
    if (acao === "copiar") {
      toast((await copiar(el.dataset.texto)) ? "Copiado!" : "Não consegui copiar.", "info", 1800);
    } else if (acao === "etiqueta" && atual) {
      const p = S.pedidos.find((x) => x.external_reference === atual.chave);
      if (p) imprimirEtiquetas([p], S.produtos);
    } else if (acao === "abrir-cliente") {
      abrirCliente(el.dataset.chave);
    } else if (acao === "abrir-pedido") {
      abrirPedido(el.dataset.ref);
    }
  });

  raiz.addEventListener("submit", async (ev) => {
    const form = ev.target.closest("[data-form='envio']");
    if (!form || !atual) return;
    ev.preventDefault();
    const p = S.pedidos.find((x) => x.external_reference === atual.chave);
    if (!p) return;
    const dados = new FormData(form);
    const upd = { ref: p.external_reference, status_envio: dados.get("status_envio"), rastreio: String(dados.get("rastreio") || "").trim(), obs: String(dados.get("obs") || "").trim() };
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      await api("/admin/pedidos/atualizar", { method: "POST", body: JSON.stringify({ atualizacoes: [upd] }) });
      p.status_envio = upd.status_envio;
      p.rastreio = upd.rastreio || null;
      p.obs = upd.obs || null;
      if (upd.status_envio === "enviado" || upd.status_envio === "entregue") p.enviado_em = p.enviado_em || new Date().toISOString();
      else p.enviado_em = null;
      toast("Pedido atualizado.", "ok");
      ctx.aoMudarPedidos();
      desenharPedido(p);
    } catch (e) {
      toast(e.message || "Não consegui salvar.", "erro");
      btn.disabled = false;
    }
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !raiz.hidden) fechar();
  });

  return {
    abrirPedido, abrirCliente, fechar,
    // chamada quando os pedidos foram recarregados: mantém a gaveta aberta e atualizada
    atualizar() {
      if (!atual || raiz.hidden) return;
      if (atual.tipo === "pedido") {
        const p = S.pedidos.find((x) => x.external_reference === atual.chave);
        if (p && !corpo.contains(document.activeElement)) desenharPedido(p);
      }
    },
  };
}


/* Painel Santino's — Dashboard de vendas. */
import { S } from "../state.js";
import { html, setHTML, icone, brl, num, pct, dataBR, diaMes, hojeBRT, ultimoDiaDoMes, primeiroDiaDoMes, NOME_DOW, NOME_MES, dowDe, haQuanto, diffDias } from "../util.js";
import { resumir, delta, serieDiaria, porProduto, porUF, porMetodo, porDiaSemana, porHora, porCupom, agruparClientes, noPeriodo, periodoAnterior, temCustos } from "../dados.js";
import { chipDelta, pillPgto, vazio } from "../comp.js";
import { colunas, barrasH, cardGrafico, sparkline, medidor, tabela } from "../charts.js";

const brlCurto = (c) => {
  const v = c / 100;
  if (Math.abs(v) >= 1000) return `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return `R$ ${v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
};

export default function dashboardView(ctx) {
  let el = null;

  function kpi(rotulo, valor, rodape, extraCls = "") {
    return html`<div class="kpi ${extraCls}"><div class="kpi-rot">${rotulo}</div><div class="kpi-val">${valor}</div><div class="kpi-rod">${rodape}</div></div>`;
  }

  function blocoMeta() {
    const meta = S.config.meta_mensal || 0;
    if (!meta) return "";
    const hoje = hojeBRT();
    const ini = primeiroDiaDoMes(hoje), fim = ultimoDiaDoMes(hoje);
    const noMes = S.pedidos.filter((p) => p._pago && p._data >= ini && p._data <= hoje).reduce((s, p) => s + p._total, 0);
    const diasPassados = diffDias(ini, hoje) + 1;
    const diasTotal = diffDias(ini, fim) + 1;
    const projecao = (noMes / diasPassados) * diasTotal;
    const fr = noMes / meta;
    const mes = NOME_MES[Number(hoje.slice(5, 7)) - 1];
    return html`<section class="card meta-card">
      <div class="meta-topo"><div><h3>Meta de ${mes}</h3><p class="card-sub">${brl(noMes)} de ${brl(meta)}</p></div>
        <strong class="meta-pct">${pct(fr, 0)}</strong></div>
      <div data-slot="medidor"></div>
      <p class="card-sub">Faltam ${diasTotal - diasPassados} dias. No ritmo atual, o mês fecha em <strong>${brl(projecao)}</strong>
        ${projecao >= meta ? "— acima da meta." : `— ${brl(meta - projecao)} abaixo da meta.`}</p>
    </section>`;
  }

  function desenhar() {
    const per = ctx.periodo();
    const ant = periodoAnterior(per);
    const lista = ctx.pedidosPeriodo();
    const listaAnt = ant ? noPeriodo(S.pedidos, ant.de, ant.ate) : null;
    const r = resumir(lista);
    const ra = listaAnt ? resumir(listaAnt) : null;
    const base = per.tipo === "mes" || per.tipo === "mesAnt" ? "vs mês anterior" : "vs período anterior";
    const d = (a, b) => chipDelta(ra ? delta(a, b) : null, base);
    const custos = temCustos(S.config);
    const serie = serieDiaria(lista, per.de, per.ate);
    const aEnviar = S.pedidos.filter((p) => p._pago && (p.status_envio || "novo") === "novo").length;

    // clientes novos x recorrentes no período (novo = 1ª compra paga caiu dentro do período)
    const todos = agruparClientes(S.pedidos);
    const compraramNoPeriodo = todos.filter((c) => c.pedidos.some((p) => p._pago && p._data >= per.de && p._data <= per.ate));
    const novos = compraramNoPeriodo.filter((c) => c.primeiro >= per.de).length;
    const recorrentes = compraramNoPeriodo.length - novos;

    const alertas = [];
    if (aEnviar) alertas.push(html`<div class="alerta alerta-warn">${icone("box", 18)}<span><strong>${aEnviar}</strong> ${aEnviar === 1 ? "pedido pago aguardando" : "pedidos pagos aguardando"} envio</span><button type="button" class="btn btn-mini" data-acao="ir" data-aba="pedidos" data-pgto="approved" data-envio="novo">Ver pedidos</button></div>`);
    if (!S.pedidos.length) alertas.push(html`<div class="alerta">${icone("alert", 18)}<span>Nenhum pedido ainda. Se você já vendeu, vá em <strong>Configurações → Sincronizar</strong> para buscar seus pedidos no Mercado Pago.</span></div>`);

    setHTML(el, html`
      ${alertas}
      <div class="grade-topo">
        <section class="card hero">
          <div class="hero-rot">Faturamento <span class="muted">· ${per.rotulo}</span></div>
          <div class="hero-val">${brl(r.receita)}</div>
          <div class="hero-rod">${d(r.receita, ra && ra.receita)}</div>
          <div class="hero-spark" data-slot="spark"></div>
          <div class="hero-sub">${num(r.pedidos)} ${r.pedidos === 1 ? "pedido pago" : "pedidos pagos"} · ${brl(r.subtotal - r.desconto)} em produtos + ${brl(r.frete)} de frete</div>
        </section>
        <div class="kpis">
          ${kpi("Pedidos pagos", num(r.pedidos), d(r.pedidos, ra && ra.pedidos))}
          ${kpi("Ticket médio", brl(r.ticket), d(r.ticket, ra && ra.ticket))}
          ${kpi("Unidades vendidas", num(r.itens), d(r.itens, ra && ra.itens))}
          ${custos
            ? kpi("Lucro estimado", brl(r.lucro), html`${d(r.lucro, ra && ra.lucro)}<span class="kpi-nota">margem ${pct(r.margem, 0)}</span>`)
            : kpi("Lucro estimado", html`<span class="kpi-cta">—</span>`, html`<button type="button" class="link-btn" data-acao="ir" data-aba="config">Configure seus custos</button>`)}
          ${kpi("Aguardando pagamento", num(r.pendentes), html`<span class="kpi-nota">${brl(r.pendentesValor)} em Pix/boletos abertos</span>`)}
          ${kpi("Clientes", num(compraramNoPeriodo.length), html`<span class="kpi-nota">${num(novos)} ${novos === 1 ? "novo" : "novos"} · ${num(recorrentes)} ${recorrentes === 1 ? "recorrente" : "recorrentes"}</span>`)}
        </div>
      </div>

      ${blocoMeta()}

      <div class="grade-2-1">
        <div data-slot="diario"></div>
        <section class="card">
          <header class="card-cab"><div class="card-tit"><h3>Resumo financeiro</h3><p class="card-sub">${per.rotulo}</p></div></header>
          <div class="card-corpo"><dl class="dl dl-fin">
            <dt>Produtos vendidos</dt><dd>${brl(r.subtotal)}</dd>
            <dt>(−) Descontos de cupom</dt><dd class="neg">−${brl(r.desconto)}</dd>
            <dt>(+) Frete cobrado</dt><dd>${brl(r.frete)}</dd>
            <dt class="forte">Faturamento</dt><dd class="forte">${brl(r.receita)}</dd>
            <dt>(−) Taxas do Mercado Pago</dt><dd class="neg">−${brl(r.taxa)}</dd>
            <dt class="forte">Você recebe</dt><dd class="forte">${brl(r.liquido)}</dd>
            ${custos ? html`
              <dt>(−) Frete repassado ao envio*</dt><dd class="neg">−${brl(r.frete)}</dd>
              <dt>(−) Custo dos produtos + embalagem</dt><dd class="neg">−${brl(r.custo)}</dd>
              <dt class="forte">Lucro estimado</dt><dd class="forte ${r.lucro >= 0 ? "pos" : "neg"}">${brl(r.lucro)}</dd>` : ""}
          </dl>
          ${custos ? html`<p class="nota">* Considera que o frete cobrado do cliente paga a etiqueta.</p>`
            : html`<p class="nota">Informe o custo de cada molho em <button type="button" class="link-btn" data-acao="ir" data-aba="config">Configurações</button> para ver custos e lucro.</p>`}
          ${r.reembolsados ? html`<p class="nota">${icone("undo", 13)} ${r.reembolsados} ${r.reembolsados === 1 ? "pedido reembolsado" : "pedidos reembolsados"} (${brl(r.reembolsadosValor)}) — não entram no faturamento.</p>` : ""}
          </div>
        </section>
      </div>

      <div class="grade-3">
        <div data-slot="produtos"></div>
        <div data-slot="uf"></div>
        <div data-slot="metodo"></div>
      </div>

      <div class="grade-2">
        <div data-slot="dow"></div>
        <div data-slot="hora"></div>
      </div>

      <div class="grade-3">
        <section class="card"><header class="card-cab"><div class="card-tit"><h3>Últimos pedidos</h3><p class="card-sub">Independente do período</p></div>
          <button type="button" class="btn-mini" data-acao="ir" data-aba="pedidos">Ver todos</button></header>
          <div class="card-corpo">${ultimos()}</div></section>
        <section class="card"><header class="card-cab"><div class="card-tit"><h3>Melhores clientes</h3><p class="card-sub">${per.rotulo}</p></div>
          <button type="button" class="btn-mini" data-acao="ir" data-aba="clientes">Ver todos</button></header>
          <div class="card-corpo">${melhores(lista)}</div></section>
        <section class="card"><header class="card-cab"><div class="card-tit"><h3>Cupons no período</h3><p class="card-sub">Pedidos pagos que usaram cupom</p></div>
          <button type="button" class="btn-mini" data-acao="ir" data-aba="cupons">Gerenciar</button></header>
          <div class="card-corpo">${cuponsCard(lista, r)}</div></section>
      </div>`);

    const slot = (nome) => el.querySelector(`[data-slot="${nome}"]`);
    slot("spark").appendChild(sparkline(serie.map((x) => x.receita)));
    const m = slot("medidor");
    if (m) m.appendChild(medidor((S.config.meta_mensal ? S.pedidos.filter((p) => p._pago && p._data >= primeiroDiaDoMes(hojeBRT()) && p._data <= hojeBRT()).reduce((s, p) => s + p._total, 0) / S.config.meta_mensal : 0), "Progresso da meta do mês"));

    const montar = (nome, card) => { slot(nome).replaceWith(card); card._pintar(); };

    /* faturamento por dia (+ linha do período anterior) */
    const serieAnt = ant ? serieDiaria(listaAnt, ant.de, ant.ate).map((x) => x.receita) : null;
    montar("diario", cardGrafico({
      titulo: "Faturamento por dia",
      sub: `${dataBR(per.de)} a ${dataBR(per.ate)}`,
      construir: (c) => colunas(c, {
        dados: serie.map((x) => ({ rotulo: diaMes(x.dia), valor: x.receita })),
        anterior: serieAnt && serieAnt.some((v) => v > 0) ? serieAnt : null,
        legenda: { atual: "Este período", anterior: ant ? `${dataBR(ant.de)} a ${dataBR(ant.ate)}` : "" },
        formato: brlCurto, formatoEixo: brlCurto,
        rotuloX: (i) => diaMes(serie[i].dia),
        ariaLabel: "Faturamento por dia",
        tooltip: (i) => {
          const x = serie[i];
          const linhas = [{ valor: brl(x.receita), rotulo: "faturamento", chave: "barra" }, { valor: `${x.pedidos} ${x.pedidos === 1 ? "pedido" : "pedidos"}`, rotulo: x.pedidos ? `ticket ${brl(x.receita / x.pedidos)}` : "" }];
          if (serieAnt && serieAnt[i] !== undefined) linhas.push({ valor: brl(serieAnt[i]), rotulo: "período anterior", chave: "linha" });
          return { titulo: `${NOME_DOW[dowDe(x.dia)]}, ${dataBR(x.dia)}`, linhas };
        },
      }),
      versaoTabela: () => tabela(["Data", "Pedidos", "Faturamento", ...(serieAnt ? ["Período anterior"] : [])],
        serie.map((x, i) => [dataBR(x.dia), num(x.pedidos), brl(x.receita), ...(serieAnt ? [serieAnt[i] !== undefined ? brl(serieAnt[i]) : "—"] : [])])),
    }));

    /* produtos */
    const prods = porProduto(lista, S.produtos);
    montar("produtos", cardGrafico({
      titulo: "Produtos mais vendidos", sub: "Unidades no período",
      construir: (c) => barrasH(c, prods.map((p) => ({ rotulo: p.nome.replace("Santino's ", ""), valor: p.qtd, sub: `${brl(p.receita)} em ${p.pedidos} ${p.pedidos === 1 ? "pedido" : "pedidos"}` })), { formato: (v) => `${num(v)} un.` }),
      versaoTabela: () => tabela(["Produto", "Unidades", "Faturamento"], prods.map((p) => [p.nome, num(p.qtd), brl(p.receita)])),
    }));

    /* estados */
    const ufs = porUF(lista).slice(0, 8);
    montar("uf", cardGrafico({
      titulo: "Vendas por estado", sub: "Faturamento — top 8",
      construir: (c) => barrasH(c, ufs.map((u) => ({ rotulo: u.chave, valor: u.receita, sub: `${u.pedidos} ${u.pedidos === 1 ? "pedido" : "pedidos"}` })), { formato: brl }),
      versaoTabela: () => tabela(["Estado", "Pedidos", "Faturamento"], ufs.map((u) => [u.chave, num(u.pedidos), brl(u.receita)])),
    }));

    /* forma de pagamento */
    const mets = porMetodo(lista);
    montar("metodo", cardGrafico({
      titulo: "Formas de pagamento", sub: "Faturamento por forma",
      construir: (c) => barrasH(c, mets.map((u) => ({ rotulo: u.chave, valor: u.receita, sub: `${u.pedidos} ${u.pedidos === 1 ? "pedido" : "pedidos"}` })), { formato: brl }),
      versaoTabela: () => tabela(["Forma", "Pedidos", "Faturamento"], mets.map((u) => [u.chave, num(u.pedidos), brl(u.receita)])),
    }));

    /* dia da semana e hora do dia (pedidos pagos) */
    const dow = porDiaSemana(lista);
    montar("dow", cardGrafico({
      titulo: "Pedidos por dia da semana", sub: "Quando seus clientes compram",
      construir: (c) => colunas(c, {
        dados: dow.map((x, i) => ({ rotulo: NOME_DOW[i].slice(0, 3), valor: x.pedidos })),
        formato: num, formatoEixo: num, inteiros: true, altura: 200, ariaLabel: "Pedidos por dia da semana",
        vazio: "Sem pedidos neste período.",
        tooltip: (i) => ({ titulo: NOME_DOW[i], linhas: [{ valor: `${dow[i].pedidos} ${dow[i].pedidos === 1 ? "pedido" : "pedidos"}`, chave: "barra" }, { valor: brl(dow[i].receita), rotulo: "faturamento" }] }),
      }),
      versaoTabela: () => tabela(["Dia", "Pedidos", "Faturamento"], dow.map((x, i) => [NOME_DOW[i], num(x.pedidos), brl(x.receita)])),
    }));
    const hora = porHora(lista);
    montar("hora", cardGrafico({
      titulo: "Pedidos por hora do dia", sub: "Horário de Brasília — bom pra escolher quando anunciar",
      construir: (c) => colunas(c, {
        dados: hora.map((x, i) => ({ rotulo: `${i}h`, valor: x.pedidos })),
        formato: num, formatoEixo: num, inteiros: true, altura: 200, ariaLabel: "Pedidos por hora do dia", vazio: "Sem pedidos neste período.",
        tooltip: (i) => ({ titulo: `${String(i).padStart(2, "0")}h às ${String(i).padStart(2, "0")}h59`, linhas: [{ valor: `${hora[i].pedidos} ${hora[i].pedidos === 1 ? "pedido" : "pedidos"}`, chave: "barra" }, { valor: brl(hora[i].receita), rotulo: "faturamento" }] }),
      }),
      versaoTabela: () => tabela(["Hora", "Pedidos", "Faturamento"], hora.map((x, i) => [`${i}h`, num(x.pedidos), brl(x.receita)])),
    }));
  }

  function ultimos() {
    const l = S.pedidos.slice(0, 6);
    if (!l.length) return vazio("Sem pedidos ainda", "Quando entrar o primeiro pedido ele aparece aqui.");
    return html`<ul class="lista-ped">${l.map(
      (p) => html`<li><button type="button" data-acao="abrir-pedido" data-ref="${p.external_reference}">
        <span class="lp-nome">${p.nome || p.external_reference}<small>${p._cidade}${p._uf !== "—" ? ` / ${p._uf}` : ""} · ${haQuanto(p.criado_em)}</small></span>
        <span class="lp-dir"><strong>${brl(p._total)}</strong>${pillPgto(p)}</span></button></li>`
    )}</ul>`;
  }

  function melhores(lista) {
    const c = agruparClientes(lista).filter((x) => x.pagos > 0).slice(0, 5);
    if (!c.length) return vazio("Sem compras no período", "Os clientes que mais compraram aparecem aqui.", "clientes");
    return html`<ul class="lista-ped">${c.map(
      (x) => html`<li><button type="button" data-acao="abrir-cliente" data-chave="${x.key}">
        <span class="lp-nome">${x.nome || "—"}<small>${x.pagos} ${x.pagos === 1 ? "pedido" : "pedidos"} · ${x.cidade}${x.uf !== "—" ? ` / ${x.uf}` : ""}</small></span>
        <span class="lp-dir"><strong>${brl(x.gasto)}</strong></span></button></li>`
    )}</ul>`;
  }

  function cuponsCard(lista, r) {
    const c = porCupom(lista).slice(0, 5);
    if (!c.length) return vazio("Nenhum cupom usado", "Crie um cupom na aba Cupons e divulgue nos anúncios.", "cupons");
    return html`<ul class="lista-ped">${c.map(
      (x) => html`<li><div class="lp-linha"><span class="lp-nome"><code>${x.cupom}</code><small>${x.pedidos} ${x.pedidos === 1 ? "pedido" : "pedidos"} · ${brl(x.receita)} faturados</small></span>
        <span class="lp-dir"><strong class="neg">−${brl(x.desconto)}</strong><small>desconto</small></span></div></li>`
    )}</ul>${r.pedidos ? html`<p class="nota">${pct(r.comCupom / r.pedidos, 0)} dos pedidos pagos usaram cupom.</p>` : ""}`;
  }

  return {
    titulo: "Dashboard",
    usaPeriodo: true,
    montar(container) {
      el = container;
      el.addEventListener("click", (ev) => ctx.aoClicarAcao(ev));
      desenhar();
    },
    atualizar() { if (el) desenhar(); },
  };
}

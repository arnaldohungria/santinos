/* Painel Santino's — gráficos (SVG/HTML puro, sem biblioteca).
 *
 * Segue as regras de dataviz do projeto: uma série = uma cor (ember), barras
 * finas (<= 24px) com topo arredondado e base reta, grade de 1px sólida e
 * discreta, legenda só quando há 2+ séries, rótulo seletivo (só o pico),
 * tooltip em cada barra (nunca é o único jeito de ler um valor: todo gráfico
 * tem a versão "Tabela"), textos sempre em tokens de texto, nunca na cor da
 * série. Todo texto vindo de dados entra via textContent.
 */

const NS = "http://www.w3.org/2000/svg";

function svgEl(tag, attrs = {}, texto) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (texto !== undefined) e.textContent = texto;
  return e;
}
function htmlEl(tag, cls, texto) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (texto !== undefined) e.textContent = texto;
  return e;
}

/* ---------------- tooltip único ---------------- */

export function mostrarTip(titulo, linhas, x, y) {
  const t = document.getElementById("tip");
  if (!t) return;
  t.replaceChildren();
  t.appendChild(htmlEl("div", "tip-tit", titulo));
  for (const l of linhas) {
    const lin = htmlEl("div", "tip-lin");
    if (l.chave) {
      const k = htmlEl("span", `tip-chave ${l.chave}`);
      lin.appendChild(k);
    }
    lin.appendChild(htmlEl("strong", "tip-val", l.valor));
    if (l.rotulo) lin.appendChild(htmlEl("span", "tip-rot", l.rotulo));
    t.appendChild(lin);
  }
  t.hidden = false;
  const pad = 10;
  t.style.left = "0px";
  t.style.top = "0px";
  const r = t.getBoundingClientRect();
  let left = x + 14;
  if (left + r.width > window.innerWidth - pad) left = x - r.width - 14;
  let top = y - r.height - 12;
  if (top < pad) top = y + 18;
  t.style.left = `${Math.max(pad, left)}px`;
  t.style.top = `${top}px`;
}
export function esconderTip() {
  const t = document.getElementById("tip");
  if (t) t.hidden = true;
}

/* ---------------- escala com números redondos ---------------- */

function escala(max, ticks = 4, inteiros = false) {
  if (!(max > 0)) return { max: ticks, passo: 1, ticks };
  if (inteiros) {
    const bruto = Math.max(1, Math.ceil(max / ticks));
    const mag = 10 ** Math.floor(Math.log10(bruto));
    const cands = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((x) => x * mag).filter(Number.isInteger);
    const passo = cands.find((x) => x >= bruto) ?? 10 * mag;
    return { max: passo * ticks, passo, ticks };
  }
  const bruto = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(bruto));
  const n = bruto / mag;
  const passo = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  return { max: passo * ticks, passo, ticks };
}

function barraPath(x, yTopo, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${yTopo + h}V${yTopo + r}Q${x},${yTopo} ${x + r},${yTopo}H${x + w - r}Q${x + w},${yTopo} ${x + w},${yTopo + r}V${yTopo + h}Z`;
}

/* ---------------- colunas (série no tempo) ----------------
 * opts: { dados:[{rotulo, valor}], anterior?:[números], formato(v), formatoEixo(v),
 *         rotuloX(i), tooltip(i)→{titulo, linhas}, altura, ariaLabel, legenda?:{atual, anterior},
 *         vazio? }
 */
export function colunas(container, opts) {
  container.classList.add("graf");
  container.replaceChildren();
  const legenda = htmlEl("div", "legenda");
  if (opts.anterior && opts.legenda) {
    legenda.append(
      chaveLegenda("barra", opts.legenda.atual),
      chaveLegenda("linha", opts.legenda.anterior)
    );
    container.appendChild(legenda);
  }
  const host = htmlEl("div", "graf-host");
  container.appendChild(host);

  let larguraDesenhada = 0;
  const desenhar = () => {
    const W = Math.max(260, Math.floor(host.clientWidth));
    if (Math.abs(W - larguraDesenhada) < 2 && host.firstChild) return;
    larguraDesenhada = W;
    host.replaceChildren();

    const dados = opts.dados;
    const n = dados.length;
    const H = opts.altura || 240;
    const m = { t: 20, r: 6, b: 26, l: 54 };
    const pw = W - m.l - m.r;
    const ph = H - m.t - m.b;
    const valores = dados.map((d) => d.valor);
    const maxDado = Math.max(0, ...valores, ...(opts.anterior || []));

    if (!n || maxDado <= 0) {
      host.appendChild(htmlEl("p", "graf-vazio", opts.vazio || "Sem vendas neste período."));
      return;
    }

    const esc = escala(maxDado, 4, opts.inteiros);
    const yDe = (v) => m.t + ph - (v / esc.max) * ph;
    const banda = pw / n;
    const larg = Math.max(2, Math.min(24, banda - 2));
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: "grafico", role: "img", "aria-label": opts.ariaLabel || "Gráfico" });

    // grade + eixo Y
    for (let i = 0; i <= esc.ticks; i++) {
      const v = i * esc.passo;
      const y = yDe(v);
      svg.appendChild(svgEl("line", { x1: m.l, x2: W - m.r, y1: y, y2: y, class: i === 0 ? "eixo" : "grade" }));
      svg.appendChild(svgEl("text", { x: m.l - 8, y: y + 4, class: "eixo-txt", "text-anchor": "end" }, (opts.formatoEixo || opts.formato)(v)));
    }

    // rótulos X: só quantos couberem
    const passoX = Math.max(1, Math.ceil(46 / banda));
    dados.forEach((d, i) => {
      const ehUltimo = i === n - 1;
      const cabe = i % passoX === 0 && n - 1 - i >= passoX * 0.7;
      if (!cabe && !ehUltimo) return;
      const cx = m.l + banda * i + banda / 2;
      svg.appendChild(svgEl("text", { x: cx, y: H - 8, class: "eixo-txt", "text-anchor": "middle" }, opts.rotuloX ? opts.rotuloX(i) : d.rotulo));
    });

    // barras
    const barras = dados.map((d, i) => {
      const h = (d.valor / esc.max) * ph;
      if (h <= 0) return null;
      const cx = m.l + banda * i + banda / 2;
      const p = svgEl("path", { d: barraPath(cx - larg / 2, m.t + ph - h, larg, h, 4), class: "barra" });
      svg.appendChild(p);
      return p;
    });

    // período anterior (linha de contexto)
    if (opts.anterior) {
      const pts = opts.anterior.map((v, i) => `${m.l + banda * i + banda / 2},${yDe(v)}`);
      svg.appendChild(svgEl("polyline", { points: pts.join(" "), class: "linha-ant" }));
    }

    // rótulo só no pico
    const iPico = valores.indexOf(Math.max(...valores));
    if (n > 1 && valores[iPico] > 0) {
      const cx = Math.min(W - m.r - 26, Math.max(m.l + 26, m.l + banda * iPico + banda / 2));
      svg.appendChild(svgEl("text", { x: cx, y: yDe(valores[iPico]) - 6, class: "rotulo-pico", "text-anchor": "middle" }, opts.formato(valores[iPico])));
    }

    // alvos de hover: a faixa inteira (maior que a barra) é o alvo
    const alvos = svgEl("g");
    dados.forEach((d, i) => {
      const r = svgEl("rect", { x: m.l + banda * i, y: m.t, width: banda, height: ph, class: "alvo", tabindex: "-1" });
      const mostrar = (ev) => {
        barras.forEach((b) => b && b.classList.remove("hover"));
        if (barras[i]) barras[i].classList.add("hover");
        const t = opts.tooltip(i);
        mostrarTip(t.titulo, t.linhas, ev.clientX, ev.clientY);
      };
      r.addEventListener("pointerenter", mostrar);
      r.addEventListener("pointermove", mostrar);
      r.addEventListener("pointerleave", () => {
        if (barras[i]) barras[i].classList.remove("hover");
        esconderTip();
      });
      alvos.appendChild(r);
    });
    svg.appendChild(alvos);
    host.appendChild(svg);
  };

  desenhar();
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => desenhar());
    ro.observe(host);
    container._ro = ro;
  }
}

function chaveLegenda(tipo, texto) {
  const c = htmlEl("span", "leg-item");
  c.appendChild(htmlEl("span", `leg-chave leg-${tipo}`));
  c.appendChild(document.createTextNode(texto));
  return c;
}

/* ---------------- barras horizontais (comparar categorias) ----------------
 * itens: [{rotulo, valor, sub?}] — uma série só, então todas as barras usam a
 * mesma cor (a cor NÃO codifica o valor; o comprimento já faz isso).
 */
export function barrasH(container, itens, opts) {
  container.classList.add("graf");
  container.replaceChildren();
  if (!itens.length || itens.every((i) => !i.valor)) {
    container.appendChild(htmlEl("p", "graf-vazio", opts.vazio || "Sem dados neste período."));
    return;
  }
  const max = Math.max(...itens.map((i) => i.valor));
  const lista = htmlEl("div", "barras-h");
  for (const it of itens) {
    const linha = htmlEl("div", "bh-linha");
    linha.appendChild(htmlEl("span", "bh-rot", it.rotulo));
    const trilha = htmlEl("div", "bh-trilha");
    const barra = htmlEl("span", "bh-barra");
    barra.style.setProperty("--p", String(max ? it.valor / max : 0));
    trilha.appendChild(barra);
    trilha.appendChild(htmlEl("span", "bh-val", opts.formato(it.valor)));
    linha.appendChild(trilha);
    const mostrar = (ev) => mostrarTip(it.rotulo, [{ valor: opts.formato(it.valor), rotulo: it.sub || "" }], ev.clientX, ev.clientY);
    linha.addEventListener("pointerenter", () => barra.classList.add("hover"));
    linha.addEventListener("pointermove", mostrar);
    linha.addEventListener("pointerleave", () => { barra.classList.remove("hover"); esconderTip(); });
    lista.appendChild(linha);
  }
  container.appendChild(lista);
}

/* ---------------- sparkline (cartão de KPI) ---------------- */

export function sparkline(valores, w = 220, h = 52) {
  const svg = svgEl("svg", { viewBox: `0 0 ${w} ${h}`, width: "100%", height: h, class: "spark", preserveAspectRatio: "none", "aria-hidden": "true" });
  const max = Math.max(...valores, 0);
  if (valores.length < 2 || max <= 0) return svg;
  const pad = 6;
  const x = (i) => pad + (i / (valores.length - 1)) * (w - pad * 2);
  const y = (v) => h - pad - (v / max) * (h - pad * 2);
  svg.appendChild(svgEl("polyline", { points: valores.map((v, i) => `${x(i)},${y(v)}`).join(" "), class: "spark-linha" }));
  return svg;
}

/* ---------------- medidor (meta, participação) ---------------- */

export function medidor(fracao, rotulo) {
  const m = htmlEl("div", "medidor");
  m.setAttribute("role", "meter");
  m.setAttribute("aria-valuemin", "0");
  m.setAttribute("aria-valuemax", "100");
  m.setAttribute("aria-valuenow", String(Math.round(Math.min(1, fracao) * 100)));
  if (rotulo) m.setAttribute("aria-label", rotulo);
  const f = htmlEl("span", "medidor-fill");
  f.style.width = `${Math.max(0, Math.min(1, fracao)) * 100}%`;
  m.appendChild(f);
  return m;
}

/* ---------------- tabela (versão acessível de todo gráfico) ---------------- */

export function tabela(colunasDef, linhas, opts = {}) {
  const wrap = htmlEl("div", "tabela-scroll");
  const t = htmlEl("table", "tabela" + (opts.compacta ? " tabela-compacta" : ""));
  const thead = htmlEl("thead");
  const trh = htmlEl("tr");
  colunasDef.forEach((c, i) => {
    const th = htmlEl("th", i > 0 && opts.numerica !== false ? "num" : "", c);
    trh.appendChild(th);
  });
  thead.appendChild(trh);
  t.appendChild(thead);
  const tbody = htmlEl("tbody");
  for (const l of linhas) {
    const tr = htmlEl("tr");
    l.forEach((c, i) => tr.appendChild(htmlEl("td", i > 0 && opts.numerica !== false ? "num" : "", c)));
    tbody.appendChild(tr);
  }
  t.appendChild(tbody);
  wrap.appendChild(t);
  return wrap;
}

/* ---------------- cartão de gráfico com alternância Gráfico/Tabela ----------------
 * construir(corpo): desenha o gráfico dentro de `corpo`
 * versaoTabela(): devolve o elemento de tabela equivalente
 */
export function cardGrafico({ titulo, sub, construir, versaoTabela, classe = "" }) {
  const card = htmlEl("section", `card ${classe}`);
  const cab = htmlEl("header", "card-cab");
  const tit = htmlEl("div", "card-tit");
  tit.appendChild(htmlEl("h3", "", titulo));
  if (sub) tit.appendChild(htmlEl("p", "card-sub", sub));
  cab.appendChild(tit);
  const alt = htmlEl("button", "btn-mini");
  alt.type = "button";
  alt.textContent = "Ver tabela";
  cab.appendChild(alt);
  const corpo = htmlEl("div", "card-corpo");
  card.append(cab, corpo);

  let modoTabela = false;
  const pintar = () => {
    esconderTip();
    if (corpo._ro) { corpo._ro.disconnect(); corpo._ro = null; }
    corpo.replaceChildren();
    if (modoTabela) corpo.appendChild(versaoTabela());
    else construir(corpo);
    alt.textContent = modoTabela ? "Ver gráfico" : "Ver tabela";
  };
  alt.addEventListener("click", () => { modoTabela = !modoTabela; pintar(); });
  card._pintar = pintar;
  return card;
}

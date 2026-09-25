/* Santino's — avaliações de produtos no site.
 *
 * Carregar DEPOIS de loja.js (usa LOJA_CONFIG). Três usos:
 *   - página de produto: seção #avaliacoes[data-produto] com resumo + lista;
 *   - cards da home / cabeçalho do produto: [data-rating-de="id"] com "★ 4,8 (12)";
 *   - avaliar.html: formulário de envio (só quem comprou; a loja aprova antes de publicar).
 *
 * SEGURANÇA: nomes e comentários vêm do público. Tudo aqui é montado com createElement +
 * textContent (nunca innerHTML com dado de avaliação).
 * Se o Worker ainda não tem a funcionalidade (deploy pendente), as seções ficam ocultas.
 */
(function () {
  "use strict";

  const api = () => String(LOJA_CONFIG.workerUrl || "").replace(/\/$/, "");

  function el(tag, props, ...filhos) {
    const e = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === "class") e.className = v;
        else if (k === "text") e.textContent = v;
        else e.setAttribute(k, v);
      }
    }
    for (const f of filhos) if (f) e.append(f);
    return e;
  }

  const nota1 = (n) => Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const dataBR = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-").reverse().join("/") : "");

  // ★★★★★ preenchidas até `nota` (aceita frações), com rótulo acessível.
  function estrelas(nota, rotulo) {
    const e = el("span", { class: "estrelas", role: "img", "aria-label": rotulo || `Nota ${nota1(nota)} de 5`, text: "★★★★★" });
    e.style.setProperty("--pct", `${Math.max(0, Math.min(5, nota)) * 20}%`);
    return e;
  }

  async function ler(caminho) {
    try {
      const r = await fetch(api() + caminho);
      if (!r.ok) return null;
      return await r.json();
    } catch {
      return null;
    }
  }

  /* ---------- "★ 4,8 (12)" nos cards e no cabeçalho do produto ---------- */
  async function initRatingsMini() {
    const alvos = document.querySelectorAll("[data-rating-de]");
    if (!alvos.length || !api()) return;
    const d = await ler("/avaliacoes");
    if (!d || !d.resumo) return;
    alvos.forEach((a) => {
      const r = d.resumo[a.dataset.ratingDe];
      if (!r || !r.total) return;
      a.replaceChildren(
        estrelas(r.media, `Nota média ${nota1(r.media)} de 5`),
        el("span", { class: "rating-txt", text: ` ${nota1(r.media)} (${r.total} ${r.total === 1 ? "avaliação" : "avaliações"})` })
      );
      a.hidden = false;
    });
  }

  /* ---------- seção completa na página do produto ---------- */
  async function initSecaoProduto() {
    const sec = document.getElementById("avaliacoes");
    if (!sec || !api()) return;
    const id = sec.dataset.produto;
    const d = await ler("/avaliacoes?produto=" + encodeURIComponent(id));
    if (!d || typeof d.total !== "number") return; // sem a funcionalidade no Worker: fica oculta

    const corpo = sec.querySelector("[data-av-corpo]");
    corpo.replaceChildren();

    const botao = el("a", { class: "btn btn-primary", href: `avaliar.html?produto=${encodeURIComponent(id)}`, text: "Avaliar este produto" });
    const nota = el("p", { class: "av-nota-rodape", text: "Só quem comprou pode avaliar. A avaliação aparece depois que a gente conferir." });

    if (!d.total) {
      // Sem avaliações ainda: só o título da seção (o convite para avaliar vai pelo WhatsApp, no envio do pedido).
    } else {
      const barras = el("div", { class: "av-barras" });
      for (let n = 5; n >= 1; n--) {
        const q = (d.distribuicao && d.distribuicao[n]) || 0;
        const fill = el("span", { class: "av-barra-fill" });
        fill.style.setProperty("width", `${Math.round((q / d.total) * 100)}%`);
        barras.append(el("div", { class: "av-barra" }, el("span", { class: "av-barra-rot", text: `${n} ★` }), el("span", { class: "av-barra-trilho" }, fill), el("span", { class: "av-barra-qtd", text: String(q) })));
      }
      corpo.append(
        el("div", { class: "av-resumo" },
          el("div", { class: "av-media" },
            el("strong", { text: nota1(d.media) }),
            estrelas(d.media, `Nota média ${nota1(d.media)} de 5`),
            el("span", { class: "av-total", text: `${d.total} ${d.total === 1 ? "avaliação" : "avaliações"}` })),
          barras,
          el("div", { class: "av-acao" }, botao, nota))
      );

      const lista = el("ul", { class: "av-lista" });
      for (const a of d.itens || []) {
        const item = el("li", { class: "av-item" },
          el("div", { class: "av-item-cab" },
            estrelas(a.nota),
            el("strong", { class: "av-item-nome", text: a.nome }),
            el("span", { class: "av-selo", text: "✔ Compra verificada" }),
            el("span", { class: "av-data", text: dataBR(a.data) })));
        if (a.comentario) item.append(el("p", { class: "av-texto", text: a.comentario }));
        if (a.resposta) item.append(el("div", { class: "av-resposta" }, el("strong", { text: "Resposta da Santino's" }), el("p", { text: a.resposta })));
        lista.append(item);
      }
      corpo.append(lista);
    }
    sec.hidden = false;
  }

  /* ---------- avaliar.html ---------- */
  function initFormulario() {
    const form = document.getElementById("avForm");
    if (!form) return;
    const msg = document.getElementById("avMsg");
    const btn = document.getElementById("avEnviar");
    const q = new URLSearchParams(location.search);

    const select = form.elements.produto;
    for (const [id, p] of Object.entries(LOJA_CONFIG.produtos)) select.append(el("option", { value: id, text: p.nome }));
    const pedidoQ = String(q.get("pedido") || "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 30);
    if (LOJA_CONFIG.produtos[q.get("produto")]) select.value = q.get("produto");
    if (pedidoQ) form.elements.pedido.value = pedidoQ;

    const contador = document.getElementById("avContador");
    const txt = form.elements.comentario;
    const atualizarContador = () => { contador.textContent = `${txt.value.length}/600`; };
    txt.addEventListener("input", atualizarContador);
    atualizarContador();

    function aviso(texto, tipo) {
      msg.textContent = texto;
      msg.className = "av-msg" + (tipo ? " " + tipo : "");
    }

    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const f = new FormData(form);
      const nota = Number(f.get("nota"));
      if (!nota) return aviso("Escolha de 1 a 5 estrelas.", "erro");
      const corpo = {
        produto: f.get("produto"),
        pedido: String(f.get("pedido") || "").trim(),
        email: String(f.get("email") || "").trim(),
        nota,
        nome: String(f.get("nome") || "").trim(),
        comentario: String(f.get("comentario") || "").trim(),
      };
      btn.disabled = true;
      aviso("Enviando…");
      try {
        const r = await fetch(api() + "/avaliar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
        let d = null;
        try { d = await r.json(); } catch { /* sem corpo */ }
        if (r.ok && d && d.ok) {
          const pagina = LOJA_CONFIG.produtos[corpo.produto] ? `${corpo.produto}.html` : "index.html";
          form.replaceWith(
            el("div", { class: "av-obrigado" },
              el("h2", { text: "Obrigado pela avaliação!" }),
              el("p", { text: d.mensagem || "Recebemos a sua avaliação." }),
              el("div", { class: "pedido-acoes" },
                el("a", { class: "btn btn-primary", href: pagina, text: "Voltar ao produto" }),
                el("a", { class: "btn btn-ghost", href: "index.html#produtos", text: "Ver os outros molhos" })))
          );
          return;
        }
        aviso((d && d.erro) || "Não consegui enviar agora. Tente de novo em instantes.", "erro");
      } catch {
        aviso("Não consegui enviar agora. Confira sua conexão e tente de novo.", "erro");
      }
      btn.disabled = false;
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    initRatingsMini();
    initSecaoProduto();
    initFormulario();
  });
})();

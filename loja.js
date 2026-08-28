/* Santino's — loja (carrinho, checkout e retorno do pagamento)
 *
 * CONFIG fica logo abaixo: preços, frete e a URL do Worker.
 *
 * ATENÇÃO: os preços e a lógica de frete existem TAMBÉM no Worker
 * (worker/src/index.js). O Worker é quem valida o valor real que vai ser
 * cobrado — o site é só a vitrine. Se mudar um preço aqui, mude lá também.
 */

const LOJA_CONFIG = {
  moeda: "BRL",

  // Preços em CENTAVOS (inteiro, evita erro de ponto flutuante).
  // Preço definido pelo Arnaldo: R$ 19,90 para os três (2026-08).
  produtos: {
    "suave":       { nome: "Santino's Suave",       preco: 1990, img: "suave.jpg" },
    "defumado":    { nome: "Santino's Defumado",    preco: 1990, img: "defumado.jpg" },
    "extra-forte": { nome: "Santino's Extra Forte", preco: 1990, img: "extra-forte.jpg" },
  },

  // Frete fixo por região, em CENTAVOS. >>> PLACEHOLDER <<<
  // Vale enquanto não há cálculo real (Melhor Envio) — depende de peso/caixa.
  freteRegioes: {
    "Sudeste":      1500,
    "Sul":          2200,
    "Centro-Oeste": 2500,
    "Nordeste":     3000,
    "Norte":        3800,
  },

  // Itapetininga-SP: entrega própria, grátis. Faixa de CEP (confirmar cobertura).
  itapetininga: { min: 18200000, max: 18219999 },

  // Frete grátis acima de um subtotal (centavos). null = desativado.
  freteGratisAcima: null,

  // URL pública do Cloudflare Worker que cria a preferência no Mercado Pago.
  // Vazio => o checkout mostra "pagamento em configuração" e não cobra nada.
  workerUrl: "",

  // Galeria do Instagram na home. ID do feed do Behold.so
  // (behold.so -> seu feed -> "Feed ID"). Vazio => a galeria não aparece,
  // fica só o botão "Seguir no Instagram".
  beholdFeedId: "pq4swuZKZCYr2UfelzGh",
};

const UF_REGIAO = {
  AC: "Norte", AP: "Norte", AM: "Norte", PA: "Norte", RO: "Norte", RR: "Norte", TO: "Norte",
  AL: "Nordeste", BA: "Nordeste", CE: "Nordeste", MA: "Nordeste", PB: "Nordeste",
  PE: "Nordeste", PI: "Nordeste", RN: "Nordeste", SE: "Nordeste",
  DF: "Centro-Oeste", GO: "Centro-Oeste", MT: "Centro-Oeste", MS: "Centro-Oeste",
  ES: "Sudeste", MG: "Sudeste", RJ: "Sudeste", SP: "Sudeste",
  PR: "Sul", RS: "Sul", SC: "Sul",
};

const CART_KEY = "santinos_cart_v1";

/* ---------- Dinheiro ---------- */
function fmt(centavos) {
  return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: LOJA_CONFIG.moeda });
}

/* ---------- Estado do carrinho ---------- */
// Formato salvo: { "suave": 2, "defumado": 1 }  (id -> quantidade)
function lerCarrinho() {
  try {
    const raw = JSON.parse(localStorage.getItem(CART_KEY) || "{}");
    const limpo = {};
    for (const id in raw) {
      if (LOJA_CONFIG.produtos[id] && Number.isFinite(raw[id]) && raw[id] > 0) {
        limpo[id] = Math.min(Math.floor(raw[id]), 99);
      }
    }
    return limpo;
  } catch {
    return {};
  }
}

function salvarCarrinho(c) {
  localStorage.setItem(CART_KEY, JSON.stringify(c));
  document.dispatchEvent(new CustomEvent("carrinho:mudou"));
}

function addItem(id, qtd = 1) {
  if (!LOJA_CONFIG.produtos[id]) return;
  const c = lerCarrinho();
  c[id] = Math.min((c[id] || 0) + qtd, 99);
  salvarCarrinho(c);
}

function setQtd(id, qtd) {
  const c = lerCarrinho();
  if (qtd <= 0) delete c[id];
  else c[id] = Math.min(qtd, 99);
  salvarCarrinho(c);
}

function removeItem(id) {
  const c = lerCarrinho();
  delete c[id];
  salvarCarrinho(c);
}

function esvaziarCarrinho() {
  localStorage.removeItem(CART_KEY);
  document.dispatchEvent(new CustomEvent("carrinho:mudou"));
}

function contarItens(c = lerCarrinho()) {
  return Object.values(c).reduce((s, q) => s + q, 0);
}

function subtotal(c = lerCarrinho()) {
  let s = 0;
  for (const id in c) s += LOJA_CONFIG.produtos[id].preco * c[id];
  return s;
}

function linhasCarrinho(c = lerCarrinho()) {
  return Object.keys(c).map((id) => ({
    id,
    qtd: c[id],
    nome: LOJA_CONFIG.produtos[id].nome,
    img: LOJA_CONFIG.produtos[id].img,
    preco: LOJA_CONFIG.produtos[id].preco,
    total: LOJA_CONFIG.produtos[id].preco * c[id],
  }));
}

/* ---------- Frete ---------- */
// Recebe CEP (só dígitos) e subtotal; devolve { valor, rotulo } ou null se região desconhecida.
function calcularFrete(cepDigitos, uf, sub) {
  const cepNum = parseInt(cepDigitos, 10);
  if (Number.isFinite(cepNum) && cepNum >= LOJA_CONFIG.itapetininga.min && cepNum <= LOJA_CONFIG.itapetininga.max) {
    return { valor: 0, rotulo: "Entrega local em Itapetininga — grátis" };
  }
  if (LOJA_CONFIG.freteGratisAcima != null && sub >= LOJA_CONFIG.freteGratisAcima) {
    return { valor: 0, rotulo: "Frete grátis" };
  }
  const regiao = UF_REGIAO[uf];
  if (!regiao || LOJA_CONFIG.freteRegioes[regiao] == null) return null;
  return { valor: LOJA_CONFIG.freteRegioes[regiao], rotulo: `Frete — ${regiao}` };
}

/* ================================================================
 * VITRINE: injeta preços nos cards e liga os botões "Adicionar"
 * ================================================================ */
function initVitrine() {
  document.querySelectorAll("[data-preco-de]").forEach((el) => {
    const p = LOJA_CONFIG.produtos[el.dataset.precoDe];
    if (p) el.textContent = fmt(p.preco);
  });

  document.querySelectorAll(".add-carrinho").forEach((btn) => {
    btn.addEventListener("click", () => {
      addItem(btn.dataset.add, 1);
      abrirDrawer();
    });
  });
}

/* ================================================================
 * DRAWER do carrinho (existe em todas as páginas que têm #cartDrawer)
 * ================================================================ */
let drawerAberto = false;

function abrirDrawer() {
  const d = document.getElementById("cartDrawer");
  const o = document.getElementById("cartOverlay");
  if (!d || !o) return;
  o.hidden = false;
  d.classList.add("open");
  d.setAttribute("aria-hidden", "false");
  drawerAberto = true;
  document.body.classList.add("no-scroll");
  document.getElementById("cartClose")?.focus();
}

function fecharDrawer() {
  const d = document.getElementById("cartDrawer");
  const o = document.getElementById("cartOverlay");
  if (!d || !o) return;
  d.classList.remove("open");
  d.setAttribute("aria-hidden", "true");
  o.hidden = true;
  drawerAberto = false;
  document.body.classList.remove("no-scroll");
  document.getElementById("cartToggle")?.focus();
}

function renderContador() {
  const el = document.getElementById("cartCount");
  if (!el) return;
  const n = contarItens();
  el.textContent = n;
  el.dataset.count = String(n);
}

function renderDrawer() {
  const lista = document.getElementById("cartItems");
  const vazio = document.getElementById("cartEmpty");
  const foot = document.getElementById("cartFoot");
  const sub = document.getElementById("cartSubtotal");
  if (!lista) return;

  const linhas = linhasCarrinho();
  lista.innerHTML = "";

  if (linhas.length === 0) {
    if (vazio) vazio.hidden = false;
    if (foot) foot.hidden = true;
    return;
  }
  if (vazio) vazio.hidden = true;
  if (foot) foot.hidden = false;

  linhas.forEach((l) => {
    const li = document.createElement("li");
    li.className = "cart-item";
    li.innerHTML = `
      <img src="${l.img}" alt="" class="cart-item-img">
      <div class="cart-item-info">
        <p class="cart-item-nome">${l.nome}</p>
        <p class="cart-item-preco">${fmt(l.preco)} / un.</p>
        <div class="cart-qtd">
          <button type="button" class="qtd-menos" data-id="${l.id}" aria-label="Diminuir">&minus;</button>
          <span class="qtd-num">${l.qtd}</span>
          <button type="button" class="qtd-mais" data-id="${l.id}" aria-label="Aumentar">+</button>
          <button type="button" class="cart-remover" data-id="${l.id}">remover</button>
        </div>
      </div>
      <strong class="cart-item-total">${fmt(l.total)}</strong>`;
    lista.appendChild(li);
  });

  if (sub) sub.textContent = fmt(subtotal());

  lista.querySelectorAll(".qtd-mais").forEach((b) =>
    b.addEventListener("click", () => setQtd(b.dataset.id, (lerCarrinho()[b.dataset.id] || 0) + 1))
  );
  lista.querySelectorAll(".qtd-menos").forEach((b) =>
    b.addEventListener("click", () => setQtd(b.dataset.id, (lerCarrinho()[b.dataset.id] || 0) - 1))
  );
  lista.querySelectorAll(".cart-remover").forEach((b) =>
    b.addEventListener("click", () => removeItem(b.dataset.id))
  );
}

function initDrawer() {
  const toggle = document.getElementById("cartToggle");
  if (!toggle) return;

  toggle.addEventListener("click", () => (drawerAberto ? fecharDrawer() : abrirDrawer()));
  document.getElementById("cartClose")?.addEventListener("click", fecharDrawer);
  document.getElementById("cartOverlay")?.addEventListener("click", fecharDrawer);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && drawerAberto) fecharDrawer();
  });

  document.addEventListener("carrinho:mudou", () => {
    renderContador();
    renderDrawer();
  });

  renderContador();
  renderDrawer();
}

/* ================================================================
 * CHECKOUT (página com <body data-page="checkout">)
 * ================================================================ */
function initCheckout() {
  const resumo = document.getElementById("ckResumo");
  const form = document.getElementById("ckForm");
  if (!resumo || !form) return;

  const linhas = linhasCarrinho();
  if (linhas.length === 0) {
    document.getElementById("ckVazio").hidden = false;
    document.getElementById("ckConteudo").hidden = true;
    return;
  }

  const elFrete = document.getElementById("ckFrete");
  const elTotal = document.getElementById("ckTotal");
  const elSub = document.getElementById("ckSubtotal");
  const cep = form.elements.cep;
  const aviso = document.getElementById("ckAviso");
  let freteAtual = null; // { valor, rotulo }

  // Resumo dos itens
  resumo.innerHTML = linhas
    .map(
      (l) => `<li>
        <span>${l.qtd}× ${l.nome}</span>
        <span>${fmt(l.total)}</span>
      </li>`
    )
    .join("");
  elSub.textContent = fmt(subtotal());

  function pintarTotais() {
    if (freteAtual) {
      elFrete.textContent = freteAtual.valor === 0 ? "Grátis" : fmt(freteAtual.valor);
      document.getElementById("ckFreteRotulo").textContent = freteAtual.rotulo;
      elTotal.textContent = fmt(subtotal() + freteAtual.valor);
    } else {
      elFrete.textContent = "—";
      document.getElementById("ckFreteRotulo").textContent = "Informe o CEP";
      elTotal.textContent = fmt(subtotal());
    }
  }
  pintarTotais();

  async function buscarCep() {
    const digs = cep.value.replace(/\D/g, "");
    if (digs.length !== 8) return;
    aviso.textContent = "Buscando CEP…";
    try {
      const r = await fetch(`https://viacep.com.br/ws/${digs}/json/`);
      const d = await r.json();
      if (d.erro) {
        aviso.textContent = "CEP não encontrado. Confira o número.";
        freteAtual = null;
        pintarTotais();
        return;
      }
      form.elements.endereco.value = d.logradouro || "";
      form.elements.bairro.value = d.bairro || "";
      form.elements.cidade.value = d.localidade || "";
      form.elements.uf.value = d.uf || "";

      freteAtual = calcularFrete(digs, d.uf, subtotal());
      if (!freteAtual) {
        aviso.textContent = `Ainda não enviamos para ${d.uf}. Fale com a gente pelo WhatsApp.`;
      } else {
        aviso.textContent = "";
      }
      pintarTotais();
    } catch {
      aviso.textContent = "Não consegui consultar o CEP agora. Tente de novo.";
    }
  }

  cep.addEventListener("blur", buscarCep);
  cep.addEventListener("input", () => {
    if (cep.value.replace(/\D/g, "").length === 8) buscarCep();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!freteAtual) {
      aviso.textContent = "Confirme um CEP com entrega disponível antes de continuar.";
      cep.focus();
      return;
    }

    const btn = document.getElementById("ckSubmit");
    btn.disabled = true;
    btn.textContent = "Processando…";

    const pedido = {
      itens: linhas.map((l) => ({ id: l.id, qtd: l.qtd })),
      frete: { cep: cep.value.replace(/\D/g, ""), uf: form.elements.uf.value },
      comprador: {
        nome: form.elements.nome.value.trim(),
        email: form.elements.email.value.trim(),
        cpf: form.elements.cpf.value.replace(/\D/g, ""),
        whatsapp: form.elements.whatsapp.value.replace(/\D/g, ""),
        endereco: {
          logradouro: form.elements.endereco.value.trim(),
          numero: form.elements.numero.value.trim(),
          complemento: form.elements.complemento.value.trim(),
          bairro: form.elements.bairro.value.trim(),
          cidade: form.elements.cidade.value.trim(),
          uf: form.elements.uf.value.trim(),
        },
      },
    };

    if (!LOJA_CONFIG.workerUrl) {
      aviso.innerHTML =
        "<strong>Pagamento em configuração.</strong> A loja ainda não está processando pedidos online. " +
        'Finalize pelo WhatsApp: <a href="https://wa.me/5515998569761">(15) 99856-9761</a>.';
      btn.disabled = false;
      btn.textContent = "Pagar com Mercado Pago";
      return;
    }

    try {
      const r = await fetch(LOJA_CONFIG.workerUrl.replace(/\/$/, "") + "/criar-preferencia", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pedido),
      });
      const d = await r.json();
      if (!r.ok || !d.init_point) throw new Error(d.erro || "Falha ao criar o pagamento.");
      // Guarda um resumo local para a página de retorno.
      sessionStorage.setItem("santinos_ultimo_pedido", JSON.stringify({
        itens: pedido.itens, total: subtotal() + freteAtual.valor, criadoEm: Date.now(),
      }));
      window.location.href = d.init_point;
    } catch (err) {
      aviso.textContent = err.message || "Não consegui iniciar o pagamento. Tente novamente.";
      btn.disabled = false;
      btn.textContent = "Pagar com Mercado Pago";
    }
  });
}

/* ================================================================
 * RETORNO do pagamento (página com <body data-page="pedido">)
 * ================================================================ */
function initPedido() {
  const box = document.getElementById("pedidoStatus");
  if (!box) return;

  const q = new URLSearchParams(location.search);
  // Mercado Pago devolve status em "status" e/ou "collection_status".
  const status = (q.get("status") || q.get("collection_status") || "").toLowerCase();

  const mapa = {
    sucesso: { classe: "ok", titulo: "Pedido confirmado!", texto: "Recebemos seu pagamento. Você vai receber os detalhes por e-mail. Obrigado!" },
    approved: { classe: "ok", titulo: "Pedido confirmado!", texto: "Recebemos seu pagamento. Você vai receber os detalhes por e-mail. Obrigado!" },
    pendente: { classe: "aguarde", titulo: "Pagamento pendente", texto: "Seu pagamento está sendo processado. Assim que for aprovado, a gente te avisa." },
    pending: { classe: "aguarde", titulo: "Pagamento pendente", texto: "Seu pagamento está sendo processado. Assim que for aprovado, a gente te avisa." },
    in_process: { classe: "aguarde", titulo: "Pagamento em análise", texto: "O Mercado Pago está analisando o pagamento. Você será notificado por e-mail." },
    falha: { classe: "erro", titulo: "Pagamento não concluído", texto: "O pagamento não foi aprovado. Nenhum valor foi cobrado. Você pode tentar de novo." },
    rejected: { classe: "erro", titulo: "Pagamento recusado", texto: "O pagamento foi recusado. Nenhum valor foi cobrado. Tente outro meio de pagamento." },
    failure: { classe: "erro", titulo: "Pagamento não concluído", texto: "O pagamento não foi aprovado. Nenhum valor foi cobrado. Você pode tentar de novo." },
  };
  const info = mapa[status] || { classe: "aguarde", titulo: "Status do pedido", texto: "Não identificamos o status do pagamento. Em caso de dúvida, fale com a gente pelo WhatsApp." };

  box.classList.add(`pedido-${info.classe}`);
  box.querySelector(".pedido-titulo").textContent = info.titulo;
  box.querySelector(".pedido-texto").textContent = info.texto;

  if (info.classe === "ok") esvaziarCarrinho();
}

/* ================================================================
 * INSTAGRAM: galeria dos últimos posts via Behold.so (auto-atualiza)
 * ================================================================ */
async function initInstagram() {
  const grid = document.getElementById("instaGrid");
  const fallback = document.getElementById("instaFallback");
  if (!grid) return;

  const id = LOJA_CONFIG.beholdFeedId;
  if (!id) {
    if (fallback) fallback.hidden = false;
    return;
  }

  try {
    const r = await fetch(`https://feeds.behold.so/${id}`);
    if (!r.ok) throw new Error("feed indisponível");
    const data = await r.json();
    const posts = (Array.isArray(data) ? data : data.posts || []).slice(0, 3);
    if (posts.length === 0) throw new Error("feed vazio");

    grid.innerHTML = posts
      .map((p) => {
        const img =
          p.sizes?.large?.mediaUrl ||
          p.sizes?.medium?.mediaUrl ||
          p.thumbnailUrl ||
          p.mediaUrl ||
          "";
        const legenda = (p.prunedCaption || "").trim() || "Post da Santino's no Instagram";
        const cap = legenda.slice(0, 140).replace(/"/g, "&quot;");
        const marca = p.mediaType === "VIDEO" ? '<span class="insta-video" aria-hidden="true"></span>' : "";
        return `<a class="insta-post" href="${p.permalink}" target="_blank" rel="noopener" aria-label="${cap}">
          <img src="${img}" alt="${cap}" loading="lazy" referrerpolicy="no-referrer">${marca}
        </a>`;
      })
      .join("");
    grid.hidden = false;

    // Se as imagens não carregarem, tira o post; se sobrar zero, mostra o fallback.
    grid.querySelectorAll("img").forEach((im) => {
      im.addEventListener("error", () => {
        im.closest(".insta-post")?.remove();
        if (grid.querySelectorAll(".insta-post").length === 0) {
          grid.hidden = true;
          if (fallback) fallback.hidden = false;
        }
      });
    });
  } catch {
    if (fallback) fallback.hidden = false;
  }
}

/* ================================================================
 * PÁGINA DE PRODUTO (PDP) — <body data-page="produto">
 * ================================================================ */
function initProduto() {
  const btn = document.querySelector("[data-add-produto]");
  if (!btn) return;
  const id = btn.dataset.addProduto;
  const qtdInput = document.getElementById("pdpQtd");

  btn.addEventListener("click", () => {
    let q = parseInt(qtdInput && qtdInput.value, 10);
    if (!Number.isFinite(q) || q < 1) q = 1;
    q = Math.min(q, 99);
    addItem(id, q);
    abrirDrawer();
  });
}

/* ---------- Boot ---------- */
document.addEventListener("DOMContentLoaded", () => {
  initVitrine();
  initDrawer();
  initInstagram();
  const page = document.body.dataset.page;
  if (page === "checkout") initCheckout();
  if (page === "pedido") initPedido();
  if (page === "produto") initProduto();
});

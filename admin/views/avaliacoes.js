/* Painel Santino's — avaliações de produtos (aprovar, ocultar, responder, apagar).
 * SEGURANÇA: nome e comentário vêm do público. Tudo passa pela tag `html` (escapa por padrão). */
import { S, api } from "../state.js";
import { html, raw, setHTML, icone, dataBR, diaBRT, num, toast } from "../util.js";
import { pill, vazio } from "../comp.js";

const STATUS = {
  pendente: { cls: "warn", rot: "Aguardando aprovação", ic: "clock" },
  aprovada: { cls: "ok", rot: "Publicada no site", ic: "check" },
  oculta: { cls: "neutro", rot: "Oculta", ic: "xcircle" },
};
const FILTROS = [["pendente", "Pendentes"], ["aprovada", "Publicadas"], ["oculta", "Ocultas"], ["todas", "Todas"]];

const nomeProduto = (id) => (S.produtos[id] && S.produtos[id].nome) || id;
const estrelasTxt = (n) => html`<span class="estrelas-txt" role="img" aria-label="${n} de 5 estrelas">${"★".repeat(n)}<span class="vazia">${"★".repeat(5 - n)}</span></span>`;

export default function avaliacoesView(ctx) {
  let el = null;
  let respondendo = null; // id da avaliação com o campo de resposta aberto

  async function carregar() {
    try {
      const d = await api("/admin/avaliacoes");
      S.avaliacoes = d.avaliacoes || [];
      ctx.aoMudarAvaliacoes();
    } catch (e) {
      toast(e.status === 404 ? "O Worker ainda não tem as avaliações. Rode a migração 003 e o deploy (veja docs/contexto)." : e.message || "Não consegui carregar as avaliações.", "erro", 7000);
    }
  }

  function resumo() {
    const linhas = Object.keys(S.produtos).length ? Object.keys(S.produtos) : ["suave", "defumado", "extra-forte"];
    return html`<div class="av-resumo-painel">${linhas.map((id) => {
      const pub = S.avaliacoes.filter((a) => a.produto === id && a.status === "aprovada");
      const pend = S.avaliacoes.filter((a) => a.produto === id && a.status === "pendente").length;
      const media = pub.length ? pub.reduce((s, a) => s + a.nota, 0) / pub.length : 0;
      return html`<section class="card"><div class="card-corpo av-prod">
        <strong>${nomeProduto(id)}</strong>
        <span class="av-prod-nota">${pub.length ? media.toFixed(1).replace(".", ",") : "—"}</span>
        ${pub.length ? estrelasTxt(Math.round(media)) : html`<span class="muted">sem avaliações publicadas</span>`}
        <small>${num(pub.length)} publicada${pub.length === 1 ? "" : "s"}${pend ? html` · <b class="pend">${num(pend)} pendente${pend === 1 ? "" : "s"}</b>` : ""}</small>
      </div></section>`;
    })}</div>`;
  }

  function cartao(a) {
    const ped = S.pedidos.find((p) => p.external_reference === a.pedido_ref);
    const st = STATUS[a.status] || STATUS.pendente;
    return html`<article class="card av-card" data-id="${a.id}">
      <div class="card-corpo">
        <header class="av-cab">
          ${estrelasTxt(a.nota)}
          <strong>${nomeProduto(a.produto)}</strong>
          ${pill(st)}
          <span class="av-meta">${dataBR(diaBRT(a.criado_em))}</span>
        </header>
        <p class="av-quem">Aparece como <b>${a.nome}</b>${ped ? html` · comprador: ${ped.nome || "—"}` : ""} ·
          <button type="button" class="link-btn" data-acao="ver-pedido" data-ref="${a.pedido_ref}">pedido ${a.pedido_ref}</button></p>
        ${a.comentario ? html`<p class="av-coment">${a.comentario}</p>` : html`<p class="muted">Sem comentário — só a nota.</p>`}
        ${a.resposta && respondendo !== a.id ? html`<div class="av-resp"><b>Sua resposta (pública):</b><p>${a.resposta}</p></div>` : ""}
        ${respondendo === a.id ? html`<form class="av-form-resp" data-form="resposta" data-id="${a.id}">
          <label>Resposta pública da Santino's <span class="opt">(aparece abaixo da avaliação no site; deixe vazio para remover)</span>
            <textarea name="resposta" rows="3" maxlength="600" placeholder="Obrigado por avaliar! …">${a.resposta || ""}</textarea></label>
          <div class="gv-acoes"><button type="submit" class="btn btn-prim">${icone("check", 15)}<span>Salvar resposta</span></button>
            <button type="button" class="btn btn-sec" data-acao="cancelar-resposta">Cancelar</button></div></form>` : ""}
        <div class="acoes-linha av-acoes">
          ${a.status !== "aprovada" ? html`<button type="button" class="btn btn-prim" data-acao="status" data-id="${a.id}" data-valor="aprovada">${icone("check", 15)}<span>${a.status === "oculta" ? "Publicar de novo" : "Aprovar e publicar"}</span></button>` : ""}
          ${a.status === "aprovada" ? html`<button type="button" class="btn btn-sec" data-acao="status" data-id="${a.id}" data-valor="oculta">${icone("xcircle", 15)}<span>Ocultar do site</span></button>` : ""}
          ${a.status === "pendente" ? html`<button type="button" class="btn btn-sec" data-acao="status" data-id="${a.id}" data-valor="oculta">${icone("xcircle", 15)}<span>Recusar</span></button>` : ""}
          ${respondendo !== a.id ? html`<button type="button" class="link-btn" data-acao="responder" data-id="${a.id}">${icone("edit", 14)}${a.resposta ? "Editar resposta" : "Responder"}</button>` : ""}
          <button type="button" class="link-btn link-perigo" data-acao="apagar" data-id="${a.id}">${icone("trash", 14)}Apagar</button>
        </div>
      </div></article>`;
  }

  function desenhar() {
    const f = S.avaliacoesUI.filtro;
    const contar = (k) => (k === "todas" ? S.avaliacoes.length : S.avaliacoes.filter((a) => a.status === k).length);
    const lista = S.avaliacoes.filter((a) => f === "todas" || a.status === f);
    setHTML(el, html`
      ${resumo()}
      <div class="seg" role="group" aria-label="Filtrar avaliações">${FILTROS.map(([k, rot]) => html`<button type="button" class="seg-btn ${f === k ? "ativo" : ""}" data-acao="filtro" data-k="${k}" aria-pressed="${f === k}">${rot}<span class="seg-n">${num(contar(k))}</span></button>`)}</div>
      <p class="muted av-dica">Só quem comprou consegue avaliar (o site confere o número do pedido e o e-mail). Nada aparece no site até você aprovar.</p>
      <div class="av-lista-painel">${lista.length ? lista.map(cartao) : vazio(f === "pendente" ? "Nenhuma avaliação para aprovar" : "Nada por aqui", f === "pendente" ? "Quando um cliente avaliar, ela aparece aqui para você conferir." : "Troque o filtro acima para ver as outras.", "star")}</div>`);
  }

  async function mudar(id, corpo, msgOk) {
    try {
      await api("/admin/avaliacoes/moderar", { method: "POST", body: JSON.stringify({ id, ...corpo }) });
      const a = S.avaliacoes.find((x) => x.id === id);
      if (a) Object.assign(a, corpo);
      toast(msgOk, "ok", 2200);
      ctx.aoMudarAvaliacoes();
      desenhar();
    } catch (e) { toast(e.message || "Não consegui salvar.", "erro"); }
  }

  return {
    titulo: "Avaliações",
    usaPeriodo: false,
    async montar(container) {
      el = container;
      setHTML(el, html`<p class="muted">Carregando avaliações…</p>`);
      await carregar();
      desenhar();
      el.addEventListener("submit", (ev) => {
        const f = ev.target.closest("[data-form=resposta]");
        if (!f) return;
        ev.preventDefault();
        const id = Number(f.dataset.id);
        const texto = String(new FormData(f).get("resposta") || "").trim();
        respondendo = null;
        mudar(id, { resposta: texto || null }, texto ? "Resposta salva." : "Resposta removida.");
      });
      el.addEventListener("click", async (ev) => {
        const b = ev.target.closest("[data-acao]");
        if (!b) return;
        const id = Number(b.dataset.id);
        switch (b.dataset.acao) {
          case "filtro": S.avaliacoesUI.filtro = b.dataset.k; respondendo = null; desenhar(); break;
          case "ver-pedido": ctx.abrirPedido(b.dataset.ref); break;
          case "responder": respondendo = id; desenhar(); break;
          case "cancelar-resposta": respondendo = null; desenhar(); break;
          case "status": mudar(id, { status: b.dataset.valor }, b.dataset.valor === "aprovada" ? "Publicada no site." : "Avaliação oculta."); break;
          case "apagar":
            if (!confirm("Apagar esta avaliação de vez? (Para só tirar do site, use Ocultar.)")) break;
            try {
              await api(`/admin/avaliacoes?id=${id}`, { method: "DELETE" });
              S.avaliacoes = S.avaliacoes.filter((x) => x.id !== id);
              ctx.aoMudarAvaliacoes();
              toast("Avaliação apagada.", "ok", 2000);
              desenhar();
            } catch (e) { toast(e.message, "erro"); }
            break;
        }
      });
    },
    atualizar() { if (el && respondendo === null) desenhar(); },
  };
}

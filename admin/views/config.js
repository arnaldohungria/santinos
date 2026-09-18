/* Painel Santino's — configurações: custos e meta, sincronização com o Mercado Pago, backup. */
import { S, api } from "../state.js";
import { html, setHTML, icone, brl, num, parseBRL, centavosParaInput, toast, baixar, hojeBRT, dataHoraBR } from "../util.js";
import { temCustos } from "../dados.js";

export default function configView(ctx) {
  let el = null;
  let sincronizando = false;

  function desenhar() {
    const cfg = S.config;
    setHTML(el, html`
      <div class="grade-config">
        <section class="card">
          <header class="card-cab"><div class="card-tit"><h3>Custos e meta</h3>
            <p class="card-sub">Com os custos, o painel calcula o <strong>lucro estimado</strong> de cada pedido e do período. Fica só aqui — não aparece pro cliente.</p></div></header>
          <form class="card-corpo grade-form" id="formCustos" autocomplete="off">
            ${Object.entries(S.produtos).map(([id, p]) => html`<label>Custo — ${p.nome} <span class="opt">(por frasco)</span>
              <input name="custo_${id}" inputmode="decimal" placeholder="0,00" value="${centavosParaInput(cfg[`custo_${id}`])}"></label>`)}
            <label>Embalagem por pedido <span class="opt">(caixa, fita, plástico-bolha…)</span>
              <input name="custo_embalagem" inputmode="decimal" placeholder="0,00" value="${centavosParaInput(cfg.custo_embalagem)}"></label>
            <label>Meta de faturamento mensal
              <input name="meta_mensal" inputmode="decimal" placeholder="Ex.: 5000,00" value="${centavosParaInput(cfg.meta_mensal)}"></label>
            <div class="ocupa-todos gv-acoes"><button type="submit" class="btn btn-prim">${icone("check", 15)}<span>Salvar</span></button><span class="admin-msg" id="custosMsg" role="status"></span></div>
          </form>
          <p class="nota nota-pad">Lucro estimado = produtos (já com desconto) − custo dos frascos − embalagem − taxas do Mercado Pago. O frete cobrado do cliente é tratado como repasse da etiqueta. ${temCustos(cfg) ? "" : "Ainda sem custos: o lucro não aparece no dashboard."}</p>
        </section>

        <section class="card">
          <header class="card-cab"><div class="card-tit"><h3>Sincronizar com o Mercado Pago</h3>
            <p class="card-sub">Os pedidos chegam sozinhos (webhook). Use isto se algum pedido não apareceu, ou pra completar dados de pedidos antigos (endereço, taxas, forma de pagamento). É seguro rodar quantas vezes quiser — não duplica e não apaga seu controle de envio.</p></div></header>
          <div class="card-corpo">
            <div class="gv-acoes">${[[7, "Últimos 7 dias"], [30, "Últimos 30 dias"], [90, "Últimos 90 dias"], [365, "Último ano"]].map(
              ([d, rot]) => html`<button type="button" class="btn btn-sec" data-sync="${d}">${icone("refresh", 15)}<span>${rot}</span></button>`)}</div>
            <p class="admin-msg" id="syncMsg" role="status"></p>
          </div>
        </section>

        <section class="card">
          <header class="card-cab"><div class="card-tit"><h3>Backup dos dados</h3>
            <p class="card-sub">Baixa tudo (pedidos, cupons e configurações) num arquivo JSON. Guarde em lugar seguro — contém dados pessoais dos clientes.</p></div></header>
          <div class="card-corpo"><button type="button" class="btn btn-sec" data-acao="backup">${icone("download", 15)}<span>Baixar backup (${num(S.pedidos.length)} pedidos)</span></button></div>
        </section>

        <section class="card">
          <header class="card-cab"><div class="card-tit"><h3>Acesso e segurança</h3></div></header>
          <div class="card-corpo texto-ajuda">
            <p>O painel pede a senha do administrador (usuário fixo <code>admin</code>). Depois de 8 senhas erradas seguidas, o acesso daquele endereço é bloqueado por 15 minutos.</p>
            <p>Pra <strong>trocar a senha</strong>, rode no PowerShell, dentro da pasta <code>worker</code> do projeto:</p>
            <pre class="codigo">npx wrangler secret put ADMIN_PASSWORD</pre>
            <p>A sessão fica só nesta aba do navegador e some quando você fecha a aba. Em computador compartilhado, clique em <strong>Sair</strong>.</p>
            <button type="button" class="btn btn-sec" data-acao="sair">Sair do painel</button>
          </div>
        </section>
      </div>`);
  }

  async function salvarCustos(form) {
    const msg = el.querySelector("#custosMsg");
    const f = new FormData(form);
    const config = {};
    for (const [chave, valor] of f.entries()) {
      const txt = String(valor).trim();
      if (!txt) { config[chave] = null; continue; }
      const c = parseBRL(txt);
      if (c === null) { msg.className = "admin-msg erro"; msg.textContent = "Confira os valores: use números, como 12,50."; return; }
      config[chave] = c;
    }
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      await api("/admin/config", { method: "POST", body: JSON.stringify({ config }) });
      for (const [k, v] of Object.entries(config)) { if (v === null) delete S.config[k]; else S.config[k] = v; }
      msg.className = "admin-msg ok";
      toast("Custos e meta salvos.", "ok");
      ctx.aoMudarConfig();
      desenhar();
    } catch (e) {
      msg.className = "admin-msg erro";
      msg.textContent = e.message || "Não consegui salvar.";
    }
    btn.disabled = false;
  }

  async function sincronizar(dias) {
    if (sincronizando) return;
    sincronizando = true;
    const msg = el.querySelector("#syncMsg");
    const botoes = el.querySelectorAll("[data-sync]");
    botoes.forEach((b) => (b.disabled = true));
    msg.className = "admin-msg";
    let off = 0, gravados = 0, total = 0;
    try {
      for (;;) {
        msg.textContent = total ? `Buscando… ${Math.min(off, total)} de ${num(total)} pagamentos` : "Consultando o Mercado Pago…";
        const r = await api("/admin/sincronizar", { method: "POST", body: JSON.stringify({ dias, offset: off }) });
        gravados += r.processados;
        total = r.total;
        if (r.proximo === null) break;
        off = r.proximo;
      }
      await ctx.recarregar();
      msg.className = "admin-msg ok";
      msg.textContent = `Pronto! ${num(gravados)} ${gravados === 1 ? "pagamento da loja atualizado" : "pagamentos da loja atualizados"} (de ${num(total)} encontrados na conta). Agora há ${num(S.pedidos.length)} pedidos no painel.`;
      toast("Sincronização concluída.", "ok");
    } catch (e) {
      msg.className = "admin-msg erro";
      msg.textContent = e.message || "A sincronização falhou.";
    }
    botoes.forEach((b) => (b.disabled = false));
    sincronizando = false;
  }

  return {
    titulo: "Configurações",
    usaPeriodo: false,
    montar(container) {
      el = container;
      desenhar();
      el.addEventListener("submit", (ev) => {
        if (ev.target.id === "formCustos") { ev.preventDefault(); salvarCustos(ev.target); }
      });
      el.addEventListener("click", (ev) => {
        const s = ev.target.closest("[data-sync]");
        if (s) return sincronizar(Number(s.dataset.sync));
        const a = ev.target.closest("[data-acao]");
        if (!a) return;
        if (a.dataset.acao === "sair") ctx.sair();
        if (a.dataset.acao === "backup") {
          const limpo = S.pedidos.map((p) => Object.fromEntries(Object.entries(p).filter(([k]) => !k.startsWith("_"))));
          baixar(`santinos-backup-${hojeBRT()}.json`, JSON.stringify({ gerado_em: new Date().toISOString(), pedidos: limpo, cupons: S.cupons, config: S.config }, null, 2), "application/json");
          toast("Backup baixado.", "ok");
        }
      });
    },
    atualizar() { /* nada: a tela não depende do período */ },
  };
}

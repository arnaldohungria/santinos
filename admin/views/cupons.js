/* Painel Santino's — cupons de desconto (criar, editar, ativar/desativar, apagar, desempenho). */
import { S, api } from "../state.js";
import { html, raw, setHTML, icone, brl, num, dataBR, hojeBRT, parseBRL, centavosParaInput, toast, copiar } from "../util.js";
import { situacaoCupom } from "../dados.js";
import { pill, vazio } from "../comp.js";

export default function cuponsView(ctx) {
  let el = null;
  let editando = null; // código em edição (ou null = novo)

  async function carregar() {
    try {
      const d = await api("/admin/cupons");
      S.cupons = d.cupons || [];
    } catch (e) {
      toast(e.message || "Não consegui carregar os cupons.", "erro");
    }
  }

  function formulario() {
    const c = editando ? S.cupons.find((x) => x.codigo === editando) : null;
    const tipo = c ? c.tipo : "percentual";
    const valor = c ? (c.tipo === "percentual" ? String(c.valor) : centavosParaInput(c.valor)) : "";
    return html`<section class="card form-cupom">
      <header class="card-cab"><div class="card-tit"><h3>${c ? html`Editando <code>${c.codigo}</code>` : "Novo cupom"}</h3>
        <p class="card-sub">Vale para qualquer cliente, quantas vezes quiserem (até o limite de usos, se você definir). O checkout do site valida tudo de novo antes de cobrar.</p></div>
        ${c ? html`<button type="button" class="btn-mini" data-acao="cancelar-edicao">Cancelar edição</button>` : ""}</header>
      <form class="card-corpo grade-form" id="formCupom" autocomplete="off">
        <label>Código<input name="codigo" maxlength="30" required placeholder="LANCA10" value="${c ? c.codigo : ""}" ${c ? raw("readonly") : ""} style="text-transform:uppercase"></label>
        <label>Tipo<select name="tipo" id="cfTipo">
          <option value="percentual" ${tipo === "percentual" ? raw("selected") : ""}>Percentual (%)</option>
          <option value="fixo" ${tipo === "fixo" ? raw("selected") : ""}>Valor fixo (R$)</option></select></label>
        <label><span id="cfValorRot">${tipo === "percentual" ? "Desconto (%)" : "Desconto (R$)"}</span><input name="valor" required inputmode="decimal" placeholder="${tipo === "percentual" ? "10" : "5,00"}" value="${valor}"></label>
        <label>Válido até <span class="opt">(opcional)</span><input type="date" name="expira_em" value="${c && c.expira_em ? c.expira_em : ""}"></label>
        <label>Limite de usos <span class="opt">(opcional)</span><input type="number" name="max_usos" min="1" step="1" placeholder="Ilimitado" value="${c && c.max_usos ? c.max_usos : ""}"></label>
        <label>Pedido mínimo (R$) <span class="opt">(opcional)</span><input name="min" inputmode="decimal" placeholder="Sem mínimo" value="${c && c.min_subtotal_centavos ? centavosParaInput(c.min_subtotal_centavos) : ""}"></label>
        <label class="ocupa-2">Anotação interna <span class="opt">(opcional)</span><input name="descricao" maxlength="120" placeholder="Ex.: campanha do Instagram de setembro" value="${c && c.descricao ? c.descricao : ""}"></label>
        <label class="check"><input type="checkbox" name="ativo" ${!c || c.ativo ? raw("checked") : ""}> Ativo</label>
        <div class="ocupa-todos gv-acoes"><button type="submit" class="btn btn-prim">${icone("check", 15)}<span>${c ? "Salvar alterações" : "Criar cupom"}</span></button>
          <span class="admin-msg" id="cupomMsg" role="status"></span></div>
      </form>
    </section>`;
  }

  function tabela() {
    if (!S.cupons.length) return vazio("Nenhum cupom ainda", "Crie o primeiro no formulário acima — por exemplo LANCA10 com 10% de desconto.", "cupons");
    const hoje = hojeBRT();
    return html`<div class="tabela-scroll"><table class="tabela tabela-lista">
      <thead><tr><th>Cupom</th><th>Desconto</th><th>Regras</th><th class="num">Usos</th><th class="num">Desconto dado</th><th class="num">Faturamento gerado</th><th>Situação</th><th></th></tr></thead>
      <tbody>${S.cupons.map((c) => {
        const sit = situacaoCupom(c, hoje);
        const regras = [c.expira_em ? `até ${dataBR(c.expira_em)}` : "", c.min_subtotal_centavos ? `mínimo ${brl(c.min_subtotal_centavos)}` : ""].filter(Boolean).join(" · ") || "—";
        return html`<tr>
          <td class="col-cli"><code class="cupom-cod">${c.codigo}</code><small>${c.descricao || ""}</small></td>
          <td class="nowrap"><strong>${c.tipo === "percentual" ? `${c.valor}%` : brl(c.valor)}</strong></td>
          <td>${regras}</td>
          <td class="num">${num(c.usos)}${c.max_usos ? ` / ${num(c.max_usos)}` : ""}</td>
          <td class="num nowrap">${c.desconto_centavos ? html`<span class="neg">−${brl(c.desconto_centavos)}</span>` : "—"}</td>
          <td class="num nowrap">${c.receita_centavos ? brl(c.receita_centavos) : "—"}</td>
          <td>${pill({ cls: sit.cls, rot: sit.rot, ic: sit.cls === "ok" ? "check" : sit.cls === "neutro" ? "clock" : "alert" })}</td>
          <td><div class="acoes-linha">
            <button type="button" class="link-btn" data-acao="editar" data-codigo="${c.codigo}">${icone("edit", 14)}Editar</button>
            <button type="button" class="link-btn" data-acao="alternar" data-codigo="${c.codigo}">${c.ativo ? "Desativar" : "Ativar"}</button>
            <button type="button" class="link-btn" data-acao="copiar" data-texto="${c.codigo}">${icone("copy", 14)}Copiar</button>
            <button type="button" class="link-btn link-perigo" data-acao="apagar" data-codigo="${c.codigo}">${icone("trash", 14)}Apagar</button>
          </div></td></tr>`;
      })}</tbody></table></div>`;
  }

  function desenhar() {
    setHTML(el, html`${formulario()}
      <section class="card card-tabela"><header class="card-cab"><div class="card-tit"><h3>Seus cupons</h3>
        <p class="card-sub">"Usos" conta pedidos que não foram recusados, cancelados ou reembolsados. Desconto e faturamento contam só pedidos pagos.</p></div></header>
        <div id="cupTabela">${tabela()}</div></section>`);
    const tipo = el.querySelector("#cfTipo");
    tipo.addEventListener("change", () => {
      const pc = tipo.value === "percentual";
      el.querySelector("#cfValorRot").textContent = pc ? "Desconto (%)" : "Desconto (R$)";
      el.querySelector("[name=valor]").placeholder = pc ? "10" : "5,00";
    });
  }

  async function salvar(form) {
    const msg = el.querySelector("#cupomMsg");
    const f = new FormData(form);
    const tipo = f.get("tipo");
    const bruto = String(f.get("valor") || "").trim();
    const valor = tipo === "percentual" ? Math.round(Number(bruto.replace(",", "."))) : parseBRL(bruto);
    const minTxt = String(f.get("min") || "").trim();
    const min = minTxt ? parseBRL(minTxt) : null;
    const erro = (t) => { msg.className = "admin-msg erro"; msg.textContent = t; };
    if (!valor || valor < 1) return erro("Informe o valor do desconto.");
    if (tipo === "percentual" && valor > 100) return erro("O percentual precisa estar entre 1 e 100.");
    if (minTxt && min === null) return erro("Pedido mínimo inválido.");
    const corpo = {
      codigo: String(f.get("codigo") || "").trim().toUpperCase(),
      tipo, valor,
      expira_em: f.get("expira_em") || null,
      max_usos: f.get("max_usos") ? Number(f.get("max_usos")) : null,
      min_subtotal_centavos: min,
      descricao: String(f.get("descricao") || "").trim() || null,
      ativo: f.get("ativo") === "on",
    };
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      await api("/admin/cupons", { method: "POST", body: JSON.stringify(corpo) });
      toast(`Cupom ${corpo.codigo} salvo.`, "ok");
      editando = null;
      await carregar();
      desenhar();
    } catch (e) {
      erro(e.message || "Não consegui salvar o cupom.");
      btn.disabled = false;
    }
  }

  return {
    titulo: "Cupons",
    usaPeriodo: false,
    async montar(container) {
      el = container;
      setHTML(el, html`<p class="muted">Carregando cupons…</p>`);
      await carregar();
      desenhar();
      el.addEventListener("submit", (ev) => {
        if (ev.target.id === "formCupom") { ev.preventDefault(); salvar(ev.target); }
      });
      el.addEventListener("click", async (ev) => {
        const a = ev.target.closest("[data-acao]");
        if (!a) return;
        const cod = a.dataset.codigo;
        switch (a.dataset.acao) {
          case "editar": editando = cod; desenhar(); el.scrollIntoView({ block: "start" }); break;
          case "cancelar-edicao": editando = null; desenhar(); break;
          case "copiar": toast((await copiar(a.dataset.texto)) ? "Código copiado!" : "Não consegui copiar.", "info", 1800); break;
          case "alternar": {
            const c = S.cupons.find((x) => x.codigo === cod);
            try {
              await api("/admin/cupons", { method: "POST", body: JSON.stringify({ codigo: cod, ativo: !c.ativo }) });
              toast(`Cupom ${cod} ${c.ativo ? "desativado" : "ativado"}.`, "ok");
              await carregar(); desenhar();
            } catch (e) { toast(e.message, "erro"); }
            break;
          }
          case "apagar":
            if (!confirm(`Apagar o cupom ${cod}? Pedidos antigos que usaram esse cupom continuam no histórico.`)) break;
            try {
              await api(`/admin/cupons?codigo=${encodeURIComponent(cod)}`, { method: "DELETE" });
              toast(`Cupom ${cod} apagado.`, "ok");
              if (editando === cod) editando = null;
              await carregar(); desenhar();
            } catch (e) { toast(e.message, "erro"); }
            break;
        }
      });
    },
    atualizar() { /* cupons vêm do servidor a cada abertura; nada a refazer com os pedidos */ },
  };
}

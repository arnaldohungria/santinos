/* Painel Santino's — definição dos relatórios.
 * Cada relatório vira { titulo, nota, colunas, numericas, linhas:[{exibir, csv}], totais }:
 *   exibir = texto formatado (tela e impressão), csv = valores crus (números em reais, pro Excel somar).
 */
import { brl, num, pct, dataBR, dataHoraBR, fmtTel, fmtCPF, fmtCEP, NOME_DOW, dowDe } from "./util.js";
import { serieDiaria, porProduto, porCidade, agruparClientes, porCupom, porMetodo, resumir, nomeMetodo, detalheMetodo, pgtoInfo, ENVIO, enderecoLinhas, temCustos, situacaoCupom } from "./dados.js";

export const RELATORIOS = [
  { id: "vendas", nome: "Vendas detalhadas", desc: "Todos os pedidos do período, linha a linha, com cliente, endereço e valores. O mais completo — serve pro contador.", icone: "pedidos" },
  { id: "diario", nome: "Vendas por dia", desc: "Faturamento, pedidos, descontos, frete e taxas de cada dia.", icone: "dashboard" },
  { id: "produtos", nome: "Vendas por produto", desc: "Unidades e faturamento de cada molho (e margem, se os custos estiverem configurados).", icone: "box" },
  { id: "regiao", nome: "Vendas por cidade e estado", desc: "De onde vêm seus pedidos — útil pra segmentar anúncios.", icone: "pin" },
  { id: "clientes", nome: "Clientes", desc: "Quem comprou no período, quanto gastou, e o histórico total de cada um.", icone: "clientes" },
  { id: "cupons", nome: "Desempenho dos cupons", desc: "Quantos pedidos cada cupom trouxe e quanto custou em desconto.", icone: "cupons" },
  { id: "financeiro", nome: "Fechamento financeiro", desc: "Faturamento, taxas, custos e lucro estimado do período.", icone: "card" },
  { id: "envio", nome: "Pedidos a enviar (romaneio)", desc: "Lista de separação: pagos que ainda não foram enviados. Não depende do período.", icone: "truck" },
];

const L = (exibir, csv) => ({ exibir, csv: csv || exibir });
const reais = (c) => (c || 0) / 100;
const nomeCurto = (produtos, id) => ((produtos[id] && produtos[id].nome) || id).replace("Santino's ", "");

function somar(linhas, idxs, reaisIdx) {
  const t = new Array(linhas[0] ? linhas[0].csv.length : 0).fill(null);
  for (const i of idxs) t[i] = Math.round(linhas.reduce((s, l) => s + (Number(l.csv[i]) || 0), 0) * 100) / 100;
  return { exibir: t.map((v, i) => (v === null ? "" : reaisIdx.includes(i) ? brl(Math.round(v * 100)) : num(v))), csv: t };
}

export function gerar(id, { pedidos, todos, periodo, produtos, config, cupons }) {
  const pagos = pedidos.filter((p) => p._pago);
  const tituloBase = RELATORIOS.find((r) => r.id === id).nome;
  const sufixo = `${periodo.de}_a_${periodo.ate}`;

  if (id === "vendas") {
    const colunas = ["Pedido", "Data", "Pago em", "Cliente", "E-mail", "WhatsApp", "CPF", "Endereço", "Cidade", "UF", "CEP", "Itens", "Unidades", "Produtos", "Desconto", "Cupom", "Frete", "Transportadora", "Total", "Taxa MP", "Líquido", "Forma de pagamento", "Status pagamento", "Status envio", "Rastreio", "Observações"];
    const linhas = pedidos.map((p) => {
      const itens = p._itens.map((i) => `${i.qtd}x ${nomeCurto(produtos, i.id)}`).join(" + ");
      const end = enderecoLinhas(p).slice(0, 2).join(" — ");
      const envio = p._pago ? (ENVIO[p.status_envio] || ENVIO.novo).rot : "";
      return L(
        [p.external_reference, dataHoraBR(p.criado_em), p.pago_em ? dataHoraBR(p.pago_em) : "", p.nome || "", p.email || "", fmtTel(p.whatsapp), fmtCPF(p.cpf), end, p._cidade, p._uf, fmtCEP(p.cep), itens, p._qtd, brl(p._subtotal), brl(p._desconto), p.cupom || "", brl(p._frete), p.frete_rotulo || "", brl(p._total), brl(p._taxa), brl(p._liquido), p.tipo_pagamento ? detalheMetodo(p) : "", pgtoInfo(p.status).rot, envio, p.rastreio || "", p.obs || ""],
        [p.external_reference, dataHoraBR(p.criado_em), p.pago_em ? dataHoraBR(p.pago_em) : "", p.nome || "", p.email || "", fmtTel(p.whatsapp), fmtCPF(p.cpf), end, p._cidade, p._uf, fmtCEP(p.cep), itens, p._qtd, reais(p._subtotal), reais(p._desconto), p.cupom || "", reais(p._frete), p.frete_rotulo || "", reais(p._total), reais(p._taxa), reais(p._liquido), p.tipo_pagamento ? detalheMetodo(p) : "", pgtoInfo(p.status).rot, envio, p.rastreio || "", p.obs || ""]
      );
    });
    const dinheiro = [13, 14, 16, 18, 19, 20];
    const pl = linhas.filter((_, i) => pedidos[i]._pago);
    const tot = pl.length ? somar(pl, [12, ...dinheiro], dinheiro) : null;
    if (tot) { tot.exibir[0] = "Total (apenas pagos)"; tot.csv[0] = "Total (apenas pagos)"; }
    return { id, titulo: tituloBase, colunas, numericas: [12, ...dinheiro], linhas, totais: tot, arquivo: `santinos-vendas-${sufixo}.csv`, nota: "Todos os status aparecem; os totais no rodapé contam só pedidos pagos." };
  }

  if (id === "diario") {
    const serie = serieDiaria(pedidos, periodo.de, periodo.ate);
    const colunas = ["Data", "Dia", "Pedidos pagos", "Unidades", "Faturamento", "Descontos", "Frete", "Taxas MP", "Líquido", "Ticket médio"];
    const linhas = serie.map((x) => L(
      [dataBR(x.dia), NOME_DOW[dowDe(x.dia)], num(x.pedidos), num(x.itens), brl(x.receita), brl(x.desconto), brl(x.frete), brl(x.taxa), brl(x.liquido), x.pedidos ? brl(x.receita / x.pedidos) : "—"],
      [dataBR(x.dia), NOME_DOW[dowDe(x.dia)], x.pedidos, x.itens, reais(x.receita), reais(x.desconto), reais(x.frete), reais(x.taxa), reais(x.liquido), x.pedidos ? Math.round(x.receita / x.pedidos) / 100 : ""]
    ));
    const dinheiro = [4, 5, 6, 7, 8];
    const tot = somar(linhas, [2, 3, ...dinheiro], dinheiro);
    tot.exibir[0] = "Total"; tot.csv[0] = "Total";
    const r = resumir(pedidos);
    tot.exibir[9] = brl(r.ticket); tot.csv[9] = Math.round(r.ticket) / 100;
    return { id, titulo: tituloBase, colunas, numericas: [2, 3, ...dinheiro, 9], linhas, totais: tot, arquivo: `santinos-diario-${sufixo}.csv` };
  }

  if (id === "produtos") {
    const custos = temCustos(config);
    const lista = porProduto(pedidos, produtos);
    const colunas = ["Produto", "Unidades", "Pedidos", "Faturamento bruto", ...(custos ? ["Custo unitário", "Custo total", "Margem bruta"] : [])];
    const linhas = lista.map((p) => {
      const cu = config[`custo_${p.id}`] || 0;
      const ct = cu * p.qtd;
      return L(
        [p.nome, num(p.qtd), num(p.pedidos), brl(p.receita), ...(custos ? [brl(cu), brl(ct), pct(p.receita ? (p.receita - ct) / p.receita : 0, 0)] : [])],
        [p.nome, p.qtd, p.pedidos, reais(p.receita), ...(custos ? [reais(cu), reais(ct), p.receita ? Math.round(((p.receita - ct) / p.receita) * 1000) / 10 : ""] : [])]
      );
    });
    const dinheiro = custos ? [3, 5] : [3];
    const tot = linhas.length ? somar(linhas, [1, 2, ...dinheiro], dinheiro) : null;
    if (tot) { tot.exibir[0] = "Total"; tot.csv[0] = "Total"; }
    return { id, titulo: tituloBase, colunas, numericas: colunas.map((_, i) => i).slice(1), linhas, totais: tot, arquivo: `santinos-produtos-${sufixo}.csv`, nota: "Faturamento bruto = unidades × preço de tabela (antes de descontos de cupom)." };
  }

  if (id === "regiao") {
    const lista = porCidade(pedidos);
    const colunas = ["Estado", "Cidade", "Pedidos", "Unidades", "Faturamento", "Ticket médio"];
    const linhas = lista.map((x) => {
      const [cidade, uf] = x.chave.split("|");
      return L([uf, cidade, num(x.pedidos), num(x.itens), brl(x.receita), brl(x.receita / x.pedidos)], [uf, cidade, x.pedidos, x.itens, reais(x.receita), Math.round(x.receita / x.pedidos) / 100]);
    });
    const tot = linhas.length ? somar(linhas, [2, 3, 4], [4]) : null;
    if (tot) { tot.exibir[0] = "Total"; tot.csv[0] = "Total"; }
    return { id, titulo: tituloBase, colunas, numericas: [2, 3, 4, 5], linhas, totais: tot, arquivo: `santinos-regiao-${sufixo}.csv` };
  }

  if (id === "clientes") {
    const doPeriodo = agruparClientes(pedidos).filter((c) => c.pagos > 0);
    const vida = new Map(agruparClientes(todos).map((c) => [c.key, c]));
    const colunas = ["Cliente", "E-mail", "WhatsApp", "CPF", "Cidade", "UF", "Pedidos no período", "Gasto no período", "Pedidos (total)", "Gasto (total)", "Primeira compra", "Última compra", "Perfil"];
    const linhas = doPeriodo.map((c) => {
      const v = vida.get(c.key) || c;
      const perfil = v.vip ? "VIP" : v.recorrente ? "Recorrente" : "Novo";
      return L(
        [c.nome || "", c.email || "", fmtTel(c.whatsapp), fmtCPF(c.cpf), c.cidade, c.uf, num(c.pagos), brl(c.gasto), num(v.pagos), brl(v.gasto), dataBR(v.primeiro), dataBR(v.ultimo), perfil],
        [c.nome || "", c.email || "", fmtTel(c.whatsapp), fmtCPF(c.cpf), c.cidade, c.uf, c.pagos, reais(c.gasto), v.pagos, reais(v.gasto), dataBR(v.primeiro), dataBR(v.ultimo), perfil]
      );
    });
    const tot = linhas.length ? somar(linhas, [6, 7, 8, 9], [7, 9]) : null;
    if (tot) { tot.exibir[0] = `${linhas.length} clientes`; tot.csv[0] = `${linhas.length} clientes`; }
    return { id, titulo: tituloBase, colunas, numericas: [6, 7, 8, 9], linhas, totais: tot, arquivo: `santinos-clientes-${sufixo}.csv`, nota: "Contém dados pessoais (CPF, e-mail, telefone) — trate com cuidado." };
  }

  if (id === "cupons") {
    const uso = porCupom(pedidos);
    const colunas = ["Cupom", "Desconto do cupom", "Pedidos pagos", "Desconto concedido", "Faturamento gerado", "Ticket médio", "Situação"];
    const info = new Map((cupons || []).map((c) => [c.codigo, c]));
    const hoje = periodo.ate;
    const linhas = uso.map((x) => {
      const c = info.get(x.cupom);
      const regra = c ? (c.tipo === "percentual" ? `${c.valor}%` : brl(c.valor)) : "—";
      const sit = c ? situacaoCupom(c, hoje).rot : "Apagado";
      return L([x.cupom, regra, num(x.pedidos), brl(x.desconto), brl(x.receita), brl(x.receita / x.pedidos), sit], [x.cupom, regra, x.pedidos, reais(x.desconto), reais(x.receita), Math.round(x.receita / x.pedidos) / 100, sit]);
    });
    const tot = linhas.length ? somar(linhas, [2, 3, 4], [3, 4]) : null;
    if (tot) { tot.exibir[0] = "Total"; tot.csv[0] = "Total"; }
    return { id, titulo: tituloBase, colunas, numericas: [2, 3, 4, 5], linhas, totais: tot, arquivo: `santinos-cupons-${sufixo}.csv` };
  }

  if (id === "financeiro") {
    const r = resumir(pedidos);
    const custos = temCustos(config);
    const linhas = [
      L(["Pedidos pagos", num(r.pedidos)], ["Pedidos pagos", r.pedidos]),
      L(["Unidades vendidas", num(r.itens)], ["Unidades vendidas", r.itens]),
      L(["Produtos vendidos", brl(r.subtotal)], ["Produtos vendidos", reais(r.subtotal)]),
      L(["(−) Descontos de cupom", brl(-r.desconto)], ["(-) Descontos de cupom", -reais(r.desconto)]),
      L(["(+) Frete cobrado dos clientes", brl(r.frete)], ["(+) Frete cobrado dos clientes", reais(r.frete)]),
      L(["FATURAMENTO", brl(r.receita)], ["FATURAMENTO", reais(r.receita)]),
      L(["(−) Taxas do Mercado Pago", brl(-r.taxa)], ["(-) Taxas do Mercado Pago", -reais(r.taxa)]),
      L(["VALOR RECEBIDO (líquido)", brl(r.liquido)], ["VALOR RECEBIDO (líquido)", reais(r.liquido)]),
      ...(custos ? [
        L(["(−) Frete repassado ao envio (estimado)", brl(-r.frete)], ["(-) Frete repassado ao envio (estimado)", -reais(r.frete)]),
        L(["(−) Custo dos produtos + embalagem", brl(-r.custo)], ["(-) Custo dos produtos + embalagem", -reais(r.custo)]),
        L(["LUCRO ESTIMADO", brl(r.lucro)], ["LUCRO ESTIMADO", reais(r.lucro)]),
        L(["Margem sobre produtos líquidos", pct(r.margem, 1)], ["Margem sobre produtos líquidos", Math.round(r.margem * 1000) / 10]),
      ] : []),
      L(["Ticket médio", brl(r.ticket)], ["Ticket médio", Math.round(r.ticket) / 100]),
      L(["Pedidos com cupom", num(r.comCupom)], ["Pedidos com cupom", r.comCupom]),
      L(["Pagamentos aguardando (não contam)", `${num(r.pendentes)} · ${brl(r.pendentesValor)}`], ["Pagamentos aguardando (nao contam)", reais(r.pendentesValor)]),
      L(["Reembolsados (não contam)", `${num(r.reembolsados)} · ${brl(r.reembolsadosValor)}`], ["Reembolsados (nao contam)", reais(r.reembolsadosValor)]),
      ...porMetodo(pedidos).map((m) => L([`Recebido via ${m.chave}`, `${num(m.pedidos)} ped. · ${brl(m.receita)}`], [`Recebido via ${m.chave}`, reais(m.receita)])),
    ];
    return { id, titulo: tituloBase, colunas: ["Item", "Valor"], numericas: [1], linhas, totais: null, arquivo: `santinos-financeiro-${sufixo}.csv`, nota: custos ? "Lucro estimado = produtos líquidos − custo dos produtos − embalagem − taxas. Considera que o frete cobrado paga a etiqueta." : "Configure os custos em Configurações para ver o lucro estimado." };
  }

  // envio: ignora o período (é o que está pendente agora)
  const pend = todos.filter((p) => p._pago && (p.status_envio || "novo") !== "enviado" && (p.status_envio || "novo") !== "entregue")
    .sort((a, b) => String(a.pago_em || a.criado_em).localeCompare(String(b.pago_em || b.criado_em)));
  const colunas = ["Pedido", "Pago em", "Cliente", "WhatsApp", "Endereço", "Cidade / UF", "CEP", "Itens", "Situação", "Rastreio"];
  const linhas = pend.map((p) => {
    const itens = p._itens.map((i) => `${i.qtd}x ${nomeCurto(produtos, i.id)}`).join(" + ");
    const end = enderecoLinhas(p).slice(0, 2).join(" — ");
    const sit = (ENVIO[p.status_envio] || ENVIO.novo).rot;
    const dados = [p.external_reference, dataHoraBR(p.pago_em || p.criado_em), p.nome || "", fmtTel(p.whatsapp), end, `${p._cidade} / ${p._uf}`, fmtCEP(p.cep), itens, sit, p.rastreio || ""];
    return L(dados);
  });
  return { id, titulo: tituloBase, colunas, numericas: [], linhas, totais: null, arquivo: `santinos-a-enviar-${periodo.ate}.csv`, nota: `${linhas.length} pedido(s) pago(s) aguardando envio, do mais antigo pro mais novo.` };
}

/* Santino's — proxy de cotação Melhor Envio (Vercel Serverless Function)
 *
 * Existe porque o Cloudflare Worker do checkout, ao chamar a API do Melhor
 * Envio diretamente, levava 401 "Unauthenticated" mesmo com o token
 * (aparentemente) certo. Causa raiz não 100% confirmada — pode ter sido o
 * mesmo problema documentado no worker/README.md (token colado com
 * caracteres de mascaramento de campo de senha) em vez de um bloqueio real
 * de tráfego Worker-a-Worker entre duas APIs atrás da Cloudflare. De todo
 * jeito, rodando esse fetch aqui na Vercel funciona, e centralizar essa
 * chamada num só lugar facilita revisar/trocar o token no futuro.
 *
 * Rota: POST /api/melhor-envio
 * Body: { cepDestino, pacote: { altura, largura, comprimento, peso } }
 * Chamador precisa mandar o header x-internal-secret batendo com
 * INTERNAL_SHARED_SECRET (evita que qualquer um bata nesse endpoint e
 * consuma a cota de cotações do Melhor Envio).
 *
 * Devolve, em caso de sucesso, exatamente o array que o Melhor Envio
 * retorna (o Worker é quem filtra/formata). Em caso de erro, devolve
 * { erro, detalhe } com o status HTTP correspondente.
 *
 * Env vars (Vercel -> Project Settings -> Environment Variables):
 *   MELHOR_ENVIO_TOKEN      token de API do Melhor Envio (escopo shipping-calculate)
 *   ORIGEM_CEP               CEP de onde os pedidos saem (Itapetininga), sem traço
 *   INTERNAL_SHARED_SECRET   mesmo valor configurado no Worker (wrangler secret put)
 */

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ erro: "Método não permitido." });
    return;
  }

  const segredoEsperado = process.env.INTERNAL_SHARED_SECRET;
  const segredoRecebido = req.headers["x-internal-secret"];
  if (!segredoEsperado || segredoRecebido !== segredoEsperado) {
    res.status(403).json({ erro: "Não autorizado." });
    return;
  }

  if (!process.env.MELHOR_ENVIO_TOKEN || !process.env.ORIGEM_CEP) {
    res.status(500).json({ erro: "MELHOR_ENVIO_TOKEN ou ORIGEM_CEP não configurados na Vercel." });
    return;
  }

  const { cepDestino, pacote } = req.body || {};
  if (!cepDestino || !pacote) {
    res.status(400).json({ erro: "cepDestino e pacote são obrigatórios." });
    return;
  }

  try {
    const r = await fetch("https://melhorenvio.com.br/api/v2/me/shipment/calculate", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.MELHOR_ENVIO_TOKEN}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "Santinos Pepper Sauces (contato@santinos.com.br)",
      },
      body: JSON.stringify({
        from: { postal_code: process.env.ORIGEM_CEP },
        to: { postal_code: cepDestino },
        package: {
          height: pacote.altura,
          width: pacote.largura,
          length: pacote.comprimento,
          weight: pacote.peso,
        },
      }),
    });

    const texto = await r.text();
    let corpo;
    try {
      corpo = JSON.parse(texto);
    } catch {
      res.status(502).json({ erro: "Melhor Envio não respondeu em JSON.", detalhe: texto.slice(0, 300) });
      return;
    }

    if (!r.ok) {
      res.status(r.status).json({ erro: "Melhor Envio recusou a cotação.", detalhe: corpo });
      return;
    }

    res.status(200).json(corpo);
  } catch (e) {
    res.status(502).json({ erro: "Falha ao contatar o Melhor Envio.", detalhe: e?.message || String(e) });
  }
}

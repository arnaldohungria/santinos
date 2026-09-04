/* Santino's — Meta Pixel (rastreamento de conversão pra tráfego pago)
 *
 * Cole o ID do Pixel abaixo (Meta Business Manager -> Gerenciador de Eventos
 * -> sua fonte de dados -> ele mostra um número tipo "1234567890123456").
 * Enquanto estiver vazio, nada é carregado — sem pixel, sem erro no console.
 */
const META_PIXEL_ID = "";

if (META_PIXEL_ID) {
  !function (f, b, e, v, n, t, s) {
    if (f.fbq) return;
    n = f.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    };
    if (!f._fbq) f._fbq = n;
    n.push = n;
    n.loaded = true;
    n.version = "2.0";
    n.queue = [];
    t = b.createElement(e);
    t.async = true;
    t.src = v;
    s = b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t, s);
  }(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");

  fbq("init", META_PIXEL_ID);
  fbq("track", "PageView");
}

// Wrapper usado pelo loja.js pros eventos de e-commerce (AddToCart,
// InitiateCheckout, Purchase etc.) — não faz nada se o pixel não tiver ID.
function metaTrack(evento, dados) {
  if (META_PIXEL_ID && window.fbq) window.fbq("track", evento, dados || {});
}

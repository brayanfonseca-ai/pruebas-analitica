/*!
 * DataSense Embed SDK — incrusta un tablero publicado en cualquier página web.
 *
 *   <div id="tablero"></div>
 *   <script src="https://TU-SERVIDOR/js/embed-sdk.js"></script>
 *   <script>
 *     const h = DataSense.embed({
 *       container: "#tablero",            // selector o elemento
 *       token: "dse_xxxxxxxx",            // token del embed (Embedding → copiar)
 *       baseUrl: "https://TU-SERVIDOR",   // opcional; por defecto, el origen de este script
 *       height: "600px",                  // opcional ("auto" ajusta la altura al contenido)
 *       theme: "dark",                    // opcional: "light" | "dark"
 *       onReady: () => {},                // opcional
 *       onError: (msg) => {},             // opcional
 *     });
 *     h.setTheme("light");  // cambiar el tema en caliente
 *     h.destroy();          // quitar el iframe
 *   </script>
 */
(function (global) {
  "use strict";

  var scriptOrigin = (function () {
    try {
      var s = document.currentScript;
      return s && s.src ? new URL(s.src).origin : "";
    } catch (e) { return ""; }
  })();

  function embed(opts) {
    opts = opts || {};
    var host = typeof opts.container === "string" ? document.querySelector(opts.container) : opts.container;
    if (!host) throw new Error("DataSense.embed: no se encontró el contenedor.");
    if (!opts.token) throw new Error("DataSense.embed: falta el token.");
    var base = String(opts.baseUrl || scriptOrigin || location.origin).replace(/\/+$/, "");
    var origin = new URL(base).origin;

    var iframe = document.createElement("iframe");
    iframe.src = base + "/embed/" + encodeURIComponent(opts.token);
    iframe.title = opts.title || "Tablero DataSense";
    iframe.loading = "lazy";
    iframe.setAttribute("allowfullscreen", "");
    iframe.style.cssText = "border:0;width:100%;display:block;height:" + (opts.height && opts.height !== "auto" ? opts.height : "600px");
    host.appendChild(iframe);

    function onMessage(ev) {
      if (ev.origin !== origin || ev.source !== iframe.contentWindow) return;
      var d = ev.data || {};
      if (d.type === "ds-embed:ready") {
        if (opts.theme) send({ type: "ds-embed:theme", theme: opts.theme });
        if (typeof opts.onReady === "function") opts.onReady(d);
      } else if (d.type === "ds-embed:error") {
        if (typeof opts.onError === "function") opts.onError(d.message);
      } else if (d.type === "ds-embed:resize" && opts.height === "auto" && d.height) {
        iframe.style.height = d.height + "px";
      }
    }
    function send(msg) {
      if (iframe.contentWindow) iframe.contentWindow.postMessage(msg, origin);
    }
    window.addEventListener("message", onMessage);

    return {
      iframe: iframe,
      setTheme: function (t) { send({ type: "ds-embed:theme", theme: t }); },
      destroy: function () {
        window.removeEventListener("message", onMessage);
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      },
    };
  }

  global.DataSense = global.DataSense || {};
  global.DataSense.embed = embed;
})(window);

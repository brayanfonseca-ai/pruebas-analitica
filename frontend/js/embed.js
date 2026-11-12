// embed.js — página incrustable (/embed/<token>). Pinta UNA hoja publicada en solo lectura con el mismo
// motor de las hojas (app-hoja.js), sin menús, sin asistente y sin edición. El token (window.__DS_EMBED)
// lo inyecta el servidor y api.js lo usa como único Authorization.
//
// Comunicación con la página que incrusta (embed-sdk.js): postMessage
//   → {type:"ds-embed:ready"}  cuando la hoja terminó de pintarse
//   → {type:"ds-embed:error", message}
//   → {type:"ds-embed:resize", height}   (si options.autoResize)
//   ← {type:"ds-embed:theme", theme:"light"|"dark"}

const CFG = window.__DS_EMBED || {};
const OPT = CFG.options || {};
const root = document.documentElement;
const view = document.getElementById("embedView");

// Sin paleta de comandos (Ctrl+K) ni atajos del resto de la plataforma dentro de un embed.
window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === "k") { e.stopImmediatePropagation(); e.preventDefault(); }
}, true);

function applyTheme(t) {
  if (t === "light" || t === "dark") root.setAttribute("data-theme", t);
}
if (OPT.theme === "light" || OPT.theme === "dark") applyTheme(OPT.theme);

root.classList.toggle("ds-embed-no-title", !!OPT.hideTitle);
root.classList.toggle("ds-embed-no-sel", !!OPT.hideSelections);

const post = (msg) => { try { window.parent !== window && window.parent.postMessage(msg, "*"); } catch { /* sin padre */ } };

window.addEventListener("message", (e) => {
  const d = e.data;
  if (d && d.type === "ds-embed:theme") applyTheme(d.theme);
});

function fail(message) {
  view.innerHTML = `<div class="ds-embed-msg"><b>No se puede mostrar este tablero</b><p></p></div>`;
  view.querySelector("p").textContent = message;
  post({ type: "ds-embed:error", message });
}

async function boot() {
  if (!CFG.token || !CFG.appId) return fail("Configuración de embed incompleta.");
  try {
    const mod = await import("/js/app-hoja.js");
    view.innerHTML = "";
    await mod.render(view, { appId: CFG.appId, sheetId: CFG.sheetId, can: () => false, embed: true });
    post({ type: "ds-embed:ready", sheetId: CFG.sheetId });
    if (OPT.autoResize) {
      const send = () => post({ type: "ds-embed:resize", height: document.documentElement.scrollHeight });
      new ResizeObserver(send).observe(document.body);
      send();
    }
  } catch (err) {
    console.error(err);
    fail(err.message || "Error al cargar el tablero.");
  }
}

boot();

// embed.js — página incrustable (/embed/<token>). Pinta una o VARIAS hojas publicadas en solo lectura con el
// mismo motor de las hojas (app-hoja.js), sin menús, sin asistente y sin edición. Con varias hojas muestra
// pestañas arriba (los filtros se conservan al cambiar). El token (window.__DS_EMBED) lo inyecta el servidor
// y api.js lo usa como único Authorization.
//
// Comunicación con la página que incrusta (embed-sdk.js): postMessage
//   → {type:"ds-embed:ready", sheetId, sheetIds}  cuando la hoja terminó de pintarse
//   → {type:"ds-embed:sheetchange", sheetId}      al cambiar de pestaña
//   ← {type:"ds-embed:sheet", sheetId}            para abrir otra de sus hojas
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

/* ---------- Varias hojas: pestañas encima del tablero (los filtros se conservan al cambiar) ---------- */
let sheetApi = null;
let tabsEl = null;
const escTxt = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function mountTabs(api) {
  sheetApi = api;
  if (api.sheets.length < 2 || OPT.hideTabs) return;
  tabsEl = document.createElement("nav");
  tabsEl.className = "ds-embed-tabs";
  tabsEl.setAttribute("role", "tablist");
  tabsEl.setAttribute("aria-label", "Hojas del tablero");
  tabsEl.innerHTML = api.sheets.map((s) => `<button type="button" role="tab" data-sheet="${escTxt(s.id)}">${escTxt(s.title || "Hoja")}</button>`).join("");
  tabsEl.addEventListener("click", (e) => { const b = e.target.closest("[data-sheet]"); if (b) api.open(b.dataset.sheet); });
  tabsEl.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const bs = [...tabsEl.querySelectorAll("button")]; const i = bs.indexOf(document.activeElement);
    const n = bs[(i + (e.key === "ArrowRight" ? 1 : -1) + bs.length) % bs.length]; n.focus(); n.click();
  });
  document.body.insertBefore(tabsEl, view);
  root.classList.add("ds-embed-has-tabs");
}
function markTab(id) {
  if (!tabsEl) return;
  tabsEl.querySelectorAll("button").forEach((b) => { const on = b.dataset.sheet === id; b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1; });
}
// La página que incrusta también puede cambiar de hoja: postMessage({type:"ds-embed:sheet", sheetId}).
window.addEventListener("message", (e) => { const d = e.data; if (d && d.type === "ds-embed:sheet" && sheetApi) sheetApi.open(String(d.sheetId)); });

async function boot() {
  if (!CFG.token || !CFG.appId) return fail("Configuración de embed incompleta.");
  try {
    const mod = await import("/js/app-hoja.js");
    view.innerHTML = "";
    let ready = false;
    await mod.render(view, {
      appId: CFG.appId, sheetId: CFG.sheetId, can: () => false, embed: true,
      onSheets: mountTabs,
      onSheetChange: (id) => { markTab(id); if (ready) post({ type: "ds-embed:sheetchange", sheetId: id }); },
    });
    ready = true;
    post({ type: "ds-embed:ready", sheetId: CFG.sheetId, sheetIds: sheetApi ? sheetApi.sheets.map((s) => s.id) : [CFG.sheetId] });
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

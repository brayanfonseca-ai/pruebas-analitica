// experimentos.js — lista de experimentos de ML (proceso independiente del hub).
// Crear (modal: nombre + app + tabla), abrir el estudio, eliminar y buscar.
// ?new=1 abre el modal de creación directamente (Crear → Experimento de ML).
// ?app=<id> preselecciona la aplicación.

import { renderNav, wireAppsButton, renderProfileMenu } from "./hub-nav.js";
import { authService } from "./auth-service.js";
import { listExperiments, createExperiment, deleteExperiment, listApps, listTables } from "./api.js";
import { ALGOS, ALGO_BY_BACKEND } from "./ml-catalog.js";

if (!authService.isAuthenticated()) location.replace("index.html");

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = (iso) => { if (!iso) return "—"; const d = new Date(iso); return isNaN(d) ? "—" : d.toLocaleString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); };
const SV = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const I = {
  flask: SV(`<path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3"/><path d="M7.5 15h9"/>`),
  plus: SV(`<path d="M12 5v14M5 12h14"/>`),
  trash: SV(`<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>`),
  seg: SV(`<circle cx="6.5" cy="7.5" r="2.4"/><circle cx="17.5" cy="7" r="2.4"/><circle cx="12" cy="17" r="2.4"/>`),
  reg: SV(`<path d="M4 20V4M4 20h16"/><path d="M6.5 16.5 18 7.5"/>`),
  cls: SV(`<path d="M3 19c7 0 7-14 18-14"/><path d="M3 12h18" stroke-dasharray="2 3"/>`),
  ts: SV(`<path d="M3 17l5-5 4 3 4-6"/><path d="M16 9l5-4" stroke-dasharray="2 2.5"/>`),
  auto: SV(`<path d="M4 18h4V9H4zM10 18h4V5h-4zM16 18h4v-6h-4z"/>`),
};

renderNav("nav", { active: "prediccion" });
wireAppsButton();
renderProfileMenu(authService);

const root = document.getElementById("root");
const params = new URLSearchParams(location.search);
let exps = [];
let apps = [];

const CAPS = [
  { ico: I.seg, t: "Segmentación", d: "K-Means, jerárquico y DBSCAN" },
  { ico: I.reg, t: "Regresión", d: "Lineal, Ridge, Lasso, polinómica, árboles, bosque, boosting, KNN" },
  { ico: I.cls, t: "Clasificación", d: "Logística, Naive Bayes, árboles, bosque, boosting, KNN" },
  { ico: I.ts, t: "Series y exploración", d: "Pronóstico, PCA, correlaciones, anomalías, reglas de asociación" },
  { ico: I.auto, t: "AutoML", d: "Compara todos los modelos y elige el mejor" },
];

function algoName(a) {
  const k = ALGO_BY_BACKEND(a);
  return k ? ALGOS[k].name : a || "—";
}

function render(filter = "") {
  const q = filter.trim().toLowerCase();
  const list = exps.filter((e) => !q || [e.name, e.app_name, e.description].some((v) => String(v || "").toLowerCase().includes(q)));
  root.innerHTML = `
    <div class="ml-head">
      <div>
        <h2 class="ml-title">Experimentos de ML</h2>
        <p class="ml-sub">Crea experimentos sobre tus datos, entrena y compara modelos, y guarda cada ejecución.</p>
      </div>
      <button class="ml-btn primary" id="newBtn"><span class="ml-ic">${I.plus}</span>Nuevo experimento</button>
    </div>
    <div class="mx-caps">${CAPS.map((c) => `<div class="mx-cap"><span class="mx-cap-ico">${c.ico}</span><div><strong>${c.t}</strong><span>${c.d}</span></div></div>`).join("")}</div>
    ${exps.length ? `
      <div class="ml-scroll mx-list-wrap"><table class="ml-table mx-list">
        <thead><tr><th>Experimento</th><th>Aplicación · tabla</th><th>Ejecuciones</th><th>Último algoritmo</th><th>Actualizado</th><th></th></tr></thead>
        <tbody>${list.map((e) => `
          <tr class="mx-row" data-open="${esc(e.id)}">
            <td><strong>${esc(e.name)}</strong>${e.description ? `<div class="mx-desc">${esc(e.description)}</div>` : ""}</td>
            <td>${esc(e.app_name)}${e.table_name ? ` <span class="ml-muted">· ${esc(e.table_name)}</span>` : ""}</td>
            <td>${e.runs}</td>
            <td>${esc(e.last_algorithm ? algoName(e.last_algorithm) : "—")}</td>
            <td>${fmtDate(e.updated_at)}</td>
            <td class="mx-actions"><a class="ml-btn ghost small" href="experimento.html?id=${encodeURIComponent(e.id)}">Abrir</a><button class="mx-icon danger" title="Eliminar" data-del="${esc(e.id)}">${I.trash}</button></td>
          </tr>`).join("") || `<tr><td colspan="6" class="ml-muted">Sin coincidencias.</td></tr>`}</tbody>
      </table></div>`
      : `<div class="ml-empty"><span class="ml-empty-ico">${I.flask}</span><strong>Aún no hay experimentos</strong><span class="ml-empty-hint">Crea el primero: elige una aplicación y una tabla, y empieza a entrenar modelos.</span><button class="ml-btn primary" id="newBtn2"><span class="ml-ic">${I.plus}</span>Nuevo experimento</button></div>`}`;
  root.querySelector("#newBtn")?.addEventListener("click", openModal);
  root.querySelector("#newBtn2")?.addEventListener("click", openModal);
  root.querySelectorAll("[data-open]").forEach((tr) => tr.addEventListener("click", (ev) => {
    if (ev.target.closest("[data-del], a")) return;
    location.href = `experimento.html?id=${encodeURIComponent(tr.dataset.open)}`;
  }));
  root.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    const e = exps.find((x) => x.id === b.dataset.del);
    if (!confirm(`¿Eliminar el experimento "${e?.name}" y todas sus ejecuciones?`)) return;
    try { await deleteExperiment(b.dataset.del); await load(); } catch (err) { alert("No se pudo eliminar: " + err.message); }
  }));
}

/* ---------------- Modal: nuevo experimento ---------------- */
const modal = document.getElementById("newModal");
const nName = document.getElementById("nName"), nApp = document.getElementById("nApp"), nTable = document.getElementById("nTable"), nDesc = document.getElementById("nDesc"), nErr = document.getElementById("nErr");

async function fillTables() {
  nTable.innerHTML = `<option value="">Cargando…</option>`;
  nTable.disabled = true;
  try {
    const t = await listTables(nApp.value);
    nTable.innerHTML = t.length ? t.map((x) => `<option value="${esc(x.id)}">${esc(x.name)} · ${x.rows ?? "?"} filas</option>`).join("") : `<option value="">La aplicación no tiene tablas</option>`;
    nTable.disabled = !t.length;
  } catch { nTable.innerHTML = `<option value="">No se pudieron cargar</option>`; }
}

async function openModal() {
  nErr.hidden = true;
  nName.value = ""; nDesc.value = "";
  if (!apps.length) {
    try { apps = await listApps(); } catch { apps = []; }
  }
  if (!apps.length) {
    nApp.innerHTML = `<option value="">No hay aplicaciones</option>`;
    nErr.textContent = "Primero crea una aplicación y carga datos en el catálogo.";
    nErr.hidden = false;
  } else {
    const pre = params.get("app");
    nApp.innerHTML = apps.map((a) => `<option value="${esc(a.id)}" ${a.id === pre ? "selected" : ""}>${esc(a.name)}</option>`).join("");
    await fillTables();
  }
  modal.hidden = false;
  setTimeout(() => nName.focus(), 30);
}
function closeModal() { modal.hidden = true; }

nApp.addEventListener("change", () => { nErr.hidden = true; fillTables(); });
nName.addEventListener("input", () => { nErr.hidden = true; });
document.getElementById("newX").addEventListener("click", closeModal);
document.getElementById("newCancel").addEventListener("click", closeModal);
modal.addEventListener("mousedown", (e) => { if (e.target === modal) closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) closeModal(); });
nName.addEventListener("keydown", (e) => { if (e.key === "Enter") document.getElementById("newCreate").click(); });
document.getElementById("newCreate").addEventListener("click", async () => {
  const btn = document.getElementById("newCreate");
  nErr.hidden = true;
  if (!nName.value.trim()) { nErr.textContent = "Escribe un nombre para el experimento."; nErr.hidden = false; nName.focus(); return; }
  if (!nApp.value) { nErr.textContent = "Elige una aplicación."; nErr.hidden = false; return; }
  if (!nTable.value) { nErr.textContent = "La aplicación elegida no tiene tablas. Carga datos primero."; nErr.hidden = false; return; }
  btn.disabled = true; btn.textContent = "Creando…";
  try {
    const e = await createExperiment({ appId: nApp.value, name: nName.value.trim(), description: nDesc.value.trim(), table: nTable.value });
    location.href = `experimento.html?id=${encodeURIComponent(e.id)}`;
  } catch (err) {
    nErr.textContent = err.message; nErr.hidden = false;
    btn.disabled = false; btn.textContent = "Crear experimento";
  }
});

document.getElementById("searchInput").addEventListener("input", (e) => render(e.target.value));

async function load() {
  try { exps = await listExperiments(); } catch (e) { root.innerHTML = `<div class="ml-note err">No se pudieron cargar los experimentos: ${esc(e.message)}</div>`; return; }
  render(document.getElementById("searchInput").value);
}

await load();
if (params.get("new") === "1") openModal();

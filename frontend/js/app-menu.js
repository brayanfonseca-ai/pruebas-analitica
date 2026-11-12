// app-menu.js — menú «⋯» de las tarjetas de aplicación (Inicio, Catálogo, Analizar).
//
// Reúne en un desplegable las acciones más usadas de una app, sin abrirla:
//   · Publicar en Producción (con TODAS sus hojas publicadas de una vez) / Volver a Desarrollo.
//   · Abrir en la hoja, el Gestor de datos, el Editor de carga, el Modelo lógico o Informes.
//   · Notas para agente, Experimento de ML nuevo, Conexiones y Embedding.
// Cada opción solo aparece si la persona tiene el permiso (el servidor vuelve a validarlo).
//
// Uso:  appMenuBtn(app.id) dentro de la tarjeta;  registerApps(lista);  onAppsChanged(recargar).

import { authService } from "./auth-service.js";
import * as api from "./api.js";
import { toast } from "./ui-kit.js";

const can = (p) => authService.can(p);
const registry = new Map();
const listeners = [];

export function registerApps(list) { registry.clear(); (list || []).forEach((a) => registry.set(a.id, a)); }
export function onAppsChanged(fn) { listeners.push(fn); }
const changed = () => listeners.forEach((fn) => { try { fn(); } catch { /* ignorar */ } });

export function appMenuBtn(appId) {
  return `<button type="button" class="ds-card-menu" data-appmenu="${String(appId).replace(/"/g, "&quot;")}" aria-haspopup="menu" aria-label="Más opciones de la aplicación" title="Más opciones">
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/></svg></button>`;
}

const ICO = {
  rocket: '<path d="M12 3c3.5 1.5 5.5 5 5.5 9l-2 3h-7l-2-3c0-4 2-7.5 5.5-9z"/><circle cx="12" cy="9.5" r="1.7"/><path d="M9.5 15 8 19l4-1.5M14.5 15 16 19l-4-1.5"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  open: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18M8.5 9v11"/>',
  db: '<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  code: '<path d="m8 7-5 5 5 5M16 7l5 5-5 5M13.6 5 10.4 19"/>',
  box: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12v9M4 7.5l8 4.5 8-4.5"/>',
  doc: '<rect x="5" y="3" width="14" height="18" rx="2.2"/><path d="M9 8h6M9 12h6M9 16h3.5"/>',
  notes: '<path d="M5 3.5h10.5L19 7v13a.5.5 0 0 1-.5.5h-13A.5.5 0 0 1 5 20z"/><path d="M15 3.5V7.5h4M8.5 12h7M8.5 15.5h4.5"/>',
  brain: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17M3.5 12h17M6 6c3 2 9 2 12 0M6 18c3-2 9-2 12 0"/>',
  plug: '<path d="M6.5 9h11v3.2a5.5 5.5 0 0 1-11 0z"/><path d="M9.5 3.5V9M14.5 3.5V9M12 17.7V21"/>',
  embed: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="m9.8 9.5-2.5 2.5 2.5 2.5M14.2 9.5l2.5 2.5-2.5 2.5"/>',
};
const ic = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICO[n]}</svg>`;
const go = (u) => () => { location.href = u; };

function itemsFor(app) {
  const id = encodeURIComponent(app.id);
  const items = [];
  if (can("apps:publish")) {
    if (app.stage !== "produccion") items.push({ ico: "rocket", label: "Publicar (app y todas sus hojas)", hint: "Producción", run: () => publishAll(app) });
    else {
      items.push({ ico: "rocket", label: "Publicar las hojas que faltan", hint: `${app.published ?? 0}/${app.sheets ?? 0}`, run: () => publishAll(app) });
      items.push({ ico: "down", label: "Volver a Desarrollo", run: () => setStage(app, "desarrollo") });
    }
    items.push({ sep: true });
  }
  items.push({ ico: "open", label: "Abrir", run: go(`app.html?app=${id}`) });
  if (can("data:import")) {
    items.push({ ico: "db", label: "Gestor de datos", run: go(`app.html?app=${id}#datos`) });
    items.push({ ico: "code", label: "Editor de carga de datos", run: go(`app.html?app=${id}#editor`) });
  }
  if (can("charts:edit")) items.push({ ico: "box", label: "Modelo lógico", run: go(`app.html?app=${id}#logico`) });
  items.push({ ico: "doc", label: "Informes", run: go(`app.html?app=${id}#informes`) });
  const more = [];
  if (can("charts:edit")) more.push({ ico: "notes", label: "Notas para agente", run: go(`notas.html?app=${id}`) });
  if (can("ml:run")) more.push({ ico: "brain", label: "Nuevo experimento de ML", run: go(`experimentos.html?new=1&app=${id}`) });
  if (can("connections:manage")) more.push({ ico: "plug", label: "Conexiones", run: go("conexiones.html") });
  if (can("embed:manage")) more.push({ ico: "embed", label: "Embedding", run: go("embedding.html") });
  if (more.length) items.push({ sep: true }, ...more);
  return items;
}

async function publishAll(app) {
  try {
    if (app.stage !== "produccion") await api.setAppStage(app.id, "produccion");
    const sheets = await api.listSheets(app.id);
    let n = 0;
    for (const s of sheets) {
      if (s.visibility !== "publica") { await api.setSheetVisibility(app.id, s.id, "publica"); n++; }
    }
    toast(`«${app.name}» en Producción · ${n ? `${n} ${n === 1 ? "hoja publicada" : "hojas publicadas"}` : "todas sus hojas ya estaban publicadas"}.`);
    changed();
  } catch (e) { toast(e.message, "err"); }
}

async function setStage(app, stage) {
  try { await api.setAppStage(app.id, stage); toast(`«${app.name}» vuelve a ${stage === "desarrollo" ? "Desarrollo" : stage}.`); changed(); }
  catch (e) { toast(e.message, "err"); }
}

/* ----------------------- Desplegable ----------------------- */
let pop = null;
function closePop() { if (pop) { pop.remove(); pop = null; } }

function openPop(btn, app) {
  closePop();
  const items = itemsFor(app);
  pop = document.createElement("div");
  pop.className = "ds-card-pop";
  pop.setAttribute("role", "menu");
  pop.innerHTML = `<div class="ds-card-pop-h" title="${app.name.replace(/"/g, "&quot;")}">${app.name.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]))}</div>` + items.map((it, i) =>
    it.sep ? `<div class="ds-card-pop-sep"></div>`
      : `<button type="button" role="menuitem" data-i="${i}">${ic(it.ico)}<span>${it.label}</span>${it.hint ? `<em>${it.hint}</em>` : ""}</button>`).join("");
  document.body.appendChild(pop);
  const r = btn.getBoundingClientRect();
  const w = pop.offsetWidth, h = pop.offsetHeight;
  pop.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w))}px`;
  pop.style.top = `${r.bottom + 6 + h > window.innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6}px`;
  pop.addEventListener("click", (e) => {
    const b = e.target.closest("[data-i]");
    if (!b) return;
    const it = items[+b.dataset.i];
    closePop();
    it.run();
  });
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-appmenu]");
  if (b) {
    e.preventDefault(); e.stopPropagation();
    if (pop && pop.dataset.for === b.dataset.appmenu) { closePop(); return; }
    const app = registry.get(b.dataset.appmenu);
    if (app) { openPop(b, app); pop.dataset.for = b.dataset.appmenu; }
    return;
  }
  if (pop && !pop.contains(e.target)) closePop();
}, true);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePop(); });
window.addEventListener("scroll", closePop, true);
window.addEventListener("resize", closePop);

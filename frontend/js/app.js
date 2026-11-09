// app.js — marco de la aplicación (in-app), estilo Qlik Sense.
//
// Lee ?app=<id>. La navegación se hace SOLO con el selector de vista de la barra
// superior, agrupado como en Qlik (Inicio / Analizar / Narrar / Preparar / Lógica
// de negocio), con atajos Alt+Shift+letra. Cada vista disponible es un módulo
// cargado de forma perezosa; las que aún no existen aparecen como "Próximamente".
// Todos los datos pasan por el backend (js/api.js).

import { svg } from "./hub-nav.js";
import { authService } from "./auth-service.js";
import { getApp } from "./api.js";
import { mountSheetMenu } from "./sheet-menu.js";

if (!authService.isAuthenticated()) location.replace("index.html");

const params = new URLSearchParams(location.search);
const APP_ID = params.get("app");
if (!APP_ID) location.replace("catalogo.html");

const VIEW_GROUPS = [
  { label: "Inicio", views: [{ key: "general", label: "General", icon: "home", shortcut: "O" }] },
  { label: "Analizar", views: [{ key: "hoja", label: "Hoja", icon: "pages", shortcut: "A", module: "./app-hoja.js" }] },
  {
    label: "Narrar",
    views: [
      { key: "narracion", label: "Narración", icon: "feed", shortcut: "Y" },
      { key: "informes", label: "Informes", icon: "catalog", shortcut: "R", module: "./app-informes.js" },
    ],
  },
  {
    label: "Ciencia de datos",
    views: [
      { key: "lab", label: "Laboratorio de ML", icon: "predict", shortcut: "L", module: "./app-lab.js" },
    ],
  },
  {
    label: "Preparar",
    views: [
      { key: "datos", label: "Gestor de datos", icon: "database", shortcut: "D", module: "./app-datos.js" },
      { key: "editor", label: "Editor de carga de datos", icon: "script", shortcut: "E", module: "./app-editor.js" },
      { key: "modelo", label: "Visor del modelo de datos", icon: "model", shortcut: "M", module: "./app-modelo.js" },
    ],
  },
  {
    label: "Lógica de negocio",
    views: [
      { key: "logico", label: "Modelo lógico", icon: "box", shortcut: "G", module: "./app-logico.js" },
      { key: "vocabulario", label: "Vocabulario", icon: "book", shortcut: "V" },
    ],
  },
];
const ALL_VIEWS = VIEW_GROUPS.flatMap((g) => g.views);
const DEFAULT_VIEW = "hoja";

const ctx = { appId: APP_ID, can: (perm) => authService.can(perm) };
let currentCleanup = null;
let sheetMenuCleanup = null;

// Puente entre la vista Hoja (que conoce la hoja activa) y el botón "···" del
// crumb. La vista llama registerSheetMenu(ctx) cuando está lista, y lo limpia al
// salir. Así el menú vive en el shell pero opera sobre el estado de la vista.
const crumbMenu = () => document.getElementById("crumbMenu");
window.__dsRegisterSheetMenu = (menuCtx) => {
  if (sheetMenuCleanup) { sheetMenuCleanup(); sheetMenuCleanup = null; }
  const host = crumbMenu();
  if (!host || !menuCtx) { if (host) host.hidden = true; return; }
  host.hidden = false;
  sheetMenuCleanup = mountSheetMenu(host, menuCtx);
};

/* ----------------------- Selector de vista ----------------------- */
function renderViewSelect(activeKey) {
  const host = document.getElementById("viewSelect");
  const active = ALL_VIEWS.find((v) => v.key === activeKey) || ALL_VIEWS.find((v) => v.key === DEFAULT_VIEW);
  host.innerHTML = `
    <button class="q-view-select-btn" id="viewSelectBtn" type="button" aria-haspopup="true" aria-expanded="false">
      <span class="q-view-select-label">${active.label}</span>
      <span class="q-view-select-caret">▾</span>
    </button>
    <div class="q-view-select-pop q-vs-grouped" id="viewSelectPop" hidden>
      ${VIEW_GROUPS.map((g) => `
        <div class="q-vs-group">${g.label}</div>
        ${g.views.map((v) => `
          <button class="q-view-select-row ${v.key === active.key ? "active" : ""} ${v.module ? "" : "soon"}"
                  type="button" data-key="${v.key}" ${v.module ? "" : "disabled"}
                  title="${v.module ? v.label : `${v.label}: Próximamente`}">
            <span class="q-view-select-ico">${svg(v.icon)}</span>
            <span class="q-vs-label">${v.label}</span>
            <span class="q-vs-key">${v.module ? `Alt + Shift + ${v.shortcut}` : "Próximamente"}</span>
          </button>`).join("")}`).join("")}
    </div>`;

  const btn = host.querySelector("#viewSelectBtn");
  const pop = host.querySelector("#viewSelectPop");
  const close = () => { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); };
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = pop.hidden;
    pop.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
  });
  pop.querySelectorAll("[data-key]:not([disabled])").forEach((row) =>
    row.addEventListener("click", () => { close(); location.hash = row.dataset.key; }));
  document.addEventListener("click", (e) => { if (!host.contains(e.target)) close(); });
}

// Atajos Alt+Shift+letra (solo vistas disponibles).
document.addEventListener("keydown", (e) => {
  if (!e.altKey || !e.shiftKey) return;
  const v = ALL_VIEWS.find((x) => x.module && x.shortcut === e.key.toUpperCase());
  if (v) { e.preventDefault(); location.hash = v.key; }
});

/* ----------------------- Menú de perfil ----------------------- */
function renderProfile() {
  const user = authService.current() || {};
  const avatar = document.getElementById("avatar");
  const pop = document.getElementById("profilePop");
  const initials = (user.name || user.email || "D").split(/[\s@.]+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  avatar.textContent = initials;
  pop.innerHTML = `
    <div class="q-prof-avatar">${initials}</div>
    <div class="q-prof-name">${user.name || "Usuario"}</div>
    <div class="q-prof-mail">${user.email || ""}</div>
    <button class="q-prof-cfg" disabled title="Próximamente">Configuración</button>
    <div class="q-prof-row">Rol: <strong>${user.role || "-"}</strong></div>
    <button class="q-prof-item" id="profCatalog">Ir al catálogo</button>
    <button class="q-prof-item" id="profLogout">Cerrar sesión</button>`;
  avatar.addEventListener("click", (e) => {
    e.stopPropagation();
    pop.hidden = !pop.hidden;
    avatar.setAttribute("aria-expanded", String(!pop.hidden));
  });
  document.addEventListener("click", (e) => { if (!pop.contains(e.target) && e.target !== avatar) pop.hidden = true; });
  pop.querySelector("#profCatalog").addEventListener("click", () => { location.href = "catalogo.html"; });
  pop.querySelector("#profLogout").addEventListener("click", () => { authService.logout(); location.replace("index.html"); });
}

/* ----------------------- Router ----------------------- */
async function showView(key) {
  const view = ALL_VIEWS.find((v) => v.key === key && v.module) || ALL_VIEWS.find((v) => v.key === DEFAULT_VIEW);
  renderViewSelect(view.key);
  const mount = document.getElementById("appView");
  mount.dataset.view = view.key;

  if (typeof currentCleanup === "function") {
    try { currentCleanup(); } catch {}
    currentCleanup = null;
  }
  // Oculta el menú "···" de la hoja; la vista Hoja lo re-registra si aplica.
  window.__dsRegisterSheetMenu(null);
  mount.innerHTML = `<p style="color:var(--q-muted);padding:18px 26px;">Cargando ${view.label.toLowerCase()}…</p>`;

  try {
    const mod = await import(view.module);
    mount.innerHTML = "";
    const cleanup = await mod.render(mount, ctx);
    if (typeof cleanup === "function") currentCleanup = cleanup;
  } catch (err) {
    mount.innerHTML = `<p style="color:#c0392b;padding:18px 26px;">No se pudo cargar la vista: ${err.message}</p>`;
    console.error(err);
  }
}

function currentKey() {
  const hash = (location.hash || "").replace(/^#/, "");
  // Compatibilidad con enlaces viejos a #analizar.
  if (hash === "analizar") return "hoja";
  return ALL_VIEWS.some((v) => v.key === hash && v.module) ? hash : DEFAULT_VIEW;
}

window.addEventListener("hashchange", () => showView(currentKey()));

async function boot() {
  try {
    const app = await getApp(APP_ID);
    document.getElementById("appName").textContent = app.name || "Aplicación";
    document.title = `DataSense · ${app.name || "Aplicación"}`;
    ctx.app = app;
  } catch (err) {
    document.getElementById("appView").innerHTML =
      `<p style="color:#c0392b;padding:18px 26px;">No se pudo abrir la aplicación: ${err.message}</p>`;
    return;
  }
  document.getElementById("appsBtn").addEventListener("click", () => { location.href = "catalogo.html"; });
  renderProfile();
  showView(currentKey());
}

boot();

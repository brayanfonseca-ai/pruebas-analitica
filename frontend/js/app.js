// app.js — marco de la aplicación (in-app), estilo Qlik Sense.
//
// Lee ?app=<id>. La navegación se hace SOLO con el selector de vista de la barra
// superior, agrupado como en Qlik (Inicio / Analizar / Narrar / Preparar / Lógica
// de negocio), con atajos Alt+Shift+letra. Cada vista disponible es un módulo
// cargado de forma perezosa; las que aún no existen aparecen como "Próximamente".
// Todos los datos pasan por el backend (js/api.js).

import { svg } from "./hub-nav.js";
import { authService } from "./auth-service.js";
import { getApp, setAppStage } from "./api.js";
import { mountSheetMenu } from "./sheet-menu.js";

if (!authService.isAuthenticated()) location.replace("index.html");

const params = new URLSearchParams(location.search);
const APP_ID = params.get("app");
if (!APP_ID) location.replace("catalogo.html");

// «perm»: permiso que exige la vista. Quien no lo tiene ni la ve en el selector (el servidor también lo exige).
const VIEW_GROUPS = [
  { label: "Analizar", views: [{ key: "hoja", label: "Hoja", icon: "pages", shortcut: "A", module: "./app-hoja.js" }] },
  { label: "Narrar", views: [{ key: "informes", label: "Informes", icon: "catalog", shortcut: "R", module: "./app-informes.js" }] },
  {
    label: "Ciencia de datos",
    views: [{ key: "lab", label: "Experimentos de ML", icon: "predict", shortcut: "L", module: "./app-lab.js", perm: "ml:run" }],
  },
  {
    label: "Preparar",
    views: [
      { key: "datos", label: "Gestor de datos", icon: "database", shortcut: "D", module: "./app-datos.js", perm: "data:import" },
      { key: "editor", label: "Editor de carga de datos", icon: "script", shortcut: "E", module: "./app-editor.js", perm: "data:import" },
      { key: "modelo", label: "Visor del modelo de datos", icon: "model", shortcut: "M", module: "./app-modelo.js", perm: "data:import" },
    ],
  },
  {
    label: "Lógica de negocio",
    views: [{ key: "logico", label: "Modelo lógico", icon: "box", shortcut: "G", module: "./app-logico.js", perm: "charts:edit" }],
  },
];
const allowed = (v) => !v.perm || authService.can(v.perm);
const VISIBLE_GROUPS = VIEW_GROUPS.map((g) => ({ ...g, views: g.views.filter(allowed) })).filter((g) => g.views.length);
const ALL_VIEWS = VISIBLE_GROUPS.flatMap((g) => g.views);
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
      ${VISIBLE_GROUPS.map((g) => `
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
    <div class="q-prof-row">Rol: <strong>${user.role || "-"}</strong></div>
    <button class="q-prof-item" id="profCatalog">Ir al catálogo</button>
    <button class="q-prof-item" id="profAccount">Mi cuenta</button>
    <button class="q-prof-item" id="profLogout">Cerrar sesión</button>`;
  avatar.addEventListener("click", (e) => {
    e.stopPropagation();
    pop.hidden = !pop.hidden;
    avatar.setAttribute("aria-expanded", String(!pop.hidden));
  });
  document.addEventListener("click", (e) => { if (!pop.contains(e.target) && e.target !== avatar) pop.hidden = true; });
  pop.querySelector("#profCatalog").addEventListener("click", () => { location.href = "catalogo.html"; });
  pop.querySelector("#profAccount").addEventListener("click", () => { location.href = "configuracion.html?tab=cuenta"; });
  pop.querySelector("#profLogout").addEventListener("click", () => { authService.logout(); location.replace("index.html"); });
}

/* ----------------------- Etapa de la app (Personal · Desarrollo · Producción) ----------------------- */
const STAGES = [
  { id: "personal", label: "Personal", desc: "Solo la ves tú" },
  { id: "desarrollo", label: "Desarrollo", desc: "El equipo técnico construye y prueba" },
  { id: "produccion", label: "Producción", desc: "Publicada: los visualizadores ven las hojas publicadas" },
];

/** Sustituye el «Personal» fijo de la miga por la etapa real, con selector si el usuario puede cambiarla. */
function mountStageChip(app) {
  const host = document.querySelector(".q-app-space");
  if (!host) return;
  const stageOf = (id) => STAGES.find((s) => s.id === id) || STAGES[0];
  const canChange = (target) => {
    const touchesProd = target === "produccion" || app.stage === "produccion";
    return touchesProd ? authService.can("apps:publish") : authService.can("charts:edit");
  };
  const editable = STAGES.some((s) => s.id !== app.stage && canChange(s.id));
  host.className = `q-app-space ds-stage ${app.stage}`;
  host.title = stageOf(app.stage).desc;
  const label = `<span class="ds-stage-dot"></span>${stageOf(app.stage).label}${editable ? ' <span class="ds-stage-caret">▾</span>' : ""}`;
  host.innerHTML = label;
  if (!editable) return;
  host.tabIndex = 0;
  host.setAttribute("role", "button");
  host.style.cursor = "pointer";
  const pop = document.createElement("div");
  pop.className = "ds-stage-pop";
  pop.hidden = true;
  document.body.appendChild(pop);
  const close = () => { pop.hidden = true; };
  const render = () => {
    pop.innerHTML = `<div class="ds-stage-pop-h">Etapa de la aplicación</div>` + STAGES.map((s) => {
      const dis = s.id === app.stage || !canChange(s.id);
      return `<button type="button" class="ds-stage-opt ${s.id === app.stage ? "on" : ""}" data-s="${s.id}" ${dis ? "disabled" : ""}>
        <span class="ds-stage ${s.id}"><span class="ds-stage-dot"></span>${s.label}</span><small>${s.desc}${!dis || s.id === app.stage ? "" : " · requiere permiso"}</small></button>`;
    }).join("") + `<div class="ds-stage-note">Las hojas se publican por separado (menú «···» de la hoja). Un visualizador solo ve apps en Producción y sus hojas publicadas.</div>`;
  };
  const open = () => {
    render();
    const r = host.getBoundingClientRect();
    pop.style.top = `${r.bottom + 8}px`;
    pop.style.left = `${Math.max(8, r.left)}px`;
    pop.hidden = false;
  };
  host.addEventListener("click", (e) => { e.stopPropagation(); pop.hidden ? open() : close(); });
  document.addEventListener("click", (e) => { if (!pop.contains(e.target)) close(); });
  pop.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-s]");
    if (!b || b.disabled) return;
    const target = b.dataset.s;
    if (target === "produccion" && !(app.published > 0) && !confirm("Esta app no tiene ninguna hoja publicada: los visualizadores la verán vacía. ¿Pasarla a Producción de todos modos?")) return;
    b.disabled = true;
    try {
      const updated = await setAppStage(APP_ID, target);
      Object.assign(app, updated);
      close();
      mountStageChip(app);
      pop.remove();
    } catch (err) {
      pop.querySelector(".ds-stage-note").textContent = err.message;
      pop.querySelector(".ds-stage-note").classList.add("err");
      b.disabled = false;
    }
  });
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
    mountStageChip(app);
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

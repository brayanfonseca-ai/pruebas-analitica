// inicio.js — vista Inicio estilo hub de Qlik (maqueta funcional de la pantalla).
// El chrome (sidebar/topbar) ahora vive centralizado en js/hub-nav.js.

import { renderNav, wireAppsButton, renderProfileMenu, svg } from "./hub-nav.js";
import { authService } from "./auth-service.js";
import { listApps } from "./api.js";

// Guard de sesión: sin sesión válida -> login.
if (!authService.isAuthenticated()) {
  location.replace("index.html");
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d) ? esc(iso) : d.toLocaleDateString("es", { year: "numeric", month: "short", day: "numeric" });
}

function appCard(a) {
  return `
    <a class="q-home-card" href="app.html?app=${encodeURIComponent(a.id)}">
      <div class="q-home-thumb">${svg("analyze")}</div>
      <div class="q-home-body">
        <div class="q-home-name" title="${esc(a.name)}">${esc(a.name)}</div>
        <div class="q-home-meta"><span class="ds-stage ${esc(a.stage)}"><span class="ds-stage-dot"></span>${esc({ personal: "Personal", desarrollo: "Desarrollo", produccion: "Producción" }[a.stage] || a.stage)}</span> · ${fmtDate(a.created_at)}</div>
      </div>
    </a>`;
}

/* ----------------------- Apps reales en Inicio ----------------------- */
async function renderHome() {
  const recent = document.getElementById("recentGrid");
  const explore = document.getElementById("exploreGrid");
  if (!recent || !explore) return;
  recent.innerHTML = explore.innerHTML = `<p class="q-muted" style="color:var(--q-muted);padding:8px">Cargando…</p>`;
  try {
    const apps = await listApps();
    // "Recientes": las últimas por fecha de creación; "Explorar": el resto.
    const sorted = [...apps].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const recents = sorted.slice(0, 4);
    const rest = sorted.slice(4);
    const empty = (txt) => `<div class="q-empty"><svg viewBox="0 0 24 24" class="q-empty-ico"><rect x="3" y="12" width="4" height="8"/><rect x="10" y="7" width="4" height="13"/><rect x="17" y="3" width="4" height="17"/></svg><p class="q-empty-title">${txt}</p></div>`;
    recent.innerHTML = recents.length ? recents.map(appCard).join("") : empty("Aún no hay aplicaciones para ti. Un visualizador ve las que se publican en Producción.");
    explore.innerHTML = rest.length ? rest.map(appCard).join("") : (recents.length ? `<p class="q-muted" style="color:var(--q-muted);padding:8px">No hay más aplicaciones para explorar.</p>` : empty("Aún no hay aplicaciones para explorar."));
  } catch (e) {
    recent.innerHTML = `<p style="color:#c0392b;padding:8px">No se pudieron cargar las aplicaciones: ${esc(e.message)}</p>`;
    explore.innerHTML = "";
  }
}

/* ----------------------- Saludo según la hora ----------------------- */
function renderGreeting() {
  const user = authService.current();
  const name = user?.name || "Usuario";
  const h = new Date().getHours();
  const saludo = h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
  const greetEl = document.getElementById("greeting");
  if (greetEl) greetEl.textContent = `${saludo}, ${name}.`;
  const avatarEl = document.getElementById("avatar");
  if (avatarEl) avatarEl.textContent = name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

/* ----------------------- Arranque ----------------------- */
renderNav("nav", { active: "inicio" });
wireAppsButton();
renderProfileMenu(authService);
renderGreeting();
renderHome();

// catalogo.js — lista/crea/abre aplicaciones. Las apps viven en el backend
// (FEAT-002); aquí solo transportamos via js/api.js. Reutiliza el chrome del hub.

import { renderNav, wireAppsButton, renderProfileMenu } from "./hub-nav.js";
import { authService } from "./auth-service.js";
import { listApps, createApp, deleteApp } from "./api.js";

// Guard de sesión.
if (!authService.isAuthenticated()) {
  location.replace("index.html");
}

const grid = document.getElementById("appsGrid");
const searchInput = document.getElementById("searchInput");
let apps = [];

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return esc(iso);
  return d.toLocaleDateString("es", { year: "numeric", month: "short", day: "numeric" });
}

function appCardHtml(a) {
  return `
    <article class="q-create-card" data-id="${esc(a.id)}">
      <div class="q-create-card-head">
        <span class="q-create-ico">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
            stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="3" fill="currentColor" fill-opacity=".15"/><path d="M3 9h18M9 9v12"/>
          </svg>
        </span>
        ${authService.can("apps:delete") ? `<button class="q-create-add" title="Eliminar" data-del="${esc(a.id)}">✕</button>` : ""}
      </div>
      <h3 class="q-create-card-title" title="${esc(a.name)}">${esc(a.name)}</h3>
      <p class="q-create-card-desc"><span class="ds-stage ${esc(a.stage)}"><span class="ds-stage-dot"></span>${esc(STAGE_LABEL[a.stage] || a.stage)}</span>
        ${a.sheets ? ` ${a.published}/${a.sheets} hojas publicadas` : " Sin hojas"}</p>
      <p class="q-create-card-desc">${a.owner_name ? `${esc(a.owner_name)} · ` : ""}Creada: ${fmtDate(a.created_at)}</p>
      <a href="app.html?app=${encodeURIComponent(a.id)}" class="q-create-more">Abrir aplicación →</a>
    </article>`;
}

const STAGE_LABEL = { personal: "Personal", desarrollo: "Desarrollo", produccion: "Producción" };
// Filtros reales: etapa (Personal · Desarrollo · Producción) y «solo mías».
const catFilter = { stage: "", mine: false };

function render() {
  const q = (searchInput?.value || "").trim().toLowerCase();
  const me = authService.current()?.userId;
  const filtered = apps.filter((a) =>
    (!q || (a.name || "").toLowerCase().includes(q)) &&
    (!catFilter.stage || a.stage === catFilter.stage) &&
    (!catFilter.mine || a.owner_id === me));
  if (!filtered.length) {
    const canCreate = authService.can("apps:create");
    grid.innerHTML = `<p style="color:var(--q-muted);">${apps.length
      ? "Ninguna aplicación coincide con el filtro."
      : canCreate ? "No hay aplicaciones todavía. Pulsa “Crear aplicación” para empezar."
        : "Todavía no hay aplicaciones publicadas para ti. Cuando un administrador publique una en Producción, aparecerá aquí."}</p>`;
    return;
  }
  grid.innerHTML = filtered.map(appCardHtml).join("");
}

document.getElementById("stageFilter")?.addEventListener("click", (e) => {
  const b = e.target.closest("[data-stage]");
  if (!b) return;
  catFilter.stage = b.dataset.stage;
  document.querySelectorAll("#stageFilter .ds-stage-f").forEach((x) => x.classList.toggle("on", x === b));
  render();
});
document.getElementById("onlyMine")?.addEventListener("change", (e) => { catFilter.mine = e.target.checked; render(); });
if (!authService.can("apps:create")) document.getElementById("newAppBtn")?.remove();

async function load() {
  grid.innerHTML = `<p style="color:var(--q-muted);">Cargando…</p>`;
  try {
    apps = await listApps();
    render();
  } catch (err) {
    grid.innerHTML = `<p style="color:#c0392b;">Error al cargar aplicaciones: ${esc(err.message)}</p>`;
  }
}

/* ----------------------- Abrir / eliminar ----------------------- */
grid.addEventListener("click", async (e) => {
  const delBtn = e.target.closest("[data-del]");
  if (delBtn) {
    e.preventDefault();
    const id = delBtn.getAttribute("data-del");
    const app = apps.find((a) => a.id === id);
    if (!confirm(`¿Eliminar la aplicación "${app?.name || id}" y todos sus datos?`)) return;
    try {
      await deleteApp(id);
      apps = apps.filter((a) => a.id !== id);
      render();
    } catch (err) {
      alert("No se pudo eliminar: " + err.message);
    }
    return;
  }
  const card = e.target.closest(".q-create-card");
  if (card && !e.target.closest("a")) {
    location.href = `app.html?app=${encodeURIComponent(card.dataset.id)}`;
  }
});

/* ----------------------- Modal crear ----------------------- */
const modal = {
  backdrop: document.getElementById("createBackdrop"),
  name: document.getElementById("appName"),
  status: document.getElementById("createStatus"),
};

function openModal() {
  modal.name.value = "";
  modal.status.textContent = "";
  modal.backdrop.hidden = false;
  modal.name.focus();
}
function closeModal() { modal.backdrop.hidden = true; }

document.getElementById("newAppBtn")?.addEventListener("click", openModal);
document.getElementById("createX").addEventListener("click", closeModal);
document.getElementById("createCancel").addEventListener("click", closeModal);
modal.backdrop.addEventListener("click", (e) => { if (e.target === modal.backdrop) closeModal(); });
modal.name.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(); });
document.getElementById("createCommit").addEventListener("click", commit);

async function commit() {
  const name = modal.name.value.trim();
  if (!name) { modal.status.textContent = "Ingresa un nombre."; modal.status.style.color = "#c0392b"; return; }
  modal.status.textContent = "Creando…";
  modal.status.style.color = "";
  try {
    const app = await createApp(name);
    location.href = `app.html?app=${encodeURIComponent(app.id)}`;
  } catch (err) {
    modal.status.textContent = "Error: " + err.message;
    modal.status.style.color = "#c0392b";
  }
}

searchInput?.addEventListener("input", render);

/* ----------------------- Arranque ----------------------- */
renderNav("nav", { active: "catalogo" });
wireAppsButton();
renderProfileMenu(authService);
load();

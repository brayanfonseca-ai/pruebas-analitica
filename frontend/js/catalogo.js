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
        <button class="q-create-add" title="Eliminar" data-del="${esc(a.id)}">✕</button>
      </div>
      <h3 class="q-create-card-title" title="${esc(a.name)}">${esc(a.name)}</h3>
      <p class="q-create-card-desc">Creada: ${fmtDate(a.created_at)}</p>
      <a href="app.html?app=${encodeURIComponent(a.id)}" class="q-create-more">Abrir aplicación →</a>
    </article>`;
}

// Filtros activos (replican los desplegables de Qlik; en DataSense el único
// tipo con datos reales es "Aplicaciones", por eso al elegir otro tipo no hay
// resultados — honesto, no inventa contenido).
const catFilter = { type: null, owner: "any" };

const CONTENT_TYPES = [
  "Aplicaciones", "Asistentes", "Automatizaciones", "Bases de conocimientos",
  "Conjuntos de datos", "Contratos de API", "Enlaces", "Experimentos de ML",
  "Flujos de datos", "Glosarios", "Gráficos", "Implementaciones de ML",
  "Notas", "Productos de datos", "Recetas de tabla", "Scripts",
];

let catMenu = null;
function closeCatMenu() { if (catMenu) { catMenu.remove(); catMenu = null; } }
document.addEventListener("pointerdown", (e) => { if (catMenu && !catMenu.contains(e.target) && !e.target.closest("[data-cat-filter]")) closeCatMenu(); }, true);

function openCatMenu(anchor, html, onMount) {
  closeCatMenu();
  const m = document.createElement("div");
  m.className = "q-dropdown";
  m.innerHTML = html;
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  m.style.left = `${r.left}px`;
  m.style.top = `${r.bottom + 4}px`;
  catMenu = m;
  if (onMount) onMount(m);
}

function wireCatFilters() {
  document.querySelectorAll("[data-cat-filter]").forEach((chip) => {
    chip.addEventListener("click", (e) => {
      e.stopPropagation();
      const kind = chip.dataset.catFilter;
      if (kind === "tipos") {
        openCatMenu(chip, `<div class="q-dd-list">${CONTENT_TYPES.map((t) =>
          `<label class="q-dd-check"><input type="radio" name="cattype" value="${esc(t)}" ${catFilter.type === t ? "checked" : ""}/> <span>${esc(t)}</span></label>`).join("")}</div>`,
          (m) => m.querySelectorAll('input[name="cattype"]').forEach((r) => r.addEventListener("change", () => { catFilter.type = r.value; closeCatMenu(); render(); })));
      } else if (kind === "propietario") {
        openCatMenu(chip, `<div class="q-dd-pad">
          <input class="q-dd-search" placeholder="Buscar usuarios" />
          ${[["any", "Cualquiera"], ["me", "Tú"], ["others", "Otros"]].map(([v, l]) =>
            `<label class="q-dd-radio"><input type="radio" name="catowner" value="${v}" ${catFilter.owner === v ? "checked" : ""}/> <span>${l}</span></label>`).join("")}</div>`,
          (m) => m.querySelectorAll('input[name="catowner"]').forEach((r) => r.addEventListener("change", () => { catFilter.owner = r.value; closeCatMenu(); render(); })));
      } else if (kind === "espacios") {
        openCatMenu(chip, `<div class="q-dd-pad"><label class="q-dd-radio"><input type="radio" name="catspace" checked/> <span>Todos</span></label>
          <label class="q-dd-radio"><input type="radio" name="catspace"/> <span>Personal</span></label></div>`);
      } else {
        catFilter.type = null; catFilter.owner = "any"; render();
      }
    });
  });
}

function render() {
  const q = (searchInput?.value || "").trim().toLowerCase();
  let filtered = q ? apps.filter((a) => (a.name || "").toLowerCase().includes(q)) : apps;
  // Tipo: solo "Aplicaciones" tiene contenido real; otros tipos → sin resultados.
  if (catFilter.type && catFilter.type !== "Aplicaciones") filtered = [];
  // Propietario "Otros" → nada (todas son del usuario local).
  if (catFilter.owner === "others") filtered = [];
  if (!filtered.length) {
    grid.innerHTML = `<p style="color:var(--q-muted);">No hay aplicaciones todavía. Pulsa “Crear aplicación” para empezar.</p>`;
    return;
  }
  grid.innerHTML = filtered.map(appCardHtml).join("");
}

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

document.getElementById("newAppBtn").addEventListener("click", openModal);
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
wireCatFilters();
load();

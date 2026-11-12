// hub-nav.js — chrome centralizado del hub (sidebar + topbar) reutilizado por
// inicio.js, crear.js y catalogo.js. Antes el NAV/ICON/svg()/renderNav() estaban
// DUPLICADOS en cada página; aquí viven una sola vez.
//
// NOTA: se ELIMINA el item de nivel superior "Editor de carga de datos": según el
// brief, el editor de carga ya no es un menú global, vive DENTRO de una aplicación
// (app.html -> sub-vista "Editor de carga"). Se agrega el item "Catálogo".

import { authService as _auth } from "./auth-service.js";

// Menú lateral. Cada entrada apunta a su página destino; las que no tienen página propia se sirven por
// el shell genérico hub.html?page=<key>. «perm» oculta la opción a quien no tiene ese permiso;
// «spacer» empuja lo siguiente (Temas y Configuración) al pie del menú.
export const NAV = [
  { key: "inicio", label: "Inicio", icon: "home", href: "inicio.html" },
  { key: "crear", label: "Crear", icon: "plus", href: "crear.html", perm: "apps:create" },
  { key: "colecciones", label: "Colecciones", icon: "book", href: "hub.html?page=colecciones" },
  { key: "catalogo", label: "Catálogo", icon: "catalog", href: "catalogo.html" },
  { divider: true },
  { key: "analizar", label: "Analizar", icon: "analyze", href: "hub.html?page=analizar" },
  { key: "prediccion", label: "Experimentos de ML", icon: "predict", href: "experimentos.html", perm: "ml:run" },
  { divider: true },
  { key: "conexiones", label: "Conexiones", icon: "plug", href: "conexiones.html", perm: "connections:manage" },
  { key: "notas", label: "Notas para agente", icon: "notes", href: "notas.html", perm: "charts:edit" },
  { key: "embedding", label: "Embedding", icon: "embed", href: "embedding.html", perm: "embed:manage" },
  { spacer: true },
  { divider: true },
  { key: "temas", label: "Temas", icon: "theme", href: "hub.html?page=temas" },
  { key: "configuracion", label: "Configuración", icon: "settings", href: "configuracion.html", perm: "users:manage" },
];

/* ------------------------------------------------------------------------
   Set de iconos corporativo «duotono»: trazo fino de 1.7 px (currentColor) con el
   cuerpo principal rellenado al 15 % (DUO). Cuadrícula de 24 px, esquinas redondeadas.
   Es el único set de iconos de navegación: lo usan el menú lateral, el selector de
   vista de la app, las tarjetas de Crear y los accesos del hub.
   ------------------------------------------------------------------------ */
export const DUO = 'fill="currentColor" fill-opacity=".15"';
const D = DUO;
/** Cerebro (IA / Machine Learning): dos hemisferios con circuitos neuronales. */
export const BRAIN =
  `<path ${D} d="M12 4.6C12 3.4 11 2.6 9.9 2.6 8.4 2.6 7.3 3.7 7.3 5.1 5.6 5.3 4.4 6.7 4.4 8.4c0 .8.3 1.5.7 2.1C4.4 11.1 4 12 4 13c0 1.5.9 2.7 2.2 3.2 0 2.1 1.5 3.6 3.3 3.6 1.4 0 2.5-.8 2.5-2.2z"/>` +
  `<path ${D} d="M12 4.6c0-1.2 1-2 2.1-2 1.5 0 2.6 1.1 2.6 2.5 1.7.2 2.9 1.6 2.9 3.3 0 .8-.3 1.5-.7 2.1.7.6 1.1 1.5 1.1 2.5 0 1.5-.9 2.7-2.2 3.2 0 2.1-1.5 3.6-3.3 3.6-1.4 0-2.5-.8-2.5-2.2z"/>` +
  '<path d="M7.6 9.6H10M7.2 13.2h3.2M16.4 9.6H14M16.8 13.2h-3.2"/><circle cx="7.6" cy="9.6" r=".7" fill="currentColor"/><circle cx="16.4" cy="9.6" r=".7" fill="currentColor"/>';

export const ICON = {
  home: `<path ${D} d="M4 11 12 4l8 7v8.5a.5.5 0 0 1-.5.5h-15a.5.5 0 0 1-.5-.5z"/><path d="M10 20v-5.5h4V20"/>`,
  pages: `<rect ${D} x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18M8.5 9v11"/>`,
  plus: `<circle ${D} cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>`,
  script: '<path d="m8 7-5 5 5 5M16 7l5 5-5 5M13.6 5 10.4 19"/>',
  feed: `<path ${D} d="M12 3 3 8l9 5 9-5z"/><path d="m3 12.5 9 5 9-5M3 16.5l9 5 9-5"/>`,
  star: `<path ${D} d="m12 3.2 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z"/>`,
  book: `<path ${D} d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3M9.5 7.5h6"/>`,
  catalog: `<rect ${D} x="5" y="3" width="14" height="18" rx="2.2"/><path d="M9 8h6M9 12h6M9 16h3.5"/>`,
  market: `<path ${D} d="M4.5 8.5h15l-1 11.2a.8.8 0 0 1-.8.8H6.3a.8.8 0 0 1-.8-.8z"/><path d="M8.5 8.5V7a3.5 3.5 0 0 1 7 0v1.5"/>`,
  box: `<path ${D} d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12v9M4 7.5l8 4.5 8-4.5"/>`,
  check: `<path ${D} d="M12 3 4.5 6v5.5c0 4.4 3 7.6 7.5 9.5 4.5-1.9 7.5-5.1 7.5-9.5V6z"/><path d="m8.8 12 2.2 2.2 4.2-4.4"/>`,
  analyze: `<rect ${D} x="3" y="3" width="18" height="18" rx="3"/><path d="M8 16v-4M12 16V8M16 16v-6"/>`,
  prepare: `<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle ${D} cx="15" cy="7" r="2.3"/><circle ${D} cx="9" cy="17" r="2.3"/>`,
  predict: BRAIN,
  assist: `<rect ${D} x="4" y="8" width="16" height="11.5" rx="3.5"/><path d="M12 8V5.2M2.5 12.5v3M21.5 12.5v3"/><circle cx="12" cy="4" r="1.3"/><circle cx="9" cy="13.5" r="1.1" fill="currentColor"/><circle cx="15" cy="13.5" r="1.1" fill="currentColor"/><path d="M9.5 17h5"/>`,
  auto: `<path ${D} d="M13.2 3 5 13.4h6L9.8 21 19 10.4h-6.2z"/>`,
  alert: `<path ${D} d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z"/><path d="M10 20.6a2 2 0 0 0 4 0"/>`,
  sub: `<rect ${D} x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3.6 7.2 8.4 6 8.4-6"/>`,
  theme: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" fill-opacity=".4"/>',
  info: `<circle ${D} cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="8" r=".9" fill="currentColor"/>`,
  settings: `<path ${D} d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 4.6 15H4a2 2 0 0 1 0-4h.1A1.6 1.6 0 0 0 5.6 7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 11 4.6V4a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.6 1.6 0 0 0 21 11h.1a2 2 0 0 1 0 4H21z"/><circle cx="12" cy="12" r="3"/>`,
  users: `<circle ${D} cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.7a3.5 3.5 0 0 1 0 6.6M18 14.2A6.5 6.5 0 0 1 21.5 20"/>`,
  trash: `<path ${D} d="M6 7h12l-1 12.2a1.6 1.6 0 0 1-1.6 1.4H8.6A1.6 1.6 0 0 1 7 19.2z"/><path d="M4 7h16M9.5 7V4.8A.8.8 0 0 1 10.3 4h3.4a.8.8 0 0 1 .8.8V7M10 11v6M14 11v6"/>`,
  lock: `<rect ${D} x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><circle cx="12" cy="15.5" r="1.2" fill="currentColor"/>`,
  rocket: `<path ${D} d="M12 3c3.5 1.5 5.5 5 5.5 9l-2 3h-7l-2-3c0-4 2-7.5 5.5-9z"/><circle cx="12" cy="9.5" r="1.7"/><path d="M9.5 15 8 19l4-1.5M14.5 15 16 19l-4-1.5"/>`,
  database: `<ellipse ${D} cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>`,
  plug: `<path ${D} d="M6.5 9h11v3.2a5.5 5.5 0 0 1-11 0z"/><path d="M9.5 3.5V9M14.5 3.5V9M12 17.7V21"/>`,
  notes: `<path ${D} d="M5 3.5h10.5L19 7v13a.5.5 0 0 1-.5.5h-13A.5.5 0 0 1 5 20z"/><path d="M15 3.5V7.5h4M8.5 12h7M8.5 15.5h4.5"/>`,
  embed: `<rect ${D} x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="m9.8 9.5-2.5 2.5 2.5 2.5M14.2 9.5l2.5 2.5-2.5 2.5"/>`,
  cloud: `<path ${D} d="M7.2 18.5a4.2 4.2 0 0 1-.7-8.3 5.6 5.6 0 0 1 10.8 1.2 3.6 3.6 0 0 1-.3 7.1z"/>`,
  bucket: `<ellipse ${D} cx="12" cy="6.5" rx="8" ry="2.8"/><path d="m4 6.5 1.7 11.7c.2 1.2 3 2.3 6.3 2.3s6.1-1.1 6.3-2.3L20 6.5"/>`,
  api: '<path d="m8 7-5 5 5 5M16 7l5 5-5 5M13.6 5 10.4 19"/>',
  share: `<circle ${D} cx="6" cy="12" r="2.6"/><circle ${D} cx="17.5" cy="6" r="2.6"/><circle ${D} cx="17.5" cy="18" r="2.6"/><path d="m8.3 10.8 6.9-3.6M8.3 13.2l6.9 3.6"/>`,
  copy: `<rect ${D} x="8.5" y="8.5" width="11.5" height="11.5" rx="2.2"/><path d="M15.5 8.5V6.2A2.2 2.2 0 0 0 13.3 4H6.2A2.2 2.2 0 0 0 4 6.2v7.1a2.2 2.2 0 0 0 2.2 2.2h2.3"/>`,
  key: `<circle ${D} cx="8" cy="15.5" r="4.2"/><path d="m11 12.5 8.5-8.5M16 7l2.5 2.5M14 9l2 2"/>`,
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v4.5h-4.5"/>',
  eye: `<path ${D} d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>`,
  model: `<circle ${D} cx="6" cy="6.5" r="2.8"/><circle ${D} cx="18" cy="6.5" r="2.8"/><circle ${D} cx="12" cy="18" r="2.8"/><path d="M8.4 8 10.7 15.3M15.6 8 13.3 15.3M8.8 6.5h6.4"/>`,
};

export function svg(name, cls = "") {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name] || ""}</svg>`;
}

/**
 * Renderiza el sidebar del hub en el elemento dado.
 * @param {HTMLElement|string} mountEl  nodo o id del contenedor <nav>
 * @param {{active?: string}} [opts]    key del item activo
 */
export function renderNav(mountEl, { active = "" } = {}) {
  const nav = typeof mountEl === "string" ? document.getElementById(mountEl) : mountEl;
  if (!nav) return;
  // Solo las opciones que el usuario puede usar (el servidor lo vuelve a comprobar). Se quitan separadores
  // sobrantes (al inicio, al final o repetidos) que quedan al ocultar opciones.
  const shown = NAV.filter((i) => i.divider || i.spacer || !i.perm || _auth.can(i.perm));
  const items = shown.filter((it, i, a) => {
    if (!it.divider) return true;
    const prev = a.slice(0, i).reverse().find((x) => !x.spacer);
    const next = a.slice(i + 1).find((x) => !x.spacer);
    return prev && next && !prev.divider && !next.divider;
  });
  nav.innerHTML = items.map((item) => {
    if (item.spacer) return `<div class="q-nav-spacer"></div>`;
    if (item.divider) return `<div class="q-nav-divider"></div>`;
    const isActive = item.key === active || item.active;
    return `
      <a class="q-nav-item ${isActive ? "active" : ""}" href="${item.href || "#"}" data-key="${item.key}">
        <span class="q-nav-ico">${svg(item.icon)}</span>
        <span class="q-nav-label">${item.label}</span>
        ${item.preview ? `<span class="q-nav-preview">Vista preliminar</span>` : ""}
        ${item.badge ? `<span class="q-nav-badge">${item.badge}</span>` : ""}
      </a>`;
  }).join("");
}

/** Hace que el botón de 9 puntos (#appsBtn) navegue al catálogo. */
export function wireAppsButton(id = "appsBtn") {
  const btn = document.getElementById(id);
  if (btn) btn.addEventListener("click", () => { location.href = "catalogo.html"; });
}

const _esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/**
 * Menú de perfil del avatar del topbar, compartido por TODAS las páginas del hub
 * (Inicio, Catálogo, Colecciones, Crear…). Antes solo existía dentro de una app
 * (app.js), por eso en el hub el avatar "no hacía nada" y no se podía cerrar
 * sesión. Ahora el avatar despliega perfil + "Cerrar sesión" en todo el hub.
 *
 * @param {object} authService  servicio de auth (current/logout)
 * @param {string} [avatarId="avatar"]
 */
export function renderProfileMenu(authService, avatarId = "avatar") {
  const avatar = document.getElementById(avatarId);
  if (!avatar) return;
  let user = {};
  try { user = authService.current() || {}; } catch {}
  const initials = (user.name || user.email || "D")
    .split(/[\s@.]+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  avatar.textContent = initials;
  avatar.style.cursor = "pointer";
  avatar.setAttribute("role", "button");
  avatar.setAttribute("aria-haspopup", "true");
  avatar.setAttribute("aria-expanded", "false");
  avatar.title = "Perfil y sesión";

  // Reusa un popup existente o crea uno (las páginas del hub no lo traen).
  let pop = document.getElementById("profilePop");
  if (!pop) {
    pop = document.createElement("div");
    pop.id = "profilePop";
    pop.className = "q-prof-pop";
    pop.hidden = true;
    document.body.appendChild(pop);
  }
  pop.innerHTML = `
    <div class="q-prof-avatar">${initials}</div>
    <div class="q-prof-name">${_esc(user.name || "Usuario")}</div>
    <div class="q-prof-mail">${_esc(user.email || "")}</div>
    <div class="q-prof-row">Rol: <strong>${_esc(user.role || "-")}</strong></div>
    <button class="q-prof-item" id="profHome">Inicio</button>
    <button class="q-prof-item" id="profCatalog">Ir al catálogo</button>
    <button class="q-prof-item" id="profAccount">Mi cuenta</button>
    <button class="q-prof-item danger" id="profLogout">Cerrar sesión</button>`;

  const place = () => {
    const r = avatar.getBoundingClientRect();
    pop.style.position = "fixed";
    pop.style.top = `${r.bottom + 8}px`;
    pop.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
    pop.style.left = "auto";
  };

  avatar.addEventListener("click", (e) => {
    e.stopPropagation();
    const show = pop.hidden;
    if (show) place();
    pop.hidden = !show;
    avatar.setAttribute("aria-expanded", String(show));
  });
  document.addEventListener("click", (e) => {
    if (!pop.hidden && !pop.contains(e.target) && e.target !== avatar) {
      pop.hidden = true; avatar.setAttribute("aria-expanded", "false");
    }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") pop.hidden = true; });

  pop.querySelector("#profHome")?.addEventListener("click", () => { location.href = "inicio.html"; });
  pop.querySelector("#profCatalog")?.addEventListener("click", () => { location.href = "catalogo.html"; });
  pop.querySelector("#profAccount")?.addEventListener("click", () => { location.href = "configuracion.html?tab=cuenta"; });
  pop.querySelector("#profLogout")?.addEventListener("click", () => {
    try { authService.logout(); } catch {}
    location.replace("index.html");
  });
}

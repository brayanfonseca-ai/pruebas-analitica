// hub-nav.js — chrome centralizado del hub (sidebar + topbar) reutilizado por
// inicio.js, crear.js y catalogo.js. Antes el NAV/ICON/svg()/renderNav() estaban
// DUPLICADOS en cada página; aquí viven una sola vez.
//
// NOTA: se ELIMINA el item de nivel superior "Editor de carga de datos": según el
// brief, el editor de carga ya no es un menú global, vive DENTRO de una aplicación
// (app.html -> sub-vista "Editor de carga"). Se agrega el item "Catálogo".

// Menú lateral que replica el de Qlik Analítica (mismo orden y nombres). Cada
// entrada apunta a su página destino. Las que ya tenían página propia
// (inicio/crear/catálogo) la conservan; el resto se sirven por el shell genérico
// hub.html?page=<key>. "preview" muestra la etiqueta «Vista preliminar».
export const NAV = [
  { key: "inicio", label: "Inicio", icon: "home", href: "inicio.html" },
  { key: "paginas", label: "Páginas", icon: "pages", href: "hub.html?page=paginas", preview: true },
  { key: "crear", label: "Crear", icon: "plus", href: "crear.html" },
  { key: "alimentar", label: "Alimentar", icon: "feed", href: "hub.html?page=alimentar" },
  { key: "favoritos", label: "Favoritos", icon: "star", href: "hub.html?page=favoritos" },
  { key: "colecciones", label: "Colecciones", icon: "book", href: "hub.html?page=colecciones" },
  { key: "catalogo", label: "Catálogo", icon: "catalog", href: "catalogo.html" },
  { key: "mercado", label: "Mercado de datos", icon: "market", href: "hub.html?page=mercado" },
  { key: "productos", label: "Productos de datos", icon: "box", href: "hub.html?page=productos" },
  { key: "calidad", label: "Calidad de los datos", icon: "check", href: "hub.html?page=calidad" },
  { divider: true },
  { key: "analizar", label: "Analizar", icon: "analyze", href: "hub.html?page=analizar" },
  { key: "preparar", label: "Preparar datos", icon: "prepare", href: "hub.html?page=preparar" },
  { key: "prediccion", label: "Predicción", icon: "predict", href: "hub.html?page=prediccion" },
  { key: "asistentes", label: "Asistentes", icon: "assist", href: "hub.html?page=asistentes" },
  { divider: true },
  { key: "automatizaciones", label: "Automatizaciones", icon: "auto", href: "hub.html?page=automatizaciones" },
  { key: "alertas", label: "Alertas", icon: "alert", href: "hub.html?page=alertas" },
  { key: "suscripciones", label: "Suscripciones", icon: "sub", href: "hub.html?page=suscripciones" },
  { key: "temas", label: "Temas", icon: "theme", href: "hub.html?page=temas" },
  { key: "informacion", label: "Información", icon: "info", href: "hub.html?page=informacion" },
];

export const ICON = {
  home: '<path d="M3 11 12 4l9 7"/><path d="M5 10v9h14v-9"/>',
  pages: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  script: '<path d="m8 6-5 6 5 6M16 6l5 6-5 6"/>',
  feed: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  star: '<path d="m12 3 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9 6.8 19l1-5.8L3.6 9.1l5.8-.8z"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19a2 2 0 0 1 2-2h13"/>',
  catalog: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/>',
  market: '<path d="M4 9h16l-1 11H5z"/><path d="M8 9V6a4 4 0 0 1 8 0v3"/>',
  box: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 3v18M4 7.5l8 4.5 8-4.5"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  analyze: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 15v-3M12 15V9M16 15v-5"/>',
  prepare: '<path d="M4 7h16M4 12h10M4 17h7"/><circle cx="18" cy="15" r="3"/>',
  predict: '<path d="M4 17c3-6 6-6 8-3s5 3 8-4"/><circle cx="20" cy="7" r="1.4" fill="currentColor"/>',
  assist: '<circle cx="12" cy="8" r="4"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  auto: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  alert: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  sub: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  theme: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="8" r="0.6" fill="currentColor"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  model: '<circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="18" r="3"/><path d="M8.5 7.5 11 15M15.5 7.5 13 15"/>',
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
  nav.innerHTML = NAV.map((item) => {
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
  pop.querySelector("#profLogout")?.addEventListener("click", () => {
    try { authService.logout(); } catch {}
    location.replace("index.html");
  });
}

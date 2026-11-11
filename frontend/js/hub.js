// hub.js — shell genérico de las páginas del menú lateral de DataSense,
// replicando las pantallas de Qlik Analítica (Páginas, Alimentar, Favoritos,
// Colecciones, Mercado de datos, Productos de datos, Calidad de los datos,
// Analizar, Preparar datos, Predicción, Asistentes).
//
// Cada página se describe de forma declarativa (título, tarjetas de creación,
// barra de filtros y estado vacío) y se renderiza según ?page=<key>. Las
// funciones enterprise que aún no tienen motor se marcan con «Próximamente».

import { renderNav, wireAppsButton, renderProfileMenu, svg, DUO as D, BRAIN } from "./hub-nav.js";
import { authService } from "./auth-service.js";

if (!authService.isAuthenticated()) location.replace("index.html");

const SOON = "Próximamente";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Tipos de contenido que Qlik muestra en el desplegable "Tipos" (fiel a la captura).
const CONTENT_TYPES = [
  "Aplicaciones", "Asistentes", "Automatizaciones", "Bases de conocimientos",
  "Conjuntos de datos", "Contratos de API", "Enlaces", "Experimentos de ML",
  "Flujos de datos", "Glosarios", "Gráficos", "Implementaciones de ML",
  "Notas", "Productos de datos", "Recetas de tabla", "Scripts",
];

// Espacios (fiel a la captura del Catálogo de Qlik).
const SPACES = {
  base: ["Todos", "Personal"],
  recientes: ["Pruebas Desarrollo IA"],
  compartidos: ["DESARROLLO", "DEV_MODELOS_IA", "TV_CONECT"],
  administrados: ["Pruebas Desarrollo IA", "Tv - Financiero", "Tv - Gestión Humana", "Tv - Operativo", "Tv - Refrigerada"],
};

/* -------------------------------------------------------------------------
   Desplegables de filtro reutilizables (abren bajo el chip, cierran al salir)
   ------------------------------------------------------------------------- */
let openMenuEl = null;
function closeMenu() { if (openMenuEl) { openMenuEl.remove(); openMenuEl = null; document.removeEventListener("pointerdown", onDocDown, true); } }
function onDocDown(e) { if (openMenuEl && !openMenuEl.contains(e.target) && !e.target.closest("[data-filter-chip]")) closeMenu(); }

function openDropdown(anchor, html, onMount) {
  closeMenu();
  const menu = document.createElement("div");
  menu.className = "q-dropdown";
  menu.innerHTML = html;
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.left = `${Math.min(r.left, window.innerWidth - menu.offsetWidth - 12)}px`;
  menu.style.top = `${r.bottom + 4}px`;
  openMenuEl = menu;
  setTimeout(() => document.addEventListener("pointerdown", onDocDown, true), 0);
  if (onMount) onMount(menu);
  return menu;
}

function typesMenu() {
  return `<div class="q-dd-list">${CONTENT_TYPES.map((t) => `
    <label class="q-dd-check"><input type="checkbox" data-type="${esc(t)}" /> <span>${esc(t)}</span></label>`).join("")}</div>`;
}
function ownerMenu() {
  return `<div class="q-dd-pad">
    <input class="q-dd-search" placeholder="Buscar usuarios" />
    <label class="q-dd-radio"><input type="radio" name="owner" value="any" checked /> <span>Cualquiera</span></label>
    <label class="q-dd-radio"><input type="radio" name="owner" value="me" /> <span>Tú</span></label>
    <label class="q-dd-radio"><input type="radio" name="owner" value="others" /> <span>Otros</span></label>
  </div>`;
}
function collectionTypeMenu(current = "todos") {
  return `<div class="q-dd-pad">
    ${[["todos", "Todos"], ["privado", "Privado"], ["publico", "Público"]].map(([v, l]) =>
      `<label class="q-dd-radio"><input type="radio" name="ctype" value="${v}" ${current === v ? "checked" : ""} /> <span>${l}</span></label>`).join("")}
  </div>`;
}
function spacesMenu() {
  const grp = (title, items) => `${title ? `<div class="q-dd-group">${esc(title)}</div>` : ""}${items.map((s) =>
    `<label class="q-dd-radio"><input type="radio" name="space" value="${esc(s)}" /> <span>${esc(s)}</span></label>`).join("")}`;
  return `<div class="q-dd-pad q-dd-scroll">
    ${grp("", SPACES.base)}
    ${grp("Vistos recientemente", SPACES.recientes)}
    ${grp("Compartidos", SPACES.compartidos)}
    ${grp("Administrados", SPACES.administrados)}
  </div>`;
}

/* Iconos extra para las tarjetas de creación (además de los de hub-nav). */
const EXTRA_ICON = {
  app: `<rect ${D} x="3" y="3" width="18" height="18" rx="3"/><path d="M8 16v-4M12 16V8M16 16v-6"/>`,
  ml: BRAIN,
  autoflow: `<circle ${D} cx="6.5" cy="6.5" r="3"/><circle ${D} cx="17.5" cy="17.5" r="3"/><path d="M9.5 6.5H15a2.5 2.5 0 0 1 2.5 2.5v5.5M6.5 9.5V15A2.5 2.5 0 0 0 9 17.5h5.5"/>`,
  conn: `<rect ${D} x="4" y="3.5" width="6" height="7" rx="1.6" transform="rotate(45 7 7)"/><rect ${D} x="14" y="13.5" width="6" height="7" rx="1.6" transform="rotate(45 17 17)"/><path d="m9.5 14.5 5-5"/>`,
  flow: `<rect ${D} x="3" y="3.5" width="7" height="5.5" rx="1.4"/><rect ${D} x="14" y="14.5" width="7" height="5.5" rx="1.4"/><path d="M6.5 9v3.5a3 3 0 0 0 3 3H14"/>`,
  note: `<path ${D} d="M5 4.5A1.5 1.5 0 0 1 6.5 3h11A1.5 1.5 0 0 1 19 4.5V15l-4.5 5.5h-8A1.5 1.5 0 0 1 5 19z"/><path d="M19 15h-3.5a1 1 0 0 0-1 1v4.5M9 8h6M9 11.5h6"/>`,
  upload: `<path ${D} d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15z"/><path d="M12 15V4.5M8 8.2l4-4 4 4"/>`,
  dataset: `<ellipse ${D} cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>`,
  recipe: `<rect ${D} x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M9 9.5V20M15 9.5V20"/>`,
  robot: `<rect ${D} x="4" y="8" width="16" height="11.5" rx="3.5"/><path d="M12 8V5.2M2.5 12.5v3M21.5 12.5v3"/><circle cx="12" cy="4" r="1.3"/><circle cx="9" cy="13.5" r="1.1" fill="currentColor"/><circle cx="15" cy="13.5" r="1.1" fill="currentColor"/><path d="M9.5 17h5"/>`,
  knowledge: `<path ${D} d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3M9.5 7.5h6M9.5 11h4"/>`,
};

function icon(name, cls = "") {
  if (EXTRA_ICON[name]) {
    return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${EXTRA_ICON[name]}</svg>`;
  }
  return svg(name, cls);
}

/* -------------------------------------------------------------------------
   Bloques reutilizables
   ------------------------------------------------------------------------- */
function createCards(cards) {
  return `<div class="q-create-grid">${cards.map((c) => `
    <article class="q-create-card ${c.soon ? "soon" : ""}" ${c.href ? `data-href="${esc(c.href)}"` : ""} ${c.soon ? `title="${SOON}"` : ""}>
      <div class="q-create-card-head">
        <span class="q-create-ico">${icon(c.icon)}</span>
        ${c.soon ? `<span class="q-chip">${SOON}</span>` : `<button class="q-create-add" title="Crear">+</button>`}
      </div>
      <h3 class="q-create-card-title">${esc(c.title)}</h3>
      <p class="q-create-card-desc">${esc(c.desc)}</p>
      <span class="q-create-more">Más información</span>
    </article>`).join("")}</div>`;
}

// filters: array de {label, kind} o string (kind = label en minúscula sin tilde).
function filterBar(filters, { search = true, right = "", searchId = "" } = {}) {
  const norm = (f) => (typeof f === "string" ? { label: f, kind: f.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") } : f);
  return `<div class="q-filterbar">
    ${search ? `<div class="q-filter-search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg><input ${searchId ? `id="${searchId}"` : ""} placeholder="Filtrar por nombre" /></div>` : ""}
    ${filters.map(norm).map((f) => `<button class="q-filter-chip" data-filter-chip data-kind="${esc(f.kind)}">${esc(f.label)} <span class="q-caret">▾</span></button>`).join("")}
    <div class="q-filterbar-right">${right}</div>
  </div>`;
}

/** Cablea los chips de filtro de una página a sus desplegables. */
function wireFilterChips(main, { onCollectionType, onSpace } = {}) {
  main.querySelectorAll("[data-filter-chip]").forEach((chip) => {
    if (chip.dataset.wired) return;
    chip.dataset.wired = "1";
    chip.addEventListener("click", (e) => {
      e.stopPropagation();
      const kind = chip.dataset.kind;
      if (kind === "tipos") openDropdown(chip, typesMenu());
      else if (kind === "propietario") openDropdown(chip, ownerMenu());
      else if (kind === "tipo") openDropdown(chip, collectionTypeMenu(), (menu) => {
        menu.querySelectorAll('input[name="ctype"]').forEach((r) => r.addEventListener("change", () => { if (r.checked && onCollectionType) onCollectionType(r.value); closeMenu(); }));
      });
      else if (kind === "espacios") openDropdown(chip, spacesMenu(), (menu) => {
        menu.querySelectorAll('input[name="space"]').forEach((r) => r.addEventListener("change", () => { if (r.checked && onSpace) onSpace(r.value); closeMenu(); }));
      });
      else if (kind === "todos los filtros") openAllFiltersPanel(main);
    });
  });
}

/** Panel lateral "Todos los filtros" (Tipos + Propietario), como en Qlik. */
function openAllFiltersPanel(main) {
  closeMenu();
  let panel = main.querySelector(".q-filters-panel");
  if (panel) { panel.remove(); return; }
  panel = document.createElement("aside");
  panel.className = "q-filters-panel";
  panel.innerHTML = `
    <div class="q-fp-head"><span>FILTROS</span><button class="q-fp-x" aria-label="Cerrar">✕</button></div>
    <button class="q-btn q-fp-clear">Borrar todos</button>
    <div class="q-fp-section"><div class="q-fp-title">Tipos</div>${typesMenu()}</div>
    <div class="q-fp-section"><div class="q-fp-title">Propietario</div>${ownerMenu()}</div>`;
  const body = main.querySelector(".q-page-body") || main;
  body.classList.add("with-filters");
  body.prepend(panel);
  panel.querySelector(".q-fp-x").addEventListener("click", () => { panel.remove(); body.classList.remove("with-filters"); });
  panel.querySelector(".q-fp-clear").addEventListener("click", () => panel.querySelectorAll("input[type=checkbox]").forEach((c) => (c.checked = false)));
}

function emptyState({ icon: ic = "empty", title, text, action }) {
  const ill = {
    feed: '<rect x="4" y="5" width="16" height="12" rx="1"/><path d="M7 15c2-4 4-4 5-2s3 2 5-3"/>',
    star: '<path d="m12 4 2 4 4 .5-3 3 .8 4.3L12 17.6 8.2 19.8 9 15.5l-3-3 4-.5z"/><path d="M5 6l1 1M19 6l-1 1"/>',
    book: '<path d="M4 5h11a2 2 0 0 1 2 2v12H6a2 2 0 0 0-2 2z"/><path d="M15 3v4"/>',
    shop: '<path d="M4 9h16l-1 11H5z"/><path d="M4 9l2-4h12l2 4"/><path d="M9 13h6"/>',
    chart: '<path d="M4 18c3-6 6-6 8-3s5 3 8-5"/><circle cx="6" cy="16" r="1.2"/><circle cx="18" cy="8" r="1.2"/>',
    empty: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 10h8M8 14h5"/>',
  }[ic] || '<rect x="4" y="5" width="16" height="14" rx="2"/>';
  return `<div class="q-empty big">
    <svg viewBox="0 0 24 24" class="q-empty-ico">${ill}</svg>
    <p class="q-empty-title">${esc(title)}</p>
    ${text ? `<p class="q-empty-text">${esc(text)}</p>` : ""}
    ${action ? `<button class="q-btn primary">${esc(action)}</button>` : ""}
  </div>`;
}

/* -------------------------------------------------------------------------
   Definición de cada página (fiel a las capturas de Qlik)
   ------------------------------------------------------------------------- */
const PAGES = {
  paginas: {
    title: "Páginas",
    preview: true,
    body: () => `
      <div class="q-video-card">
        <div class="q-video-frame">
          <div class="q-video-play">▶</div>
          <span class="q-video-time">0:00 / 0:04</span>
        </div>
        <h2>Páginas de aterrizaje del panel de control</h2>
        <p>Cree y utilice páginas de inicio y paneles personalizados, alimentados por múltiples aplicaciones, que se adaptan a su flujo de trabajo o al de sus usuarios. Con las nuevas páginas basadas en el lienzo central, puede diseñar disposiciones flexibles combinando gráficos, KPI, texto, enlaces y más, yendo más allá de los carriles tradicionales.</p>
        <div class="q-video-actions">
          <button class="q-btn">Más información</button>
          <button class="q-btn primary">Probar las páginas</button>
        </div>
      </div>`,
  },

  alimentar: {
    title: "",
    topbar: () => `<div class="q-feed-top"><span class="q-feed-tab">ⓘ Información</span>
      <span class="q-feed-right"><button class="q-filter-chip">Filtros</button><button class="q-filter-chip">&lt;/&gt; Insertar</button></span></div>`,
    body: () => emptyState({ icon: "feed", title: "Aún no hay información que explore aquí…", text: "Los conocimientos aparecerán en el feed a medida que se creen y activen." }),
  },

  favoritos: {
    title: "Favoritos",
    body: () => filterBar(["Tipos", "Propietario", "Todos los filtros"]) +
      emptyState({ icon: "star", title: "No se encontraron favoritos", text: "Todavía no tiene ninguno o necesita ajustar sus filtros de búsqueda favoritos. Para marcar un elemento como favorito, haga clic en la estrella." }),
    mount: (main) => wireFilterChips(main),
  },

  colecciones: {
    title: "Colecciones",
    headerRight: () => `<button class="q-btn" id="newCollectionBtn">Crear colección</button>`,
    body: () => filterBar(["Tipo"], { right: `<button class="q-filter-chip">Modificado por ▾</button>` }) +
      `<div id="collectionsWrap"></div>`,
    mount: mountCollections,
  },

  mercado: {
    title: "Mercado de datos",
    body: () => `
      <div class="q-banner">
        <h2>busque datos en los que pueda <span class="q-accent">Confiar</span>.</h2>
        <p>Explore datos que han sido seleccionados, preparados y revisados solo para usted.</p>
      </div>` +
      emptyState({ icon: "shop", title: "No hay productos de datos", text: "Cree un nuevo producto de datos para empezar a compartir conjuntos de datos aprobados con su organización." }),
  },

  productos: {
    title: "Productos de datos",
    headerRight: () => `<button class="q-btn primary">+ Crear nuevo</button>`,
    body: () => emptyState({ icon: "shop", title: "No hay productos de datos", text: "Cree un nuevo producto de datos para empezar a compartir conjuntos de datos aprobados con su organización.", action: "+ Agregar" }),
  },

  calidad: {
    title: "Calidad de los datos",
    body: () => `
      <div class="q-subtabs"><button class="q-subtab active">Tipos semánticos</button><button class="q-subtab">Reglas de validación</button><button class="q-subtab">Puntuación de confianza</button></div>
      ${filterBar(["Tipo", "Creador"], { right: `<button class="q-filter-chip">Modificado por última vez ▾</button>` })}
      <table class="q-table">
        <thead><tr><th><input type="checkbox" /></th><th>Nombre</th><th>Tipo</th><th>Clasificación</th><th>Usado en</th><th>Creador</th><th>Modificado</th></tr></thead>
        <tbody>
          ${[
            ["Bebida (desactivado)", "Diccionario", ""],
            ["Compañía", "Diccionario", ""],
            ["Título religioso cristiano", "Diccionario", "SPI · PII"],
            ["Territorio Provincia CA", "Diccionario", ""],
            ["Número de ruta bancaria", "Patrón", ""],
            ["Tarjeta Amex", "Patrón", "PCI · SPI"],
            ["Civilidad", "Diccionario", "PII"],
            ["Código de continente", "Diccionario", ""],
          ].map((r) => `<tr><td><input type="checkbox" /></td><td class="q-td-name">${esc(r[0])}</td><td>${esc(r[1])}</td><td>${r[2] ? r[2].split(" · ").map((t) => `<span class="q-tag">${esc(t)}</span>`).join(" ") : ""}</td><td></td><td>◍ DataSense</td><td class="q-muted">25 feb 2026</td></tr>`).join("")}
        </tbody>
      </table>
      <p class="q-p-hint">Los tipos semánticos permiten clasificar y validar los datos automáticamente. La edición completa llegará ${SOON.toLowerCase()}.</p>`,
  },

  analizar: {
    title: "Analizar",
    headerRight: () => `<button class="q-btn primary">+ Crear nuevo ▾</button>`,
    body: () => createCards([
      { icon: "app", title: "Aplicación", desc: "Cree una aplicación para visualizar y presentar sus datos.", href: "catalogo.html" },
      { icon: "upload", title: "Cargar", desc: "Cargue aplicaciones y scripts en DataSense.", soon: true },
      { icon: "conn", title: "Conexión de datos", desc: "Agregue conexiones a fuentes de datos locales o en la nube.", soon: true },
      { icon: "dataset", title: "Conjunto de datos", desc: "Cargue un archivo de datos o registre datos externos.", soon: true },
      { icon: "note", title: "Nota", desc: "Cree un análisis personal o compartido.", soon: true },
    ]) + filterBar(["Espacios", "Tipos", "Propietario", "Todos los filtros"]) +
      `<div class="q-apps-grid" id="appsGrid"></div>`,
    mount: mountAnalyzeApps,
  },

  preparar: {
    title: "Preparación de datos",
    headerRight: () => `<button class="q-btn primary">+ Crear nuevo ▾</button>`,
    body: () => createCards([
      { icon: "recipe", title: "Receta de tabla", desc: "Cree una receta para preparar los datos de una sola tabla.", soon: true },
      { icon: "flow", title: "Flujo de datos", desc: "Cree un flujo para preparar sus datos sin código.", soon: true },
      { icon: "script", title: "Guion", desc: "Cree un script para cargar, transformar y exportar sus datos.", href: "catalogo.html" },
      { icon: "upload", title: "Cargar", desc: "Cargue aplicaciones y scripts en DataSense.", soon: true },
      { icon: "conn", title: "Conexión de datos", desc: "Agregue conexiones a fuentes de datos locales o en la nube.", soon: true },
    ]) + filterBar(["Espacios", "Tipos", "Propietario", "Todos los filtros"]) +
      emptyState({ icon: "empty", title: "Aún no hay elementos de preparación de datos.", text: "Use el Editor de carga dentro de una aplicación para transformar sus datos con script." }),
  },

  prediccion: {
    title: "Predicción",
    headerRight: () => `<button class="q-btn primary">+ Crear nuevo ▾</button>`,
    body: () => createCards([
      { icon: "ml", title: "Experimento de ML", desc: "Cree un experimento sobre sus datos y entrene, compare y pruebe modelos.", href: "experimentos.html?new=1" },
      { icon: "dataset", title: "Conjunto de datos", desc: "Cargue un archivo de datos o registre datos externos.", soon: true },
    ]) + filterBar(["Espacios", "Tipos", "Propietario", "Todos los filtros"]) +
      emptyState({ icon: "chart", title: "No se encontraron resultados", text: "El aprendizaje automático (AutoML) estará disponible " + SOON.toLowerCase() + "." }),
  },

  asistentes: {
    title: "Asistentes",
    headerRight: () => `<button class="q-btn primary">+ Crear nuevo ▾</button>`,
    body: () => createCards([
      { icon: "robot", title: "Asistente", desc: "Cree un asistente de chat personalizado para responder preguntas usando información.", soon: true },
      { icon: "knowledge", title: "Base de conocimientos", desc: "Fuentes orgánicas y archivos de datos no estructurados para que los utilice un asistente.", soon: true },
      { icon: "upload", title: "Cargar archivos de conocimiento", desc: "Cargue un archivo no estructurado para utilizarlo en las bases de conocimientos.", soon: true },
      { icon: "conn", title: "Conexión de datos", desc: "Agregue conexiones a fuentes de datos locales o en la nube.", soon: true },
    ]) + filterBar(["Espacios", "Tipos", "Propietario", "Todos los filtros"]) +
      emptyState({ icon: "chart", title: "No se encontraron resultados", text: "Los asistentes de IA (chat y bases de conocimiento) estarán disponibles " + SOON.toLowerCase() + "." }),
  },

  // Apariencia real de DataSense: la aplica js/theme.js (preferencias por navegador).
  temas: {
    title: "Temas",
    body: () => temasHtml(),
    mount: (main) => mountTemas(main),
  },
};

/* -------------------------------------------------------------------------
   Página «Temas»: modo, color de acento, fondo y animaciones
   ------------------------------------------------------------------------- */
const TM_MODES = [
  { v: "light", label: "Claro", desc: "Contenido claro con marco oscuro de neón." },
  { v: "dark", label: "Oscuro", desc: "Todo oscuro, ideal para salas y de noche." },
  { v: "system", label: "Sistema", desc: "Sigue el modo de Windows automáticamente." },
];
const TM_BG_DESC = { grid: "Rejilla técnica con aurora de color.", aurora: "Solo resplandores de color difuminados.", plain: "Fondo limpio, sin decoración." };

function temasHtml() {
  const T = window.DSTheme;
  if (!T) return emptyState({ icon: "chart", title: "Tema no disponible", text: "Recargue la página." });
  const modeCards = TM_MODES.map((m) => `
    <button type="button" class="ds-tm-card" data-k="theme" data-v="${m.v}">
      <div class="ds-tm-prev ${m.v}" aria-hidden="true"><i class="t"></i><i class="s"></i><div class="c"><i></i><i></i><i></i><i></i></div></div>
      <strong>${esc(m.label)}</strong><span class="ds-tm-desc">${esc(m.desc)}</span>
    </button>`).join("");
  const swatches = T.accents.map((a) => `
    <button type="button" class="ds-tm-sw" data-k="accent" data-v="${esc(a.id)}">
      <b style="background:linear-gradient(135deg, ${esc(a.color)}, ${esc(a.second)})"></b>${esc(a.label)}
    </button>`).join("");
  const bgCards = T.backgrounds.map((b) => `
    <button type="button" class="ds-tm-card" data-k="bg" data-v="${esc(b.id)}">
      <div class="ds-tm-prev bg bg-${esc(b.id)}" aria-hidden="true"></div>
      <strong>${esc(b.label)}</strong><span class="ds-tm-desc">${esc(TM_BG_DESC[b.id] || "")}</span>
    </button>`).join("");
  return `
    <div class="ds-tm">
      <section class="ds-tm-sec"><h2>Modo</h2><p>Elige cómo se ve DataSense. También puedes cambiarlo con el botón junto a la campana.</p>
        <div class="ds-tm-grid">${modeCards}</div></section>
      <section class="ds-tm-sec"><h2>Color de acento</h2><p>Botones, enlaces, brillos y el marco de neón usan este color.</p>
        <div class="ds-tm-sws">${swatches}</div></section>
      <section class="ds-tm-sec"><h2>Fondo</h2><p>Decoración del fondo de todas las páginas.</p>
        <div class="ds-tm-grid">${bgCards}</div></section>
      <section class="ds-tm-sec"><h2>Movimiento y atajos</h2><p>Preferencias de este navegador.</p>
        <div class="ds-tm-row"><div><strong>Animaciones</strong><small>Aurora, línea de neón, elevación de tarjetas y transiciones.</small></div>
          <button type="button" class="ds-tm-switch" role="switch" id="dsTmMotion" aria-label="Animaciones"></button></div>
        <div class="ds-tm-row"><div><strong>Paleta de comandos</strong><small class="ds-tm-kbd">Pulsa <kbd>Ctrl</kbd> + <kbd>K</kbd> en cualquier página para buscar apps, páginas y acciones.</small></div>
          <button type="button" class="q-btn primary" id="dsTmPalette">Abrir paleta</button></div>
        <div class="ds-tm-row"><div><strong>Restablecer apariencia</strong><small>Vuelve a modo sistema, acento Índigo, rejilla y animaciones activadas.</small></div>
          <button type="button" class="q-btn" id="dsTmReset">Restablecer</button></div>
      </section>
    </div>`;
}

function mountTemas(main) {
  const T = window.DSTheme;
  if (!T) return;
  const sync = () => {
    const p = T.prefs();
    main.querySelectorAll("[data-k]").forEach((el) => {
      const on = p[el.dataset.k] === el.dataset.v;
      el.classList.toggle("on", on);
      el.setAttribute("aria-pressed", on ? "true" : "false");
    });
    const sw = main.querySelector("#dsTmMotion");
    if (sw) sw.setAttribute("aria-checked", p.motion === "on" ? "true" : "false");
  };
  main.querySelectorAll("[data-k]").forEach((el) => el.addEventListener("click", () => T.setPref(el.dataset.k, el.dataset.v)));
  main.querySelector("#dsTmMotion")?.addEventListener("click", () => T.setPref("motion", T.prefs().motion === "on" ? "off" : "on"));
  main.querySelector("#dsTmPalette")?.addEventListener("click", () => T.openPalette());
  main.querySelector("#dsTmReset")?.addEventListener("click", () => {
    ["theme", "accent", "bg", "motion"].forEach((k) => { try { localStorage.removeItem("ds." + k); } catch { /* sin storage */ } });
    T.setPref("theme", "system");
  });
  window.addEventListener("ds-theme", sync);
  sync();
}

/* -------------------------------------------------------------------------
   Montajes dinámicos (contenido real donde existe motor)
   ------------------------------------------------------------------------- */
async function mountCollections(main) {
  wireFilterChips(main, { onCollectionType: (v) => applyCollectionFilter(main, v) });
  const btn = main.querySelector("#newCollectionBtn");
  if (btn) btn.addEventListener("click", () => openCollectionModal(main));
  await loadCollections(main);
}

let _collections = [];
let _collectionFilter = "todos";

async function loadCollections(main) {
  const wrap = main.querySelector("#collectionsWrap");
  if (!wrap) return;
  wrap.innerHTML = `<p class="q-muted" style="padding:8px">Cargando…</p>`;
  try {
    const api = await import("./api.js");
    _collections = await api.listCollections();
    renderCollections(main);
  } catch (e) {
    wrap.innerHTML = `<p style="color:#c0392b;padding:8px">No se pudieron cargar las colecciones: ${esc(e.message)}</p>`;
  }
}

function applyCollectionFilter(main, v) { _collectionFilter = v; renderCollections(main); }

function renderCollections(main) {
  const wrap = main.querySelector("#collectionsWrap");
  if (!wrap) return;
  let list = _collections;
  if (_collectionFilter === "privado") list = list.filter((c) => c.visibility !== "publica");
  else if (_collectionFilter === "publico") list = list.filter((c) => c.visibility === "publica");
  if (!list.length) {
    wrap.innerHTML = `<div class="q-empty-box">${emptyState({ icon: "book", title: "No tiene ninguna colección todavía.", text: "Puede organizar el contenido en colecciones. Las colecciones son privadas.", action: "Crear colección" })}</div>`;
    wrap.querySelector(".q-btn")?.addEventListener("click", () => openCollectionModal(main));
    return;
  }
  wrap.innerHTML = `<div class="q-coll-grid">${list.map((c) => `
    <article class="q-coll-card" data-id="${esc(c.id)}">
      <div class="q-coll-top">${icon("book")}<button class="q-coll-del" data-del="${esc(c.id)}" title="Eliminar">✕</button></div>
      <h3 class="q-coll-name">${esc(c.name)}</h3>
      <p class="q-coll-desc">${esc(c.description || "")}</p>
      <span class="q-coll-vis ${c.visibility === "publica" ? "pub" : ""}">${c.visibility === "publica" ? "Pública" : "Privada"}</span>
    </article>`).join("")}</div>`;
  wrap.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async (e) => {
    e.stopPropagation();
    const id = b.dataset.del;
    const c = _collections.find((x) => x.id === id);
    if (!confirm(`¿Eliminar la colección "${c?.name || id}"?`)) return;
    try { const api = await import("./api.js"); await api.deleteCollection(id); _collections = _collections.filter((x) => x.id !== id); renderCollections(main); }
    catch (err) { alert("No se pudo eliminar: " + err.message); }
  }));
}

function openCollectionModal(main) {
  closeMenu();
  const back = document.createElement("div");
  back.className = "q-modal-backdrop";
  back.innerHTML = `
    <div class="q-modal">
      <div class="q-modal-head"><h2>Crear una nueva colección</h2><button class="q-modal-x" data-x aria-label="Cerrar">✕</button></div>
      <div class="q-modal-body">
        <label class="q-p-label" for="colName">Nombre</label>
        <input id="colName" class="q-input" placeholder="" />
        <label class="q-p-label" for="colDesc" style="margin-top:12px;display:block">Descripción</label>
        <textarea id="colDesc" class="q-input" rows="3"></textarea>
        <label class="q-p-label" for="colVis" style="margin-top:12px;display:block">Visibilidad</label>
        <select id="colVis" class="q-input"><option value="privada">Privado</option><option value="publica">Público</option></select>
        <p class="q-upload-status" id="colStatus" style="color:#c0392b"></p>
      </div>
      <div class="q-modal-foot"><button class="q-btn" data-x>Cancelar</button><button class="q-btn primary" data-commit disabled>Crear</button></div>
    </div>`;
  document.body.appendChild(back);
  const name = back.querySelector("#colName");
  const commit = back.querySelector("[data-commit]");
  const close = () => back.remove();
  name.addEventListener("input", () => { commit.disabled = !name.value.trim(); });
  back.querySelectorAll("[data-x]").forEach((b) => b.addEventListener("click", close));
  back.addEventListener("pointerdown", (e) => { if (e.target === back) close(); });
  commit.addEventListener("click", async () => {
    const payload = { name: name.value.trim(), description: back.querySelector("#colDesc").value.trim(), visibility: back.querySelector("#colVis").value };
    if (!payload.name) return;
    commit.disabled = true;
    try {
      const api = await import("./api.js");
      const created = await api.createCollection(payload);
      _collections.unshift(created);
      close();
      renderCollections(main);
    } catch (e) {
      back.querySelector("#colStatus").textContent = "Error: " + e.message;
      commit.disabled = false;
    }
  });
  setTimeout(() => name.focus(), 0);
}

async function mountThemes(main) {
  try {
    const { theme } = await import("./store.js");
    const cur = theme.get();
    const radio = main.querySelector(`input[name="theme"][value="${cur}"]`);
    if (radio) radio.checked = true;
    main.querySelectorAll('input[name="theme"]').forEach((r) =>
      r.addEventListener("change", () => { if (r.checked) theme.set(r.value); }));
  } catch {}
}

async function mountAnalyzeApps(main) {
  const grid = main.querySelector("#appsGrid");
  if (!grid) return;
  grid.innerHTML = `<div class="q-muted" style="padding:16px">Cargando aplicaciones…</div>`;
  try {
    const api = await import("./api.js");
    const apps = await api.listApps();
    if (!apps.length) { grid.innerHTML = emptyState({ icon: "empty", title: "No hay aplicaciones.", text: "Cree una desde el Catálogo.", action: "Ir al Catálogo" }); grid.querySelector(".q-btn")?.addEventListener("click", () => location.href = "catalogo.html"); return; }
    grid.innerHTML = apps.map((a) => `
      <a class="q-app-card" href="app.html?app=${encodeURIComponent(a.id)}">
        <div class="q-app-thumb">${icon("app")}</div>
        <div class="q-app-name">${esc(a.name)}</div>
        <div class="q-app-meta q-muted">Creado: ${esc((a.created_at || "").slice(0, 10))}</div>
      </a>`).join("");
  } catch (e) {
    grid.innerHTML = `<div class="q-muted" style="padding:16px">No se pudieron cargar las aplicaciones: ${esc(e.message)}</div>`;
  }
}

/* -------------------------------------------------------------------------
   Arranque
   ------------------------------------------------------------------------- */
function renderAvatar() {
  // Avatar + menú de perfil (incluye "Cerrar sesión"), compartido con el resto del hub.
  renderProfileMenu(authService);
}

function currentPageKey() {
  const p = new URLSearchParams(location.search).get("page");
  return PAGES[p] ? p : "paginas";
}

function render() {
  const key = currentPageKey();
  const page = PAGES[key];
  renderNav("nav", { active: key });
  wireAppsButton();
  renderAvatar();

  const main = document.getElementById("main");
  const header = page.title || page.headerRight
    ? `<div class="q-greeting">
        <h1>${esc(page.title)}${page.preview ? ` <span class="q-nav-preview inline">Vista preliminar</span>` : ""}</h1>
        ${page.headerRight ? page.headerRight() : ""}
      </div>`
    : "";
  main.innerHTML = `${page.topbar ? page.topbar() : ""}${header}<div class="q-page-body">${page.body()}</div>`;
  document.title = `DataSense · ${page.title || "Analítica"}`;
  // Tarjetas de creación con destino: navegan; las "Próximamente" no hacen nada.
  main.querySelectorAll(".q-create-card[data-href]").forEach((card) =>
    card.addEventListener("click", () => { location.href = card.dataset.href; }));
  if (page.mount) page.mount(main);
  // Cablea cualquier chip de filtro que la página no haya cableado ya en su mount.
  wireFilterChips(main);
}

render();

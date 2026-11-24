// crear.js — vista «Crear»: tarjetas agrupadas (Análisis · Inteligencia y automatización · Datos y conexiones),
// solo con acciones reales y según los permisos del usuario. Cada tarjeta entera es el botón.
// El chrome (sidebar/topbar) vive centralizado en js/hub-nav.js.

import { renderNav, svg, wireAppsButton, renderProfileMenu, DUO as D, BRAIN } from "./hub-nav.js";
import { authService } from "./auth-service.js";
import { createApp } from "./api.js";
import { openConnectionsFromHub } from "./conn-hub.js";
import { openQuick } from "./ask-home.js";

// Guard de sesión.
if (!authService.isAuthenticated()) {
  location.replace("index.html");
}

/* ----------------------- Tarjetas de "Crear" (según Qlik) ----------------------- */
// icon: SVG inline; title; desc.
const CREATE_ICON = {
  app: `<rect ${D} x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M9 9v12"/>`,
  ml: BRAIN,
  automation: `<circle ${D} cx="6.5" cy="6.5" r="3"/><circle ${D} cx="17.5" cy="17.5" r="3"/><path d="M9.5 6.5H15a2.5 2.5 0 0 1 2.5 2.5v5.5M6.5 9.5V15A2.5 2.5 0 0 0 9 17.5h5.5"/>`,
  connection: `<rect ${D} x="4" y="3.5" width="6" height="7" rx="1.6" transform="rotate(45 7 7)"/><rect ${D} x="14" y="13.5" width="6" height="7" rx="1.6" transform="rotate(45 17 17)"/><path d="m9.5 14.5 5-5"/>`,
  dataflow: `<rect ${D} x="3" y="3.5" width="7" height="5.5" rx="1.4"/><rect ${D} x="14" y="3.5" width="7" height="5.5" rx="1.4"/><rect ${D} x="8.5" y="15" width="7" height="5.5" rx="1.4"/><path d="M6.5 9v3.2h11V9M12 12.2V15"/>`,
  assistant: `<rect ${D} x="4" y="8" width="16" height="11.5" rx="3.5"/><path d="M12 8V5.2M2.5 12.5v3M21.5 12.5v3"/><circle cx="12" cy="4" r="1.3"/><circle cx="9" cy="13.5" r="1.1" fill="currentColor"/><circle cx="15" cy="13.5" r="1.1" fill="currentColor"/><path d="M9.5 17h5"/>`,
  knowledge: `<path ${D} d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3M9.5 7.5h6M9.5 11h4"/>`,
  surround: `<circle ${D} cx="12" cy="12" r="3.2"/><path d="M12 3v3.2M12 17.8V21M3 12h3.2M17.8 12H21M5.6 5.6l2.2 2.2M16.2 16.2l2.2 2.2M18.4 5.6l-2.2 2.2M7.8 16.2l-2.2 2.2"/>`,
  note: `<path ${D} d="M5 4.5A1.5 1.5 0 0 1 6.5 3h11A1.5 1.5 0 0 1 19 4.5V15l-4.5 5.5h-8A1.5 1.5 0 0 1 5 19z"/><path d="M19 15h-3.5a1 1 0 0 0-1 1v4.5M9 8h6M9 11.5h6"/>`,
  recipe: `<rect ${D} x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M9 9.5V20M15 9.5V20"/>`,
  script: '<path d="m8 7-5 5 5 5M16 7l5 5-5 5M13.6 5 10.4 19"/>',
  upload: `<path ${D} d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15z"/><path d="M12 15V4.5M8 8.2l4-4 4 4"/>`,
  dataset: `<ellipse ${D} cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>`,
  product: `<path ${D} d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12v9M4 7.5l8 4.5 8-4.5"/>`,
};

function createSvg(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${CREATE_ICON[name] || ""}</svg>`;
}

function createCardsHtml(cards) {
  return cards.map((c) => `
    <article class="q-create-card" data-action="${c.action}" tabindex="0" role="button" aria-label="${c.title}">
      <div class="q-create-card-head">
        <span class="q-create-ico">${createSvg(c.icon)}</span>
        ${c.tag ? `<span class="q-create-tag">${c.tag}</span>` : ""}
      </div>
      <h3 class="q-create-card-title">${c.title}</h3>
      <p class="q-create-card-desc">${c.desc}</p>
      <span class="q-create-more">${c.cta} →</span>
    </article>`).join("");
}

// Solo lo que existe de verdad (las tarjetas de relleno copiadas de Qlik se retiraron). «perm»: se oculta a quien no puede.
const GROUPS = [
  {
    id: "analisis", title: "Análisis", cards: [
      { icon: "upload", title: "De archivo a tablero", desc: "Sube un CSV o Excel y en segundos tienes una aplicación con su tablero: KPIs, gráficos y filtros.", action: "quick", cta: "Subir archivo", tag: "Rápido", perm: ["apps:create", "data:import", "charts:edit"] },
      { icon: "app", title: "Aplicación", desc: "Una aplicación vacía para cargar tus datos con SQL y construir hojas a tu medida.", action: "create-app", cta: "Crear aplicación", perm: ["apps:create"] },
      { icon: "knowledge", title: "Colección", desc: "Agrupa aplicaciones, hojas y gráficos para encontrarlos rápido o compartirlos con tu equipo.", action: "collection", cta: "Crear colección", perm: ["charts:edit"] },
      { icon: "product", title: "Tablero incrustado", desc: "Publica una o varias hojas dentro de otra página web con un token de solo lectura.", action: "embed", cta: "Crear embed", perm: ["embed:manage"] },
    ],
  },
  {
    id: "inteligencia", title: "Inteligencia y automatización", cards: [
      { icon: "ml", title: "Experimento de ML", desc: "Segmentación, regresión, clasificación, pronóstico y AutoML sobre tus datos.", action: "open-lab", cta: "Nuevo experimento", perm: ["ml:run"] },
      { icon: "automation", title: "Automatización", desc: "Flujos por nodos: recarga datos, consulta tus apps, usa agentes de IA y avisa por correo, WhatsApp o Teams.", action: "open-flows", cta: "Nueva automatización", perm: ["charts:edit"] },
    ],
  },
  {
    id: "datos", title: "Datos y conexiones", cards: [
      { icon: "connection", title: "Conexión de datos", desc: "Conecta bases de datos, Amazon S3, Athena y otras fuentes para cargar sus tablas.", action: "create-connection", cta: "Nueva conexión", perm: ["connections:manage"] },
      { icon: "dataflow", title: "Credencial de automatización", desc: "Correo (SMTP), WhatsApp, webhooks de Teams o Slack y APIs que usan tus automatizaciones.", action: "open-flow-credentials", cta: "Agregar credencial", perm: ["charts:edit"] },
      { icon: "note", title: "Notas para agente", desc: "Explica a la IA qué significa cada columna para que analice y responda mejor.", action: "notes", cta: "Documentar datos", perm: ["charts:edit"] },
    ],
  },
];

function renderCreate() {
  const can = (p) => (p || []).every((x) => authService.can(x));
  const host = document.getElementById("createGroups");
  host.innerHTML = GROUPS.map((g) => {
    const cards = g.cards.filter((c) => can(c.perm));
    return cards.length ? `<section class="q-create-section"><h2 class="q-create-title">${g.title}</h2><div class="q-create-grid">${createCardsHtml(cards)}</div></section>` : "";
  }).join("") || `<p class="cfg-muted">Tu rol no tiene permisos para crear contenido. Pídeselo a un administrador.</p>`;
}

/* ----------------------- "Aplicación" como punto de entrada ----------------------- */
// El brief indica que Crear -> Aplicación crea una app y la abre.
async function handleCreateApp() {
  const name = prompt("Nombre de la aplicación:", "Mi aplicación");
  if (!name || !name.trim()) return;
  try {
    const app = await createApp(name.trim());
    location.href = `app.html?app=${encodeURIComponent(app.id)}`;
  } catch (err) {
    alert("No se pudo crear la aplicación: " + err.message);
  }
}

function wireCreateActions() {
  document.querySelectorAll("main").forEach((main) => {
    main.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.matches(".q-create-card")) { e.preventDefault(); e.target.click(); } });
    main.addEventListener("click", (e) => {
      const el = e.target.closest("[data-action]");
      if (!el) return;
      const action = el.dataset.action;
      if (action === "create-app") { e.preventDefault(); handleCreateApp(); }
      else if (action === "quick") { e.preventDefault(); openQuick(); }
      else if (action === "collection") { e.preventDefault(); location.href = "hub.html?page=colecciones&new=1"; }
      else if (action === "embed") { e.preventDefault(); location.href = "embedding.html?new=1"; }
      else if (action === "notes") { e.preventDefault(); location.href = "notas.html"; }
      else if (action === "create-connection") { e.preventDefault(); openConnectionsFromHub(); }
      else if (action === "open-lab") { e.preventDefault(); location.href = "experimentos.html?new=1"; }
      else if (action === "open-flows") { e.preventDefault(); location.href = "automatizaciones.html?new=1"; }
      else if (action === "open-flow-credentials") { e.preventDefault(); location.href = "automatizaciones.html?credentials=1"; }
    });
  });
}

/* ----------------------- Arranque ----------------------- */
renderNav("nav", { active: "crear" });
wireAppsButton();
renderProfileMenu(authService);
renderCreate();
wireCreateActions();

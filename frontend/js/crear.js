// crear.js — vista "Crear" estilo Qlik: tarjetas en 3 secciones
// (Recomendado, Contenido y colaboración, Datos y carga), según la
// documentación oficial del Analytics activity center de Qlik Cloud.
// El chrome (sidebar/topbar) vive centralizado en js/hub-nav.js.

import { renderNav, svg, wireAppsButton, renderProfileMenu, DUO as D, BRAIN } from "./hub-nav.js";
import { authService } from "./auth-service.js";
import { createApp } from "./api.js";
import { openConnectionsFromHub } from "./conn-hub.js";

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
    <article class="q-create-card" data-action="${c.action || ""}">
      <div class="q-create-card-head">
        <span class="q-create-ico">${createSvg(c.icon)}</span>
        <button class="q-create-add" title="Crear" data-action="${c.action || ""}">+</button>
      </div>
      <h3 class="q-create-card-title">${c.title}</h3>
      <p class="q-create-card-desc">${c.desc}</p>
      <a href="#" class="q-create-more">Más información</a>
    </article>`).join("");
}

const RECOMMENDED = [
  { icon: "app", title: "Aplicación", desc: "Crea una aplicación para visualizar y presentar sus datos.", action: "create-app" },
  { icon: "ml", title: "Experimento de ML", desc: "Crea un experimento sobre tus datos: segmentación, regresión, clasificación, pronóstico y AutoML.", action: "open-lab" },
  { icon: "automation", title: "Automatización", desc: "Utiliza una interfaz visual de código para crear análisis de datos y flujos de trabajo automatizados." },
  { icon: "connection", title: "Conexión de datos", desc: "Agregue conexiones a fuentes de datos locales o en la nube.", action: "create-connection" },
  { icon: "dataflow", title: "Flujo de datos", desc: "Crea un flujo de datos para preparar sus datos con un flujo gráfico o script." },
];

const CONTENT = [
  { icon: "app", title: "Aplicación", desc: "Crea una aplicación para visualizar y presentar sus datos.", action: "create-app" },
  { icon: "assistant", title: "Asistente", desc: "Crea un asistente de chat personalizado para responder preguntas." },
  { icon: "automation", title: "Automatización", desc: "Configure análisis y flujos de trabajo sin necesidad de programar." },
  { icon: "knowledge", title: "Base de conocimientos", desc: "Fuentes y archivos de datos no estructurados." },
  { icon: "surround", title: "Rodear a", desc: "Agregue enlaces a contenido útil." },
  { icon: "ml", title: "Experimento de ML", desc: "Crea un experimento de aprendizaje automático y compara modelos.", action: "open-lab" },
  { icon: "dataflow", title: "Flujo de datos", desc: "Crea un flujo de datos para preparar sus datos cuando grafique." },
  { icon: "note", title: "Nota", desc: "Crea un análisis personal y compartido." },
  { icon: "recipe", title: "Receta de tabla", desc: "Crea una receta de tabla para preparar los datos de una sola tabla." },
  { icon: "script", title: "Guion", desc: "Crea un script para cargar, transformar y preparar sus datos." },
];

const DATA = [
  { icon: "upload", title: "Cargar", desc: "Cargar archivos existentes en la nube." },
  { icon: "automation", title: "Conexión de automatización", desc: "Crear conexiones para flujos de trabajo automatizados." },
  { icon: "connection", title: "Conexión de datos", desc: "Conéctese a fuentes de datos, bases de datos y destinos.", action: "create-connection" },
  { icon: "dataset", title: "Conjunto de datos", desc: "Cargar un archivo de datos o registre datos externos." },
  { icon: "product", title: "Producto de datos", desc: "Crear productos de datos seleccionados y controlados." },
];

function renderCreate() {
  document.getElementById("recommended").innerHTML = createCardsHtml(RECOMMENDED);
  document.getElementById("content").innerHTML = createCardsHtml(CONTENT);
  document.getElementById("data").innerHTML = createCardsHtml(DATA);
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
    main.addEventListener("click", (e) => {
      const el = e.target.closest("[data-action]");
      if (!el) return;
      const action = el.dataset.action;
      if (action === "create-app") { e.preventDefault(); handleCreateApp(); }
      else if (action === "create-connection") { e.preventDefault(); openConnectionsFromHub(); }
      else if (action === "open-lab") { e.preventDefault(); location.href = "experimentos.html?new=1"; }
    });
  });
}

/* ----------------------- Arranque ----------------------- */
renderNav("nav", { active: "crear" });
wireAppsButton();
renderProfileMenu(authService);
renderCreate();
wireCreateActions();

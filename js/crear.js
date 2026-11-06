// crear.js — vista "Crear" estilo Qlik: tarjetas en 3 secciones
// (Recomendado, Contenido y colaboración, Datos y carga), según la
// documentación oficial del Analytics activity center de Qlik Cloud.
// El chrome (sidebar/topbar) vive centralizado en js/hub-nav.js.

import { renderNav, svg, wireAppsButton, renderProfileMenu } from "./hub-nav.js";
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
  app: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
  ml: '<path d="M9 3v4M15 3v4M9 17v4M15 17v4M3 9h4M3 15h4M17 9h4M17 15h4"/><rect x="7" y="7" width="10" height="10" rx="2"/>',
  automation: '<circle cx="7" cy="7" r="3"/><circle cx="17" cy="17" r="3"/><path d="M10 7h7v7M7 10v7h4"/>',
  connection: '<path d="M8 12a4 4 0 0 1 4-4h2a4 4 0 0 1 0 8M16 12a4 4 0 0 1-4 4h-2a4 4 0 0 1 0-8"/>',
  dataflow: '<rect x="3" y="4" width="6" height="5" rx="1"/><rect x="15" y="4" width="6" height="5" rx="1"/><rect x="9" y="15" width="6" height="5" rx="1"/><path d="M6 9v3h12V9M12 12v3"/>',
  assistant: '<circle cx="12" cy="9" r="4"/><path d="M5 21a7 7 0 0 1 14 0"/>',
  knowledge: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/>',
  surround: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>',
  note: '<path d="M4 4h16v12l-4 4H4z"/><path d="M16 20v-4h4"/>',
  recipe: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18"/>',
  script: '<path d="m8 6-5 6 5 6M16 6l5 6-5 6"/>',
  upload: '<path d="M12 15V4M8 8l4-4 4 4"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  dataset: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/>',
  product: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/>',
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
  { icon: "ml", title: "Experimento de ML", desc: "Carga datos históricos en un experimento de aprendizaje automático." },
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
  { icon: "ml", title: "Experimento de ML", desc: "Carga datos históricos en un experimento automatizado de ML." },
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
    });
  });
}

/* ----------------------- Arranque ----------------------- */
renderNav("nav", { active: "crear" });
wireAppsButton();
renderProfileMenu(authService);
renderCreate();
wireCreateActions();

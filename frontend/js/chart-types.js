// chart-types.js — registro declarativo de tipos de objeto de la Hoja.
//
// Cada tipo declara sus ROLES (nombre de la dimensión/medida que pide, mínimos y
// máximos), su tamaño inicial en la rejilla y las opciones de Presentación que
// admite. El panel de propiedades y el estado vacío del objeto se generan a
// partir de esta definición, como en Qlik ("Línea" / "Altura de línea").
//
// Los valores los calcula SIEMPRE el motor Python (/query, /fields/values). Aquí
// solo se dibuja lo que devuelve. Los tipos con available:false se muestran en el
// catálogo en gris con "Próximamente": no se pueden arrastrar.

import { ML_TYPE_DEFS } from "./ml-views.js";

export const PALETTE = [
  "#0a8f3c", "#1f6feb", "#f0a132", "#c0392b", "#8e44ad",
  "#16a085", "#d35400", "#2c3e50", "#7f8c8d", "#b8860b",
];

const I = {
  sankey: '<path d="M3 5h4c6 0 6 14 14 14M3 12h4c4 0 6-7 14-7M3 19h4"/>',
  box: '<rect x="6" y="7" width="12" height="10"/><path d="M12 3v4M12 17v4M6 12h12"/>',
  dist: '<circle cx="6" cy="8" r="1.4"/><circle cx="11" cy="14" r="1.4"/><circle cx="16" cy="9" r="1.4"/><path d="M3 20h18"/>',
  combo: '<path d="M5 20V12M10 20V8M15 20v-6"/><path d="M3 9l6-4 5 5 7-6"/>',
  bar: '<path d="M5 20V10M10 20V5M15 20v-8M20 20v-4"/>',
  block: '<rect x="3" y="3" width="10" height="11"/><rect x="13" y="3" width="8" height="7"/><rect x="13" y="10" width="8" height="11"/><rect x="3" y="14" width="10" height="7"/>',
  grid: '<circle cx="6" cy="6" r="1.6"/><circle cx="12" cy="6" r="1.6"/><circle cx="18" cy="6" r="2.4"/><circle cx="6" cy="12" r="2.4"/><circle cx="12" cy="12" r="1.6"/><circle cx="18" cy="18" r="1.6"/>',
  scatter: '<circle cx="7" cy="16" r="1.8"/><circle cx="11" cy="9" r="1.8"/><circle cx="16" cy="13" r="1.8"/><circle cx="18" cy="6" r="1.8"/><path d="M3 3v18h18"/>',
  funnel: '<path d="M3 4h18l-7 8v7l-4 2v-9z"/>',
  line: '<path d="M3 17l5-6 4 3 8-9"/><path d="M3 21h18"/>',
  pie: '<path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',
  bullet: '<path d="M3 8h18M3 16h18"/><rect x="3" y="10" width="11" height="4"/>',
  waterfall: '<path d="M4 20V12M9 12V6M14 6v5M19 11v9"/>',
  mekko: '<rect x="3" y="4" width="6" height="16"/><rect x="9" y="4" width="8" height="16"/><rect x="17" y="4" width="4" height="16"/><path d="M3 11h6M9 14h8M17 9h4"/>',
  histo: '<path d="M4 20v-6h4v6M8 20V8h4v12M12 20v-9h4v9M16 20v-4h4v4"/>',
  gauge: '<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4-5"/>',
  kpi: '<path d="M5 8h2v8M5 16h4M12 8h4l-3 8"/><path d="M19 8v8"/>',
  map: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>',
  org: '<rect x="9" y="3" width="6" height="4"/><rect x="3" y="15" width="6" height="4"/><rect x="15" y="15" width="6" height="4"/><path d="M12 7v4M6 15v-4h12v4"/>',
  filter: '<path d="M4 5h16l-6 7v6l-4 2v-8z"/>',
  table: '<rect x="3" y="4" width="18" height="16"/><path d="M3 9h18M3 14h18M9 4v16"/>',
  pivot: '<rect x="3" y="4" width="18" height="16"/><path d="M3 9h18M8 4v16M3 14h5"/>',
  anim: '<circle cx="12" cy="12" r="8"/><path d="M10 9l5 3-5 3z"/>',
  button: '<rect x="3" y="8" width="18" height="8" rx="2"/><path d="M8 12h8"/>',
  layout: '<rect x="3" y="3" width="18" height="18"/><path d="M3 9h18M12 9v12"/>',
  matrix: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
  tabs: '<path d="M3 8h6V5h6v3h6v12H3z"/>',
  slider: '<path d="M3 12h18"/><circle cx="9" cy="12" r="2.6"/>',
  input: '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 12h1"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 17l-6-6-8 8"/>',
  nl: '<path d="M4 6h16M4 12h10M4 18h6"/><circle cx="18" cy="16" r="3"/>',
  hline: '<path d="M3 12h18"/>',
  nav: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  video: '<rect x="3" y="6" width="14" height="12" rx="2"/><path d="M17 10l4-2v8l-4-2"/>',
  date: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  radar: '<path d="M12 3l8 6-3 10H7L4 9z"/><path d="M12 8l4 3-1.5 5h-5L8 11z"/>',
  network: '<circle cx="6" cy="6" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="10" cy="18" r="2"/><path d="M8 7l8 1M7 8l2 8M12 17l5-7"/>',
  cloud: '<path d="M4 10h6M12 10h8M4 15h4M10 15h10"/>',
  variance: '<path d="M4 20V8M9 20V4M14 20v-6M19 20V10"/><path d="M4 8h5"/>',
  // ---- Machine Learning ----
  mlcluster: '<circle cx="7" cy="8" r="1.5"/><circle cx="9" cy="6" r="1.2"/><circle cx="6" cy="5.5" r="1"/><circle cx="16" cy="15" r="1.5"/><circle cx="18" cy="17" r="1.2"/><circle cx="15" cy="18" r="1"/><circle cx="17" cy="7" r="1.3"/><path d="M3 3v18h18"/>',
  mlelbow: '<path d="M4 4c1 8 3 11 7 12s7 1 9 1"/><path d="M4 19l4-6 4 2 4-5 4 1" stroke-dasharray="2 2"/>',
  mlsil: '<path d="M3 16h18"/><path d="M3 16v-2M9 16v-2M15 16v-2M21 16v-2"/><path d="M15 12l2-5 2 5"/>',
  mlseg: '<rect x="3" y="4" width="8" height="7" rx="1.5"/><rect x="13" y="4" width="8" height="7" rx="1.5"/><rect x="3" y="13" width="8" height="7" rx="1.5"/><path d="M5 7h4M15 7h4M5 16h4"/>',
  mlprofile: '<path d="M12 3v18"/><path d="M12 6h6M12 10H7M12 14h4M12 18H8"/>',
  mlsizes: '<path d="M5 20V9M10 20V6M15 20v-9M20 20V4"/><circle cx="5" cy="6" r="1"/><circle cx="20" cy="2.5" r="1"/>',
  mlactual: '<path d="M3 21L21 3" stroke-dasharray="2 2"/><circle cx="7" cy="16" r="1.4"/><circle cx="11" cy="11" r="1.4"/><circle cx="15" cy="9" r="1.4"/><circle cx="17" cy="5" r="1.4"/>',
  mlimp: '<path d="M4 5h14M4 10h10M4 15h7M4 20h4"/>',
  mlcoef: '<path d="M12 3v18"/><path d="M12 7h7M12 12H6M12 17h4"/>',
  mlroc: '<path d="M3 21V3M3 21h18"/><path d="M3 21c2-10 7-15 18-18"/><path d="M3 21L21 3" stroke-dasharray="2 2"/>',
  mlconf: '<rect x="3" y="3" width="8" height="8"/><rect x="13" y="3" width="8" height="8"/><rect x="3" y="13" width="8" height="8"/><rect x="13" y="13" width="8" height="8"/><path d="M6 7h2M16 17h2"/>',
  mlboard: '<path d="M4 6h16M4 12h11M4 18h7"/><circle cx="20" cy="12" r="1.2"/>',
  mlforecast: '<path d="M3 16l4-4 4 2 4-5"/><path d="M15 9l6-3" stroke-dasharray="2 2"/><path d="M15 12l6-1M15 6l6-5" stroke-opacity=".5"/>',
  mlcorr: '<rect x="3" y="3" width="6" height="6"/><rect x="9" y="3" width="6" height="6"/><rect x="15" y="3" width="6" height="6"/><rect x="3" y="9" width="6" height="6"/><rect x="9" y="9" width="6" height="6"/><rect x="3" y="15" width="6" height="6"/>',
  mlpca: '<path d="M4 20V6M9 20V11M14 20v-6M19 20v-3"/><path d="M4 6l5-2 5 2 5 1"/>',
  mlanom: '<path d="M4 20v-5h3v5M7 20V9h3v11M10 20v-7h3v7M13 20v-3h3v3"/><circle cx="20" cy="6" r="1.8"/>',
  mlrules: '<path d="M4 7h6M14 7h6M10 7l4 0"/><path d="M12 5l2 2-2 2"/><path d="M4 15h6M14 15h6"/><path d="M12 13l2 2-2 2"/>',
  mlmetrics: '<rect x="3" y="6" width="5" height="12" rx="1"/><rect x="10" y="6" width="5" height="12" rx="1"/><rect x="17" y="6" width="4" height="12" rx="1"/>',
  mlinsight: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z"/>',
};

export function typeIcon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[name] || I.bar}</svg>`;
}

/* --------------------------------------------------------------------------
   Definiciones. roles.dims / roles.measures: {min, max, labels[]}.
   La etiqueta del rol i es labels[min(i, labels.length-1)].
   -------------------------------------------------------------------------- */
// render: cómo lo dibuja hoja-render. dimN/measN con etiqueta de cada rol.
const DEFS = [
  // ---------------- Visualizaciones ----------------
  {
    type: "sankey", label: "Diagrama de Sankey", icon: "sankey", group: "viz", available: true, render: "sankey",
    roles: { dims: { min: 2, max: 2, labels: ["Origen", "Destino"] }, measures: { min: 1, max: 1, labels: ["Flujo"] } },
    size: { w: 12, h: 8 }, axes: false, legend: false, presentation: [],
  },
  {
    type: "boxplot", label: "Diagrama de caja", icon: "box", group: "viz", available: true, render: "box",
    roles: { dims: { min: 1, max: 1, labels: ["Grupo"] }, measures: { min: 1, max: 1, labels: ["Medida"] } },
    size: { w: 12, h: 8 }, axes: true, legend: false, presentation: ["orientation"],
  },
  {
    type: "distribution", label: "Diagrama de distribución", icon: "dist", group: "viz", available: true, render: "distribution",
    roles: { dims: { min: 1, max: 1, labels: ["Grupo"] }, measures: { min: 1, max: 1, labels: ["Valor"] } },
    size: { w: 12, h: 8 }, axes: true, legend: false, presentation: [],
  },
  {
    type: "combo", label: "Gráfico combinado", icon: "combo", group: "viz", available: true, render: "chartjs",
    roles: { dims: { min: 1, max: 1, labels: ["Dimensión"] }, measures: { min: 2, max: 2, labels: ["Barra", "Línea"] } },
    size: { w: 12, h: 8 }, axes: true, legend: true, presentation: ["orientation"],
  },
  {
    type: "bar", label: "Gráfico de barras", icon: "bar", group: "viz", available: true, render: "chartjs",
    roles: { dims: { min: 1, max: 1, labels: ["Barra"] }, measures: { min: 1, max: 3, labels: ["Altura de barra"] } },
    size: { w: 12, h: 8 }, axes: true, legend: true, palette: true, presentation: ["barMode", "orientation"],
  },
  {
    type: "block", label: "Gráfico de bloques", icon: "block", group: "viz", available: true, render: "treemap",
    roles: { dims: { min: 1, max: 1, labels: ["Bloque"] }, measures: { min: 1, max: 1, labels: ["Tamaño"] } },
    size: { w: 10, h: 8 }, axes: false, legend: false, palette: true, presentation: ["valueLabels"],
  },
  {
    type: "gridchart", label: "Gráfico de cuadrícula", icon: "grid", group: "viz", available: true, render: "heatmap",
    roles: { dims: { min: 2, max: 2, labels: ["Eje X", "Eje Y"] }, measures: { min: 1, max: 1, labels: ["Color"] } },
    size: { w: 12, h: 8 }, axes: false, legend: true, presentation: [],
  },
  {
    type: "scatter", label: "Gráfico de dispersión", icon: "scatter", group: "viz", available: true, render: "chartjs",
    roles: { dims: { min: 1, max: 1, labels: ["Burbuja"] }, measures: { min: 2, max: 2, labels: ["Eje X", "Eje Y"] } },
    size: { w: 12, h: 8 }, axes: true, legend: false, presentation: ["points"],
  },
  {
    type: "funnel", label: "Gráfico de embudo", icon: "funnel", group: "viz", available: true, render: "funnel",
    roles: { dims: { min: 1, max: 1, labels: ["Fase"] }, measures: { min: 1, max: 1, labels: ["Valor"] } },
    size: { w: 8, h: 8 }, axes: false, legend: false, palette: true, presentation: ["valueLabels"],
  },
  {
    type: "line", label: "Gráfico de líneas", icon: "line", group: "viz", available: true, render: "chartjs",
    roles: { dims: { min: 1, max: 1, labels: ["Línea"] }, measures: { min: 1, max: 3, labels: ["Altura de línea"] } },
    size: { w: 12, h: 8 }, axes: true, legend: true, presentation: ["lineStyle", "orientation", "missing", "points"],
  },
  {
    type: "pie", label: "Gráfico de tarta", icon: "pie", group: "viz", available: true, render: "chartjs",
    roles: { dims: { min: 1, max: 1, labels: ["Porción"] }, measures: { min: 1, max: 1, labels: ["Ángulo"] } },
    size: { w: 8, h: 8 }, axes: false, legend: true, palette: true, presentation: ["donut", "valueLabels"],
  },
  {
    type: "bulletchart", label: "Gráfico de viñetas", icon: "bullet", group: "viz", available: true, render: "bullet",
    roles: { dims: { min: 1, max: 1, labels: ["Medida (fila)"] }, measures: { min: 1, max: 1, labels: ["Valor"] } },
    size: { w: 10, h: 6 }, axes: false, legend: false, presentation: [],
  },
  {
    type: "waterfall", label: "Gráfico en cascada", icon: "waterfall", group: "viz", available: true, render: "waterfall",
    roles: { dims: { min: 1, max: 1, labels: ["Paso"] }, measures: { min: 1, max: 1, labels: ["Cambio"] } },
    size: { w: 12, h: 8 }, axes: true, legend: false, presentation: [],
  },
  {
    type: "mekko", label: "Gráfico mekko", icon: "mekko", group: "viz", available: true, render: "chartjs",
    roles: { dims: { min: 1, max: 1, labels: ["Columna"] }, measures: { min: 1, max: 2, labels: ["Altura", "Ancho"] } },
    size: { w: 12, h: 8 }, axes: true, legend: true, presentation: ["barMode"],
  },
  {
    type: "histogram", label: "Histograma", icon: "histo", group: "viz", available: true, render: "histogram",
    roles: { dims: { min: 0, max: 0, labels: [] }, measures: { min: 1, max: 1, labels: ["Medida"] } },
    size: { w: 12, h: 8 }, axes: true, legend: false, presentation: [],
  },
  {
    type: "gauge", label: "Indicador", icon: "gauge", group: "viz", available: true, render: "gauge",
    roles: { dims: { min: 0, max: 0, labels: [] }, measures: { min: 1, max: 1, labels: ["Medida"] } },
    size: { w: 6, h: 5 }, axes: false, legend: false, presentation: ["gaugeRange"],
  },
  {
    type: "kpi", label: "KPI", icon: "kpi", group: "viz", available: true, render: "kpi",
    roles: { dims: { min: 0, max: 0, labels: [] }, measures: { min: 1, max: 2, labels: ["Medida principal", "Medida de comparación"] } },
    size: { w: 6, h: 4 }, axes: false, legend: false, presentation: ["kpiAlign"],
  },
  {
    type: "map", label: "Mapa", icon: "map", group: "viz", available: true, render: "map",
    roles: { dims: { min: 1, max: 1, labels: ["Ubicación"] }, measures: { min: 1, max: 1, labels: ["Medida"] } },
    size: { w: 12, h: 8 }, axes: false, legend: true, presentation: [],
  },
  {
    type: "orgchart", label: "Organigrama", icon: "org", group: "viz", available: true, render: "orgchart",
    roles: { dims: { min: 2, max: 2, labels: ["Nodo", "Padre"] }, measures: { min: 0, max: 0, labels: [] } },
    size: { w: 12, h: 8 }, axes: false, legend: false, presentation: [],
  },
  {
    type: "filterpane", label: "Panel de filtrado", icon: "filter", group: "viz", available: true, render: "filterpane",
    roles: { dims: { min: 1, max: 4, labels: ["Dimensión"] }, measures: { min: 0, max: 0, labels: [] } },
    size: { w: 4, h: 6 }, axes: false, legend: false, presentation: [],
  },
  {
    type: "annotationtable", label: "Tabla de anotaciones", icon: "table", group: "viz", available: true, render: "table",
    roles: { dims: { min: 1, max: 1, labels: ["Columna"] }, measures: { min: 0, max: 5, labels: ["Columna"] } },
    size: { w: 12, h: 6 }, axes: false, legend: false, presentation: ["totals"],
  },
  {
    type: "pivot", label: "Tabla dinámica", icon: "pivot", group: "viz", available: true, render: "pivot",
    roles: { dims: { min: 1, max: 2, labels: ["Fila", "Columna"] }, measures: { min: 1, max: 1, labels: ["Valor"] } },
    size: { w: 12, h: 7 }, axes: false, legend: false, presentation: [],
  },
  {
    type: "table", label: "Tabla simple", icon: "table", group: "viz", available: true, render: "table",
    roles: { dims: { min: 1, max: 1, labels: ["Columna"] }, measures: { min: 1, max: 5, labels: ["Columna"] } },
    size: { w: 12, h: 6 }, axes: false, legend: false, presentation: ["totals"],
  },

  // ---------------- Objetos del cuadro de mando ----------------
  {
    type: "animator", label: "Animador", icon: "anim", group: "dash", available: true, render: "note", noData: true,
    roles: { dims: { min: 0, max: 0, labels: [] }, measures: { min: 0, max: 0, labels: [] } },
    size: { w: 6, h: 3 }, axes: false, legend: false, presentation: [],
  },
  {
    type: "button", label: "Botón", icon: "button", group: "dash", available: true, render: "button", noData: true,
    roles: { dims: { min: 0, max: 0, labels: [] }, measures: { min: 0, max: 0, labels: [] } },
    size: { w: 4, h: 2 }, axes: false, legend: false, presentation: ["buttonAction"],
  },
  {
    type: "layoutcontainer", label: "Contenedor de diseño", icon: "layout", group: "dash", available: true, render: "container", noData: true,
    roles: { dims: { min: 0, max: 0, labels: [] }, measures: { min: 0, max: 0, labels: [] } },
    size: { w: 10, h: 6 }, axes: false, legend: false, presentation: [],
  },
  {
    type: "matrixcontainer", label: "Contenedor de matriz", icon: "matrix", group: "dash", available: true, render: "container", noData: true,
    roles: { dims: { min: 0, max: 0, labels: [] }, measures: { min: 0, max: 0, labels: [] } },
    size: { w: 10, h: 6 }, axes: false, legend: false, presentation: [],
  },
  {
    type: "tabcontainer", label: "Contenedor de pestañas", icon: "tabs", group: "dash", available: true, render: "container", noData: true,
    roles: { dims: { min: 0, max: 0, labels: [] }, measures: { min: 0, max: 0, labels: [] } },
    size: { w: 10, h: 6 }, axes: false, legend: false, presentation: [],
  },
  {
    type: "slider", label: "Deslizador", icon: "slider", group: "dash", available: true, render: "note", noData: true,
    roles: { dims: { min: 0, max: 0, labels: [] }, measures: { min: 0, max: 0, labels: [] } },
    size: { w: 6, h: 2 }, axes: false, legend: false, presentation: [],
  },
  {
    type: "variableinput", label: "Entrada variable", icon: "input", group: "dash", available: true, render: "note", noData: true,
    roles: { dims: { min: 0, max: 0, labels: [] }, measures: { min: 0, max: 0, labels: [] } },
    size: { w: 6, h: 2 }, axes: false, legend: false, presentation: [],
  },
  {
    type: "image", label: "Imagen", icon: "image", group: "dash", available: true, render: "image", noData: true,
    roles: { dims: { min: 0, max: 0, labels: [] }, measures: { min: 0, max: 0, labels: [] } },
    size: { w: 8, h: 5 }, axes: false, legend: false, presentation: [],
  },
  {
    type: "nlinsights", label: "Información en LN", icon: "nl", group: "dash", available: true, render: "note", noData: true,
    roles: { dims: { min: 0, max: 0, labels: [] }, measures: { min: 0, max: 0, labels: [] } },
    size: { w: 8, h: 5 }, axes: false, legend: false, presentation: [],
  },
  {
    type: "hline", label: "Línea", icon: "hline", group: "dash", available: true, render: "divider", noData: true,
    roles: { dims: { min: 0, max: 0, labels: [] }, measures: { min: 0, max: 0, labels: [] } },
    size: { w: 12, h: 1 }, axes: false, legend: false, presentation: [],
  },
  {
    type: "navmenu", label: "Menú de navegación", icon: "nav", group: "dash", available: true, render: "navmenu", noData: true,
    roles: { dims: { min: 0, max: 0, labels: [] }, measures: { min: 0, max: 0, labels: [] } },
    size: { w: 12, h: 2 }, axes: false, legend: false, presentation: [],
  },
  {
    type: "video", label: "Reproductor de vídeo", icon: "video", group: "dash", available: true, render: "video", noData: true,
    roles: { dims: { min: 0, max: 0, labels: [] }, measures: { min: 0, max: 0, labels: [] } },
    size: { w: 8, h: 5 }, axes: false, legend: false, presentation: [],
  },
  {
    type: "datepicker", label: "Selector de fechas", icon: "date", group: "dash", available: true, render: "note", noData: true,
    roles: { dims: { min: 0, max: 0, labels: [] }, measures: { min: 0, max: 0, labels: [] } },
    size: { w: 6, h: 2 }, axes: false, legend: false, presentation: [],
  },
  {
    type: "text", label: "Texto", icon: "text", group: "dash", available: true, render: "text", noData: true,
    roles: { dims: { min: 0, max: 0, labels: [] }, measures: { min: 0, max: 0, labels: [] } },
    size: { w: 8, h: 3 }, axes: false, legend: false, presentation: ["textAlign"],
  },

  // ---------------- Heredado ----------------
  {
    type: "variance", label: "Cascada de varianza", icon: "variance", group: "legacy", available: true, render: "waterfall",
    roles: { dims: { min: 1, max: 1, labels: ["Paso"] }, measures: { min: 1, max: 1, labels: ["Varianza"] } },
    size: { w: 12, h: 8 }, axes: true, legend: false, presentation: [],
  },
  {
    type: "radar", label: "Gráfico de radar", icon: "radar", group: "legacy", available: true, render: "chartjs",
    roles: { dims: { min: 1, max: 1, labels: ["Eje"] }, measures: { min: 1, max: 3, labels: ["Valor"] } },
    size: { w: 8, h: 8 }, axes: false, legend: true, presentation: [],
  },
  {
    type: "network", label: "Gráfico de red", icon: "network", group: "legacy", available: true, render: "orgchart",
    roles: { dims: { min: 2, max: 2, labels: ["Nodo", "Conecta con"] }, measures: { min: 0, max: 0, labels: [] } },
    size: { w: 12, h: 8 }, axes: false, legend: false, presentation: [],
  },
  {
    type: "wordcloud", label: "Nube de palabras", icon: "cloud", group: "legacy", available: true, render: "wordcloud",
    roles: { dims: { min: 1, max: 1, labels: ["Palabra"] }, measures: { min: 1, max: 1, labels: ["Frecuencia"] } },
    size: { w: 10, h: 7 }, axes: false, legend: false, presentation: [],
  },
];

// ---------------- Machine Learning (objetos personalizados) ----------------
// Dibujan una ejecución guardada de Experimentos de ML (props.ml = {experimentId, runId});
// no usan dimensiones/medidas del modelo asociativo. Se ofrecen en "Objetos personalizados".
ML_TYPE_DEFS.forEach((d) => DEFS.push(d));

export const GROUPS = [
  { key: "viz", label: "Visualizaciones" },
  { key: "ml", label: "Machine Learning" },
  { key: "dash", label: "Objetos del cuadro de mando" },
  { key: "legacy", label: "Heredado" },
];

export const CHART_TYPES = DEFS;
export const getType = (type) => DEFS.find((d) => d.type === type) || null;

export function roleLabel(def, kind, index) {
  const r = def.roles[kind];
  if (!r || !r.labels.length) return kind === "dims" ? "Dimensión" : "Medida";
  return r.labels[Math.min(index, r.labels.length - 1)];
}

/** Props por defecto para un objeto nuevo de un tipo dado. */
export function defaultProps(type) {
  return {
    showTitles: true,
    title: "",
    subtitle: "",
    footnote: "",
    showDetails: true,
    dims: [],
    measures: [],
    filters: [],
    sort: { by: "auto", dir: "asc" },
    addons: { limit: 0, refLines: [] },
    look: {
      orientation: "vertical",
      barMode: "grouped",
      lineStyle: "line",
      missing: "gaps",
      points: type === "scatter",
      donut: false,
      valueLabels: true,
      kpiAlign: "center",
      textAlign: "left",
      totals: true,
      color: PALETTE[0],
      byDimension: type === "pie",
      legend: true,
      legendPos: "auto",
      xLabels: true,
      yLabels: true,
      xTitle: "",
      yTitle: "",
      tooltip: true,
    },
    text: type === "text" ? "Texto" : "",
  };
}

/** ¿Tiene el objeto los datos mínimos que exige su tipo? */
export function isComplete(def, props) {
  if (def.noData) return true;
  return props.dims.length >= def.roles.dims.min && props.measures.length >= def.roles.measures.min;
}

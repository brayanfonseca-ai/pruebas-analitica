// hoja-templates.js — plantillas de "Crear nueva hoja" y miniaturas de diseño.
//
// Una plantilla NO trae gráficos hechos: deja casillas vacías ya ubicadas en la
// rejilla (24 columnas x 12 filas), cada una de un tipo, para que el usuario las
// llene con dimensiones y medidas. Solo se incluyen plantillas cuyos objetos ya
// están implementados; las que requieren "Menú de navegación" llegan después.

import { getType, typeIcon } from "./chart-types.js";

export const GRID_COLS = 24;
export const GRID_ROWS = 12;

const o = (type, x, y, w, h) => ({ type, x, y, w, h });

export const TEMPLATE_CATEGORIES = [
  { key: "dashboard-filters", label: "Dashboard with filters" },
  { key: "dashboard-filters-nav", label: "Dashboard with filters and navigation" },
  { key: "analysis-filters", label: "Analysis with filters" },
  { key: "analysis-filters-nav", label: "Analysis with filters and navigation" },
  { key: "report-filters", label: "Report with filters" },
  { key: "report-filters-nav", label: "Report with filters and navigation" },
  { key: "extended", label: "Extended sheet" },
];

export const TEMPLATES = [
  { key: "empty", label: "Empty sheet", category: null, highlight: true, objects: [] },
  {
    key: "kpis-filters-top", label: "KPIs with filters on top", category: "dashboard-filters", highlight: true,
    objects: [
      o("filterpane", 0, 0, 24, 2),
      o("kpi", 0, 2, 8, 2), o("kpi", 8, 2, 8, 2), o("kpi", 16, 2, 8, 2),
      o("bar", 0, 4, 12, 4), o("line", 12, 4, 12, 4),
      o("pie", 0, 8, 12, 4), o("scatter", 12, 8, 12, 4),
    ],
  },
  {
    key: "kpis-filters-side", label: "KPIs with filters on side", category: "dashboard-filters", highlight: false,
    objects: [
      o("filterpane", 0, 0, 4, 12),
      o("kpi", 4, 0, 7, 2), o("kpi", 11, 0, 7, 2), o("kpi", 18, 0, 6, 2),
      o("bar", 4, 2, 10, 5), o("line", 14, 2, 10, 5),
      o("pie", 4, 7, 10, 5), o("scatter", 14, 7, 10, 5),
    ],
  },
  {
    key: "charts-filters-side", label: "Charts with filters on side", category: "analysis-filters", highlight: true,
    objects: [
      o("filterpane", 0, 0, 4, 12),
      o("bar", 4, 0, 10, 6), o("line", 14, 0, 10, 6),
      o("table", 4, 6, 20, 6),
    ],
  },
  {
    key: "kpis-filters-side-table", label: "KPIs with filters on side", category: "analysis-filters", highlight: false,
    objects: [
      o("filterpane", 0, 0, 4, 12),
      o("kpi", 4, 0, 7, 2), o("kpi", 11, 0, 7, 2), o("kpi", 18, 0, 6, 2),
      o("bar", 4, 2, 7, 5), o("bar", 11, 2, 7, 5), o("bar", 18, 2, 6, 5),
      o("table", 4, 7, 20, 5),
    ],
  },
  {
    key: "kpis-filters-top-table", label: "KPIs with filters on top and straight table", category: "report-filters", highlight: true,
    objects: [
      o("filterpane", 0, 0, 24, 2),
      o("kpi", 0, 2, 8, 2), o("kpi", 8, 2, 8, 2), o("kpi", 16, 2, 8, 2),
      o("table", 0, 4, 24, 8),
    ],
  },
  {
    key: "five-charts-filters-side", label: "Five charts with filters on side", category: "extended", highlight: true,
    objects: [
      o("filterpane", 0, 0, 4, 12),
      o("bar", 4, 0, 10, 4), o("line", 14, 0, 10, 4),
      o("pie", 4, 4, 10, 4), o("combo", 14, 4, 10, 4),
      o("table", 4, 8, 20, 4),
    ],
  },
];

const KIND_CLASS = { filterpane: "t-filter", kpi: "t-kpi", table: "t-table", text: "t-text" };

/**
 * Miniatura del diseño: cajas proporcionales con el ícono del tipo.
 * Sirve para plantillas y para las miniaturas del panel Hojas.
 */
export function layoutThumb(objects, rows = GRID_ROWS) {
  const maxRows = Math.max(rows, ...objects.map((x) => x.y + x.h), 1);
  if (!objects.length) {
    return `<div class="ho-thumb empty">${typeIcon("bar")}</div>`;
  }
  return `<div class="ho-thumb">${objects.map((x) => {
    const def = getType(x.type);
    const cls = KIND_CLASS[x.type] || "t-chart";
    const style = `left:${(x.x / GRID_COLS) * 100}%;top:${(x.y / maxRows) * 100}%;width:${(x.w / GRID_COLS) * 100}%;height:${(x.h / maxRows) * 100}%;`;
    const inner = x.type === "kpi" ? "#1" : def ? typeIcon(def.icon) : "";
    return `<span class="ho-thumb-box ${cls}" style="${style}">${inner}</span>`;
  }).join("")}</div>`;
}

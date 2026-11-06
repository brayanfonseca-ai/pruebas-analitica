// app-modelo.js — Visor del modelo (solo lectura), estilo lienzo Qlik. Pinta cada
// tabla como una CAJA (cabecera = nombre + nº de filas, una fila por campo, los
// campos clave marcados) y cada asociación como una LÍNEA SVG entre cajas con su
// etiqueta 1:1 / 1:N / N:N. Un rail vertical a la derecha permite acercar/alejar/
// ajustar. Los datos vienen tal cual de GET /model (getModel): nada se calcula aquí.

import { getModel } from "./api.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const TYPE_LABEL = {
  "one-to-one": "1 : 1",
  "one-to-many": "1 : N",
  "many-to-many": "N : N",
};

// Dimensiones de layout.
const BOX_W = 184;
const COL_GAP = 120;   // separación horizontal entre columnas
const ROW_GAP = 40;    // separación vertical entre cajas de una columna
const PAD = 30;        // margen del lienzo
const HEAD_H = 34;     // alto aproximado de la cabecera de la caja
const FIELD_H = 25;    // alto aproximado por fila de campo

function boxHeight(n) {
  const fields = (n.fields || []).length;
  return HEAD_H + Math.min(fields, 8) * FIELD_H + 8;
}

// Auto-layout determinista: columnas por "profundidad de asociación" vía BFS desde
// el nodo más conectado; los nodos sin conexión caen en la última columna.
function layout(nodes, edges) {
  const byTable = new Map(nodes.map((n) => [n.table, n]));
  const adj = new Map(nodes.map((n) => [n.table, new Set()]));
  edges.forEach((e) => {
    if (adj.has(e.from) && adj.has(e.to)) {
      adj.get(e.from).add(e.to);
      adj.get(e.to).add(e.from);
    }
  });

  // Orden determinista: más conexiones primero, luego por nombre.
  const degree = (t) => adj.get(t)?.size || 0;
  const roots = [...nodes].sort((a, b) =>
    degree(b.table) - degree(a.table) || a.table.localeCompare(b.table));

  const depth = new Map();
  const queue = [];
  roots.forEach((r) => {
    if (!depth.has(r.table)) {
      depth.set(r.table, 0);
      queue.push(r.table);
      while (queue.length) {
        const cur = queue.shift();
        const d = depth.get(cur);
        [...adj.get(cur)].sort().forEach((nb) => {
          if (!depth.has(nb)) { depth.set(nb, d + 1); queue.push(nb); }
        });
      }
    }
  });
  nodes.forEach((n) => { if (!depth.has(n.table)) depth.set(n.table, 0); });

  // Agrupa por columna (profundidad).
  const cols = new Map();
  nodes.forEach((n) => {
    const d = depth.get(n.table) || 0;
    if (!cols.has(d)) cols.set(d, []);
    cols.get(d).push(n);
  });

  const positions = new Map();
  let maxBottom = 0;
  [...cols.keys()].sort((a, b) => a - b).forEach((d, colIdx) => {
    const x = PAD + colIdx * (BOX_W + COL_GAP);
    let y = PAD;
    cols.get(d).sort((a, b) => a.table.localeCompare(b.table)).forEach((n) => {
      const h = boxHeight(n);
      positions.set(n.table, { x, y, w: BOX_W, h });
      y += h + ROW_GAP;
      maxBottom = Math.max(maxBottom, y);
    });
  });

  const colCount = cols.size;
  const width = PAD * 2 + colCount * BOX_W + Math.max(0, colCount - 1) * COL_GAP;
  const height = Math.max(maxBottom, 300) + PAD;
  return { positions, width, height, byTable };
}

// Construye un path tipo "manhattan" suave entre los centros de los lados de dos cajas.
function edgePath(a, b) {
  const ax = a.x + a.w, ay = a.y + a.h / 2;   // salida por el lado derecho
  const bx = b.x, by = b.y + b.h / 2;         // entrada por el lado izquierdo
  // Si b está a la izquierda de a, invierte para que la curva mire bien.
  let x1 = ax, y1 = ay, x2 = bx, y2 = by;
  if (b.x < a.x) { x1 = a.x; x2 = b.x + b.w; }
  const mx = (x1 + x2) / 2;
  return { d: `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`, lx: mx, ly: (y1 + y2) / 2 };
}

export async function render(mount, ctx) {
  mount.innerHTML = `
    <div class="q-subtoolbar">
      <span class="q-sub-title">Visor del modelo</span>
      <div class="q-subtabs"><button class="q-subtab active" type="button">Modelo</button></div>
      <span class="q-sub-spacer"></span>
    </div>
    <div id="modelBox"><p style="color:var(--q-muted);">Cargando modelo…</p></div>`;

  let model;
  try {
    model = await getModel(ctx.appId);
  } catch (err) {
    mount.querySelector("#modelBox").innerHTML = `<p style="color:#c0392b;">No se pudo cargar el modelo: ${esc(err.message)}</p>`;
    return;
  }

  const nodes = model.nodes || [];
  const edges = model.edges || [];
  const warnings = model.warnings || [];
  const box = mount.querySelector("#modelBox");

  if (!nodes.length) {
    box.innerHTML = `<p style="color:var(--q-muted);">El modelo está vacío. Sube tablas en el Gestor de datos.</p>`;
    return;
  }

  const warnHtml = warnings.length ? `
    <div class="q-warn-banner">
      <strong>⚠ Advertencias del modelo</strong>
      <ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>
    </div>` : "";

  // Campos que participan en alguna asociación (se marcan como clave).
  const keyFields = new Map(); // table -> Set(field)
  edges.forEach((e) => {
    (e.fields || []).forEach((f) => {
      [e.from, e.to].forEach((t) => {
        if (!keyFields.has(t)) keyFields.set(t, new Set());
        keyFields.get(t).add(f);
      });
    });
  });

  const { positions, width, height } = layout(nodes, edges);

  const keyIco = `<svg class="q-model-key-ico" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8" cy="8" r="5"/><path d="M11.5 11.5 20 20M16 16l2-2M18 18l2-2"/></svg>`;

  const boxesHtml = nodes.map((n) => {
    const p = positions.get(n.table);
    const keys = keyFields.get(n.table) || new Set();
    const fieldsHtml = (n.fields || []).map((f) => {
      const isKey = keys.has(f);
      return `<li class="${isKey ? "is-key" : ""}">${isKey ? keyIco : ""}<span>${esc(f)}</span></li>`;
    }).join("");
    return `
      <div class="q-model-box" style="left:${p.x}px; top:${p.y}px; width:${p.w}px;">
        <div class="q-model-box-head">${esc(n.table)} <span class="small">${n.rows ?? "?"} filas</span></div>
        <ul class="q-model-box-fields">${fieldsHtml || `<li class="small">(sin campos)</li>`}</ul>
      </div>`;
  }).join("");

  const pathsHtml = edges.map((e) => {
    const a = positions.get(e.from);
    const b = positions.get(e.to);
    if (!a || !b) return "";
    const { d, lx, ly } = edgePath(a, b);
    const label = TYPE_LABEL[e.type] || esc(e.type);
    return `<path d="${d}"></path>
            <text class="edge-label" x="${lx}" y="${ly - 4}" text-anchor="middle">${esc(label)}</text>`;
  }).join("");

  box.innerHTML = `
    ${warnHtml}
    <div class="q-model-wrap">
      <div class="q-model-viewport" id="modelViewport">
        <div class="q-model-canvas" id="modelCanvas" style="width:${width}px; height:${height}px;">
          <svg class="q-model-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${pathsHtml}</svg>
          ${boxesHtml}
        </div>
        <div class="q-zoom-rail">
          <button class="q-zoom-btn" id="zoomIn" title="Acercar" aria-label="Acercar">+</button>
          <button class="q-zoom-btn" id="zoomOut" title="Alejar" aria-label="Alejar">−</button>
          <button class="q-zoom-btn" id="zoomFit" title="Ajustar" aria-label="Ajustar">⤢</button>
        </div>
      </div>
    </div>`;

  // ---- Rail de zoom (transform: scale sobre el lienzo) ----
  const canvas = box.querySelector("#modelCanvas");
  let zoom = 1;
  const apply = () => { canvas.style.transform = `scale(${zoom})`; };
  box.querySelector("#zoomIn").addEventListener("click", () => { zoom = Math.min(2.5, zoom + 0.15); apply(); });
  box.querySelector("#zoomOut").addEventListener("click", () => { zoom = Math.max(0.4, zoom - 0.15); apply(); });
  box.querySelector("#zoomFit").addEventListener("click", () => { zoom = 1; apply(); });
}

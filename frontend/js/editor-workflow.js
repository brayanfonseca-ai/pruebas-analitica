// editor-workflow.js — «Ver una vista previa de los datos» como WORKFLOW visual.
//
// Lee el script del editor (bloques LIB CONNECT / [tabla]: LOAD … ; SQL … / FROM [lib://…]) y el modelo
// cargado (/tables) y dibuja el recorrido de los datos en 5 etapas conectadas:
//   Fuente → Extracción → Transformación (LOAD) → Tabla del modelo → Asociaciones (campos en común)
// Cada nodo es clicable: abajo se muestran sus campos (los comentados con // aparecen tachados) y una
// muestra real de datos. Nada se calcula en el navegador salvo el análisis del texto del script.

import { listTables } from "./api.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtN = (n) => (n == null ? "—" : Number(n).toLocaleString("es-CO"));

/* ----------------------- Análisis del script ----------------------- */
export function parseScriptFlow(text) {
  const lines = String(text || "").split(/\r?\n/);
  const blocks = [];
  let conn = null, cur = null, section = "Principal";
  const flush = () => { if (cur) { blocks.push(cur); cur = null; } };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    let m;
    if ((m = t.match(/^\/\/\/\$tab\s*(.*)$/i))) { flush(); section = m[1].trim() || "Principal"; continue; }
    if ((m = t.match(/^LIB\s+CONNECT\s+TO\s+'((?:[^']|'')*)'/i))) { flush(); conn = m[1].replace(/''/g, "'"); continue; }
    if ((m = t.match(/^\[([^\]]+)\]\s*:\s*$/)) || (m = t.match(/^([\p{L}_][\p{L}\w.]*)\s*:\s*$/u))) {
      flush();
      cur = { name: m[1], conn, section, line: i, fields: [], where: null, distinct: false, sql: null, file: null, from: null };
      continue;
    }
    if (!cur) continue;
    if (/^LOAD\b/i.test(t)) { if (/^LOAD\s+DISTINCT\b/i.test(t)) cur.distinct = true; const rest = t.replace(/^LOAD\b\s*(DISTINCT\b\s*)?/i, ""); if (rest) addFields(cur, rest, false, i); continue; }
    if ((m = t.match(/^SQL\s+(.+?);?$/i))) {
      cur.sql = m[1];
      const f = cur.sql.match(/FROM\s+((?:"[^"]+"|\w+)(?:\.(?:"[^"]+"|\w+))*)/i);
      cur.from = f ? f[1].replace(/"/g, "") : null;
      flush();
      continue;
    }
    if ((m = t.match(/^FROM\s+\[lib:\/\/([^/\]]+)\/([^\]]+)\]/i))) { cur.file = m[2]; cur.conn = cur.conn || m[1]; cur.from = m[2]; if (t.endsWith(";")) flush(); continue; }
    if ((m = t.match(/^WHERE\s+(.+?);?$/i))) { cur.where = m[1]; continue; }
    if (t.startsWith("//")) {
      const rest = t.replace(/^\/\/+\s*/, "");
      if (rest.startsWith("[")) addFields(cur, rest, true, i); // campo comentado = no se carga
      continue;                                                 // cualquier otro comentario es documentación
    }
    if (t) addFields(cur, t, false, i);
    if (t.endsWith(";") && !cur.sql && !cur.file) { /* fin del LOAD; seguirá SQL o FROM */ }
  }
  flush();
  return blocks;
}

function addFields(b, chunk, commented, line) {
  const clean = chunk.replace(/;\s*$/, "");
  for (const part of clean.split(/,(?![^\[]*\])/)) {
    const p = part.trim();
    if (!p || /^FROM\b|^SQL\b|^WHERE\b/i.test(p)) continue;
    const as = p.match(/^(.*?)\s+AS\s+\[?([^\]]+)\]?$/i);
    const src = (as ? as[1] : p).trim().replace(/^\[|\]$/g, "");
    if (!src) continue;
    b.fields.push({ source: src, name: as ? as[2].trim() : src, renamed: !!as, commented, line });
  }
}

/* ----------------------- Modal ----------------------- */
export async function openWorkflow({ appId, scriptText, onJump }) {
  const bd = document.createElement("div");
  bd.className = "ed-modal-backdrop wf-bd";
  bd.innerHTML = `
    <div class="ed-modal wf-modal" role="dialog" aria-modal="true" aria-label="Flujo de datos">
      <div class="ed-modal-head wf-head">
        <div class="wf-title"><span class="wf-logo"></span><div><h3>Flujo de datos</h3><small>Del origen al modelo · según el script y la última carga</small></div></div>
        <div class="wf-legend"><span><i class="lg-src"></i>Fuente</span><span><i class="lg-ext"></i>Extracción</span><span><i class="lg-tr"></i>Transformación</span><span><i class="lg-mod"></i>Modelo</span><span><i class="lg-as"></i>Asociación</span></div>
        <button class="ho-x" data-close aria-label="Cerrar">✕</button>
      </div>
      <div class="ed-modal-body wf-body"><div class="wf-loading"><span class="wf-spin"></span>Armando el flujo…</div></div>
    </div>`;
  document.body.appendChild(bd);
  const close = () => { bd.remove(); window.removeEventListener("resize", redraw); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  bd.querySelector("[data-close]").addEventListener("click", close);
  bd.addEventListener("mousedown", (e) => { if (e.target === bd) close(); });

  let tables = [];
  try { tables = await listTables(appId); } catch (e) { bd.querySelector(".wf-body").innerHTML = `<p class="wf-err">${esc(e.message)}</p>`; return; }
  const blocks = parseScriptFlow(scriptText);
  const byName = new Map(tables.map((t) => [t.name.toLowerCase(), t]));

  // Nodos por tabla: une el bloque del script con la tabla cargada (si existe).
  const flows = [];
  const seen = new Set();
  for (const b of blocks) {
    const t = byName.get(b.name.toLowerCase());
    seen.add(b.name.toLowerCase());
    flows.push({ name: b.name, block: b, table: t || null });
  }
  for (const t of tables) if (!seen.has(t.name.toLowerCase())) flows.push({ name: t.name, block: null, table: t });

  // Asociaciones: campos con el mismo nombre en 2+ tablas del modelo.
  const fieldOwners = new Map();
  for (const f of flows) {
    const cols = f.table ? f.table.columns.map((c) => c.name) : (f.block ? f.block.fields.filter((x) => !x.commented).map((x) => x.name) : []);
    for (const c of cols) { const k = c.toLowerCase(); if (!fieldOwners.has(k)) fieldOwners.set(k, { name: c, tables: new Set() }); fieldOwners.get(k).tables.add(f.name); }
  }
  const assocs = [...fieldOwners.values()].filter((a) => a.tables.size > 1).map((a) => ({ name: a.name, tables: [...a.tables] }));

  // Fuentes únicas.
  const sources = [];
  const srcKey = (f) => (f.block?.conn ? `c:${f.block.conn}` : f.block?.file ? "c:DataFiles" : f.table ? `f:${f.table.source_name || "Archivo"}` : "c:?");
  for (const f of flows) {
    const k = srcKey(f);
    if (!sources.some((s) => s.key === k)) {
      const label = k.startsWith("c:") ? k.slice(2) : k.slice(2);
      sources.push({ key: k, label, kind: k === "c:DataFiles" || k.startsWith("f:") ? "file" : "conn" });
    }
    f.src = k;
  }

  const totalRows = flows.reduce((a, f) => a + (f.table?.rows || 0), 0);
  const totalCommented = flows.reduce((a, f) => a + (f.block ? f.block.fields.filter((x) => x.commented).length : 0), 0);
  const body = bd.querySelector(".wf-body");
  body.innerHTML = `
    <div class="wf-kpis">
      <div><b>${sources.length}</b><span>${sources.length === 1 ? "fuente" : "fuentes"}</span></div>
      <div><b>${flows.length}</b><span>${flows.length === 1 ? "tabla" : "tablas"}</span></div>
      <div><b>${fmtN(totalRows)}</b><span>filas en el modelo</span></div>
      <div><b>${assocs.length}</b><span>${assocs.length === 1 ? "asociación" : "asociaciones"}</span></div>
      <div class="${totalCommented ? "warn" : ""}"><b>${totalCommented}</b><span>campos comentados (no se cargan)</span></div>
    </div>
    <div class="wf-canvas" id="wfCanvas">
      <svg class="wf-edges" id="wfEdges"></svg>
      <div class="wf-col"><div class="wf-col-h"><span class="n">1</span>Fuente</div>
        ${sources.map((s) => `<div class="wf-node src" data-node="${esc(s.key)}"><span class="wf-ic">${s.kind === "conn" ? icoCloud() : icoFile()}</span>
          <div><b>${esc(s.label)}</b><small>${s.kind === "conn" ? "Conexión" : "Archivo"} · ${flows.filter((f) => f.src === s.key).length} tabla(s)</small></div></div>`).join("")}</div>
      <div class="wf-col"><div class="wf-col-h"><span class="n">2</span>Extracción</div>
        ${flows.map((f, i) => `<div class="wf-node ext" data-node="ext${i}" data-from="${esc(f.src)}"><span class="wf-ic">${icoDb()}</span>
          <div><b title="${esc(f.block?.from || f.table?.source_name || f.name)}">${esc(f.block?.from || f.table?.source_name || f.name)}</b>
          <small>${f.block?.sql ? "SQL · " + esc(shortSql(f.block.sql)) : f.block?.file ? "Archivo · lib://" : "Carga directa"}</small></div></div>`).join("")}</div>
      <div class="wf-col"><div class="wf-col-h"><span class="n">3</span>Transformación</div>
        ${flows.map((f, i) => {
          const b = f.block, on = b ? b.fields.filter((x) => !x.commented).length : (f.table?.columns.length || 0);
          const off = b ? b.fields.filter((x) => x.commented).length : 0, ren = b ? b.fields.filter((x) => x.renamed && !x.commented).length : 0;
          return `<div class="wf-node tr" data-node="tr${i}" data-from="ext${i}"><span class="wf-ic">${icoFx()}</span>
          <div><b>LOAD ${on} campo${on === 1 ? "" : "s"}</b>
          <small class="wf-tags">${off ? `<em class="off">${off} comentado${off === 1 ? "" : "s"}</em>` : ""}${ren ? `<em>${ren} renombre${ren === 1 ? "" : "s"}</em>` : ""}${b?.where ? `<em>WHERE</em>` : ""}${b?.distinct ? `<em>DISTINCT</em>` : ""}${!off && !ren && !b?.where && !b?.distinct ? "Sin cambios" : ""}</small></div></div>`;
        }).join("")}</div>
      <div class="wf-col"><div class="wf-col-h"><span class="n">4</span>Modelo</div>
        ${flows.map((f, i) => `<div class="wf-node mod ${f.table ? "" : "pending"}" data-node="mod${i}" data-from="tr${i}" data-i="${i}" tabindex="0" role="button"><span class="wf-ic">${icoTable()}</span>
          <div><b>${esc(f.name)}</b><small>${f.table ? `${fmtN(f.table.rows)} filas · ${f.table.columns.length} campos` : "Aún no cargada: pulsa Cargar datos"}</small></div>
          ${f.table ? `<span class="wf-bar" style="--w:${totalRows ? Math.max(4, Math.round((f.table.rows / totalRows) * 100)) : 0}%"></span>` : ""}</div>`).join("")}</div>
      <div class="wf-col"><div class="wf-col-h"><span class="n">5</span>Asociaciones</div>
        ${assocs.length ? assocs.map((a, j) => `<div class="wf-node as" data-node="as${j}" data-from="${a.tables.map((t) => "mod" + flows.findIndex((f) => f.name === t)).join(" ")}"><span class="wf-ic">${icoLink()}</span>
          <div><b>${esc(a.name)}</b><small>${a.tables.length} tablas</small></div></div>`).join("")
        : `<div class="wf-empty">Sin campos en común entre tablas.<br><small>Si deberían cruzarse, renombra con AS para que coincidan.</small></div>`}</div>
    </div>
    <div class="wf-detail" id="wfDetail"><div class="wf-detail-empty">Haz clic en una tabla del <b>Modelo</b> para ver sus campos y una muestra de los datos.</div></div>`;

  const canvas = body.querySelector("#wfCanvas");
  const svg = body.querySelector("#wfEdges");
  function redraw() {
    const cr = canvas.getBoundingClientRect();
    svg.setAttribute("width", canvas.scrollWidth); svg.setAttribute("height", canvas.scrollHeight);
    let paths = "";
    canvas.querySelectorAll(".wf-node[data-from]").forEach((n) => {
      for (const fromId of n.dataset.from.split(" ")) {
        const from = canvas.querySelector(`.wf-node[data-node="${CSS.escape(fromId)}"]`);
        if (!from) continue;
        const a = from.getBoundingClientRect(), b = n.getBoundingClientRect();
        const x1 = a.right - cr.left + canvas.scrollLeft, y1 = a.top + a.height / 2 - cr.top + canvas.scrollTop;
        const x2 = b.left - cr.left + canvas.scrollLeft, y2 = b.top + b.height / 2 - cr.top + canvas.scrollTop;
        const dx = Math.max(30, (x2 - x1) / 2);
        const cls = n.classList.contains("as") ? "as" : n.classList.contains("pending") ? "pending" : "";
        paths += `<path class="${cls}" data-to="${esc(n.dataset.node)}" data-from="${esc(fromId)}" d="M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}"/>`;
      }
    });
    svg.innerHTML = paths;
  }
  requestAnimationFrame(redraw);
  window.addEventListener("resize", redraw);

  // Resaltar el recorrido de una tabla al pasar el cursor.
  const chainOf = (i) => [`mod${i}`, `tr${i}`, `ext${i}`, flows[i].src];
  const highlight = (ids) => {
    canvas.classList.toggle("focus", !!ids);
    canvas.querySelectorAll(".wf-node").forEach((n) => n.classList.toggle("hl", !!ids && ids.includes(n.dataset.node)));
    svg.querySelectorAll("path").forEach((p) => p.classList.toggle("hl", !!ids && ids.includes(p.dataset.to) && ids.includes(p.dataset.from)));
  };
  canvas.querySelectorAll(".wf-node[data-i], .wf-node.ext, .wf-node.tr").forEach((n) => {
    const i = Number(n.dataset.i ?? n.dataset.node.replace(/\D/g, ""));
    n.addEventListener("mouseenter", () => highlight(chainOf(i)));
    n.addEventListener("mouseleave", () => highlight(null));
    n.addEventListener("click", () => showDetail(i));
  });

  function showDetail(i) {
    const f = flows[i];
    canvas.querySelectorAll(".wf-node.sel").forEach((x) => x.classList.remove("sel"));
    canvas.querySelectorAll(`[data-node="mod${i}"], [data-node="tr${i}"], [data-node="ext${i}"]`).forEach((x) => x.classList.add("sel"));
    const det = body.querySelector("#wfDetail");
    const b = f.block, t = f.table;
    const typeOf = (name) => t?.columns.find((c) => c.name === name)?.type || "";
    const fields = b ? b.fields : (t ? t.columns.map((c) => ({ source: c.name, name: c.name, commented: false })) : []);
    const cols = t ? t.columns.map((c) => c.name) : [];
    det.innerHTML = `
      <div class="wf-det-head"><div><h4>${esc(f.name)}</h4><small>${f.block?.conn ? "Conexión " + esc(f.block.conn) + " · " : ""}${t ? `${fmtN(t.rows)} filas · ${t.columns.length} campos` : "sin datos cargados"}</small></div>
        ${b && onJump ? `<button type="button" class="ed-tb-btn ghost" id="wfJump">Ir al bloque en el script</button>` : ""}</div>
      <div class="wf-det-grid">
        <div class="wf-fields">${fields.map((x) => `<span class="wf-field ${x.commented ? "off" : ""}" title="${x.commented ? "Comentado con //: no se carga" : esc(typeOf(x.name))}">
          ${esc(x.renamed ? `${x.source} → ${x.name}` : x.name)}${!x.commented && typeOf(x.name) ? `<i>${esc(typeOf(x.name))}</i>` : ""}</span>`).join("")}</div>
        <div class="wf-sample">${t && t.preview?.length ? `<table class="ho-table"><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
          <tbody>${t.preview.slice(0, 10).map((r) => `<tr>${cols.map((c) => `<td>${esc(r[c])}</td>`).join("")}</tr>`).join("")}</tbody></table>` : `<div class="wf-detail-empty">Sin muestra de datos.</div>`}</div>
      </div>`;
    det.querySelector("#wfJump")?.addEventListener("click", () => { close(); onJump(b.line); });
    det.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  if (flows.length) showDetail(0);
}

const shortSql = (s) => (s.length > 38 ? s.slice(0, 36) + "…" : s);
const I = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const icoCloud = () => I('<path d="M7.2 18.5a4.2 4.2 0 0 1-.7-8.3 5.6 5.6 0 0 1 10.8 1.2 3.6 3.6 0 0 1-.3 7.1z" fill="currentColor" fill-opacity=".15"/>');
const icoFile = () => I('<path d="M6 3h8l4 4v14H6z" fill="currentColor" fill-opacity=".15"/><path d="M14 3v4h4"/>');
const icoDb = () => I('<ellipse cx="12" cy="5.5" rx="7" ry="2.6" fill="currentColor" fill-opacity=".15"/><path d="M5 5.5v13c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6v-13M5 12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6"/>');
const icoFx = () => I('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.3" fill="currentColor" fill-opacity=".15"/><circle cx="9" cy="17" r="2.3" fill="currentColor" fill-opacity=".15"/>');
const icoTable = () => I('<rect x="3" y="4" width="18" height="16" rx="2.5" fill="currentColor" fill-opacity=".15"/><path d="M3 9h18M9 9v11"/>');
const icoLink = () => I('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/>');

// app-datos.js — Gestor de datos (estilo enterprise). Sube archivos al backend,
// muestra el perfilado real de cada columna (tipo, completitud, distintos,
// muestra), una vista previa de filas, la preparación visual de campos
// (renombrar / forzar tipo / ocultar) y el mapa de asociaciones entre tablas.
// Nada se calcula en JS: el modelo lo construye el backend.
//
// Asociación por nombre de campo (concepto Qlik): compartir un campo asocia las
// tablas; compartir más de uno crea una clave sintética que conviene resolver.

import {
  listTables, uploadTable, deleteTable,
  recommendAssociations, listAssociations, acceptAssociation, createAssociation, deleteAssociation,
  getModel, getFieldOverrides, putFieldOverrides,
} from "./api.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const NF = new Intl.NumberFormat("es-CO");

const SV = (d, extra = "") => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
const ICON = {
  table: SV(`<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10"/>`),
  upload: SV(`<path d="M12 15V4M8 8l4-4 4 4"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>`),
  trash: SV(`<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>`),
  close: SV(`<path d="M6 6l12 12M18 6 6 18"/>`),
  edit: SV(`<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>`),
  warn: SV(`<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17h.01"/>`),
  link: SV(`<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>`),
  eye: SV(`<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>`),
  list: SV(`<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>`),
  text: SV(`<path d="M4 7V5h16v2M12 5v14M9 19h6"/>`),
  number: SV(`<path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16"/>`),
  date: SV(`<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/>`),
  empty: SV(`<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>`),
};

const TYPE_LABEL = { text: "Texto", number: "Número", date: "Fecha" };
const typeIcon = (t) => ICON[t] || ICON.text;

export async function render(mount, ctx) {
  const canImport = ctx.can("data:import");
  const canPrepare = ctx.can("data:import") || ctx.can("charts:edit");

  mount.innerHTML = `
    <div class="q-subtoolbar">
      <span class="q-sub-title">Gestor de datos</span>
      <div class="q-subtabs">
        <button class="q-subtab active" type="button" data-dmtab="tablas">Tablas</button>
        <button class="q-subtab" type="button" data-dmtab="asoc">Asociaciones<span class="dm-tab-badge" id="dmWarnBadge" hidden></span></button>
      </div>
      <span class="q-sub-spacer"></span>
      <div class="q-sub-actions">
        ${canImport ? `<button class="dm-btn-primary" id="addDataBtn"><span class="dm-ic">${ICON.upload}</span>Agregar datos</button>` : ""}
      </div>
    </div>

    <div class="dm-wrap">
      <section id="dmTablas">
        <div id="dmSummary"></div>
        <div id="tablesBox"><p class="dm-muted">Cargando…</p></div>
      </section>

      <section id="dmAsoc" hidden>
        <div id="synthBanner"></div>
        <div class="dm-panel">
          <div class="dm-panel-head"><h3>Mapa de asociaciones</h3></div>
          <div class="dm-graph" id="bubbleBox"></div>
        </div>
        <div id="recBox"></div>
        ${canImport ? `<div id="assocEditor"></div>` : ""}
      </section>
    </div>

    <div class="q-modal-backdrop" id="uploadBackdrop" hidden>
      <div class="q-modal">
        <div class="q-modal-head">
          <h2>Agregar datos</h2>
          <button class="q-modal-x" id="uploadX" aria-label="Cerrar">${ICON.close}</button>
        </div>
        <div class="q-modal-body">
          <div class="q-dropzone" id="dropzone">
            <svg viewBox="0 0 24 24"><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>
            <strong>Suelte un archivo aquí o haga clic para seleccionar</strong>
            <span class="muted">.xlsx, .xls, .csv</span>
            <input type="file" id="fileInput" accept=".xlsx,.xls,.csv" hidden />
          </div>
          <p class="q-upload-status" id="uploadStatus"></p>
        </div>
        <div class="q-modal-foot">
          <button class="q-ed-btn ghost" id="uploadCancel">Cerrar</button>
        </div>
      </div>
    </div>`;

  let tables = [];
  let model = null;
  const ui = { view: {} }; // vista por tabla: campos | preview | prep

  async function refresh() {
    try { tables = await listTables(ctx.appId); } catch (e) { console.error("listTables", e); tables = tables || []; }
    try { model = await getModel(ctx.appId); } catch (e) { console.error("getModel", e); model = model || { nodes: [], edges: [], warnings: [] }; }
    try { renderSummary(); } catch (e) { console.error("renderSummary", e); }
    try { renderTables(); } catch (e) { console.error("renderTables", e); }
    try { renderSynthBanner(); } catch (e) { console.error("renderSynthBanner", e); }
    try { await renderAssociations(); } catch (e) { console.error("renderAssociations", e); }
    try { renderAssocEditor(); } catch (e) { console.error("renderAssocEditor", e); }
  }

  /* ---------------- Pestañas principales ---------------- */
  mount.querySelectorAll("[data-dmtab]").forEach((tab) =>
    tab.addEventListener("click", () => {
      mount.querySelectorAll("[data-dmtab]").forEach((t) => t.classList.toggle("active", t === tab));
      const isAsoc = tab.dataset.dmtab === "asoc";
      mount.querySelector("#dmTablas").hidden = isAsoc;
      mount.querySelector("#dmAsoc").hidden = !isAsoc;
    }));

  /* ---------------- Resumen global ---------------- */
  const completeness = (t) => {
    const total = (t.rows || 0) * (t.columns?.length || 0);
    if (!total) return 100;
    const nulls = t.columns.reduce((s, c) => s + (c.null_count || 0), 0);
    return Math.max(0, Math.min(100, (1 - nulls / total) * 100));
  };

  function renderSummary() {
    const box = mount.querySelector("#dmSummary");
    if (!tables.length) { box.innerHTML = ""; return; }
    const rows = tables.reduce((s, t) => s + (t.rows || 0), 0);
    const cols = tables.reduce((s, t) => s + (t.columns?.length || 0), 0);
    const comp = tables.reduce((s, t) => s + completeness(t), 0) / tables.length;
    const stat = (ico, val, lab) => `<div class="dm-stat"><span class="dm-stat-ico">${ico}</span><div><div class="dm-stat-val">${val}</div><div class="dm-stat-lab">${lab}</div></div></div>`;
    box.innerHTML = `<div class="dm-stats">
      ${stat(ICON.table, NF.format(tables.length), tables.length === 1 ? "Tabla" : "Tablas")}
      ${stat(ICON.list, NF.format(rows), "Filas")}
      ${stat(ICON.number, NF.format(cols), "Columnas")}
      ${stat(ICON.eye, comp.toFixed(1) + "%", "Completitud")}
    </div>`;
  }

  /* ---------------- Tablas ---------------- */
  function renderTables() {
    const box = mount.querySelector("#tablesBox");
    if (!tables.length) {
      box.innerHTML = `<div class="dm-empty"><span class="dm-empty-ico">${ICON.empty}</span>
        <strong>Sin datos</strong>
        <span class="dm-empty-hint">${canImport ? "Agrega un archivo Excel o CSV para empezar." : "No hay tablas cargadas."}</span></div>`;
      return;
    }
    box.innerHTML = tables.map((t) => {
      const comp = completeness(t);
      const view = ui.view[t.id] || "campos";
      return `
      <article class="dm-card" data-card="${esc(t.id)}">
        <header class="dm-card-head">
          <span class="dm-card-ico">${ICON.table}</span>
          <div class="dm-card-title">
            <strong>${esc(t.name)}</strong>
            <span class="dm-muted">${esc(t.source_name || "")}</span>
          </div>
          <div class="dm-badges">
            <span class="dm-badge">${NF.format(t.rows ?? 0)} filas</span>
            <span class="dm-badge">${t.columns.length} columnas</span>
            <span class="dm-badge ${comp >= 98 ? "ok" : comp >= 90 ? "warn" : "bad"}">${comp.toFixed(1)}% completo</span>
          </div>
          <div class="dm-card-actions">
            ${canPrepare ? `<button class="dm-btn-ghost" data-prep-table="${esc(t.id)}"><span class="dm-ic">${ICON.edit}</span>Preparar campos</button>` : ""}
            ${canImport ? `<button class="dm-icon-btn danger" title="Eliminar tabla" data-del-table="${esc(t.id)}">${ICON.trash}</button>` : ""}
          </div>
        </header>
        <div class="dm-seg" role="tablist">
          <button class="dm-seg-btn ${view === "campos" ? "active" : ""}" data-seg="campos" data-t="${esc(t.id)}">Campos</button>
          <button class="dm-seg-btn ${view === "preview" ? "active" : ""}" data-seg="preview" data-t="${esc(t.id)}">Vista previa</button>
        </div>
        <div class="dm-card-body" data-body="${esc(t.id)}"></div>
      </article>`;
    }).join("");

    tables.forEach((t) => drawBody(t));

    box.querySelectorAll("[data-seg]").forEach((b) =>
      b.addEventListener("click", () => {
        ui.view[b.dataset.t] = b.dataset.seg;
        const card = b.closest(".dm-card");
        card.querySelectorAll("[data-seg]").forEach((x) => x.classList.toggle("active", x === b));
        drawBody(tables.find((x) => x.id === b.dataset.t));
      }));

    box.querySelectorAll("[data-del-table]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-del-table");
        const t = tables.find((x) => x.id === id);
        if (!confirm(`¿Eliminar la tabla "${t?.name || id}"?`)) return;
        try { await deleteTable(ctx.appId, id); delete ui.view[id]; await refresh(); }
        catch (err) { alert("No se pudo eliminar: " + err.message); }
      }));

    box.querySelectorAll("[data-prep-table]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-prep-table");
        ui.view[id] = ui.view[id] === "prep" ? "campos" : "prep";
        const card = btn.closest(".dm-card");
        card.querySelectorAll("[data-seg]").forEach((x) => x.classList.toggle("active", x.dataset.seg === ui.view[id]));
        drawBody(tables.find((x) => x.id === id));
      }));
  }

  function bodyEl(t) {
    return Array.from(mount.querySelectorAll("[data-body]")).find((el) => el.dataset.body === t.id);
  }

  function drawBody(t) {
    const el = bodyEl(t);
    if (!el || !t) return;
    const view = ui.view[t.id] || "campos";
    if (view === "preview") return drawPreview(t, el);
    if (view === "prep") return openFieldPrep(t, el);
    drawProfile(t, el);
  }

  /* ---- Perfilado de columnas ---- */
  function drawProfile(t, el) {
    const total = t.rows || 0;
    el.innerHTML = `
      <table class="dm-table">
        <thead><tr><th>Campo</th><th>Tipo</th><th class="dm-w-comp">Completitud</th><th class="dm-num">Distintos</th><th>Muestra</th></tr></thead>
        <tbody>
          ${t.columns.map((c) => {
            const tc = c.total_count || total;
            const comp = tc ? (1 - (c.null_count || 0) / tc) * 100 : 100;
            const sample = (c.sample || []).slice(0, 3);
            return `<tr>
              <td><span class="dm-field"><span class="dm-tico ${esc(c.type)}">${typeIcon(c.type)}</span>${esc(c.name)}</span></td>
              <td><span class="dm-chip ${esc(c.type)}">${TYPE_LABEL[c.type] || esc(c.type)}</span></td>
              <td><div class="dm-meter" title="${(c.null_count || 0)} nulos"><span class="dm-meter-bar ${comp >= 98 ? "ok" : comp >= 90 ? "warn" : "bad"}" style="width:${comp.toFixed(1)}%"></span></div><span class="dm-meter-val">${comp.toFixed(0)}%</span></td>
              <td class="dm-num">${NF.format(c.distinct_count ?? 0)}</td>
              <td class="dm-sample">${sample.map((s) => `<span class="dm-sample-chip">${esc(s)}</span>`).join("")}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>`;
  }

  /* ---- Vista previa de filas ---- */
  function drawPreview(t, el) {
    const rows = t.preview || [];
    if (!rows.length) { el.innerHTML = `<p class="dm-muted dm-pad">Sin filas para previsualizar.</p>`; return; }
    const cols = t.columns.map((c) => c.name);
    el.innerHTML = `
      <div class="dm-scroll">
        <table class="dm-table dm-prev">
          <thead><tr><th class="dm-idx">#</th>${t.columns.map((c) => `<th><span class="dm-field"><span class="dm-tico ${esc(c.type)}">${typeIcon(c.type)}</span>${esc(c.name)}</span></th>`).join("")}</tr></thead>
          <tbody>${rows.map((r, i) => `<tr><td class="dm-idx">${i + 1}</td>${cols.map((k) => {
            const v = r[k];
            const isNum = typeof v === "number";
            return `<td class="${isNum ? "dm-num" : ""}">${v == null || v === "" ? '<span class="dm-null">null</span>' : esc(isNum ? NF.format(v) : v)}</td>`;
          }).join("")}</tr>`).join("")}</tbody>
        </table>
      </div>
      <p class="dm-foot-note">Mostrando ${rows.length} de ${NF.format(t.rows ?? rows.length)} filas.</p>`;
  }

  /* ---- Preparación visual de campos (field overrides) ---- */
  async function openFieldPrep(t, panel) {
    const tableId = t.id;
    panel.innerHTML = `<p class="dm-muted dm-pad">Cargando campos…</p>`;

    let overrides = [];
    try { overrides = await getFieldOverrides(ctx.appId, tableId); }
    catch (e) { console.error("getFieldOverrides", e); overrides = []; }

    const bySource = new Map();
    for (const ov of overrides) {
      bySource.set(ov.source_field, {
        source: ov.source_field, rename: ov.rename || "", type: ov.forced_type || "", hidden: !!ov.hidden,
      });
    }
    for (const c of t.columns) {
      const matched = overrides.some((ov) =>
        (ov.rename && ov.rename === c.name) || (!ov.rename && ov.source_field === c.name));
      if (!matched && !bySource.has(c.name)) {
        bySource.set(c.name, { source: c.name, rename: "", type: "", hidden: false });
      }
    }
    const fields = Array.from(bySource.values());
    const effType = new Map(t.columns.map((c) => [c.name, c.type]));
    const typeOptions = (sel) => ["text", "number", "date"].map((v) =>
      `<option value="${v}"${sel === v ? " selected" : ""}>${TYPE_LABEL[v]}</option>`).join("");

    panel.innerHTML = `
      <div class="dm-prep">
        <div class="dm-prep-head"><span>Campo origen</span><span>Nombre en análisis</span><span>Tipo</span><span>Visible</span></div>
        ${fields.map((f) => {
          const curType = f.type || effType.get(f.rename || f.source) || "text";
          return `
          <div class="dm-prep-row${f.hidden ? " is-hidden" : ""}" data-source="${esc(f.source)}">
            <span class="dm-field"><span class="dm-tico ${esc(curType)}">${typeIcon(curType)}</span>${esc(f.source)}</span>
            <input class="dm-input q-fieldprep-rename" type="text" placeholder="${esc(f.source)}" value="${esc(f.rename)}" aria-label="Nuevo nombre" />
            <select class="dm-input q-fieldprep-type" aria-label="Tipo">${typeOptions(curType)}</select>
            <label class="dm-check"><input type="checkbox" class="q-fieldprep-visible"${f.hidden ? "" : " checked"} /><span class="dm-check-box"></span></label>
          </div>`;
        }).join("")}
      </div>
      <div class="dm-prep-foot">
        <span class="dm-status" data-prep-status></span>
        <button class="dm-btn-ghost" data-prep-cancel>Cancelar</button>
        <button class="dm-btn-primary" data-prep-apply>Aplicar cambios</button>
      </div>`;

    panel.querySelector("[data-prep-cancel]").addEventListener("click", () => {
      ui.view[tableId] = "campos";
      const card = panel.closest(".dm-card");
      card.querySelectorAll("[data-seg]").forEach((x) => x.classList.toggle("active", x.dataset.seg === "campos"));
      drawBody(t);
    });

    panel.querySelector("[data-prep-apply]").addEventListener("click", async () => {
      const status = panel.querySelector("[data-prep-status]");
      const payload = Array.from(panel.querySelectorAll(".dm-prep-row")).map((rowEl) => ({
        source_field: rowEl.getAttribute("data-source"),
        rename: rowEl.querySelector(".q-fieldprep-rename").value.trim(),
        forced_type: rowEl.querySelector(".q-fieldprep-type").value,
        hidden: !rowEl.querySelector(".q-fieldprep-visible").checked,
      }));
      status.className = "dm-status";
      status.textContent = "Aplicando…";
      try {
        await putFieldOverrides(ctx.appId, tableId, payload);
        ui.view[tableId] = "campos";
        await refresh();
      } catch (err) {
        status.className = "dm-status err";
        status.textContent = "Error: " + err.message;
      }
    });
  }

  /* ---------------- Advertencias del modelo ---------------- */
  function renderSynthBanner() {
    const warnings = (model && model.warnings) || [];
    const box = mount.querySelector("#synthBanner");
    const badge = mount.querySelector("#dmWarnBadge");
    badge.hidden = !warnings.length;
    badge.textContent = warnings.length || "";
    if (!warnings.length) { box.innerHTML = ""; return; }
    box.innerHTML = `
      <div class="dm-warn">
        <span class="dm-warn-ico">${ICON.warn}</span>
        <div><strong>Advertencias del modelo</strong>
          <ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>
      </div>`;
  }

  /* ---------------- Mapa de asociaciones (SVG) ---------------- */
  function drawGraph(nodes, edges) {
    const W = 760, H = 340, cx = W / 2, cy = H / 2;
    const maxRows = Math.max(1, ...nodes.map((n) => n.rows || 1));
    const rad = (n) => 24 + 26 * Math.sqrt((n.rows || 1) / maxRows);
    const R = Math.min(W / 2 - 110, H / 2 - 60);
    const pos = {};
    nodes.forEach((n, i) => {
      if (nodes.length === 1) { pos[n.table] = { x: cx, y: cy }; return; }
      const a = (2 * Math.PI * i) / nodes.length - Math.PI / 2;
      pos[n.table] = { x: cx + Math.cos(a) * R * 1.35, y: cy + Math.sin(a) * R };
    });
    const lines = edges.map((e) => {
      const a = pos[e.from], b = pos[e.to];
      if (!a || !b) return "";
      const label = (e.fields || []).join(", ");
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const w = Math.max(40, label.length * 6.2 + 14);
      return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="dm-edge"/>
        <g><rect x="${mx - w / 2}" y="${my - 10}" width="${w}" height="20" rx="10" class="dm-edge-tag"/>
        <text x="${mx}" y="${my + 4}" text-anchor="middle" class="dm-edge-text">${esc(label)}</text></g>`;
    }).join("");
    const circles = nodes.map((n) => {
      const p = pos[n.table], r = rad(n);
      const name = String(n.table).length > 20 ? String(n.table).slice(0, 19) + "…" : n.table;
      return `<g><circle cx="${p.x}" cy="${p.y}" r="${r}" class="dm-node"><title>${esc(n.table)} · ${NF.format(n.rows ?? 0)} filas</title></circle>
        <text x="${p.x}" y="${p.y + 4}" text-anchor="middle" class="dm-node-rows">${NF.format(n.rows ?? 0)}</text>
        <text x="${p.x}" y="${p.y + r + 16}" text-anchor="middle" class="dm-node-name">${esc(name)}</text></g>`;
    }).join("");
    return `<svg viewBox="0 0 ${W} ${H}" class="dm-graph-svg" role="img" aria-label="Mapa de asociaciones">${lines}${circles}</svg>`;
  }

  async function renderAssociations() {
    const graph = mount.querySelector("#bubbleBox");
    const nodes = (model && model.nodes) || [];
    const edges = (model && model.edges) || [];

    if (!nodes.length) {
      graph.innerHTML = `<div class="dm-empty flat"><span class="dm-empty-ico">${ICON.link}</span><strong>Sin tablas</strong><span class="dm-empty-hint">Carga al menos una tabla para ver sus asociaciones.</span></div>`;
    } else {
      graph.innerHTML = drawGraph(nodes, edges) +
        (edges.length ? "" : `<p class="dm-graph-note">Sin enlaces entre tablas.</p>`);
    }

    const recBox = mount.querySelector("#recBox");
    let recs = [];
    try { recs = await recommendAssociations(ctx.appId); } catch { recs = []; }
    const persisted = await listAssociations(ctx.appId).catch(() => []);
    const isPersisted = (r) => persisted.some((p) =>
      ((p.left_table === r.left_table && p.right_table === r.right_table) ||
       (p.left_table === r.right_table && p.right_table === r.left_table)) &&
      JSON.stringify([...r.fields].sort()) === JSON.stringify([...p.fields].sort()));

    const pending = recs.filter((r) => !isPersisted(r));
    let html = "";
    if (pending.length) {
      html += `<div class="dm-panel"><div class="dm-panel-head"><h3>Recomendadas</h3></div>
        ${pending.map((r, i) => `
          <div class="dm-row">
            <div class="dm-row-main"><span class="dm-row-ico">${ICON.link}</span>
              <div><strong>${esc(r.left_table)} <span class="dm-arrow">↔</span> ${esc(r.right_table)}</strong>
                <div class="dm-row-sub">${(r.fields || []).map((f) => `<span class="dm-sample-chip">${esc(f)}</span>`).join("")}${r.confidence != null ? `<span class="dm-conf">${Math.round(r.confidence * 100)}% confianza</span>` : ""}</div></div></div>
            <button class="dm-btn-primary small" data-accept="${i}">Aceptar</button>
          </div>`).join("")}</div>`;
    }
    if (persisted.length) {
      html += `<div class="dm-panel"><div class="dm-panel-head"><h3>Activas</h3></div>
        ${persisted.map((p) => `
          <div class="dm-row">
            <div class="dm-row-main"><span class="dm-row-ico active">${ICON.link}</span>
              <div><strong>${esc(p.left_table)} <span class="dm-arrow">↔</span> ${esc(p.right_table)}</strong>
                <div class="dm-row-sub">${(p.fields || []).map((f) => `<span class="dm-sample-chip">${esc(f)}</span>`).join("")}${p.is_custom ? '<span class="dm-conf">personalizada</span>' : ""}</div></div></div>
            ${canImport ? `<button class="dm-icon-btn danger" title="Quitar" data-del-assoc="${esc(p.id)}">${ICON.trash}</button>` : ""}
          </div>`).join("")}</div>`;
    }
    recBox.innerHTML = html;

    recBox.querySelectorAll("[data-accept]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const r = pending[Number(btn.getAttribute("data-accept"))];
        try {
          await acceptAssociation(ctx.appId, {
            left_table: r.left_table, right_table: r.right_table,
            fields: r.fields, basis: r.basis, confidence: r.confidence,
          });
          await refresh();
        } catch (err) { alert("No se pudo aceptar la asociación: " + err.message); }
      }));
    recBox.querySelectorAll("[data-del-assoc]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        try { await deleteAssociation(ctx.appId, btn.getAttribute("data-del-assoc")); await refresh(); }
        catch (err) { alert("No se pudo quitar: " + err.message); }
      }));
  }

  /* ---------------- Asociación personalizada ---------------- */
  function renderAssocEditor() {
    const box = mount.querySelector("#assocEditor");
    if (!box) return;
    if (tables.length < 2) { box.innerHTML = ""; return; }
    const tableOpts = tables.map((t) => `<option value="${esc(t.name)}">${esc(t.name)}</option>`).join("");
    box.innerHTML = `
      <div class="dm-panel">
        <div class="dm-panel-head"><h3>Nueva asociación</h3></div>
        <div class="dm-form">
          <label class="dm-lab"><span>Tabla origen</span><select class="dm-input" id="assocLeft">${tableOpts}</select></label>
          <label class="dm-lab"><span>Tabla destino</span><select class="dm-input" id="assocRight">${tableOpts}</select></label>
          <label class="dm-lab"><span>Campo compartido</span><input class="dm-input" id="assocField" placeholder="ClienteID" /></label>
          <button class="dm-btn-primary" id="assocCreate">Crear</button>
        </div>
        <p class="dm-status" id="assocStatus"></p>
      </div>`;

    box.querySelector("#assocCreate").addEventListener("click", async () => {
      const left = box.querySelector("#assocLeft").value;
      const right = box.querySelector("#assocRight").value;
      const field = box.querySelector("#assocField").value.trim();
      const status = box.querySelector("#assocStatus");
      status.className = "dm-status err";
      if (left === right) { status.textContent = "Elige dos tablas distintas."; return; }
      if (!field) { status.textContent = "Indica el campo compartido."; return; }
      try {
        await createAssociation(ctx.appId, { left_table: left, right_table: right, fields: [field], basis: "custom" });
        status.textContent = ""; await refresh();
      } catch (err) { status.textContent = "Error: " + err.message; }
    });
  }

  /* ---------------- Modal de subida ---------------- */
  if (canImport) {
    const backdrop = mount.querySelector("#uploadBackdrop");
    const fileInput = mount.querySelector("#fileInput");
    const dropzone = mount.querySelector("#dropzone");
    const status = mount.querySelector("#uploadStatus");

    const open = () => { status.textContent = ""; backdrop.hidden = false; };
    const close = () => { backdrop.hidden = true; };

    mount.querySelector("#addDataBtn").addEventListener("click", open);
    mount.querySelector("#uploadX").addEventListener("click", (e) => { e.preventDefault(); close(); });
    mount.querySelector("#uploadCancel").addEventListener("click", (e) => { e.preventDefault(); close(); });
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !backdrop.hidden) close(); });
    dropzone.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", (e) => { const f = e.target.files[0]; if (f) doUpload(f); e.target.value = ""; });
    ["dragenter", "dragover"].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add("over"); }));
    ["dragleave", "drop"].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove("over"); }));
    dropzone.addEventListener("drop", (e) => { const f = e.dataTransfer?.files?.[0]; if (f) doUpload(f); });

    async function doUpload(file) {
      status.style.color = "";
      status.textContent = `Subiendo "${file.name}"…`;
      try {
        const uploaded = await uploadTable(ctx.appId, file);
        status.textContent = `Cargada: ${uploaded.name} (${uploaded.rows} filas, ${uploaded.columns.length} columnas). Pulsa “Cerrar”.`;
      } catch (err) {
        status.textContent = "Error: " + err.message;
        status.style.color = "#c0392b";
        return;
      }
      try { await refresh(); }
      catch (err) {
        console.error("refresh() tras la subida falló:", err);
        status.textContent += " (aviso: no se pudo refrescar la vista; cierra y recarga.)";
      }
    }
  }

  await refresh();
}

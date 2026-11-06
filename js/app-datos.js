// app-datos.js — Gestor de datos. Sube archivos al backend, muestra el perfilado
// de columnas (tipo lógico, nulos, distintos) que devuelve el motor Python, y una
// vista de burbujas de asociaciones (cada tabla es una burbuja; los enlaces son
// asociaciones). El usuario puede aceptar asociaciones recomendadas o crear una
// personalizada. Nada se calcula en JS: el modelo lo construye el backend.
//
// Concepto de asociación por nombre de campo tomado de Qlik (paráfrasis de
// help.qlik.com "associating-data"): Qlik asocia tablas automáticamente cuando
// comparten nombres de campo; compartir más de un campo crea una CLAVE SINTÉTICA
// que conviene resolver. Aquí el backend detecta ambos casos.

import {
  listTables, uploadTable, deleteTable,
  recommendAssociations, listAssociations, acceptAssociation, createAssociation, deleteAssociation,
  getModel, getFieldOverrides, putFieldOverrides,
} from "./api.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const TYPE_LABEL = { text: "Texto", number: "Número", date: "Fecha" };

export async function render(mount, ctx) {
  const canImport = ctx.can("data:import");
  // El panel de "Preparar campos" es visible para quien pueda importar datos o
  // editar gráficas (preparación visual sin escribir script).
  const canPrepare = ctx.can("data:import") || ctx.can("charts:edit");

  mount.innerHTML = `
    <div class="q-subtoolbar">
      <span class="q-sub-title">Gestor de datos</span>
      <div class="q-subtabs">
        <button class="q-subtab active" type="button">Tablas</button>
        <button class="q-subtab" type="button">Asociaciones</button>
      </div>
      <span class="q-sub-spacer"></span>
      <div class="q-sub-actions">
        ${canImport ? `<button class="q-ed-btn primary" id="addDataBtn">
          <svg viewBox="0 0 24 24"><path d="M12 15V4M8 8l4-4 4 4"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/></svg>
          Agregar datos</button>` : ""}
      </div>
    </div>

    <div id="synthBanner"></div>

    <section class="q-create-section">
      <h2 class="q-create-title">Tablas y perfilado de columnas</h2>
      <div id="tablesBox"><p style="color:var(--q-muted);">Cargando…</p></div>
    </section>

    <section class="q-create-section">
      <h2 class="q-create-title">Asociaciones (vista de burbujas)</h2>
      <div class="q-bubble-wrap" id="bubbleBox"></div>
      <div id="recBox"></div>
      ${canImport ? `<div class="q-assoc-editor" id="assocEditor"></div>` : ""}
    </section>

    <!-- Modal subir archivo (markup reutilizado del antiguo editor-datos.html) -->
    <div class="q-modal-backdrop" id="uploadBackdrop" hidden>
      <div class="q-modal">
        <div class="q-modal-head">
          <h2>Agregar datos</h2>
          <button class="q-modal-x" id="uploadX" aria-label="Cerrar">✕</button>
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

  async function refresh() {
    try { tables = await listTables(ctx.appId); } catch (e) { console.error("listTables", e); tables = tables || []; }
    try { model = await getModel(ctx.appId); } catch (e) { console.error("getModel", e); model = model || { nodes: [], edges: [], warnings: [] }; }
    // Cada render aislado: si uno falla, los demás siguen.
    try { renderTables(); } catch (e) { console.error("renderTables", e); }
    try { renderSynthBanner(); } catch (e) { console.error("renderSynthBanner", e); }
    try { await renderAssociations(); } catch (e) { console.error("renderAssociations", e); }
    try { renderAssocEditor(); } catch (e) { console.error("renderAssocEditor", e); }
  }

  /* ---------------- Perfilado de columnas ---------------- */
  function renderTables() {
    const box = mount.querySelector("#tablesBox");
    if (!tables.length) {
      box.innerHTML = `<p style="color:var(--q-muted);">No hay tablas. ${canImport ? 'Usa “Agregar datos”.' : ""}</p>`;
      return;
    }
    box.innerHTML = tables.map((t) => `
      <div class="q-table-card">
        <div class="q-table-card-head">
          <strong>${esc(t.name)}</strong>
          <span class="muted small">${t.rows ?? "?"} filas · ${t.columns.length} columnas</span>
          ${canPrepare ? `<button class="q-ed-btn ghost small-btn" data-prep-table="${esc(t.id)}">Preparar campos</button>` : ""}
          ${canImport ? `<button class="q-create-add" title="Eliminar tabla" data-del-table="${esc(t.id)}">✕</button>` : ""}
        </div>
        <table class="q-prof-table">
          <thead><tr><th>Columna</th><th>Tipo</th><th>Nulos</th><th>Distintos</th></tr></thead>
          <tbody>
            ${t.columns.map((c) => `
              <tr>
                <td>${esc(c.name)}</td>
                <td><span class="q-type-chip type-${esc(c.type)}">${TYPE_LABEL[c.type] || esc(c.type)}</span></td>
                <td>${c.null_count ?? 0}</td>
                <td>${c.distinct_count ?? 0}</td>
              </tr>`).join("")}
          </tbody>
        </table>
        <div class="q-fieldprep" id="prep-${esc(t.id)}" hidden></div>
      </div>`).join("");

    box.querySelectorAll("[data-del-table]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-del-table");
        const t = tables.find((x) => x.id === id);
        if (!confirm(`¿Eliminar la tabla "${t?.name || id}"?`)) return;
        try { await deleteTable(ctx.appId, id); await refresh(); }
        catch (err) { alert("No se pudo eliminar: " + err.message); }
      }));

    box.querySelectorAll("[data-prep-table]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-prep-table");
        const panel = mount.querySelector(`#prep-${CSS.escape(id)}`);
        if (!panel) return;
        if (panel.hidden) { openFieldPrep(id, panel); }
        else { panel.hidden = true; panel.innerHTML = ""; }
      }));
  }

  /* ---------------- Preparación visual de campos (field overrides) ---------------- */
  // Renombrar / forzar tipo / ocultar columnas por clic, persistido en el backend
  // (tabla field_overrides) y aplicado al servir la tabla. No reescribe el CSV.
  async function openFieldPrep(tableId, panel) {
    const t = tables.find((x) => x.id === tableId);
    if (!t) return;
    panel.hidden = false;
    panel.innerHTML = `<p class="muted small">Cargando campos…</p>`;

    let overrides = [];
    try { overrides = await getFieldOverrides(ctx.appId, tableId); }
    catch (e) { console.error("getFieldOverrides", e); overrides = []; }

    // Construye la lista de CAMPOS ORIGEN (source_field) a mostrar:
    //  - cada override conocido (incluye ocultos, que no vienen en t.columns), y
    //  - cada columna visible que no sea ya el renombre/origen de un override.
    const bySource = new Map();
    for (const ov of overrides) {
      bySource.set(ov.source_field, {
        source: ov.source_field,
        rename: ov.rename || "",
        type: ov.forced_type || "",
        hidden: !!ov.hidden,
      });
    }
    for (const c of t.columns) {
      // Una columna visible corresponde a un override si su nombre expuesto es el
      // rename, o (sin rename) si coincide con el source_field.
      const matched = overrides.some((ov) =>
        (ov.rename && ov.rename === c.name) || (!ov.rename && ov.source_field === c.name));
      if (!matched && !bySource.has(c.name)) {
        bySource.set(c.name, { source: c.name, rename: "", type: "", hidden: false });
      }
    }
    const fields = Array.from(bySource.values());

    // Tipo efectivo actual por columna visible, para prellenar el selector cuando
    // no hay forced_type explícito.
    const effType = new Map(t.columns.map((c) => [c.name, c.type]));
    const typeOptions = (sel) => ["text", "number", "date"].map((v) =>
      `<option value="${v}"${sel === v ? " selected" : ""}>${TYPE_LABEL[v]}</option>`).join("");

    panel.innerHTML = `
      <div class="q-fieldprep-head">
        <strong>Preparar campos — ${esc(t.name)}</strong>
        <span class="muted small">Renombra, cambia el tipo u oculta columnas. Los datos de origen no se borran.</span>
        <span class="muted small">Estos cambios se propagan a los campos (/fields), a las consultas y a los rótulos de las hojas. La identidad del campo se mantiene por su columna física, así que no se rompen los objetos (KPIs, gráficos, tablas) que ya lo usan.</span>
      </div>
      <div class="q-fieldprep-rows">
        ${fields.map((f) => {
          const curType = f.type || effType.get(f.rename || f.source) || "text";
          return `
          <div class="q-fieldprep-row${f.hidden ? " is-hidden" : ""}" data-source="${esc(f.source)}">
            <span class="q-fieldprep-src" title="Campo de origen">${esc(f.source)}</span>
            <input class="q-fieldprep-rename" type="text" placeholder="${esc(f.source)}" value="${esc(f.rename)}" aria-label="Nuevo nombre" />
            <select class="q-fieldprep-type" aria-label="Tipo">${typeOptions(curType)}</select>
            <label class="q-fieldprep-hide"><input type="checkbox" class="q-fieldprep-hidden"${f.hidden ? " checked" : ""} /> Ocultar</label>
          </div>`;
        }).join("")}
      </div>
      <div class="q-fieldprep-foot">
        <span class="q-upload-status" id="prepStatus-${esc(tableId)}"></span>
        <button class="q-ed-btn primary small-btn" data-prep-apply="${esc(tableId)}">Aplicar cambios</button>
      </div>`;

    panel.querySelector(`[data-prep-apply="${CSS.escape(tableId)}"]`).addEventListener("click", async () => {
      const status = panel.querySelector(`#prepStatus-${CSS.escape(tableId)}`);
      const payload = Array.from(panel.querySelectorAll(".q-fieldprep-row")).map((rowEl) => {
        const source = rowEl.getAttribute("data-source");
        const rename = rowEl.querySelector(".q-fieldprep-rename").value.trim();
        const forced = rowEl.querySelector(".q-fieldprep-type").value;
        const hidden = rowEl.querySelector(".q-fieldprep-hidden").checked;
        return { source_field: source, rename, forced_type: forced, hidden };
      });
      status.style.color = "";
      status.textContent = "Aplicando…";
      try {
        await putFieldOverrides(ctx.appId, tableId, payload);
        status.textContent = "";
        await refresh();
        // Reabrir el panel ya cerrado por el refresh para ver el resultado aplicado.
        const reopened = mount.querySelector(`#prep-${CSS.escape(tableId)}`);
        if (reopened) await openFieldPrep(tableId, reopened);
      } catch (err) {
        status.textContent = "Error: " + err.message;
        status.style.color = "#c0392b";
      }
    });
  }

  /* ---------------- Advertencia de clave sintética ---------------- */
  function renderSynthBanner() {
    const warnings = (model && model.warnings) || [];
    const box = mount.querySelector("#synthBanner");
    if (!warnings.length) { box.innerHTML = ""; return; }
    box.innerHTML = `
      <div class="q-warn-banner">
        <strong>⚠ Advertencias del modelo</strong>
        <ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>
      </div>`;
  }

  /* ---------------- Vista de burbujas + asociaciones ---------------- */
  async function renderAssociations() {
    const bubble = mount.querySelector("#bubbleBox");
    const nodes = (model && model.nodes) || [];
    const edges = (model && model.edges) || [];

    if (!nodes.length) {
      bubble.innerHTML = `<p style="color:var(--q-muted);">Sube al menos una tabla para ver el mapa de asociaciones.</p>`;
    } else {
      const maxRows = Math.max(1, ...nodes.map((n) => n.rows || 1));
      bubble.innerHTML = nodes.map((n) => {
        const size = 56 + Math.round(64 * Math.sqrt((n.rows || 1) / maxRows));
        const linked = edges.filter((e) => e.from === n.table || e.to === n.table).length;
        return `
          <div class="q-bubble" style="width:${size}px;height:${size}px;" title="${esc(n.table)} · ${n.rows ?? "?"} filas · ${linked} enlace(s)">
            <span class="q-bubble-name">${esc(n.table)}</span>
            <span class="q-bubble-rows">${n.rows ?? "?"}</span>
          </div>`;
      }).join("") + (edges.length
        ? `<div class="q-bubble-edges">${edges.map((e) =>
            `<span class="q-edge-chip">${esc(e.from)} ↔ ${esc(e.to)} <em>(${esc((e.fields || []).join(", "))} · ${esc(e.type)})</em></span>`).join("")}</div>`
        : `<div class="q-bubble-edges"><span class="muted small">Sin enlaces persistidos todavía.</span></div>`);
    }

    // Asociaciones recomendadas por el backend (sugerencias para aceptar).
    const recBox = mount.querySelector("#recBox");
    let recs = [];
    try { recs = await recommendAssociations(ctx.appId); } catch { recs = []; }
    const persisted = await listAssociations(ctx.appId).catch(() => []);
    const isPersisted = (r) => persisted.some((p) =>
      ((p.left_table === r.left_table && p.right_table === r.right_table) ||
       (p.left_table === r.right_table && p.right_table === r.left_table)) &&
      JSON.stringify([...r.fields].sort()) === JSON.stringify([...p.fields].sort()));

    const pending = recs.filter((r) => !isPersisted(r));
    if (pending.length) {
      recBox.innerHTML = `
        <div class="q-rec-box">
          <strong>Asociaciones recomendadas</strong>
          ${pending.map((r, i) => `
            <div class="q-rec-row">
              <span>${esc(r.left_table)} ↔ ${esc(r.right_table)} <em>(${esc(r.fields.join(", "))})</em>
                ${r.confidence != null ? `· confianza ${Math.round(r.confidence * 100)}%` : ""}</span>
              <button class="q-ed-btn primary small-btn" data-accept="${i}">Aceptar</button>
            </div>`).join("")}
        </div>`;
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
    } else {
      recBox.innerHTML = recs.length
        ? `<p class="muted small">Todas las asociaciones recomendadas ya están aceptadas.</p>`
        : "";
    }

    // Permite eliminar asociaciones persistidas.
    if (persisted.length) {
      recBox.innerHTML += `
        <div class="q-rec-box">
          <strong>Asociaciones activas</strong>
          ${persisted.map((p) => `
            <div class="q-rec-row">
              <span>${esc(p.left_table)} ↔ ${esc(p.right_table)} <em>(${esc(p.fields.join(", "))})</em>
                ${p.is_custom ? "· personalizada" : ""}</span>
              ${canImport ? `<button class="q-ed-btn ghost small-btn" data-del-assoc="${esc(p.id)}">Quitar</button>` : ""}
            </div>`).join("")}
        </div>`;
      recBox.querySelectorAll("[data-del-assoc]").forEach((btn) =>
        btn.addEventListener("click", async () => {
          try { await deleteAssociation(ctx.appId, btn.getAttribute("data-del-assoc")); await refresh(); }
          catch (err) { alert("No se pudo quitar: " + err.message); }
        }));
    }
  }

  /* ---------------- Editor de asociación personalizada ---------------- */
  function renderAssocEditor() {
    const box = mount.querySelector("#assocEditor");
    if (!box) return;
    if (tables.length < 2) { box.innerHTML = ""; return; }
    const tableOpts = tables.map((t) => `<option value="${esc(t.name)}">${esc(t.name)}</option>`).join("");
    box.innerHTML = `
      <div class="q-rec-box">
        <strong>Crear asociación personalizada</strong>
        <div class="q-assoc-form">
          <select id="assocLeft">${tableOpts}</select>
          <select id="assocRight">${tableOpts}</select>
          <input id="assocField" placeholder="Campo compartido (p. ej. ClienteID)" />
          <button class="q-ed-btn primary small-btn" id="assocCreate">Crear</button>
        </div>
        <p class="q-upload-status" id="assocStatus"></p>
      </div>`;

    box.querySelector("#assocCreate").addEventListener("click", async () => {
      const left = box.querySelector("#assocLeft").value;
      const right = box.querySelector("#assocRight").value;
      const field = box.querySelector("#assocField").value.trim();
      const status = box.querySelector("#assocStatus");
      if (left === right) { status.textContent = "Elige dos tablas distintas."; status.style.color = "#c0392b"; return; }
      if (!field) { status.textContent = "Indica el campo compartido."; status.style.color = "#c0392b"; return; }
      try {
        await createAssociation(ctx.appId, { left_table: left, right_table: right, fields: [field], basis: "custom" });
        status.textContent = ""; await refresh();
      } catch (err) { status.textContent = "Error: " + err.message; status.style.color = "#c0392b"; }
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

    // Cierre robusto: nunca depende de que refresh() haya terminado bien.
    mount.querySelector("#addDataBtn").addEventListener("click", open);
    mount.querySelector("#uploadX").addEventListener("click", (e) => { e.preventDefault(); close(); });
    mount.querySelector("#uploadCancel").addEventListener("click", (e) => { e.preventDefault(); close(); });
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    // Tecla Escape también cierra el modal.
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !backdrop.hidden) close(); });
    dropzone.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", (e) => { const f = e.target.files[0]; if (f) doUpload(f); e.target.value = ""; });
    ["dragenter", "dragover"].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add("over"); }));
    ["dragleave", "drop"].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove("over"); }));
    dropzone.addEventListener("drop", (e) => { const f = e.dataTransfer?.files?.[0]; if (f) doUpload(f); });

    async function doUpload(file) {
      status.style.color = "";
      status.textContent = `Subiendo "${file.name}"…`;
      let uploaded = null;
      try {
        uploaded = await uploadTable(ctx.appId, file);
        status.textContent = `Cargada: ${uploaded.name} (${uploaded.rows} filas, ${uploaded.columns.length} columnas). Pulsa “Cerrar”.`;
      } catch (err) {
        status.textContent = "Error: " + err.message;
        status.style.color = "#c0392b";
        return;
      }
      // El refresco de tablas/asociaciones NO debe poder bloquear el modal.
      // Si algo falla aquí (p. ej. perfilar 197 columnas), el modal igual cierra.
      try {
        await refresh();
      } catch (err) {
        console.error("refresh() tras la subida falló:", err);
        status.textContent += " (aviso: no se pudo refrescar la vista; cierra y recarga.)";
      }
    }
  }

  // Sub-tabs (Tablas / Asociaciones): puramente visuales, solo desplazan a la
  // sección correspondiente. No alteran ninguna llamada al backend.
  const subtabs = Array.from(mount.querySelectorAll(".q-subtab"));
  const sections = mount.querySelectorAll(".q-create-section");
  subtabs.forEach((tab, i) =>
    tab.addEventListener("click", () => {
      subtabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      sections[i]?.scrollIntoView({ behavior: "smooth", block: "start" });
    }));

  await refresh();
}

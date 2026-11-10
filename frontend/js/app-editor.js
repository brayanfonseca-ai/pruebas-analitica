// app-editor.js — Editor de carga de datos (in-app), estilo Qlik.
//
// Tres regiones: Secciones (lista derivada del script) · editor CodeMirror con
// números de línea y mini-toolbar (Secciones/Buscar/Historial/Depurar) · panel
// "Añadir datos" con Conexiones (DataFiles local + stubs de catálogo/espacios),
// Seleccionar datos (subir), Insertar sentencia Store e Incluir script.
//
// "Cargar datos" EJECUTA el script en el motor Python (/script/run). Si el script
// fue editado, el motor lo interpreta de verdad y reconstruye el modelo; si es el
// auto-generado, reconstruye desde los archivos subidos. "Ver una vista previa de
// los datos" lista las tablas resultantes. Nada se calcula en JS.

import { getScript, putScript, runScript, uploadTable, listTables, listConnections, listAllConnections, browseConnection, previewConnection, deleteConnection, loadConnection, aiModelar } from "./api.js";
import { openConnectionWizard, CONNECTORS } from "./connections.js";
import { mountEstrellita } from "./estrellita.js";

const SOON = "Próximamente";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function logClass(line) {
  if (/^===/.test(line) || /^—/.test(line)) return "ok";
  if (/^ADVERTENCIA/i.test(line)) return "warn";
  if (/error|fall|✖|no se/i.test(line)) return "err";
  if (/completad|✔/i.test(line)) return "ok";
  return "";
}

// Deriva las "Secciones" del texto del script a partir de los marcadores ///$tab.
function parseSections(text) {
  const out = [];
  const re = /^\s*\/\/\/\$tab\s*(.*)$/gim;
  let m;
  while ((m = re.exec(text)) !== null) out.push({ name: (m[1] || "Main").trim(), index: m.index });
  if (!out.length) out.push({ name: "Main", index: 0 });
  return out;
}

export async function render(mount, ctx) {
  const canEdit = ctx.can("charts:edit") || ctx.can("data:import");
  const canImport = ctx.can("data:import");

  mount.innerHTML = `
    <div class="ed">
      <div class="ed-toolbar">
        <div class="ed-tb-left">
          <button class="ed-tb-btn" data-act="toggleSecciones" title="Mostrar/ocultar secciones">⊟ Secciones</button>
          <div class="ed-tb-sep"></div>
          <button class="ed-tb-ico" data-act="find" title="Buscar (Ctrl+F)">🔍</button>
          <button class="ed-tb-ico" data-act="comment" title="Comentar/descomentar">//</button>
          <button class="ed-tb-ico" data-act="indent" title="Sangrar">⇥</button>
          <span class="ed-tb-title">Editor de carga · <span id="edActiveSec">Main</span></span>
        </div>
        <div class="ed-tb-right">
          <button class="ed-tb-btn" data-act="historial" title="Historial de ejecuciones">↻ Historial</button>
          <button class="ed-tb-btn" data-act="depurar" title="Depurar (${SOON})" disabled>🐞 Depurar</button>
          <div class="ed-tb-sep"></div>
          <div class="ed-preview-split">
            <button class="ed-tb-btn ghost" data-act="preview" title="Ver una vista previa de los datos">⟦⟧ Ver una vista previa de los datos</button>
          </div>
          ${canEdit ? `<button class="ed-tb-btn" data-act="save" title="Guardar el script">Guardar script</button>` : ""}
          <button class="ed-run" data-act="run" title="Ejecutar la carga">▶ Cargar datos</button>
        </div>
      </div>

      <div class="ed-main">
        <aside class="ed-sections" id="edSections">
          <div class="ed-sections-head"><span>Secciones</span>
            ${canEdit ? `<button class="ed-addsec" id="edAddSec" title="Añadir sección">+</button>` : ""}
          </div>
          <div class="ed-arch-note">Arquitectura QDF de 3 capas (reformulado de la documentación de Qlik).</div>
          <div class="ed-section-list" id="edSectionList"></div>
        </aside>

        <section class="ed-center">
          <div class="ed-center-head"><span id="edGenBadge" class="ed-gen-badge">auto-generado</span></div>
          <div class="ed-code"><textarea id="edCode" spellcheck="false"></textarea></div>
          <div class="ed-bottom">
            <div class="ed-bottom-tabs">
              <button class="ed-bt-tab active" data-bt="vista">Vista previa</button>
              <button class="ed-bt-tab" data-bt="resultado">Resultado</button>
            </div>
            <div class="ed-bottom-body" id="edBottom">
              <div class="ed-bottom-empty">Pulsa <strong>Cargar datos</strong> para ejecutar el script, o <strong>Ver una vista previa</strong>.</div>
            </div>
          </div>
        </section>

        <aside class="ed-adddata">
          <div class="ed-ad-head">Añadir datos</div>
          <button class="ed-ad-btn soon" disabled title="${SOON}">+ Añadir desde el catálogo de datos <span class="ed-soon">${SOON}</span></button>
          <button class="ed-ad-btn" data-act="includeScript" title="Insertar una plantilla de script">⎙ Incluir script</button>

          <div class="ed-ad-title">Conexiones de datos</div>
          <button class="ed-ad-btn" data-act="createConn" title="Crear conexión de datos">+ Crear conexión</button>
          <div class="ed-space">
            <button class="ed-space-btn" id="edSpaceBtn" type="button">
              <span class="ed-space-dot"></span><span id="edSpaceName">DEV_MODELOS_IA</span><span class="ed-space-caret">▾</span>
            </button>
            <div class="ed-space-pop" id="edSpacePop" hidden></div>
          </div>
          <div class="ed-ad-sub" id="edConnSub">Conexiones realizadas</div>
          <input class="ed-ad-search" id="edConnSearch" placeholder="Buscar conexión" />
          <div id="edConnList"></div>
          ${canImport ? `<input type="file" id="edFileInput" accept=".xlsx,.xls,.csv" hidden />` : ""}
          <p class="ed-ad-status" id="edStatus"></p>
        </aside>
      </div>

      <div class="ed-modal-backdrop" id="edModal" hidden></div>
      <div class="ed-modal-backdrop" id="edLoadModal" hidden></div>
    </div>`;

  const $ = (s) => mount.querySelector(s);
  const code = $("#edCode");
  const bottom = $("#edBottom");
  const status = $("#edStatus");
  const genBadge = $("#edGenBadge");
  const modal = $("#edModal");
  const loadModal = $("#edLoadModal");
  // Las ventanas emergentes viven en <body>: un ancestro con transform/contain
  // haría que position:fixed se calcule respecto al área con scroll y no a la pantalla.
  document.body.appendChild(modal);
  document.body.appendChild(loadModal);

  /* ---------------- Script del backend + CodeMirror ---------------- */
  let script;
  try { script = await getScript(ctx.appId); }
  catch (err) { bottom.innerHTML = `<div class="ed-bottom-empty err">No se pudo obtener el script: ${esc(err.message)}</div>`; return; }
  code.value = script.text || "";
  genBadge.textContent = script.is_custom ? "editado" : "auto-generado";

  let cm = null;
  if (window.CodeMirror) {
    cm = window.CodeMirror.fromTextArea(code, {
      mode: "text/x-sql", lineNumbers: true, lineWrapping: true, theme: "default", readOnly: !canEdit,
    });
    cm.setSize("100%", "100%");
    cm.on("cursorActivity", updateActiveSection);
    cm.on("change", () => { markDirty(); renderSectionList(); });
  } else if (!canEdit) code.readOnly = true;

  const getCode = () => (cm ? cm.getValue() : code.value);
  const setCode = (t) => { if (cm) cm.setValue(t); else code.value = t; };
  let dirty = false;
  function markDirty() { if (!dirty) { dirty = true; genBadge.textContent = "editado (sin guardar)"; } }

  /* ---------------- Secciones ---------------- */
  const sectionList = $("#edSectionList");
  function renderSectionList() {
    const secs = parseSections(getCode());
    const layerOf = (n) => /extract|1/i.test(n) ? "extract" : /transform|qvd|2/i.test(n) ? "transform" : /model|fact|3/i.test(n) ? "model" : "";
    sectionList.innerHTML = secs.map((s, i) => `
      <div class="ed-section layer-${layerOf(s.name)}" data-pos="${s.index}" data-i="${i}">
        <span class="ed-section-dot"></span><span class="ed-section-name">${esc(s.name)}</span>
      </div>`).join("");
    sectionList.querySelectorAll(".ed-section").forEach((el) => el.addEventListener("click", () => {
      if (!cm) return;
      const pos = Number(el.dataset.pos);
      const line = getCode().slice(0, pos).split("\n").length - 1;
      cm.setCursor({ line: Math.max(0, line), ch: 0 });
      cm.focus();
      cm.scrollIntoView({ line, ch: 0 }, 60);
    }));
  }
  function updateActiveSection() {
    if (!cm) return;
    const pos = cm.indexFromPos(cm.getCursor());
    const secs = parseSections(getCode());
    let active = secs[0];
    for (const s of secs) if (s.index <= pos) active = s;
    $("#edActiveSec").textContent = active?.name || "Main";
    sectionList.querySelectorAll(".ed-section").forEach((el) =>
      el.classList.toggle("active", Number(el.dataset.pos) === active.index));
  }
  renderSectionList();
  updateActiveSection();

  $("#edAddSec")?.addEventListener("click", () => {
    const name = prompt("Nombre de la sección:");
    if (!name || !name.trim()) return;
    const insert = `\n///$tab ${name.trim()}\n`;
    if (cm) { cm.replaceRange(insert, { line: cm.lineCount(), ch: 0 }); } else setCode(getCode() + insert);
    markDirty(); renderSectionList();
  });

  /* ---------------- Mini-toolbar ---------------- */
  $(".ed-tb-left").addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!act || !cm) return;
    if (act === "find") cm.execCommand("find");
    if (act === "comment") cm.execCommand("toggleComment");
    if (act === "indent") cm.execCommand("indentMore");
    if (act === "toggleSecciones") $("#edSections").classList.toggle("collapsed");
  });

  /* ---------------- Guardar / Cargar / Vista previa / Historial ---------------- */
  const runHistory = [];
  mount.querySelector(".ed-tb-right").addEventListener("click", async (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!act) return;
    if (act === "save") return saveScript();
    if (act === "run") return runNow();
    if (act === "preview") return preview();
    if (act === "historial") return showHistory();
  });

  async function saveScript() {
    try {
      const saved = await putScript(ctx.appId, getCode());
      dirty = false;
      genBadge.textContent = saved.is_custom ? "editado" : "auto-generado";
      status.textContent = "Script guardado.";
      status.style.color = "";
    } catch (err) { status.textContent = "No se pudo guardar: " + err.message; status.style.color = "#c0392b"; }
  }

  async function runNow() {
    // Modal de progreso emergente (adicional a la bandeja inferior .ed-console).
    const prog = openLoadProgress("Ejecución del script de carga");
    setBottom("resultado");
    bottom.innerHTML = `<pre class="ed-console"><span class="log ok">▶ Ejecutando la carga en el motor…</span></pre>`;
    try {
      if (dirty && canEdit) {
        prog.step("Guardando script…");
        try { await putScript(ctx.appId, getCode()); dirty = false; genBadge.textContent = "editado"; } catch {}
      }
      prog.step("Ejecutando la carga en el motor…");
      const result = await runScript(ctx.appId);
      // Volcar cada línea del log del motor como paso (estado reutilizando logClass),
      // y también en la bandeja inferior (no se degrada).
      const log = result.log || [];
      log.forEach((l) => prog.step(l, logClass(l)));
      const lines = log.map((l) => `<span class="log ${logClass(l)}">${esc(l)}</span>`).join("\n");
      bottom.innerHTML = `<pre class="ed-console">${lines}</pre>`;
      const nTables = (result.tables || []).length;
      prog.done(`Modelo reconstruido: ${nTables} tabla(s) cargada(s).`);
      runHistory.unshift({ at: new Date().toLocaleTimeString("es-CO"), tables: nTables, ok: true });
    } catch (err) {
      prog.fail(err.message);
      bottom.innerHTML = `<pre class="ed-console"><span class="log err">✖ ${esc(err.message)}</span></pre>`;
      runHistory.unshift({ at: new Date().toLocaleTimeString("es-CO"), error: err.message, ok: false });
    }
  }

  async function preview() {
    setBottom("vista");
    bottom.innerHTML = `<div class="ed-bottom-empty">Cargando vista previa del modelo…</div>`;
    try {
      const tables = await listTables(ctx.appId);
      if (!tables.length) { bottom.innerHTML = `<div class="ed-bottom-empty">El modelo está vacío. Sube un archivo o ejecuta el script.</div>`; return; }
      bottom.innerHTML = `<div class="ed-preview">
        <div class="ed-preview-tabs">${tables.map((t, i) => `<button class="ed-pv-tab ${i === 0 ? "active" : ""}" data-t="${i}">${esc(t.name)} <em>(${t.rows})</em></button>`).join("")}</div>
        <div class="ed-preview-body" id="edPvBody"></div></div>`;
      const drawTable = (t) => {
        const cols = t.columns.map((c) => c.name);
        $("#edPvBody").innerHTML = `<table class="ho-table"><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
          <tbody>${(t.preview || []).slice(0, 12).map((r) => `<tr>${cols.map((c) => `<td>${esc(r[c])}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
      };
      drawTable(tables[0]);
      bottom.querySelectorAll(".ed-pv-tab").forEach((b) => b.addEventListener("click", () => {
        bottom.querySelectorAll(".ed-pv-tab").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        drawTable(tables[Number(b.dataset.t)]);
      }));
    } catch (err) { bottom.innerHTML = `<div class="ed-bottom-empty err">${esc(err.message)}</div>`; }
  }

  function showHistory() {
    openModal(`<h3>Historial de ejecuciones</h3>`,
      runHistory.length
        ? `<ul class="ed-hist">${runHistory.map((h) => `<li class="${h.ok ? "ok" : "err"}">${esc(h.at)} — ${h.ok ? `OK, ${h.tables} tabla(s)` : "Error: " + esc(h.error)}</li>`).join("")}</ul>`
        : `<p class="ed-muted">Aún no has ejecutado el script en esta sesión.</p>`);
  }

  function setBottom(tab) {
    mount.querySelectorAll(".ed-bt-tab").forEach((b) => b.classList.toggle("active", b.dataset.bt === tab));
  }
  mount.querySelector(".ed-bottom-tabs").addEventListener("click", (e) => {
    const bt = e.target.closest("[data-bt]")?.dataset.bt;
    if (bt === "vista") preview();
    if (bt === "resultado") runNow();
  });

  /* ---------------- Panel Añadir datos ---------------- */
  const SPACES = {
    personal: [{ name: "Personal", sub: "Solo yo" }],
    compartidos: [{ name: "DESARROLLO" }, { name: "DEV_MODELOS_IA" }, { name: "TV_CONECT" }],
    administrados: [{ name: "Pruebas Desarrollo IA" }, { name: "Tv - Gestión Humana" }],
  };
  $("#edSpaceBtn").addEventListener("click", () => {
    const pop = $("#edSpacePop");
    pop.hidden = !pop.hidden;
    if (pop.hidden) return;
    const current = $("#edSpaceName").textContent;
    pop.innerHTML = `<input class="ed-ad-search" id="edSpaceSearch" placeholder="Seleccionar el espacio" />
      <div class="ed-space-group">Espacios personales</div>
      ${SPACES.personal.map((s) => spaceRow(s, current)).join("")}
      <div class="ed-space-group">Espacios compartidos</div>
      ${SPACES.compartidos.map((s) => spaceRow(s, current)).join("")}
      <div class="ed-space-group">Espacios administrados</div>
      ${SPACES.administrados.map((s) => spaceRow(s, current, true)).join("")}`;
    pop.querySelectorAll("[data-space]").forEach((r) => r.addEventListener("click", () => {
      $("#edSpaceName").textContent = r.dataset.space;
      pop.hidden = true;
    }));
    pop.querySelector("#edSpaceSearch").addEventListener("input", (ev) => {
      const q = ev.target.value.toLowerCase();
      pop.querySelectorAll("[data-space]").forEach((r) => { r.hidden = !r.dataset.space.toLowerCase().includes(q); });
    });
  });
  function spaceRow(s, current, managed = false) {
    return `<button class="ed-space-row ${s.name === current ? "active" : ""}" data-space="${esc(s.name)}" type="button">
      <span class="ed-space-dot ${managed ? "managed" : ""}"></span>
      <span><strong>${esc(s.name)}</strong>${s.sub ? `<em>${esc(s.sub)}</em>` : ""}</span>
      ${s.name === current ? "✓" : ""}</button>`;
  }

  // Acciones de la conexión DataFiles (delegado: la lista se re-renderiza).
  $("#edConnList").addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "selectData") openSelectFile();
    if (act === "insertScript") insertAtCursor(`\n// Selección de datos de DataFiles\nLOAD *\nFROM [lib://DataFiles/archivo.csv]\n(txt, utf8, embedded labels, delimiter is ',', msq);\n`);
    if (act === "insertStore") openInsertStore();
  });
  mount.querySelector(".ed-adddata").addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "createConn") openCreateConn();
    if (act === "includeScript") openIncludeScript();
  });

  function insertAtCursor(text) {
    if (cm) cm.replaceRange(text, cm.getCursor());
    else setCode(getCode() + text);
    markDirty(); renderSectionList();
  }

  /* ---------------- Subida (Seleccionar datos) ---------------- */
  const fileInput = $("#edFileInput");
  function openSelectFile() {
    if (!canImport) { status.textContent = "Tu rol no permite subir datos."; status.style.color = "#c0392b"; return; }
    openModal(`<h3>Seleccionar archivo</h3>`, `
      <div class="ed-sel-path">Ruta: <strong>📁 DataFiles</strong></div>
      <div class="ed-sel-row">
        <input class="ed-ad-search" placeholder="Buscar archivos y carpetas" disabled />
        <select disabled><option>Todos los archivos de datos</option></select>
      </div>
      <div class="q-dropzone" id="edDrop">
        <svg viewBox="0 0 24 24"><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>
        <strong>Suelte un archivo aquí o haga clic para seleccionar un archivo</strong>
        <span class="muted">.xlsx, .xls, .csv</span>
      </div>
      <p class="ed-ad-status" id="edDropStatus"></p>`,
      `<button class="ho-btn" data-close>Cancelar</button>`);
    const drop = modal.querySelector("#edDrop");
    const dstatus = modal.querySelector("#edDropStatus");
    drop.addEventListener("click", () => fileInput.click());
    ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
    drop.addEventListener("drop", (e) => { const f = e.dataTransfer?.files?.[0]; if (f) doUpload(f, dstatus); });
    fileInput.onchange = (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) doUpload(f, dstatus); };
  }

  async function doUpload(file, dstatus) {
    (dstatus || status).textContent = `Subiendo "${file.name}"…`;
    (dstatus || status).style.color = "";
    try {
      const up = await uploadTable(ctx.appId, file);
      const msg = `Cargada: ${up.name} (${up.rows} filas, ${up.columns.length} columnas).`;
      if (dstatus) dstatus.textContent = msg;
      status.textContent = msg;
      // Si el script no estaba editado, refresca el auto-generado.
      if (!dirty) {
        try { const fresh = await getScript(ctx.appId); if (!fresh.is_custom) { setCode(fresh.text || ""); genBadge.textContent = "auto-generado"; renderSectionList(); } } catch {}
      } else {
        insertAtCursor(`\n// Origen disponible para FROM:\n// LOAD * FROM [lib://DataFiles/${up.name}] (txt);\n`);
      }
    } catch (err) {
      (dstatus || status).textContent = "Error: " + err.message;
      (dstatus || status).style.color = "#c0392b";
    }
  }

  /* ---------------- Insertar sentencia Store ---------------- */
  function openInsertStore() {
    openModal(`<h3>Insertar la instrucción Store para DataFiles</h3>`, `
      <p class="ed-muted">La sentencia creará una salida de archivo QVD, Parquet o de texto. Solo puede exportar campos de una tabla de datos.</p>
      <label class="ed-field"><span>Almacenar</span><input id="stTable" placeholder="Nombre de la tabla" /></label>
      <label class="ed-field"><span>Ruta</span><input id="stPath" placeholder="carpeta/subcarpeta" value="QVD" /></label>
      <label class="ed-field"><span>Archivo</span><span class="ed-field-row"><input id="stFile" placeholder="Nombre de salida" />
        <select id="stFmt"><option value="qvd">.QVD</option><option value="parquet">.Parquet</option><option value="csv">.CSV</option></select></span></label>`,
      `<button class="ho-btn" data-close>Cancelar</button><button class="ho-btn primary" id="stInsert">Insertar</button>`);
    modal.querySelector("#stInsert").addEventListener("click", () => {
      const t = modal.querySelector("#stTable").value.trim() || "Tabla";
      const path = modal.querySelector("#stPath").value.trim() || "QVD";
      const file = modal.querySelector("#stFile").value.trim() || t;
      const fmt = modal.querySelector("#stFmt").value;
      closeModal();
      insertAtCursor(`\nSTORE ${t} INTO [lib://DataFiles/${path}/${file}.${fmt}] (${fmt});\n`);
    });
  }

  /* ---------------- Crear conexión (asistente real) ---------------- */
  function openCreateConn() {
    // Al crearla aparece en "Conexiones realizadas" y se abre su selector de datos.
    openConnectionWizard(ctx.appId, connHost, async (created) => {
      await renderConnections();
      const c = allConns.find((x) => x.id === created?.id);
      if (c && (canImport || canEdit)) openDataSelector(c);
    });
  }

  /* ---------------- Conexiones existentes (reales + DataFiles) ---------------- */
  const CONN_LABEL = {};
  Object.values(CONNECTORS).forEach((arr) => arr.forEach((c) => { CONN_LABEL[c.id] = c.name; }));
  let allConns = [];

  async function renderConnections(filter = "") {
    const box = $("#edConnList");
    if (!box) return;
    // "Conexiones realizadas": el stack completo de conexiones del usuario (de
    // cualquier app), no solo las creadas en esta. Al pulsar una se abre el
    // selector de datos con validación de la extracción y script en paralelo.
    let conns = [];
    try { conns = await listAllConnections(); } catch { try { conns = await listConnections(ctx.appId); } catch {} }
    allConns = conns;
    const q = (filter || "").toLowerCase();
    const items = conns.filter((c) => !q || c.name.toLowerCase().includes(q) || (CONN_LABEL[c.connector] || c.connector || "").toLowerCase().includes(q) || (c.app_name || "").toLowerCase().includes(q));
    const dataFilesVisible = !q || "datafiles".includes(q);
    const sub = $("#edConnSub");
    if (sub) sub.textContent = `Conexiones realizadas (${conns.length})`;
    box.innerHTML =
      (dataFilesVisible ? `
      <div class="ed-conn">
        <div class="ed-conn-head">📁 DataFiles<span class="ed-conn-kind">Carpeta</span></div>
        <div class="ed-conn-actions">
          <button class="ed-conn-act" data-act="selectData" title="Seleccionar datos">▦</button>
          <button class="ed-conn-act" data-act="insertScript" title="Insertar script de selección">⎘</button>
          <button class="ed-conn-act" data-act="insertStore" title="Insertar sentencia store">⇲</button>
        </div>
      </div>` : "") +
      (items.length ? "" : (conns.length ? `<p class="ed-muted ed-conn-empty">Ninguna conexión coincide con “${esc(filter)}”.</p>` : `<p class="ed-muted ed-conn-empty">Aún no hay conexiones. Pulsa <strong>Crear conexión</strong>; aparecerá aquí para seleccionar sus datos.</p>`)) +
      items.map((c) => `
        <div class="ed-conn ed-conn-real" data-conn-id="${esc(c.id)}" tabindex="0" role="button" title="Seleccionar datos de ${esc(c.name)}">
          <div class="ed-conn-head"><span class="cn-ic cn-ic-${esc(connIcon(c.connector))}"></span><span class="ed-conn-name">${esc(c.name)}</span><span class="ed-conn-kind">${esc(CONN_LABEL[c.connector] || c.connector)}</span></div>
          <div class="ed-conn-meta">${esc(connSummary(c))}${c.app_id && c.app_id !== ctx.appId ? ` · creada en ${esc(c.app_name || "otra app")}` : ""}</div>
          <div class="ed-conn-actions">
            ${(canImport || canEdit) ? `<button class="ed-conn-act ed-conn-load-btn" data-conn-sel="${esc(c.id)}" title="Seleccionar y cargar datos">▦</button>` : ""}
            <button class="ed-conn-act" data-conn-sel="${esc(c.id)}" data-only-script="1" title="Validar e insertar script de carga">⎘</button>
            <button class="ed-conn-act" data-conn-del="${esc(c.id)}" title="Eliminar conexión">🗑</button>
          </div>
        </div>`).join("");

    box.querySelectorAll("[data-conn-del]").forEach((b) => b.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const id = b.dataset.connDel;
      const c = items.find((x) => x.id === id);
      if (!confirm(`¿Eliminar la conexión "${c?.name || id}"? Dejará de estar disponible en todas las aplicaciones.`)) return;
      try { await deleteConnection(c?.app_id || ctx.appId, id); renderConnections(filter); } catch (e) { alert(e.message); }
    }));
    box.querySelectorAll("[data-conn-sel]").forEach((b) => b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const c = items.find((x) => x.id === b.dataset.connSel);
      if (c) openDataSelector(c, filter);
    }));
    box.querySelectorAll(".ed-conn-real").forEach((card) => {
      const open = () => { const c = items.find((x) => x.id === card.dataset.connId); if (c) openDataSelector(c, filter); };
      card.addEventListener("click", open);
      card.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); open(); } });
    });
  }

  function connSummary(c) {
    const cfg = c.config || {};
    if (c.connector === "athena") return [cfg.database, cfg.workgroup, cfg.awsRegion].filter(Boolean).join(" · ");
    if (c.connector === "s3") return ["s3://" + (cfg.bucket || ""), cfg.prefix].filter(Boolean).join("/");
    if (cfg.host) return `${cfg.host}${cfg.port ? ":" + cfg.port : ""}${cfg.database ? "/" + cfg.database : ""}`;
    return cfg.url || cfg.dsn || c.space || "";
  }

  /* ---------------- Cargar datos desde una conexión (FEAT-002) ----------------
     Mini-diálogo para capturar los params según el conector; al confirmar, lanza
     el flujo de carga con el modal de progreso vía loadConnection(). */
  function loadFieldsFor(connector) {
    // Campos simples por conector (con placeholders); todos opcionales salvo donde aplique.
    if (connector === "athena") return [
      ["database", "Base de datos (schema)", "default"],
      ["table", "Tabla", "mi_tabla"],
      ["query", "O una consulta SQL", "SELECT * FROM default.mi_tabla LIMIT 1000"],
      ["tableName", "Nombre de la tabla destino (opcional)", ""],
    ];
    if (["postgres","mysql","mariadb","sqlserver","oracle","redshift","odbc","rds"].includes(connector)) return [
      ["table", "Tabla", "mi_tabla"],
      ["query", "O una consulta SQL", "SELECT * FROM mi_tabla"],
      ["tableName", "Nombre de la tabla destino (opcional)", ""],
    ];
    if (connector === "s3") return [
      ["key", "Objeto / key (CSV o Excel)", "carpeta/archivo.csv"],
      ["tableName", "Nombre de la tabla destino (opcional)", ""],
    ];
    if (["webfile","rest","graphql","odata"].includes(connector)) return [
      ["url", "URL (opcional, usa la de la conexión si se omite)", ""],
      ["tableName", "Nombre de la tabla destino (opcional)", ""],
    ];
    // Resto: solo permite nombre de tabla destino; el backend decidirá/explicará.
    return [
      ["object", "Objeto / recurso (opcional)", ""],
      ["tableName", "Nombre de la tabla destino (opcional)", ""],
    ];
  }

  /* ---------------- Selector de datos de una conexión realizada ----------------
     Ventana emergente: explorador (bases → tablas / objetos) · parámetros ·
     "Validar extracción" (muestra real de 50 filas SIN materializar) con el script
     de carga generado EN PARALELO. "Cargar datos" trae la tabla al modelo y deja
     el código en el editor para empezar a modelar. */
  const SQL_CONNECTORS = ["athena", "postgres", "mysql", "mariadb", "sqlserver", "oracle", "redshift", "odbc", "rds"];
  const BROWSABLE = [...SQL_CONNECTORS, "s3"];

  function openDataSelector(conn, filter) {
    const isSql = SQL_CONNECTORS.includes(conn.connector);
    const canBrowse = BROWSABLE.includes(conn.connector);
    const sel = { database: conn.config?.database || "", object: "", items: [], preview: null, busy: false };
    const extraFields = canBrowse ? [] : loadFieldsFor(conn.connector).filter(([n]) => n !== "tableName");
    const body = `
      <div class="ed-ds">
        <aside class="ed-ds-nav">
          <div class="ed-ds-conn"><span class="cn-ic cn-ic-${esc(connIcon(conn.connector))}"></span><div><strong>${esc(conn.name)}</strong>
            <em>${esc(CONN_LABEL[conn.connector] || conn.connector)}${conn.app_name ? " · " + esc(conn.app_name) : ""}</em></div></div>
          ${conn.connector === "athena" ? `<label class="ed-field"><span>Base de datos</span><select id="dsDb"><option>${esc(sel.database || "Cargando…")}</option></select></label>` : ""}
          ${conn.connector === "s3" ? `<label class="ed-field"><span>Prefijo (carpeta)</span><input id="dsPrefix" placeholder="carpeta/" value="${esc(conn.config?.prefix || "")}" /></label>` : ""}
          ${canBrowse ? `<input class="ed-ad-search" id="dsFilter" placeholder="${conn.connector === "s3" ? "Buscar archivo" : "Buscar tabla"}" />
          <div class="ed-ds-list" id="dsList" role="listbox" aria-label="Objetos disponibles"><p class="ed-muted">Cargando objetos…</p></div>`
            : `<p class="ed-muted">Este conector no permite explorar objetos. Indica el recurso a la derecha.</p>`}
        </aside>
        <section class="ed-ds-main">
          <div class="ed-ds-form">
            ${canBrowse ? `<label class="ed-field"><span>${conn.connector === "s3" ? "Archivo" : "Tabla"}</span><input id="dsObject" placeholder="${conn.connector === "s3" ? "carpeta/archivo.csv" : "Selecciona en el explorador o escribe"}" /></label>` : ""}
            ${extraFields.map(([name, label, ph]) => `<label class="ed-field"><span>${esc(label)}</span><input data-ds-extra="${esc(name)}" placeholder="${esc(ph)}" /></label>`).join("")}
            ${isSql ? `<label class="ed-field ed-ds-limit"><span>Límite de filas</span><input id="dsLimit" type="number" min="1" step="1" value="1000" /></label>` : ""}
            <label class="ed-field"><span>Tabla destino en el modelo</span><input id="dsTarget" placeholder="(mismo nombre)" /></label>
          </div>
          ${isSql ? `<label class="ed-field"><span>Consulta SQL (opcional: reemplaza la tabla elegida)</span><textarea id="dsQuery" rows="2" placeholder="SELECT columna1, columna2 FROM ${conn.connector === "athena" ? "&quot;base&quot;.&quot;tabla&quot;" : "tabla"} WHERE …"></textarea></label>` : ""}
          <div class="ed-ds-actions"><button class="ho-btn" id="dsValidate">Validar extracción</button><span class="ed-ds-status" id="dsStatus" aria-live="polite"></span></div>
          <div class="ed-ds-panes">
            <div class="ed-ds-pane"><div class="ed-ds-pane-h">Vista previa de los datos</div><div class="ed-ds-grid" id="dsGrid"><p class="ed-muted">Elige una tabla y pulsa <strong>Validar extracción</strong>: se trae una muestra real sin cargarla.</p></div></div>
            <div class="ed-ds-pane"><div class="ed-ds-pane-h">Script de carga <em>(se añade al editor al cargar)</em></div><pre class="ed-ds-code" id="dsCode">// El script aparecerá aquí al validar la extracción.</pre></div>
          </div>
        </section>
      </div>`;
    const foot = `<button class="ho-btn" data-close>Cancelar</button>
      <button class="ho-btn" id="dsInsert" disabled>Insertar script</button>
      ${(canImport || canEdit) ? `<button class="ho-btn primary" id="dsLoad" disabled>Cargar datos</button>` : ""}`;
    const m = openModal(`<h3>Seleccionar datos · ${esc(conn.name)}</h3>`, body, foot);
    m.querySelector(".ed-modal").classList.add("ed-ds-modal");
    const q = (s) => m.querySelector(s);
    const statusEl = q("#dsStatus");
    const setStatus = (t, kind = "") => { statusEl.textContent = t; statusEl.className = "ed-ds-status " + kind; };

    function params() {
      const p = {};
      const obj = q("#dsObject")?.value.trim();
      if (obj) { if (conn.connector === "s3") p.key = obj; else p.table = obj; }
      if (conn.connector === "athena" && sel.database) p.database = sel.database;
      const lim = q("#dsLimit")?.value.trim();
      if (lim) p.limit = Number(lim);
      const query = q("#dsQuery")?.value.trim();
      if (query) p.query = query;
      const tgt = q("#dsTarget")?.value.trim();
      if (tgt) p.tableName = tgt;
      m.querySelectorAll("[data-ds-extra]").forEach((el) => { const v = el.value.trim(); if (v) p[el.dataset.dsExtra] = v; });
      return p;
    }
    function invalidate() {
      sel.preview = null;
      q("#dsInsert").disabled = true;
      if (q("#dsLoad")) q("#dsLoad").disabled = true;
    }
    m.querySelectorAll("#dsObject, #dsLimit, #dsQuery, #dsTarget, [data-ds-extra]").forEach((el) => el.addEventListener("input", () => { if (sel.preview) { invalidate(); setStatus("Cambiaste los parámetros: vuelve a validar.", "warn"); } }));

    function drawList() {
      const box = q("#dsList");
      if (!box) return;
      const f = (q("#dsFilter")?.value || "").toLowerCase();
      const items = sel.items.filter((it) => !f || it.name.toLowerCase().includes(f));
      if (!sel.items.length) { box.innerHTML = `<p class="ed-muted">No hay objetos disponibles.</p>`; return; }
      box.innerHTML = items.slice(0, 400).map((it) => `
        <button type="button" class="ed-ds-item ${it.name === sel.object ? "active" : ""}" data-obj="${esc(it.name)}" role="option" aria-selected="${it.name === sel.object}">
          <span class="ed-ds-item-n">${esc(it.name)}</span>
          <span class="ed-ds-item-m">${it.columns ? `${it.columns.length} campos` : esc(it.type || "")}</span></button>`).join("")
        + (items.length > 400 ? `<p class="ed-muted">Mostrando 400 de ${items.length}; filtra para acotar.</p>` : "")
        + (!items.length ? `<p class="ed-muted">Sin coincidencias.</p>` : "");
      box.querySelectorAll("[data-obj]").forEach((b) => b.addEventListener("click", () => {
        sel.object = b.dataset.obj;
        q("#dsObject").value = sel.object;
        if (q("#dsQuery")) q("#dsQuery").value = "";
        invalidate();
        drawList();
        const it = sel.items.find((x) => x.name === sel.object);
        setStatus(it?.columns ? `${it.columns.length} campos: ${it.columns.slice(0, 6).map((c) => c.name).join(", ")}${it.columns.length > 6 ? "…" : ""}` : "Listo para validar.");
        validate();
      }));
    }

    async function browse(extra = {}) {
      const box = q("#dsList");
      if (!box) return;
      box.innerHTML = `<p class="ed-muted">Cargando objetos…</p>`;
      try {
        const r = await browseConnection(conn.id, extra);
        if (!r.ok) { box.innerHTML = `<p class="ed-ds-err">${esc(r.message || "No se pudo explorar la conexión.")}</p>`; return null; }
        return r;
      } catch (e) { box.innerHTML = `<p class="ed-ds-err">${esc(e.message)}</p>`; return null; }
    }

    async function loadTables() {
      const r = await browse(conn.connector === "athena" ? { database: sel.database } : conn.connector === "s3" ? { prefix: q("#dsPrefix")?.value.trim() || "" } : {});
      if (!r) return;
      sel.items = r.items || [];
      drawList();
    }

    (async () => {
      if (!canBrowse) return;
      if (conn.connector === "athena") {
        const r = await browse({});
        const dbSel = q("#dsDb");
        if (r && dbSel) {
          const dbs = (r.items || []).map((x) => x.name);
          if (!sel.database || !dbs.includes(sel.database)) sel.database = dbs.includes(r.defaultDatabase) ? r.defaultDatabase : (dbs[0] || "");
          dbSel.innerHTML = dbs.map((d) => `<option value="${esc(d)}" ${d === sel.database ? "selected" : ""}>${esc(d)}</option>`).join("");
          dbSel.addEventListener("change", () => { sel.database = dbSel.value; sel.object = ""; q("#dsObject").value = ""; invalidate(); loadTables(); });
        }
        if (r) await loadTables();
      } else {
        await loadTables();
        q("#dsPrefix")?.addEventListener("change", loadTables);
      }
      q("#dsFilter")?.addEventListener("input", drawList);
    })();

    async function validate() {
      const p = params();
      if (!p.table && !p.key && !p.query && canBrowse) { setStatus("Elige una tabla/archivo o escribe una consulta.", "err"); return; }
      sel.busy = true; invalidate();
      const btn = q("#dsValidate");
      btn.disabled = true;
      setStatus("Extrayendo una muestra de la fuente…");
      q("#dsGrid").innerHTML = `<div class="ed-ds-loading"><span class="ed-load-spinner"></span>Consultando ${esc(conn.name)}…</div>`;
      try {
        const r = await previewConnection(conn.id, p);
        if (!r.ok) {
          setStatus("La extracción falló.", "err");
          q("#dsGrid").innerHTML = `<p class="ed-ds-err">${esc(r.message)}</p>`;
          q("#dsCode").textContent = "// Corrige el origen y vuelve a validar.";
          return;
        }
        sel.preview = { params: p, ...r };
        const cols = r.columns || [];
        q("#dsGrid").innerHTML = `<table class="ho-table"><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
          <tbody>${(r.rows || []).map((row) => `<tr>${row.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
        q("#dsCode").textContent = r.script || "";
        if (!q("#dsTarget").value) q("#dsTarget").placeholder = r.tableName || "(mismo nombre)";
        setStatus(`${r.message} (${r.elapsedMs} ms)`, "ok");
        q("#dsInsert").disabled = false;
        if (q("#dsLoad")) q("#dsLoad").disabled = false;
      } catch (e) {
        setStatus("La extracción falló.", "err");
        q("#dsGrid").innerHTML = `<p class="ed-ds-err">${esc(e.message)}</p>`;
      } finally { sel.busy = false; btn.disabled = false; }
    }
    q("#dsValidate").addEventListener("click", validate);
    q("#dsInsert").addEventListener("click", () => {
      if (!sel.preview) return;
      const name = sel.preview.tableName || "Tabla";
      closeModal();
      insertAtCursor(`\n///$tab ${name}\n${sel.preview.script}`);
      status.textContent = `Script de carga de ${name} insertado. Pulsa Cargar datos (en la conexión) para traer los datos.`;
      status.style.color = "";
    });
    q("#dsLoad")?.addEventListener("click", () => {
      if (!sel.preview) return;
      const p = sel.preview.params;
      closeModal();
      doLoadConnection(conn, p, filter);
    });
  }

  async function doLoadConnection(conn, params, filter) {
    const prog = openLoadProgress(`Carga desde “${conn.name}”`);
    try {
      prog.step(`LIB CONNECT TO '${conn.name}'…`);
      prog.step(params.query ? "Ejecutando la consulta SQL en la fuente…" : `Extrayendo ${params.table || params.key || "datos"}…`);
      const r = await loadConnection(ctx.appId, conn.id, params);
      if (!r || r.ok === false) {
        // El mensaje incluye el error real del backend (AWS/JDBC).
        prog.fail((r && r.message) || "No se pudieron cargar los datos.");
        return;
      }
      const t = r.table || {};
      prog.step("Materializando la tabla en el modelo…", "ok");
      // En paralelo: el código de carga queda en el editor para empezar a modelar.
      const fresh = await getScript(ctx.appId).catch(() => null);
      if (!dirty && fresh && !fresh.is_custom) {
        setCode(fresh.text || ""); genBadge.textContent = "auto-generado"; renderSectionList();
        prog.step("Script auto-generado actualizado con LIB CONNECT + SQL SELECT.", "ok");
      } else if (r.script) {
        const marker = `[${t.name}]:`;
        if (!getCode().includes(marker)) insertAtCursor(`\n///$tab ${t.name}\n${r.script}`);
        prog.step("Bloque de carga añadido al script (guárdalo para conservarlo).", "ok");
      }
      prog.done(`${r.message}. Ya puedes modelar: Modelo de datos / Modelo lógico.`);
      status.textContent = r.message || `Tabla ${t.name || ""} cargada.`;
      status.style.color = "var(--q-green-dark, #101d5e)";
      renderConnections(filter);
    } catch (err) {
      prog.fail(err.message);
    }
  }

  function connIcon(id) {
    for (const arr of Object.values(CONNECTORS)) { const c = arr.find((x) => x.id === id); if (c) return c.icon; }
    return "db";
  }

  /* ---------------- Incluir script ---------------- */
  function openIncludeScript() {
    const tpl = `\n///$tab Transform\n// Transforma una tabla existente (edítala y pulsa Cargar datos)\n// QVD_Ejemplo:\n// LOAD\n//   [cedula] AS [cedula],\n//   Upper([Sucursal]) AS [Sucursal],\n//   If([probabilidad_retiro] > 0.9, 'Muy Alto', 'Otro') AS [CategoriaRiesgo]\n// RESIDENT RAW_Ejemplo;\n`;
    insertAtCursor(tpl);
    status.textContent = "Plantilla de script insertada. Ajústala y pulsa Cargar datos.";
    status.style.color = "";
  }

  // Buscador de conexiones (filtra DataFiles + conexiones reales).
  $("#edConnSearch")?.addEventListener("input", (e) => renderConnections(e.target.value));

  // Render inicial de la lista de conexiones (DataFiles + guardadas).
  renderConnections();

  /* ---------------- Estrellita (asistente IA · ingeniero de datos) ---------------- */
  const unmountStar = mountEstrellita({
    appId: ctx.appId,
    persona: "ingeniero de datos",
    title: "Ingeniero de datos",
    greeting: "Soy tu ingeniero de datos. Cargo tus tablas y te propongo un modelo (estrella/copo/araña), llaves PK/FK y un script LOAD en Qlik. ¿Qué modelamos?",
    sendFn: aiModelar,
    buildContext: async () => {
      let tablas = [];
      try {
        const tables = await listTables(ctx.appId);
        tablas = (tables || []).map((t) => ({
          name: t.name,
          rows: t.rows,
          columns: (t.columns || []).map((c) => ({
            name: c.name, type: c.type, null_count: c.null_count, distinct_count: c.distinct_count,
          })),
        }));
      } catch {}
      return { tablas };
    },
    // EJECUTOR del plan del ingeniero: aplicar el script de carga (FEAT-002).
    onAction: async (action) => {
      if (!action || action.kind !== "apply-script" || typeof action.script !== "string" || !action.script.trim()) {
        return "No había un script que aplicar.";
      }
      const script = action.script;
      const current = getCode();
      const hasContent = (current && current.trim().length > 0) || dirty;
      let feedback;
      if (hasContent) {
        const replace = confirm("El editor ya tiene contenido. ¿Reemplazarlo por el script del asistente?\n\nAceptar = Reemplazar · Cancelar = Insertar en el cursor");
        if (replace) { setCode(script); markDirty(); renderSectionList(); feedback = "Reemplacé el script del editor."; }
        else { insertAtCursor(script); feedback = "Inserté el script en el cursor."; }
      } else {
        setCode(script); markDirty(); renderSectionList();
        feedback = "Puse el script en el editor.";
      }
      if (confirm("¿Cargar datos ahora?")) {
        try { await runNow(); feedback += " Lancé la carga de datos."; }
        catch { feedback += " No se pudo lanzar la carga."; }
      }
      return feedback;
    },
  });

  /* ---------------- Modal de progreso de carga (FEAT-002) ----------------
     Modal emergente "Cargando…" con pasos/log en vivo, estética de marca
     (azul empresarial #172983). Devuelve un controlador {step, done, fail}. */
  function openLoadProgress(title) {
    loadModal.innerHTML = `
      <div class="ed-modal ed-load-modal">
        <div class="ed-modal-head">
          <h3><span class="ed-load-spinner" id="edLoadSpinner"></span>Cargando…</h3>
          <button class="ho-x" data-close hidden>✕</button>
        </div>
        <div class="ed-modal-body">
          <div class="ed-load-title">${esc(title || "Carga de datos")}</div>
          <ul class="ed-load-steps" id="edLoadSteps"></ul>
          <div class="ed-load-result" id="edLoadResult" hidden></div>
        </div>
        <div class="ed-modal-foot">
          <button class="ho-btn" id="edLoadClose" disabled>Cerrar</button>
        </div>
      </div>`;
    loadModal.hidden = false;

    const stepsEl = loadModal.querySelector("#edLoadSteps");
    const resultEl = loadModal.querySelector("#edLoadResult");
    const spinner = loadModal.querySelector("#edLoadSpinner");
    const closeBtn = loadModal.querySelector("#edLoadClose");
    const xBtn = loadModal.querySelector(".ho-x");

    function closeLoad() { loadModal.hidden = true; loadModal.innerHTML = ""; }
    function enableClose() {
      spinner.classList.add("done");
      closeBtn.disabled = false;
      xBtn.hidden = false;
      closeBtn.addEventListener("click", closeLoad);
      xBtn.addEventListener("click", closeLoad);
    }

    let lastStep = null;
    return {
      /** Añade (o marca) un paso. estado: '' | 'ok' | 'warn' | 'err'. */
      step(text, estado = "") {
        if (lastStep) lastStep.classList.add("prev");
        const li = document.createElement("li");
        li.className = "ed-load-step" + (estado ? " " + estado : "");
        li.textContent = text;
        stepsEl.appendChild(li);
        stepsEl.scrollTop = stepsEl.scrollHeight;
        lastStep = li;
        return li;
      },
      /** Éxito: muestra el resumen y habilita Cerrar. */
      done(resumen) {
        if (lastStep) lastStep.classList.add("prev");
        resultEl.hidden = false;
        resultEl.className = "ed-load-result ok";
        resultEl.textContent = resumen || "Carga completada.";
        enableClose();
      },
      /** Fallo: pinta el error de forma destacada y habilita Cerrar. */
      fail(mensajeError) {
        resultEl.hidden = false;
        resultEl.className = "ed-load-result err";
        resultEl.textContent = mensajeError || "La carga falló.";
        enableClose();
      },
    };
  }

  /* ---------------- Modal genérico ---------------- */
  function openModal(headHtml, bodyHtml, footHtml = `<button class="ho-btn" data-close>Cerrar</button>`) {
    modal.innerHTML = `<div class="ed-modal"><div class="ed-modal-head">${headHtml}<button class="ho-x" data-close>✕</button></div>
      <div class="ed-modal-body">${bodyHtml}</div><div class="ed-modal-foot">${footHtml}</div></div>`;
    modal.hidden = false;
    modal.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeModal));
    modal.addEventListener("pointerdown", (e) => { if (e.target === modal) closeModal(); }, { once: true });
    return modal;
  }
  function closeModal() { modal.hidden = true; modal.innerHTML = ""; }

  // Adaptador para el asistente de conexiones (js/connections.js).
  const connHost = {
    get space() { return $("#edSpaceName")?.textContent || "DEV_MODELOS_IA"; },
    openModal: (title, body, foot) => openModal(`<h3>${esc(title)}</h3>`, body, foot),
    closeModal,
    toast: (msg) => { status.textContent = msg; status.style.color = "var(--q-green-dark, #101d5e)"; },
  };

  document.addEventListener("click", (e) => {
    const pop = $("#edSpacePop");
    if (pop && !pop.hidden && !$(".ed-space").contains(e.target)) pop.hidden = true;
  });

  return () => { try { cm?.toTextArea(); } catch {} try { unmountStar(); } catch {} modal.remove(); loadModal.remove(); };
}

// app-editor.js — Script de datos (in-app).
//
// Tres regiones: Secciones (lista derivada del script) · editor CodeMirror con
// números de línea y mini-toolbar (Secciones/Buscar/Historial/Depurar) · panel
// "Añadir datos" con Conexiones (DataFiles local + stubs de catálogo/espacios),
// Seleccionar datos (subir), Insertar sentencia Store e Incluir script.
//
// "Ejecutar script" EJECUTA el script en el motor Python (/script/run). Si el script
// fue editado, el motor lo interpreta de verdad y reconstruye el modelo; si es el
// auto-generado, reconstruye desde los archivos subidos. "Ver una vista previa de
// los datos" lista las tablas resultantes. Nada se calcula en JS.

import { openWorkflow } from "./editor-workflow.js";
import { openEnvSearch } from "./editor-search.js";
import { getScript, putScript, listScriptVersions, runScript, uploadTable, listTables, listConnections, listAllConnections, deleteConnectionGlobal, loadConnection, aiModelar, convertScript } from "./api.js";
import { openConnectionWizard, CONNECTORS } from "./connections.js";
import { openDataSelector as openDataSelectorModal } from "./data-selector.js";
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

/** ¿El script está en SQL (CREATE TABLE … AS SELECT …)? Un script vacío se escribe en SQL. */
export const isSqlScript = (text) => !String(text || "").trim() || /^\s*CREATE\s+(OR\s+REPLACE\s+)?TABLE\b/im.test(text) || /^\s*--\s*#pesta/im.test(text);

// Deriva las "Secciones" del texto del script: «-- #pestaña X» (SQL) o ///$tab X (sintaxis anterior).
function parseSections(text) {
  const out = [];
  const re = /^\s*(?:\/\/\/\$tab|--\s*#pesta[ñn]a)\s*(.*)$/gim;
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
          <button class="ed-tb-ico" data-act="find" title="Buscar en todo el entorno: script, tablas, campos, notas, hojas y conexiones (Ctrl+F)">🔍</button>
          <button class="ed-tb-ico" data-act="comment" title="Comentar/descomentar líneas (Ctrl+/): un campo comentado en un LOAD no se carga">//</button>
          <button class="ed-tb-ico" data-act="indent" title="Sangrar">⇥</button>
          <span class="ed-tb-title">Script de datos · <span id="edActiveSec">Main</span></span>
        </div>
        <div class="ed-tb-right">
          <button class="ed-tb-btn" data-act="historial" title="Historial de ejecuciones">↻ Historial</button>
          <div class="ed-tb-sep"></div>
          <div class="ed-preview-split">
            <button class="ed-tb-btn ghost" data-act="preview" title="Ver una vista previa de los datos">⟦⟧ Ver una vista previa de los datos</button>
          </div>
          ${canEdit ? `<button class="ed-tb-btn" data-act="save" title="Guardar el script">Guardar script</button>` : ""}
          <button class="ed-tb-btn ed-src-toggle" data-act="toggleFuentes" id="edSrcToggle" aria-expanded="false" title="Mostrar u ocultar fuentes y conexiones">⛁ Fuentes</button>
          <button class="ed-run" data-act="run" title="Ejecutar la carga">▶ Ejecutar script</button>
        </div>
      </div>

      <div class="ed-main">
        <section class="ed-center">
          <div class="ed-center-head">
            <div class="ed-sections" id="edSections" title="Pestañas del script: extracción · transformación · modelo">
              <div class="ed-section-list" id="edSectionList" role="tablist"></div>
              ${canEdit ? `<button class="ed-addsec" id="edAddSec" title="Añadir pestaña">+</button>` : ""}
            </div>
            <span class="ed-ch-right"><span id="edGenBadge" class="ed-gen-badge">auto-generado</span><span id="edLang"></span></span>
          </div>
          <div class="ed-code"><textarea id="edCode" spellcheck="false"></textarea></div>
          <div class="ed-bottom">
            <div class="ed-bottom-tabs">
              <button class="ed-bt-tab active" data-bt="vista">Vista previa</button>
              <button class="ed-bt-tab" data-bt="resultado">Resultado</button>
            </div>
            <div class="ed-bottom-body" id="edBottom">
              <div class="ed-bottom-empty">Pulsa <strong>Ejecutar script</strong> para ejecutar el script, o <strong>Ver una vista previa</strong>.</div>
            </div>
          </div>
        </section>

        <aside class="ed-adddata" id="edAddData">
          <div class="ed-ad-head"><span>Fuentes</span><button type="button" class="ed-ad-close" data-act="toggleFuentes" title="Cerrar" aria-label="Cerrar fuentes">✕</button></div>
          <button class="ed-ad-btn" data-act="includeScript" title="Insertar una plantilla de script">⎙ Insertar plantilla</button>

          <div class="ed-ad-title">Conexiones</div>
          <button class="ed-ad-btn" data-act="createConn" title="Crear conexión de datos">+ Crear conexión</button>
          <div class="ed-space" hidden>
            <button class="ed-space-btn" id="edSpaceBtn" type="button">
              <span class="ed-space-dot"></span><span id="edSpaceName">DEV_MODELOS_IA</span><span class="ed-space-caret">▾</span>
            </button>
            <div class="ed-space-pop" id="edSpacePop" hidden></div>
          </div>
          <div class="ed-ad-sub" id="edConnSub">Conexiones realizadas</div>
          <input class="ed-ad-search" id="edConnSearch" placeholder="Buscar conexión" />
          <div id="edConnList"></div>
          ${canImport ? `<input type="file" id="edFileInput" accept=".xlsx,.xls,.csv" hidden />` : ""}
        </aside>
      </div>
      <div class="ed-statusbar"><p class="ed-ad-status" id="edStatus"></p></div>

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
  const setCode = (t) => { if (cm) cm.setValue(t); else code.value = t; paintLang(); };
  let dirty = false;
  function markDirty() { if (!dirty) { dirty = true; genBadge.textContent = "editado (sin guardar)"; } }
  const sqlMode = () => isSqlScript(getCode());
  const tabMarker = (name) => (sqlMode() ? `-- #pestaña ${name}` : `///$tab ${name}`);

  /** Lenguaje del script: SQL, o la sintaxis anterior con el botón para convertirlo. */
  function paintLang() {
    const host = $("#edLang");
    if (!host) return;
    if (sqlMode()) { host.innerHTML = `<span class="ed-lang" title="El script está en SQL">SQL</span>`; return; }
    host.innerHTML = `<span class="ed-lang old" title="Sintaxis anterior (estilo Qlik)">Sintaxis anterior</span>${canEdit ? `<button type="button" class="ed-conv-btn" id="edConv" title="Convierte el script a SQL. Revisa y guarda: la carga da el mismo resultado.">Convertir a SQL</button>` : ""}`;
    host.querySelector("#edConv")?.addEventListener("click", async (e) => {
      const b = e.currentTarget; b.disabled = true; b.textContent = "Convirtiendo…";
      try {
        const r = await convertScript(ctx.appId, getCode(), "sql");
        setCode(r.text || ""); markDirty(); renderSectionList();
        status.textContent = "Script convertido a SQL. Revísalo y pulsa Guardar script: la carga da el mismo resultado.";
        status.style.color = "";
      } catch (err) {
        b.disabled = false; b.textContent = "Convertir a SQL";
        status.textContent = "No se pudo convertir: " + err.message; status.style.color = "#c0392b";
      }
    });
  }
  paintLang();
  if (cm) cm.on("change", () => { clearTimeout(paintLang._t); paintLang._t = setTimeout(paintLang, 300); });

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

  // Cajón «Fuentes» (conexiones y plantillas): se abre a la derecha y se recuerda. Abierto si la app aún no tiene datos.
  function setFuentes(open) {
    mount.querySelector(".ed").classList.toggle("src-open", open);
    $("#edSrcToggle")?.setAttribute("aria-expanded", String(open));
    $("#edSrcToggle")?.classList.toggle("on", open);
    try { localStorage.setItem("ds.ed.fuentes", open ? "1" : "0"); } catch {}
    setTimeout(() => cm?.refresh(), 260);
  }
  mount.querySelectorAll('[data-act="toggleFuentes"]').forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    setFuentes(!mount.querySelector(".ed").classList.contains("src-open"));
  }));
  let srcPref = null; try { srcPref = localStorage.getItem("ds.ed.fuentes"); } catch {}
  setFuentes(srcPref === null ? !String(getCode() || "").trim() : srcPref === "1");

  $("#edAddSec")?.addEventListener("click", () => {
    const name = prompt("Nombre de la pestaña:");
    if (!name || !name.trim()) return;
    const insert = `\n${tabMarker(name.trim())}\n`;
    if (cm) { cm.replaceRange(insert, { line: cm.lineCount(), ch: 0 }); } else setCode(getCode() + insert);
    markDirty(); renderSectionList();
  });

  /* ---------------- Mini-toolbar ---------------- */
  // Salta a una línea del script y la resalta un momento.
  function jumpToLine(line) {
    if (!cm) return;
    cm.focus();
    cm.setCursor({ line, ch: 0 });
    cm.scrollIntoView({ line, ch: 0 }, 120);
    const h = cm.addLineClass(line, "background", "ed-line-flash");
    setTimeout(() => cm.removeLineClass(h, "background", "ed-line-flash"), 1800);
  }

  /** «//»: comenta o descomenta las líneas seleccionadas. Un campo comentado en un LOAD no se carga. */
  function toggleComment() {
    if (!cm || !canEdit) return;
    const ranges = cm.listSelections();
    let from = Infinity, to = -1;
    for (const r of ranges) { from = Math.min(from, r.anchor.line, r.head.line); to = Math.max(to, r.anchor.line, r.head.line); }
    const idx = []; for (let l = from; l <= to; l++) if (cm.getLine(l).trim()) idx.push(l);
    if (!idx.length) return;
    // SQL comenta con «--»; la sintaxis anterior con «//». Las cabeceras de sección no se tocan.
    const tok = sqlMode() ? "--" : "//";
    const isHead = (t) => /^\s*(\/\/\/\$tab|--\s*#pesta)/i.test(t);
    const reTok = tok === "--" ? /^--\s?/ : /^\/\/\s?/;
    const allCommented = idx.every((l) => reTok.test(cm.getLine(l).trimStart()) && !isHead(cm.getLine(l)));
    cm.operation(() => {
      for (const l of idx) {
        const text = cm.getLine(l);
        if (isHead(text)) continue;
        const lead = text.match(/^\s*/)[0].length;
        if (allCommented) {
          const m = text.slice(lead).match(reTok);
          cm.replaceRange("", { line: l, ch: lead }, { line: l, ch: lead + m[0].length });
        } else cm.replaceRange(tok + " ", { line: l, ch: lead });
      }
    });
    status.textContent = allCommented ? "Líneas descomentadas: se volverán a cargar." : "Líneas comentadas: los campos comentados no se cargan. Guarda y pulsa Ejecutar script.";
    status.style.color = "";
  }

  $(".ed-tb-left").addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!act) return;
    if (act === "find") {
      const sel = cm ? cm.getSelection().trim() : "";
      return openEnvSearch({ appId: ctx.appId, getCode, onJump: jumpToLine, initial: sel.length < 60 ? sel : "" });
    }
    if (!cm) return;
    if (act === "comment") toggleComment();
    if (act === "indent") cm.execCommand("indentMore");
  });
  if (cm) cm.setOption("extraKeys", {
    "Ctrl-F": () => openEnvSearch({ appId: ctx.appId, getCode, onJump: jumpToLine, initial: cm.getSelection().trim().slice(0, 60) }),
    "Ctrl-/": () => toggleComment(),
    "Ctrl-S": () => { if (canEdit) saveScript(); },
  });

  /* ---------------- Guardar / Cargar / Vista previa / Historial ---------------- */
  const runHistory = [];
  mount.querySelector(".ed-tb-right").addEventListener("click", async (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!act) return;
    if (act === "save") return saveScript();
    if (act === "run") return runNow();
    if (act === "preview") return openWorkflow({ appId: ctx.appId, scriptText: getCode(), onJump: jumpToLine });
    if (act === "historial") return showHistory();
  });

  /** Guardar script = nueva versión (control de versiones en Notas para agente). Pide una descripción del cambio. */
  async function saveScript() {
    let versions = [];
    try { versions = await listScriptVersions(ctx.appId); } catch { /* sin historial todavía */ }
    const head = versions[0];
    const m = openModal(`<h3>Guardar script</h3>`, `
      <div class="ed-save">
        <div class="ed-save-line"><span class="ed-save-dot"></span><div><b>${head ? `Nueva versión v${head.version + 1}` : "Primera versión (v1)"}</b>
          <small>${head ? `La v${head.version} (${esc(head.message)}) baja al historial y la nueva queda como principal. Nada se pierde.` : "Se guarda como la versión principal del script."}</small></div></div>
        <label class="ed-field"><span>¿Qué cambiaste? <em>(como un mensaje de commit)</em></span>
          <input id="edSaveMsg" maxlength="300" placeholder="${head ? "Ej.: Comento FECHA RETIRO y renombro CEDULA" : "Ej.: Versión inicial del script"}" /></label>
        <p class="ed-muted">El historial se ve en <a href="notas.html?app=${encodeURIComponent(ctx.appId)}#versiones">Notas para agente → Versiones del script</a>, con el detalle de cada cambio y la opción de restaurar.</p>
      </div>`,
      `<button class="ho-btn" data-close>Cancelar</button><button class="ho-btn primary" id="edSaveOk">Guardar versión</button>`);
    const inp = m.querySelector("#edSaveMsg");
    inp.focus();
    const go = async () => {
      m.querySelector("#edSaveOk").disabled = true;
      try {
        const saved = await putScript(ctx.appId, getCode(), inp.value.trim());
        dirty = false;
        genBadge.textContent = `editado · v${saved.version}`;
        status.textContent = saved.version_created ? `Guardado como v${saved.version}: ${saved.version_message}` : `Sin cambios: la v${saved.version} ya es igual.`;
        status.style.color = "";
        closeModal();
      } catch (err) {
        m.querySelector("#edSaveOk").disabled = false;
        status.textContent = "No se pudo guardar: " + err.message; status.style.color = "#c0392b";
      }
    };
    m.querySelector("#edSaveOk").addEventListener("click", go);
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  }

  async function runNow() {
    // Modal de progreso emergente (adicional a la bandeja inferior .ed-console).
    const prog = openLoadProgress("Ejecución del script de carga");
    setBottom("resultado");
    bottom.innerHTML = `<pre class="ed-console"><span class="log ok">▶ Ejecutando la carga en el motor…</span></pre>`;
    try {
      if (dirty && canEdit) {
        prog.step("Guardando script…");
        try {
          const sv = await putScript(ctx.appId, getCode(), "Guardado automático al cargar datos");
          dirty = false; genBadge.textContent = `editado · v${sv.version}`;
          if (sv.version_created) prog.step(`Script guardado como v${sv.version}.`);
        } catch {}
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
      prog.tables(result.tables || []);
      prog.done(`Modelo reconstruido: ${nTables} ${nTables === 1 ? "tabla cargada" : "tablas cargadas"}.`);
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
        ? `<ul class="ed-hist">${runHistory.map((h) => `<li class="${h.ok ? "ok" : "err"}">${esc(h.at)} — ${h.ok ? `OK, ${h.tables} ${h.tables === 1 ? "tabla" : "tablas"}` : "Error: " + esc(h.error)}</li>`).join("")}</ul>`
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
        <strong>Suelta un archivo aquí o haz clic para elegirlo</strong>
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
        insertAtCursor(sqlMode()
          ? `\n-- Origen disponible:\n-- CREATE TABLE ${up.name} AS SELECT * FROM read_file('lib://DataFiles/${up.name}');\n`
          : `\n// Origen disponible para FROM:\n// LOAD * FROM [lib://DataFiles/${up.name}] (txt);\n`);
      }
    } catch (err) {
      (dstatus || status).textContent = "Error: " + err.message;
      (dstatus || status).style.color = "#c0392b";
    }
  }

  /* ---------------- Insertar sentencia Store ---------------- */
  function openInsertStore() {
    openModal(`<h3>Insertar la instrucción Store para DataFiles</h3>`, `
      <p class="ed-muted">La sentencia creará una salida de archivo QVD, Parquet o de texto. Solo puedes exportar campos de una tabla de datos.</p>
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
      insertAtCursor(sqlMode()
        ? `\n-- Exportar (aún no se ejecuta al cargar):\n-- COPY ${t} TO 'lib://DataFiles/${path}/${file}.${fmt}' (FORMAT ${fmt});\n`
        : `\nSTORE ${t} INTO [lib://DataFiles/${path}/${file}.${fmt}] (${fmt});\n`);
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
          <div class="ed-conn-meta">${esc(connSummary(c))}${c.mine === false ? ` · compartida por ${esc(c.owner_name || "otro usuario")}` : (c.shared_with && c.shared_with.length ? ` · compartida con ${c.shared_with.length}` : "")}</div>
          <div class="ed-conn-actions">
            ${(canImport || canEdit) ? `<button class="ed-conn-act ed-conn-load-btn" data-conn-sel="${esc(c.id)}" title="Seleccionar y cargar datos">▦</button>` : ""}
            <button class="ed-conn-act" data-conn-sel="${esc(c.id)}" data-only-script="1" title="Validar e insertar script de carga">⎘</button>
            ${c.mine === false ? "" : `<button class="ed-conn-act" data-conn-del="${esc(c.id)}" title="Eliminar conexión">🗑</button>`}
          </div>
        </div>`).join("");

    box.querySelectorAll("[data-conn-del]").forEach((b) => b.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const id = b.dataset.connDel;
      const c = items.find((x) => x.id === id);
      if (!confirm(`¿Eliminar la conexión "${c?.name || id}"? Dejará de estar disponible para ti y para quienes la compartiste.`)) return;
      try { await deleteConnectionGlobal(id); renderConnections(filter); } catch (e) { alert(e.message); }
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

  /* ---------------- Selector de datos de una conexión realizada ----------------
     Ventana emergente estilo Power Query (js/data-selector.js): explorador,
     extracción Todo / Parcial / Muestra, vista previa transformada, Transformar
     (quitar/renombrar/tipos/nulos/calculadas/filtro), Ver script y Editar script.
     "Ejecutar script" trae la tabla al modelo y deja el código en el editor. */
  function openDataSelector(conn, filter) {
    openDataSelectorModal(conn, {
      openModal, closeModal,
      canLoad: canImport || canEdit,
      label: (c) => CONN_LABEL[c] || c,
      icon: connIcon,
      insertScript: (script, name) => {
        insertAtCursor(`\n${tabMarker(name)}\n${script}`);
        status.textContent = `Script de carga de ${name} insertado. Ejecuta Ejecutar script para traer los datos.`;
        status.style.color = "";
      },
      load: (c, params) => doLoadConnection(c, params, filter),
    });
  }

  async function doLoadConnection(conn, params, filter) {
    const prog = openLoadProgress(`Carga desde “${conn.name}”`);
    try {
      prog.step(`Conectando con «${conn.name}»…`);
      const modeTxt = params.mode === "all" ? "todas las filas" : params.mode === "sample" ? `muestra aleatoria de ${params.limit} filas` : params.limit ? `primeras ${params.limit} filas` : "";
      prog.step((params.query ? "Ejecutando la consulta SQL en la fuente" : `Extrayendo ${params.table || params.key || "datos"}`) + (modeTxt ? ` (${modeTxt})…` : "…"));
      const r = await loadConnection(ctx.appId, conn.id, params);
      if (!r || r.ok === false) {
        // El mensaje incluye el error real del backend (AWS/JDBC).
        prog.fail((r && r.message) || "No se pudieron cargar los datos.");
        return;
      }
      const t = r.table || {};
      if (params.transform) prog.step(`Transformaciones aplicadas: ${r.rowsExtracted ?? "?"} filas extraídas → ${t.rows} cargadas.`, "ok");
      (r.warnings || []).forEach((w) => prog.step(w, "warn"));
      prog.step("Materializando la tabla en el modelo…", "ok");
      prog.tables([{ table: t.name, rows: t.rows, fields: t.columns || t.fields || [], source: conn.name }]);
      // En paralelo: el código de carga queda en el editor para empezar a modelar.
      const fresh = await getScript(ctx.appId).catch(() => null);
      if (!dirty && fresh && !fresh.is_custom) {
        setCode(fresh.text || ""); genBadge.textContent = "auto-generado"; renderSectionList();
        prog.step("El script de datos se actualizó con esta tabla.", "ok");
      } else if (r.script) {
        const nm = String(t.name || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const already = getCode().includes(`[${t.name}]:`) || new RegExp(`CREATE\\s+(OR\\s+REPLACE\\s+)?TABLE\\s+"?${nm}"?\\s+AS`, "i").test(getCode());
        if (!already) insertAtCursor(`\n${tabMarker(t.name)}\n${r.script}`);
        prog.step("Bloque de carga añadido al script (guárdalo para conservarlo).", "ok");
      }
      prog.done(`${r.message}. Ya puedes modelar en Mapa de relaciones y Capa de negocio.`);
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
    const tpl = sqlMode()
      ? `\n-- #pestaña Transform\n-- Ejemplo de transformación en SQL (quita los «--» y ajústalo):\n-- CREATE TABLE ventas AS\n-- SELECT\n--     cedula,\n--     UPPER(sucursal) AS sucursal,\n--     CASE WHEN probabilidad_retiro > 0.9 THEN 'Muy alto' ELSE 'Otro' END AS categoria_riesgo\n-- FROM (\n--     SELECT * FROM esquema.tabla\n-- ) AS origen\n-- WHERE cedula IS NOT NULL;\n`
      : `\n///$tab Transform\n// Transforma una tabla existente (edítala y pulsa Ejecutar script)\n// QVD_Ejemplo:\n// LOAD\n//   [cedula] AS [cedula],\n//   Upper([Sucursal]) AS [Sucursal],\n//   If([probabilidad_retiro] > 0.9, 'Muy Alto', 'Otro') AS [CategoriaRiesgo]\n// RESIDENT RAW_Ejemplo;\n`;
    insertAtCursor(tpl);
    status.textContent = "Plantilla de script insertada. Ajústala y pulsa Ejecutar script.";
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
    greeting: "Soy tu ingeniero de datos. Cargo tus tablas y te propongo un modelo (estrella/copo/araña), llaves PK/FK y el script de carga en SQL. ¿Qué modelamos?",
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
      if (confirm("¿Ejecutar el script ahora?")) {
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
    // Pipeline visual: Preparar → Conectar → Traer datos → Modelo listo. Las tablas aparecen como tarjetas
    // con sus filas contando; el registro técnico queda plegado en «Ver detalle».
    const STAGES = [["prep", "Preparar", "M4 7h16M4 12h10M4 17h7"], ["conn", "Conectar", "M7 12h10M4 9v6M20 9v6M10 7l-3 5 3 5M14 7l3 5-3 5"],
      ["pull", "Traer datos", "M12 4v12M7 11l5 5 5-5M5 20h14"], ["model", "Modelo listo", "M5 12l4 4 10-10"]];
    const t0 = performance.now();
    loadModal.innerHTML = `
      <div class="ed-modal lp" role="dialog" aria-modal="true" aria-label="Carga de datos">
        <div class="lp-aurora" aria-hidden="true"></div>
        <header class="lp-head">
          <div class="lp-orb" id="lpOrb" aria-hidden="true"><i></i><i></i><i></i><svg viewBox="0 0 24 24"><path d="M12 3c4.4 0 8 1.6 8 3.5S16.4 10 12 10 4 8.4 4 6.5 7.6 3 12 3z"/><path d="M4 6.5v11C4 19.4 7.6 21 12 21s8-1.6 8-3.5v-11M4 12c0 1.9 3.6 3.5 8 3.5s8-1.6 8-3.5"/></svg></div>
          <div class="lp-htxt"><h3 id="lpTitle">Cargando tus datos</h3><p>${esc(String(title || "Carga de datos").replace(/^Ejecución del script de carga$/, "Script de datos").replace(/^Carga desde /, "Desde "))}</p></div>
          <span class="lp-time" id="lpTime">0,0 s</span>
          <button class="lp-x" id="lpX" hidden aria-label="Cerrar">✕</button>
        </header>
        <ol class="lp-pipe" id="lpPipe">${STAGES.map(([id, l, d], i) => `<li data-st="${id}" class="${i === 0 ? "on" : ""}">
          <span class="lp-node"><svg viewBox="0 0 24 24"><path d="${d}"/></svg></span><b>${l}</b>${i < STAGES.length - 1 ? '<i class="lp-wire"><em></em></i>' : ""}</li>`).join("")}</ol>
        <div class="lp-now" id="lpNow"><span class="lp-dot"></span><span id="lpNowTxt">Preparando…</span></div>
        <div class="lp-tables" id="lpTables"></div>
        <div class="lp-result" id="lpResult" hidden></div>
        <details class="lp-log"><summary>Ver detalle técnico <em id="lpLogN">0</em></summary><ol id="lpLog"></ol></details>
        <footer class="lp-foot" id="lpFoot"><button class="ho-btn" id="lpClose" disabled>Cerrar</button></footer>
      </div>`;
    loadModal.hidden = false;
    const $l = (s) => loadModal.querySelector(s);
    const timer = setInterval(() => { const e = $l("#lpTime"); if (e) e.textContent = `${((performance.now() - t0) / 1000).toLocaleString("es-CO", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`; }, 100);
    const warns = [];
    let stage = 0;
    const setStage = (n, state = "") => {
      stage = Math.max(stage, n);
      loadModal.querySelectorAll("#lpPipe li").forEach((li, i) => {
        li.classList.toggle("done", i < stage || state === "done");
        li.classList.toggle("on", i === stage && state !== "done");
        li.classList.toggle("err", i === stage && state === "err");
      });
    };
    // Mensajes del motor → lenguaje humano y etapa del pipeline.
    const human = (t) => String(t)
      .replace(/^LIB CONNECT TO '([^']+)'\s*(→|…)?\s*(extrayendo\s*)?/i, (_, c, __, x) => `Conectando con «${c}»${x ? " y trayendo " : "…"}`)
      .replace(/^LOAD\s+([^:]+):\s*/i, "Tabla $1 lista: ")
      .replace(/LIB CONNECT \+ SQL SELECT/g, "la tabla nueva")
      .replace(/^Reconstruyendo el modelo desde las tablas cargadas…/, "Preparando la carga del modelo…");
    const stageOf = (t) => /conectando|consulta|extrayendo|trayendo/i.test(t) ? 1 : /tabla .* lista|materializando|transformaciones/i.test(t) ? 2 : /guardando|preparando|script/i.test(t) ? 0 : -1;
    const tableCard = (name, rows, fields, source, max) => `<article class="lp-tcard" style="--p:${Math.max(4, Math.round((rows / Math.max(1, max)) * 100))}%">
        <header><span class="lp-tico">▦</span><b title="${esc(name)}">${esc(name)}</b>${source ? `<em>${esc(source)}</em>` : ""}</header>
        <div class="lp-tnum"><strong data-to="${rows}">0</strong><span>filas</span><strong class="sm">${fields}</strong><span>campos</span></div>
        <i class="lp-tbar"><i></i></i></article>`;
    const countUp = (root) => root.querySelectorAll("[data-to]").forEach((el) => {
      const to = Number(el.dataset.to) || 0, s = performance.now();
      const run = (n) => { const k = Math.min(1, (n - s) / 900), e = 1 - Math.pow(1 - k, 3); el.textContent = Math.round(to * e).toLocaleString("es-CO"); if (k < 1) requestAnimationFrame(run); };
      requestAnimationFrame(run);
    });
    const seenTables = new Map();
    const close = () => { clearInterval(timer); loadModal.hidden = true; loadModal.innerHTML = ""; };
    const finish = (ok) => {
      clearInterval(timer);
      $l("#lpOrb").classList.add(ok ? "ok" : "bad");
      $l("#lpNow").hidden = true;
      const b = $l("#lpClose"); b.disabled = false; b.addEventListener("click", close);
      const x = $l("#lpX"); x.hidden = false; x.addEventListener("click", close);
      const onKey = (e) => { if (e.key === "Escape" && !loadModal.hidden) { close(); document.removeEventListener("keydown", onKey); } };
      document.addEventListener("keydown", onKey);
    };
    const api = {
      /** Añade un paso. estado: '' | 'ok' | 'warn' | 'err'. */
      step(text, estado = "") {
        const t = human(text);
        const li = document.createElement("li");
        li.className = estado || logClass(t) || "";
        li.textContent = t;
        $l("#lpLog").appendChild(li);
        $l("#lpLogN").textContent = String($l("#lpLog").children.length);
        if (/^ADVERTENCIA/i.test(t) || estado === "warn") { warns.push(t.replace(/^ADVERTENCIA:\s*/i, "")); return li; }
        const m = t.match(/^Tabla (.+?) lista:\s*([\d.]+) filas y (\d+) campos/i) || t.match(/^Tabla (.+?) lista:\s*([\d.]+) filas, (\d+) campos/i);
        if (m) { seenTables.set(m[1], { rows: Number(m[2].replace(/\./g, "")), fields: Number(m[3]) }); setStage(2); }
        const sg = stageOf(t);
        if (sg >= 0) setStage(sg);
        if (!/^\s*·/.test(t) && !/^Carga completa/i.test(t)) $l("#lpNowTxt").textContent = t;
        return li;
      },
      /** Tarjetas de tablas con su origen (opcional; si no, se usan las vistas en el registro). */
      tables(list) {
        const arr = (list || []).map((x) => ({ name: x.table || x.name, rows: Number(x.rows) || 0, fields: Array.isArray(x.fields) ? x.fields.length : Number(x.fields) || 0, source: x.source && x.source !== "archivo" ? x.source : x.source === "archivo" ? "Archivo" : "" }));
        const max = Math.max(1, ...arr.map((x) => x.rows));
        const host = $l("#lpTables");
        host.innerHTML = arr.map((x) => tableCard(x.name, x.rows, x.fields, x.source, max)).join("");
        countUp(host);
      },
      /** Éxito: resumen grande con lo que quedó en el modelo y accesos directos. */
      done(resumen) {
        setStage(3, "done");
        $l("#lpTitle").textContent = warns.length ? "Datos cargados con avisos" : "Tus datos están listos";
        const host = $l("#lpTables");
        if (!host.children.length && seenTables.size) api.tables([...seenTables].map(([name, v]) => ({ name, ...v })));
        const cards = [...host.querySelectorAll(".lp-tcard")];
        const rows = cards.reduce((a, c) => a + (Number(c.querySelector("[data-to]").dataset.to) || 0), 0);
        const fields = cards.reduce((a, c) => a + (Number(c.querySelector(".sm").textContent) || 0), 0);
        const secs = ((performance.now() - t0) / 1000).toLocaleString("es-CO", { maximumFractionDigits: 1 });
        const r = $l("#lpResult");
        r.hidden = false;
        r.className = `lp-result ok${warns.length ? " warn" : ""}`;
        r.innerHTML = `${cards.length ? `<div class="lp-stats"><div><b data-to="${cards.length}">0</b><span>${cards.length === 1 ? "tabla" : "tablas"}</span></div>
            <div><b data-to="${rows}">0</b><span>filas</span></div><div><b data-to="${fields}">0</b><span>campos</span></div><div><b>${secs} s</b><span>duración</span></div></div>` : ""}
          <p>${esc(String(resumen || "Carga completada.").replace(/^Modelo reconstruido:\s*/, "Modelo actualizado: "))}</p>
          ${warns.length ? `<ul class="lp-warns">${warns.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}`;
        countUp(r);
        $l("#lpFoot").insertAdjacentHTML("afterbegin", `<a class="ho-btn ghost" href="#datos" data-go>Ver tablas y campos</a><a class="ho-btn ghost" href="#modelo" data-go>Mapa de relaciones</a><span class="lp-sp"></span>`);
        loadModal.querySelectorAll("[data-go]").forEach((a) => a.addEventListener("click", close));
        $l("#lpClose").classList.add("primary");
        finish(true);
      },
      /** Fallo: lo dice claro y deja el detalle a mano. */
      fail(mensajeError) {
        setStage(stage, "err");
        $l("#lpTitle").textContent = "La carga no se completó";
        const r = $l("#lpResult");
        r.hidden = false; r.className = "lp-result err";
        r.innerHTML = `<p><b>Qué pasó:</b> ${esc(human(mensajeError || "La carga falló."))}</p><p class="lp-hint">Los datos anteriores se conservan. Revisa el detalle técnico o la conexión e inténtalo de nuevo.</p>`;
        $l(".lp-log").open = true;
        finish(false);
      },
    };
    return api;
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

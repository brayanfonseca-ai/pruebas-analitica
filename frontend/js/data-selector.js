// data-selector.js — Selector de datos de una conexión (estilo Power Query).
//
// Entornos de trabajo sobre la MISMA extracción:
//   · Vista previa  — muestra real (50 filas) ya transformada; en cada columna:
//                     incluir/quitar, renombrar y tipo, directamente en el encabezado.
//   · Transformar   — limpieza por columna (tipo, recortar/mayúsculas, nulos),
//                     columnas calculadas, filtro de filas, duplicados y
//                     "Pasos aplicados" (cada paso se puede deshacer).
//   · Ver script    — el bloque LOAD … SQL SELECT … que se añadirá al editor.
//   · Editar script — el desarrollador modifica el bloque y se re-interpreta
//                     (los cambios vuelven al asistente visual).
// Extracción: Todo · Parcial (primeras N) · Muestra aleatoria (N).
// El backend aplica las transformaciones (mismo motor en vista previa, carga y
// recarga del script); aquí solo se edita el spec y se pinta.

import { browseConnection, previewConnection, transformConnection, parseLoadScript } from "./api.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const SQL_CONNECTORS = ["athena", "postgres", "mysql", "mariadb", "sqlserver", "oracle", "redshift", "odbc", "rds"];
const BROWSABLE = [...SQL_CONNECTORS, "s3"];
const TYPES = [["auto", "Automático"], ["text", "Texto"], ["integer", "Entero"], ["decimal", "Decimal"], ["date", "Fecha"]];
const TYPE_ICON = { auto: "Auto", text: "ABC", integer: "123", decimal: "1.2", date: "Fecha" };
const TEXT_OPS = [["none", "Sin cambio"], ["trim", "Recortar espacios"], ["upper", "MAYÚSCULAS"], ["lower", "minúsculas"]];
const NULL_OPS = [["keep", "Conservar"], ["remove", "Quitar filas"], ["fill", "Reemplazar por…"]];
const FUNCS = ["If(cond, a, b)", "IsNull([x])", "Alt([x], 0)", "Round([x], 2)", "Upper([x])", "Trim([x])", "Left([x], 3)", "Year([fecha])", "[a] & ' ' & [b]"];

/**
 * @param {object} conn conexión (de "Conexiones realizadas")
 * @param {object} host {openModal(head, body, foot), closeModal(), insertScript(text, name), load(conn, params), canLoad, label(connector), icon(connector)}
 */
export function openDataSelector(conn, host) {
  const isSql = SQL_CONNECTORS.includes(conn.connector);
  const canBrowse = BROWSABLE.includes(conn.connector);
  const isS3 = conn.connector === "s3";
  const st = {
    database: conn.config?.database || "", object: "", items: [], mode: isSql ? "partial" : "all", limit: 1000,
    useQuery: false, query: "", target: "",
    raw: null, nulls: {}, out: null, warnings: [], tErr: null, script: "", sql: "",
    tf: { columns: [], computed: [], filter: "", distinct: false },
    view: "preview", busy: false, validatedKey: null, editText: null, editErr: null, transformSeq: 0,
  };

  const body = `
    <div class="ed-ds">
      <aside class="ed-ds-nav">
        <div class="ed-ds-conn"><span class="cn-ic cn-ic-${esc(host.icon(conn.connector))}"></span><div><strong>${esc(conn.name)}</strong>
          <em>${esc(host.label(conn.connector))}${conn.app_name ? " · " + esc(conn.app_name) : ""}</em></div></div>
        ${conn.connector === "athena" ? `<label class="ed-field"><span>Base de datos</span><select id="dsDb"><option>${esc(st.database || "Cargando…")}</option></select></label>` : ""}
        ${isS3 ? `<label class="ed-field"><span>Prefijo (carpeta)</span><input id="dsPrefix" placeholder="carpeta/" value="${esc(conn.config?.prefix || "")}" /></label>` : ""}
        ${canBrowse ? `<input class="ed-ad-search" id="dsFilter" placeholder="${isS3 ? "Buscar archivo" : "Buscar tabla"}" />
          <div class="ed-ds-list" id="dsList" role="listbox" aria-label="Objetos disponibles"><p class="ed-muted">Cargando objetos…</p></div>`
          : `<p class="ed-muted">Este conector no permite explorar objetos.</p>`}
      </aside>
      <section class="ed-ds-main">
        <div class="ed-ds-form2">
          <label class="ed-field ed-ds-f-obj"><span>${isS3 ? "Archivo" : "Tabla"}</span><input id="dsObject" placeholder="${isS3 ? "carpeta/archivo.csv" : "Selecciona en el explorador o escribe"}" /></label>
          ${isSql ? `<label class="ed-field"><span>Extracción</span><select id="dsMode">
              <option value="all">Todo (sin límite)</option>
              <option value="partial" selected>Parcial (primeras N filas)</option>
              <option value="sample">Muestra aleatoria (N filas)</option></select></label>
            <label class="ed-field"><span>Cantidad de filas</span><input id="dsLimit" type="number" min="1" step="1" value="1000" /></label>` : ""}
          <label class="ed-field"><span>Tabla destino en el modelo</span><input id="dsTarget" placeholder="(mismo nombre)" /></label>
        </div>
        ${isSql ? `<details class="ed-ds-sql" id="dsSqlBox"><summary>Consulta SQL propia <em>(opcional: reemplaza la tabla elegida)</em></summary>
          <textarea id="dsQuery" rows="3" spellcheck="false" placeholder="SELECT columna1, columna2 FROM ${conn.connector === "athena" ? "&quot;base&quot;.&quot;tabla&quot;" : "tabla"} WHERE …"></textarea></details>` : ""}
        <div class="ed-ds-bar">
          <button class="ho-btn" id="dsValidate">Validar extracción</button>
          <span class="ed-ds-status" id="dsStatus" aria-live="polite"></span>
          <span class="ed-ds-spacer"></span>
          <div class="ed-ds-tabs" role="tablist">
            <button class="ed-ds-tab active" data-view="preview" role="tab">Vista previa</button>
            <button class="ed-ds-tab" data-view="transform" role="tab">Transformar <span class="ed-ds-count" id="dsSteps"></span></button>
            <button class="ed-ds-tab" data-view="script" role="tab">Ver script</button>
            <button class="ed-ds-tab" data-view="edit" role="tab">Editar script</button>
          </div>
        </div>
        <div class="ed-ds-work" id="dsWork"></div>
      </section>
    </div>`;
  const foot = `<span class="ed-ds-foot-info" id="dsFootInfo"></span>
    <button class="ho-btn" data-close>Cancelar</button>
    <button class="ho-btn" id="dsInsert" disabled>Insertar script</button>
    ${host.canLoad ? `<button class="ho-btn primary" id="dsLoad" disabled>Cargar datos</button>` : ""}`;
  const m = host.openModal(`<h3>Seleccionar datos · ${esc(conn.name)}</h3>`, body, foot);
  m.querySelector(".ed-modal").classList.add("ed-ds-modal");
  const q = (s) => m.querySelector(s);
  const work = q("#dsWork");
  const setStatus = (t, kind = "") => { const el = q("#dsStatus"); el.textContent = t; el.className = "ed-ds-status " + kind; };

  /* ============================ Parámetros ============================ */
  const tfActive = () => st.tf.columns.length > 0 || st.tf.computed.length > 0 || !!st.tf.filter || st.tf.distinct;
  function params({ withTransform = true } = {}) {
    const p = {};
    if (st.useQuery && st.query.trim()) p.query = st.query.trim();
    else if (st.object) { if (isS3) p.key = st.object; else p.table = st.object; }
    if (conn.connector === "athena" && st.database) p.database = st.database;
    if (isSql) { p.mode = st.mode; p.limit = Math.max(1, Number(st.limit) || 1000); }
    if (st.target.trim()) p.tableName = st.target.trim();
    if (withTransform && tfActive()) p.transform = JSON.parse(JSON.stringify(st.tf));
    return p;
  }
  const sourceKey = () => JSON.stringify([st.useQuery ? st.query.trim() : "", st.useQuery ? "" : st.object, st.database, st.mode === "sample" ? "s" : "p"]);
  const colSpec = (src) => {
    let c = st.tf.columns.find((x) => x.source === src);
    if (!c) { c = { source: src, include: true, name: src, type: "auto", text: "none", nulls: "keep", fill: "" }; st.tf.columns.push(c); }
    return c;
  };

  /* ============================ Explorador ============================ */
  function drawList() {
    const box = q("#dsList");
    if (!box) return;
    const f = (q("#dsFilter")?.value || "").toLowerCase();
    const items = st.items.filter((it) => !f || it.name.toLowerCase().includes(f));
    if (!st.items.length) { box.innerHTML = `<p class="ed-muted">No hay objetos disponibles.</p>`; return; }
    box.innerHTML = items.slice(0, 400).map((it) => `
      <button type="button" class="ed-ds-item ${it.name === st.object ? "active" : ""}" data-obj="${esc(it.name)}" role="option" aria-selected="${it.name === st.object}">
        <span class="ed-ds-item-n">${esc(it.name)}</span><span class="ed-ds-item-m">${it.columns ? `${it.columns.length} campos` : esc(it.type || "")}</span></button>`).join("")
      + (items.length > 400 ? `<p class="ed-muted">Mostrando 400 de ${items.length}; filtra para acotar.</p>` : "") + (!items.length ? `<p class="ed-muted">Sin coincidencias.</p>` : "");
    box.querySelectorAll("[data-obj]").forEach((b) => b.addEventListener("click", () => {
      st.object = b.dataset.obj; q("#dsObject").value = st.object;
      st.useQuery = false; if (q("#dsSqlBox")) q("#dsSqlBox").open = false;
      st.tf = { columns: [], computed: [], filter: "", distinct: false };
      drawList(); validate();
    }));
  }
  async function browse(extra = {}) {
    const box = q("#dsList");
    if (!box) return null;
    box.innerHTML = `<p class="ed-muted">Cargando objetos…</p>`;
    try {
      const r = await browseConnection(conn.id, extra);
      if (!r.ok) { box.innerHTML = `<p class="ed-ds-err">${esc(r.message || "No se pudo explorar la conexión.")}</p>`; return null; }
      return r;
    } catch (e) { box.innerHTML = `<p class="ed-ds-err">${esc(e.message)}</p>`; return null; }
  }
  async function loadTables() {
    const r = await browse(conn.connector === "athena" ? { database: st.database } : isS3 ? { prefix: q("#dsPrefix")?.value.trim() || "" } : {});
    if (!r) return;
    st.items = r.items || [];
    drawList();
  }
  (async () => {
    if (!canBrowse) return;
    if (conn.connector === "athena") {
      const r = await browse({});
      const dbSel = q("#dsDb");
      if (r && dbSel) {
        const dbs = (r.items || []).map((x) => x.name);
        if (!st.database || !dbs.includes(st.database)) st.database = dbs.includes(r.defaultDatabase) ? r.defaultDatabase : (dbs[0] || "");
        dbSel.innerHTML = dbs.map((d) => `<option value="${esc(d)}" ${d === st.database ? "selected" : ""}>${esc(d)}</option>`).join("");
        dbSel.addEventListener("change", () => { st.database = dbSel.value; st.object = ""; q("#dsObject").value = ""; invalidate(); loadTables(); });
      }
      if (r) await loadTables();
    } else {
      await loadTables();
      q("#dsPrefix")?.addEventListener("change", loadTables);
    }
    q("#dsFilter")?.addEventListener("input", drawList);
  })();

  /* ============================ Validación y transformación ============================ */
  function invalidate(msg) {
    st.validatedKey = null;
    updateButtons();
    if (msg) setStatus(msg, "warn");
  }
  function updateButtons() {
    const ok = !!st.validatedKey && st.validatedKey === sourceKey() && !st.tErr;
    q("#dsInsert").disabled = !ok;
    if (q("#dsLoad")) q("#dsLoad").disabled = !ok;
    const steps = stepsList().length;
    q("#dsSteps").textContent = steps ? String(steps) : "";
    const info = q("#dsFootInfo");
    if (st.out) {
      const n = isSql ? (st.mode === "all" ? "todas las filas" : `${Number(st.limit).toLocaleString("es-CO")} filas ${st.mode === "sample" ? "al azar" : ""}`) : "todo el archivo";
      info.textContent = `Se cargará: ${n} · ${st.out.columns.length} columnas${st.tf.columns.some((c) => !c.include) ? ` (${st.tf.columns.filter((c) => !c.include).length} quitadas)` : ""}`;
    } else info.textContent = "";
  }

  async function validate() {
    const p = params();
    if (!p.table && !p.key && !p.query && canBrowse) { setStatus("Elige una tabla/archivo o escribe una consulta.", "err"); return; }
    st.busy = true; invalidate();
    q("#dsValidate").disabled = true;
    setStatus("Extrayendo una muestra de la fuente…");
    work.innerHTML = `<div class="ed-ds-loading"><span class="ed-load-spinner"></span>Consultando ${esc(conn.name)}…</div>`;
    try {
      const r = await previewConnection(conn.id, p);
      if (!r.ok) {
        setStatus("La extracción falló.", "err");
        work.innerHTML = `<p class="ed-ds-err">${esc(r.message)}</p>`;
        st.raw = null; st.out = null;
        return;
      }
      // Conserva la configuración de las columnas que siguen existiendo.
      st.raw = r.raw; st.nulls = r.nulls || {};
      const known = new Set(r.raw.columns);
      st.tf.columns = st.tf.columns.filter((c) => known.has(c.source));
      r.raw.columns.forEach((c) => colSpec(c));
      st.tf.columns.sort((a, b) => r.raw.columns.indexOf(a.source) - r.raw.columns.indexOf(b.source));
      applyResult(r);
      st.validatedKey = sourceKey();
      if (!st.target) q("#dsTarget").placeholder = r.tableName || "(mismo nombre)";
      setStatus(`${r.message} (${r.elapsedMs} ms)`, "ok");
      // Si había transformaciones, la respuesta ya las trae aplicadas.
      if (tfActive() && !p.transform) await retransform();
    } catch (e) {
      setStatus("La extracción falló.", "err");
      work.innerHTML = `<p class="ed-ds-err">${esc(e.message)}</p>`;
    } finally { st.busy = false; q("#dsValidate").disabled = false; updateButtons(); draw(); }
  }

  function applyResult(r) {
    st.out = { columns: r.columns, rows: r.rows };
    st.warnings = r.warnings || [];
    st.tErr = r.transformError || null;
    st.script = r.script || "";
    st.sql = r.sql || "";
  }

  let tfTimer = null;
  function changed({ redraw = true } = {}) {
    clearTimeout(tfTimer);
    tfTimer = setTimeout(retransform, 220);
    if (redraw) draw();
    updateButtons();
  }
  async function retransform() {
    if (!st.raw) return;
    const seq = ++st.transformSeq;
    try {
      const r = await transformConnection(conn.id, { params: params(), columns: st.raw.columns, rows: st.raw.rows });
      if (seq !== st.transformSeq) return;
      applyResult(r);
      if (st.tErr) setStatus(st.tErr, "err");
      else if (st.validatedKey === sourceKey()) setStatus(st.warnings.length ? st.warnings.join(" · ") : "Transformaciones aplicadas a la muestra.", st.warnings.length ? "warn" : "ok");
    } catch (e) { st.tErr = e.message; setStatus(e.message, "err"); }
    draw(); updateButtons();
  }

  /* ============================ Pasos aplicados ============================ */
  function stepsList() {
    const steps = [];
    const lbl = (v, list) => (list.find(([k]) => k === v) || [v, v])[1];
    st.tf.columns.forEach((c) => {
      if (!c.include) steps.push({ t: `Quitar columna «${c.source}»`, undo: () => { c.include = true; } });
      if (c.name && c.name !== c.source) steps.push({ t: `Renombrar «${c.source}» → «${c.name}»`, undo: () => { c.name = c.source; } });
      if (c.type !== "auto") steps.push({ t: `Tipo de «${c.name || c.source}» → ${lbl(c.type, TYPES)}`, undo: () => { c.type = "auto"; } });
      if (c.text !== "none") steps.push({ t: `${lbl(c.text, TEXT_OPS)} en «${c.name || c.source}»`, undo: () => { c.text = "none"; } });
      if (c.nulls === "remove") steps.push({ t: `Quitar filas con «${c.source}» vacío`, undo: () => { c.nulls = "keep"; } });
      if (c.nulls === "fill") steps.push({ t: `Reemplazar vacíos de «${c.name || c.source}» por «${c.fill ?? ""}»`, undo: () => { c.nulls = "keep"; c.fill = ""; } });
    });
    st.tf.computed.forEach((c, i) => steps.push({ t: `Columna calculada «${c.name}» = ${c.expr}`, undo: () => { st.tf.computed.splice(i, 1); } }));
    if (st.tf.filter) steps.push({ t: `Filtrar filas: ${st.tf.filter}`, undo: () => { st.tf.filter = ""; } });
    if (st.tf.distinct) steps.push({ t: "Quitar filas duplicadas", undo: () => { st.tf.distinct = false; } });
    return steps;
  }

  /* ============================ Dibujo de los entornos ============================ */
  function draw() {
    m.querySelectorAll(".ed-ds-tab").forEach((b) => b.classList.toggle("active", b.dataset.view === st.view));
    if (st.busy) return;
    if (!st.raw && st.view !== "edit") {
      work.innerHTML = `<p class="ed-muted ed-ds-hint">Elige una tabla y pulsa <strong>Validar extracción</strong>: se trae una muestra real (50 filas) sin cargarla. Luego podrás quitar columnas, renombrarlas, cambiar tipos, limpiar nulos y crear columnas calculadas.</p>`;
      return;
    }
    if (st.view === "preview") drawPreview();
    else if (st.view === "transform") drawTransform();
    else if (st.view === "script") drawScript();
    else drawEdit();
  }

  /** Columna de salida i -> spec de origen (incluidas en orden de origen, luego calculadas). */
  function outMap() {
    const inc = st.tf.columns.filter((c) => c.include);
    return st.out.columns.map((name, i) => (i < inc.length ? { kind: "src", spec: inc[i] } : { kind: "comp", comp: st.tf.computed[i - inc.length], index: i - inc.length }));
  }

  function drawPreview() {
    const map = outMap();
    const excluded = st.tf.columns.filter((c) => !c.include);
    work.innerHTML = `
      ${st.tErr ? `<div class="ed-ds-banner err">${esc(st.tErr)}</div>` : st.warnings.length ? `<div class="ed-ds-banner warn">${st.warnings.map(esc).join(" · ")}</div>` : ""}
      ${excluded.length ? `<div class="ed-ds-excl"><span>Columnas quitadas (clic para volver a incluir):</span>${excluded.map((c) => `<button class="ed-ds-chip" data-incl="${esc(c.source)}" title="Volver a incluir">＋ ${esc(c.source)}</button>`).join("")}</div>` : ""}
      <div class="ed-ds-grid2"><table class="ho-table ed-ds-table"><thead><tr>${map.map((x, i) => x.kind === "src" ? `
        <th><div class="ed-ds-th">
          <label class="ed-ds-th-chk" title="Incluir esta columna"><input type="checkbox" checked data-excl="${esc(x.spec.source)}" aria-label="Incluir ${esc(x.spec.source)}"></label>
          <input class="ed-ds-th-name" data-rename="${esc(x.spec.source)}" value="${esc(x.spec.name || x.spec.source)}" title="Renombrar (origen: ${esc(x.spec.source)})" aria-label="Nombre de ${esc(x.spec.source)}">
          <select class="ed-ds-th-type" data-type="${esc(x.spec.source)}" title="Tipo de dato" aria-label="Tipo de ${esc(x.spec.source)}">${TYPES.map(([k, l]) => `<option value="${k}" ${x.spec.type === k ? "selected" : ""}>${k === "auto" ? "Auto" : `${TYPE_ICON[k]} ${l}`}</option>`).join("")}</select>
        </div>${x.spec.name !== x.spec.source ? `<div class="ed-ds-th-src">${esc(x.spec.source)}</div>` : ""}${st.nulls[x.spec.source] ? `<div class="ed-ds-th-null">${st.nulls[x.spec.source]} vacíos en la muestra</div>` : ""}</th>` : `
        <th class="ed-ds-th-comp"><div class="ed-ds-th"><span class="ed-ds-fx">fx</span><span class="ed-ds-th-cname">${esc(st.out.columns[i])}</span>
          <button class="ed-ds-x" data-delcomp="${x.index}" title="Quitar columna calculada" aria-label="Quitar ${esc(st.out.columns[i])}">✕</button></div>
          <div class="ed-ds-th-src">${esc(x.comp?.expr || "")}</div></th>`).join("")}</tr></thead>
        <tbody>${st.out.rows.map((r) => `<tr>${r.map((v) => `<td class="${v == null || v === "" ? "nul" : ""}">${v == null ? "∅" : esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
      <div class="ed-ds-gridfoot">${st.out.rows.length} de ${st.raw.rows.length} filas de muestra tras las transformaciones · ${st.out.columns.length} columnas</div>`;
    work.querySelectorAll("[data-excl]").forEach((cb) => cb.addEventListener("change", () => { colSpec(cb.dataset.excl).include = cb.checked; changed(); }));
    work.querySelectorAll("[data-incl]").forEach((b) => b.addEventListener("click", () => { colSpec(b.dataset.incl).include = true; changed(); }));
    work.querySelectorAll("[data-rename]").forEach((inp) => inp.addEventListener("change", () => { colSpec(inp.dataset.rename).name = inp.value.trim() || inp.dataset.rename; changed(); }));
    work.querySelectorAll("[data-type]").forEach((s) => s.addEventListener("change", () => { colSpec(s.dataset.type).type = s.value; changed(); }));
    work.querySelectorAll("[data-delcomp]").forEach((b) => b.addEventListener("click", () => { st.tf.computed.splice(Number(b.dataset.delcomp), 1); changed(); }));
  }

  function drawTransform() {
    const steps = stepsList();
    const allOn = st.tf.columns.every((c) => c.include);
    const fieldChips = st.tf.columns.map((c) => `<button class="ed-ds-chip sm" data-ins="[${esc(c.name || c.source)}]">${esc(c.name || c.source)}</button>`).join("");
    work.innerHTML = `
      ${st.tErr ? `<div class="ed-ds-banner err">${esc(st.tErr)}</div>` : ""}
      <div class="ed-ds-tf">
        <div class="ed-ds-tf-main">
          <div class="ed-ds-sec-h">Columnas <span class="ed-muted">${st.tf.columns.filter((c) => c.include).length} de ${st.tf.columns.length} incluidas</span>
            <span class="ed-ds-spacer"></span><label class="ed-ds-allchk"><input type="checkbox" id="dsAll" ${allOn ? "checked" : ""}> Todas</label></div>
          <div class="ed-ds-tf-scroll"><table class="ed-ds-tf-table"><thead><tr><th>Incluir</th><th>Origen</th><th>Nombre en el modelo</th><th>Tipo</th><th>Texto</th><th>Vacíos</th><th>Reemplazo</th></tr></thead>
            <tbody>${st.tf.columns.map((c) => `
              <tr class="${c.include ? "" : "off"}">
                <td><input type="checkbox" data-c="${esc(c.source)}" data-k="include" ${c.include ? "checked" : ""} aria-label="Incluir ${esc(c.source)}"></td>
                <td class="src">${esc(c.source)}${st.nulls[c.source] ? `<em>${st.nulls[c.source]} vacíos</em>` : ""}</td>
                <td><input data-c="${esc(c.source)}" data-k="name" value="${esc(c.name || c.source)}" aria-label="Nombre de ${esc(c.source)}"></td>
                <td><select data-c="${esc(c.source)}" data-k="type">${TYPES.map(([k, l]) => `<option value="${k}" ${c.type === k ? "selected" : ""}>${l}</option>`).join("")}</select></td>
                <td><select data-c="${esc(c.source)}" data-k="text">${TEXT_OPS.map(([k, l]) => `<option value="${k}" ${c.text === k ? "selected" : ""}>${l}</option>`).join("")}</select></td>
                <td><select data-c="${esc(c.source)}" data-k="nulls">${NULL_OPS.map(([k, l]) => `<option value="${k}" ${c.nulls === k ? "selected" : ""}>${l}</option>`).join("")}</select></td>
                <td><input data-c="${esc(c.source)}" data-k="fill" value="${esc(c.fill ?? "")}" placeholder="${c.nulls === "fill" ? "Valor" : "—"}" ${c.nulls === "fill" ? "" : "disabled"} aria-label="Reemplazo de vacíos de ${esc(c.source)}"></td>
              </tr>`).join("")}</tbody></table></div>

          <div class="ed-ds-sec-h">Columnas calculadas</div>
          ${st.tf.computed.length ? `<ul class="ed-ds-comp">${st.tf.computed.map((c, i) => `<li><strong>${esc(c.name)}</strong> = <code>${esc(c.expr)}</code><button class="ed-ds-x" data-delcomp="${i}" title="Quitar">✕</button></li>`).join("")}</ul>` : ""}
          <div class="ed-ds-compform">
            <input id="dsCompName" placeholder="Nombre (p. ej. Total)">
            <input id="dsCompExpr" placeholder="Expresión (p. ej. [Altas Mes] - [Bajas Mes])" spellcheck="false">
            <button class="ho-btn" id="dsCompAdd">Añadir columna</button>
          </div>
          <p class="ed-muted ed-ds-note">Las columnas calculadas y el filtro leen los valores tal como vienen de la fuente (antes de los cambios de tipo o limpieza), igual que un LOAD de Qlik. Puedes usar el nombre nuevo o el de origen.</p>
          <div class="ed-ds-chips"><span class="ed-muted">Campos:</span>${fieldChips}</div>
          <div class="ed-ds-chips"><span class="ed-muted">Funciones:</span>${FUNCS.map((f) => `<button class="ed-ds-chip sm fn" data-ins="${esc(f)}">${esc(f)}</button>`).join("")}</div>

          <div class="ed-ds-sec-h">Filas</div>
          <div class="ed-ds-rowsopt">
            <label class="ed-field"><span>Filtrar filas (se conservan las que cumplen)</span><input id="dsFilterExpr" value="${esc(st.tf.filter)}" placeholder="p. ej. [ANIO] >= 2024 AND [ESTADO CONTRATO] = 'ACTIVO'" spellcheck="false"></label>
            <label class="ho-check"><input type="checkbox" id="dsDistinct" ${st.tf.distinct ? "checked" : ""}> Quitar filas duplicadas</label>
          </div>
        </div>
        <aside class="ed-ds-steps">
          <div class="ed-ds-sec-h">Pasos aplicados</div>
          <ol><li class="base">Origen: ${esc(st.useQuery ? "consulta SQL" : st.object || "—")}${isSql ? ` · ${st.mode === "all" ? "todo" : (st.mode === "sample" ? "muestra de " : "primeras ") + Number(st.limit).toLocaleString("es-CO")}` : ""}</li>
          ${steps.map((s, i) => `<li>${esc(s.t)}<button class="ed-ds-x" data-undo="${i}" title="Deshacer este paso">✕</button></li>`).join("")}</ol>
          ${steps.length ? `<button class="ho-btn" id="dsReset">Quitar todos los pasos</button>` : `<p class="ed-muted">Sin transformaciones: se cargarán las columnas tal cual.</p>`}
        </aside>
      </div>`;
    let lastFocus = null;
    work.querySelectorAll("[data-c]").forEach((el) => {
      const ev = el.type === "checkbox" || el.tagName === "SELECT" ? "change" : "change";
      el.addEventListener(ev, () => {
        const c = colSpec(el.dataset.c), k = el.dataset.k;
        if (k === "include") c.include = el.checked;
        else if (k === "name") c.name = el.value.trim() || c.source;
        else if (k === "fill") c.fill = el.value;
        else c[k] = el.value;
        changed({ redraw: k === "nulls" || k === "include" });
      });
    });
    q("#dsAll")?.addEventListener("change", (e) => { st.tf.columns.forEach((c) => { c.include = e.target.checked; }); changed(); });
    work.querySelectorAll("[data-delcomp]").forEach((b) => b.addEventListener("click", () => { st.tf.computed.splice(Number(b.dataset.delcomp), 1); changed(); }));
    work.querySelectorAll("[data-undo]").forEach((b) => b.addEventListener("click", () => { steps[Number(b.dataset.undo)].undo(); changed(); }));
    q("#dsReset")?.addEventListener("click", () => { st.tf = { columns: st.tf.columns.map((c) => ({ source: c.source, include: true, name: c.source, type: "auto", text: "none", nulls: "keep", fill: "" })), computed: [], filter: "", distinct: false }; changed(); });
    ["#dsCompName", "#dsCompExpr", "#dsFilterExpr"].forEach((s) => q(s)?.addEventListener("focus", (e) => { lastFocus = e.target; }));
    work.querySelectorAll("[data-ins]").forEach((b) => b.addEventListener("click", () => {
      const t = lastFocus && lastFocus.id !== "dsCompName" ? lastFocus : q("#dsCompExpr");
      const pos = t.selectionStart ?? t.value.length;
      t.value = t.value.slice(0, pos) + b.dataset.ins + t.value.slice(t.selectionEnd ?? pos);
      t.focus(); t.selectionStart = t.selectionEnd = pos + b.dataset.ins.length;
      lastFocus = t;
    }));
    q("#dsCompAdd").addEventListener("click", () => {
      const name = q("#dsCompName").value.trim(), expr = q("#dsCompExpr").value.trim();
      if (!name || !expr) { setStatus("La columna calculada necesita nombre y expresión.", "err"); return; }
      st.tf.computed.push({ name, expr });
      changed();
    });
    q("#dsFilterExpr").addEventListener("change", (e) => { st.tf.filter = e.target.value.trim(); changed({ redraw: false }); });
    q("#dsDistinct").addEventListener("change", (e) => { st.tf.distinct = e.target.checked; changed({ redraw: false }); });
  }

  function drawScript() {
    work.innerHTML = `
      <div class="ed-ds-scriptbar"><span class="ed-muted">Script que se añadirá al editor de carga. Lo genera el asistente; para modificarlo a mano usa <strong>Editar script</strong>.</span>
        <span class="ed-ds-spacer"></span><button class="ho-btn" id="dsCopy">Copiar</button><button class="ho-btn" id="dsToEdit">Editar script</button></div>
      <pre class="ed-ds-code big">${esc(st.script || "// Valida la extracción para generar el script.")}</pre>`;
    q("#dsCopy").addEventListener("click", async () => { try { await navigator.clipboard.writeText(st.script); setStatus("Script copiado.", "ok"); } catch { setStatus("No se pudo copiar.", "err"); } });
    q("#dsToEdit").addEventListener("click", () => { st.view = "edit"; st.editText = null; draw(); });
  }

  function drawEdit() {
    if (st.editText == null) st.editText = st.script || "";
    work.innerHTML = `
      <div class="ed-ds-scriptbar"><span class="ed-muted">Modifica el bloque (campos del <code>LOAD</code>, <code>AS</code>, <code>WHERE</code>, el <code>SQL SELECT</code>…) y pulsa <strong>Aplicar script</strong>: los cambios vuelven al asistente visual y a la vista previa.</span>
        <span class="ed-ds-spacer"></span><button class="ho-btn" id="dsEditReset">Descartar cambios</button><button class="ho-btn primary" id="dsEditApply">Aplicar script</button></div>
      ${st.editErr ? `<div class="ed-ds-banner err">${esc(st.editErr)}</div>` : ""}
      <textarea class="ed-ds-edit" id="dsEditText" spellcheck="false" aria-label="Script de carga">${esc(st.editText)}</textarea>`;
    const ta = q("#dsEditText");
    ta.addEventListener("input", () => { st.editText = ta.value; });
    ta.addEventListener("keydown", (e) => { if (e.key === "Tab") { e.preventDefault(); const p = ta.selectionStart; ta.value = ta.value.slice(0, p) + "    " + ta.value.slice(ta.selectionEnd); ta.selectionStart = ta.selectionEnd = p + 4; st.editText = ta.value; } });
    q("#dsEditReset").addEventListener("click", () => { st.editText = null; st.editErr = null; draw(); });
    q("#dsEditApply").addEventListener("click", applyEditedScript);
  }

  async function applyEditedScript() {
    const btn = q("#dsEditApply");
    btn.disabled = true;
    try {
      const r = await parseLoadScript(conn.id, { script: st.editText, columns: st.raw?.columns || st.tf.columns.map((c) => c.source), params: params() });
      if (!r.ok) { st.editErr = r.message; draw(); return; }
      st.editErr = null;
      const p = r.params || {};
      const before = sourceKey();
      if (p.query) { st.useQuery = true; st.query = p.query; if (q("#dsQuery")) q("#dsQuery").value = p.query; if (q("#dsSqlBox")) q("#dsSqlBox").open = true; }
      else { st.useQuery = false; st.object = p.table || p.key || st.object; q("#dsObject").value = st.object; }
      if (p.database && conn.connector === "athena") { st.database = p.database; if (q("#dsDb")) q("#dsDb").value = p.database; }
      if (p.mode && isSql) { st.mode = p.mode; q("#dsMode").value = p.mode; q("#dsLimit").disabled = p.mode === "all"; }
      if (p.limit && isSql) { st.limit = p.limit; q("#dsLimit").value = p.limit; }
      if (p.tableName) { st.target = p.tableName; q("#dsTarget").value = p.tableName; }
      const t = p.transform || {};
      st.tf = { columns: (t.columns || []).map((c) => ({ fill: "", ...c })), computed: t.computed || [], filter: t.filter || "", distinct: !!t.distinct };
      st.editText = null;
      st.view = "preview";
      if (sourceKey() !== before || !st.raw) await validate();
      else { await retransform(); setStatus("Script aplicado: el asistente y la vista previa se actualizaron.", "ok"); }
    } catch (e) { st.editErr = e.message; draw(); }
    finally { if (q("#dsEditApply")) q("#dsEditApply").disabled = false; }
  }

  /* ============================ Eventos de la barra ============================ */
  m.querySelectorAll(".ed-ds-tab").forEach((b) => b.addEventListener("click", () => { st.view = b.dataset.view; if (st.view === "edit") st.editText = null; draw(); }));
  q("#dsValidate").addEventListener("click", validate);
  q("#dsObject").addEventListener("change", (e) => { st.object = e.target.value.trim(); invalidate("Cambiaste la tabla: vuelve a validar."); });
  q("#dsTarget").addEventListener("input", (e) => { st.target = e.target.value; changed({ redraw: false }); });
  q("#dsMode")?.addEventListener("change", (e) => {
    st.mode = e.target.value; q("#dsLimit").disabled = st.mode === "all";
    if (st.raw && sourceKey() !== st.validatedKey) invalidate("Cambiaste a muestra aleatoria: vuelve a validar para ver filas al azar.");
    changed({ redraw: st.view === "transform" });
  });
  q("#dsLimit")?.addEventListener("input", (e) => { st.limit = e.target.value; changed({ redraw: false }); });
  q("#dsQuery")?.addEventListener("change", (e) => { st.query = e.target.value; st.useQuery = !!st.query.trim(); invalidate("Cambiaste la consulta: vuelve a validar."); });
  q("#dsInsert").addEventListener("click", () => {
    const name = st.target.trim() || q("#dsTarget").placeholder || "Tabla";
    host.closeModal();
    host.insertScript(st.script, name);
  });
  q("#dsLoad")?.addEventListener("click", () => {
    const p = params();
    host.closeModal();
    host.load(conn, p);
  });
  draw();
}

// app-hoja.js — vista "Hoja" (Analizar) estilo Qlik Sense.
//
// Modo vista: la hoja con sus objetos; los clics en gráficos, tablas y paneles de
// filtrado hacen SELECCIONES que el motor Python propaga de forma asociativa.
// Modo edición ("Editar hoja"): barra de herramientas, riel de activos (Hojas,
// Marcadores, Campos, Elementos maestros, Gráficos, Variables…), rejilla de 24
// columnas donde se ARRASTRAN gráficos, se mueven y se redimensionan, y el panel
// de propiedades en acordeón (Datos / Ordenar / Módulos adicionales / Aspecto).
//
// Todo dato sale del backend: /query, /fields/values, /expressions/parse,
// /master-items y /sheets. Este módulo no agrega ni calcula valores.

import * as api from "./api.js";
import { svg } from "./hub-nav.js";
import {
  CHART_TYPES as BASE_TYPES, GROUPS as BASE_GROUPS, getType as baseGetType, typeIcon, roleLabel, defaultProps, isComplete, PALETTE,
} from "./chart-types.js";
import {
  buildQuery, mergeSelections, renderChart, renderKpi, renderTable, renderFilterPane, renderText,
  renderTreemap, renderHeatmap, renderFunnel, renderWaterfall, renderBoxplot, renderHistogram,
  renderGauge, renderBullet, renderSankey, renderPivot, renderOrg, renderMap, renderWordcloud,
  renderNote, renderButton, renderDivider, renderContainer, renderImage, renderVideo, renderNavMenu,
  esc, fmt,
} from "./hoja-render.js";
import { TEMPLATES, TEMPLATE_CATEGORIES, GRID_COLS, GRID_ROWS, layoutThumb } from "./hoja-templates.js";
import { renderMlView, ML_FAMILIES, ML_VIEWS, ML_TYPE_DEFS, getMlView, isMlType, runMatches, algoName } from "./ml-views.js";

// Los gráficos de ML se registran aquí también: si el navegador conserva en memoria un
// chart-types.js anterior (pestaña abierta antes de actualizar), siguen disponibles.
const CHART_TYPES = [...BASE_TYPES.filter((t) => t.group !== "ml"), ...ML_TYPE_DEFS];
const GROUPS = BASE_GROUPS.some((g) => g.key === "ml") ? BASE_GROUPS
  : [BASE_GROUPS[0], { key: "ml", label: "Machine Learning" }, ...BASE_GROUPS.slice(1)];
const getType = (type) => baseGetType(type) || ML_TYPE_DEFS.find((d) => d.type === type) || null;
import { mountEstrellita } from "./estrellita.js";

const MAX_ROWS = 200;
const MIN_W = 2;
const MIN_H = 2;

/**
 * Espaciado de líneas de cuadrícula → separación (gutter) en px entre celdas,
 * replicando los presets de Qlik Sense. "personalizado" usa props.gutterPx.
 * @type {Record<string, number>}
 */
const GRID_GUTTER = { estrecho: 2, medio: 4, ancho: 8 };
/** Columnas que ocupa el "paso" de ajuste (snap) según el espaciado. */
const GRID_SNAP = { estrecho: 1, medio: 1, ancho: 2 };
/** Tamaño de hoja personalizado: límites de alto de fila y de columnas. */
const CELLH_MIN = 24, CELLH_MAX = 120, CUSTOM_COLS_MIN = 12, CUSTOM_COLS_MAX = 48;

/** Valores por defecto de las propiedades de una hoja nueva. */
const DEFAULT_SHEET_PROPS = { grid: "medio", gutterPx: 4, size: "adaptable", cellH: 40, cols: GRID_COLS, small: "lista", extend: false };
const AGG_LABEL = { sum: "Sum", avg: "Avg", count: "Count", min: "Min", max: "Max" };
const AGG_NAME = { sum: "Suma", avg: "Promedio", count: "Recuento", min: "Mínimo", max: "Máximo" };
const SOON = "Próximamente";

const RAIL = [
  { key: "hojas", label: "Hojas", icon: "pages" },
  { key: "marcadores", label: "Marcadores", icon: "star" },
  { key: "disparadores", label: "Disparadores de información", icon: "predict" },
  { key: "campos", label: "Campos", icon: "database" },
  { key: "maestros", label: "Elementos maestros", icon: "book" },
  { key: "graficos", label: "Gráficos", icon: "analyze" },
  { key: "analisis", label: "Análisis", icon: "assist" },
  { key: "objetos", label: "Objetos personalizados", icon: "box" },
  { key: "variables", label: "Variables", icon: "sub" },
];

const ANALYSES = [
  "Agrupación en clústeres (k-means)", "Año hasta la fecha", "Anomalía (pico)", "Anomalía (tendencia)",
  "Comparación", "Control de procesos (media móvil)", "Control de procesos (media)", "Correlación",
  "Descomposición de series de tiempo", "Desglose", "Desglose (geoespacial)", "General",
  "Importancia relativa", "Información mutua", "Medida calculada (KPI)", "Ranking",
  "Ranking (agrupado)", "Tendencia a lo largo del tiempo", "Tendencia con previsión",
];

const uid = () => "o" + Math.random().toString(36).slice(2, 10);
const clone = (x) => JSON.parse(JSON.stringify(x));
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export async function render(mount, ctx) {
  const canEdit = ctx.can("charts:edit");
  const LS = (k) => `ds.hoja.${k}.${ctx.appId}`;

  /* ======================================================================
     Estado
     ====================================================================== */
  const st = {
    sheets: [],
    sheet: null,           // copia de trabajo de la hoja activa
    edit: false,
    selectedId: null,
    rail: "graficos",
    assetsOpen: true,
    propsOpen: true,
    accordion: "datos",
    sub: { general: true, presentacion: false, colores: false, ejex: false, ejey: false, tooltip: false, estados: false, manejo: true, reflines: false, formas: false, imagenes: false },
    fields: [],            // [{field, type, tables[]}]
    masters: [],
    selections: loadSelections(),
    touch: localStorage.getItem(`ds.hoja.touch.${ctx.appId}`) === "1",
    selBack: [],
    selFwd: [],
    history: [],
    future: [],
    clipboard: null,
    tableFilter: "",
  };
  const els = new Map();       // objId -> elemento DOM
  const cleanups = new Map();  // objId -> destroy()
  const tokens = new Map();    // objId -> token de la última consulta

  /* ---------------- Objetos de Machine Learning (ejecuciones guardadas) ---------------- */
  const mlCache = new Map();   // "expId:runId" -> Promise<resultado>
  let mlExpsP = null;          // Promise<[{id, name, app_id, app_name, runs}]>
  function mlRun(expId, runId) {
    const k = `${expId}:${runId}`;
    if (!mlCache.has(k)) mlCache.set(k, api.getExperimentRun(expId, runId).catch((e) => { mlCache.delete(k); throw e; }));
    return mlCache.get(k);
  }
  /** Experimentos con sus ejecuciones; primero los de esta app. */
  function mlExperiments(force = false) {
    if (!mlExpsP || force) {
      mlExpsP = api.listExperiments().then((list) => Promise.all(
        [...list].sort((a, b) => (b.app_id === ctx.appId) - (a.app_id === ctx.appId)).map((e) =>
          api.getExperiment(e.id).then((d) => ({ id: e.id, name: e.name, app_id: e.app_id, app_name: e.app_name, runs: d.runList || [] }))
            .catch(() => ({ id: e.id, name: e.name, app_id: e.app_id, app_name: e.app_name, runs: [] })))))
        .catch((e) => { mlExpsP = null; throw e; });
    }
    return mlExpsP;
  }
  /** Ejecución por defecto para una vista nueva: la de la hoja (si la generó "Asociar a"), si no la más reciente compatible. */
  async function mlDefaultRef(type) {
    const exps = await mlExperiments().catch(() => []);
    const sm = st.sheet?.props?.ml;
    if (sm?.ejecucionId) {
      const e = exps.find((x) => x.id === sm.experimentoId);
      const run = e?.runs.find((x) => x.id === sm.ejecucionId);
      if (run && runMatches(type, run)) return { experimentId: e.id, runId: run.id };
    }
    for (const e of exps) {
      const run = e.runs.find((x) => runMatches(type, x));
      if (run) return { experimentId: e.id, runId: run.id };
    }
    return null;
  }
  let dragPayload = null;      // {kind:'type', type} | {kind:'field'|'master', ...}
  let saveTimer = null;
  let rowH = 40;
  const listeners = [];
  const on = (target, ev, fn, opts) => { target.addEventListener(ev, fn, opts); listeners.push([target, ev, fn, opts]); };
  let unmountStar = null;   // estrellita: función de limpieza (con .setPersona)

  function loadSelections() {
    try { return JSON.parse(sessionStorage.getItem(`ds.sel.${ctx.appId}`) || "{}") || {}; } catch { return {}; }
  }
  function saveSelections() {
    sessionStorage.setItem(`ds.sel.${ctx.appId}`, JSON.stringify(st.selections));
  }

  /* ======================================================================
     Esqueleto
     ====================================================================== */
  mount.innerHTML = `
    <div class="ho" id="ho">
      <div class="ho-toolbar">
        <div class="ho-tb-group">
          <button class="ho-tb-btn edit-only" data-act="activos" title="Mostrar/ocultar el panel de activos">${svg("pages")}<span>Activos</span></button>
          <button class="ho-tb-btn edit-only" data-act="hojas" title="Hojas">${svg("pages")}<span>Hojas</span></button>
          <button class="ho-tb-btn edit-only" data-act="marcadores" title="Marcadores">${svg("star")}<span>Marcadores</span></button>
        </div>
        <div class="ho-tb-sep edit-only"></div>
        <div class="ho-tb-group edit-only">
          <button class="ho-tb-ico" data-act="cut" title="Cortar (Ctrl+X)">✂</button>
          <button class="ho-tb-ico" data-act="copy" title="Copiar (Ctrl+C)">⧉</button>
          <button class="ho-tb-ico" data-act="paste" title="Pegar (Ctrl+V)">📋</button>
          <button class="ho-tb-ico" data-act="delete" title="Eliminar (Supr)">🗑</button>
        </div>
        <div class="ho-tb-status" id="hoStatus"></div>
        <div class="ho-tb-group right">
          <button class="ho-tb-ico edit-only" data-act="undo" title="Deshacer (Ctrl+Z)">↶</button>
          <button class="ho-tb-ico edit-only" data-act="redo" title="Rehacer (Ctrl+Y)">↷</button>
          <div class="ho-tb-sep edit-only"></div>
          <button class="ho-tb-btn edit-only" data-act="source" disabled title="Tabla de origen: ${SOON}">${svg("database")}<span>Tabla de origen</span></button>
          <button class="ho-tb-btn edit-only" data-act="props" title="Mostrar/ocultar propiedades">${svg("catalog")}<span>Propiedades</span></button>
          ${canEdit ? `<button class="ho-tb-edit" data-act="toggleEdit" id="hoEditBtn">✎ <span>Editar hoja</span></button>` : ""}
        </div>
      </div>
      <div class="ho-selbar" id="hoSelbar" hidden></div>
      <div class="ho-body">
        <nav class="ho-rail edit-only" id="hoRail"></nav>
        <aside class="ho-assets" id="hoAssets"></aside>
        <section class="ho-stage">
          <header class="ho-sheet-title" id="hoTitle"></header>
          <div class="ho-scroll" id="hoScroll">
            <div class="ho-grid" id="hoGrid"></div>
          </div>
        </section>
        <aside class="ho-props edit-only" id="hoProps"></aside>
      </div>
      <div class="ho-pop" id="hoPop" hidden></div>
      <div class="ho-modal-backdrop" id="hoModal" hidden></div>
    </div>`;

  const $ = (sel) => mount.querySelector(sel);
  const root = $("#ho");
  const grid = $("#hoGrid");
  const scroll = $("#hoScroll");
  const pop = $("#hoPop");
  const modal = $("#hoModal");

  async function loadFields() {
    try {
      const f = await api.getFields(ctx.appId);
      const byName = new Map();
      // La IDENTIDAD de un campo es su nombre físico (c.field); c.display es el
      // alias de presentación del override (rename o el físico). Guardamos ambos
      // para rotular por display sin cambiar la identidad que se envía a /query.
      [...(f.dimensions || []), ...(f.measures || [])].forEach((c) => {
        const cur = byName.get(c.field);
        if (cur) { if (!cur.tables.includes(c.table)) cur.tables.push(c.table); }
        else byName.set(c.field, { field: c.field, display: c.display || c.field, type: c.type, tables: [c.table] });
      });
      st.fields = [...byName.values()].sort((a, b) => (a.display || a.field).localeCompare(b.display || b.field, "es"));
    } catch { st.fields = []; }
  }

  /** Display (rename del override) de un campo físico; cae al propio nombre si no hay override. */
  function displayOf(field) {
    const f = (st.fields || []).find((x) => x.field === field);
    return (f && f.display) || field;
  }
  async function loadMasters() {
    try { st.masters = await api.listMasterItems(ctx.appId); } catch { st.masters = []; }
  }

  /* ======================================================================
     Hojas: abrir, crear, guardar
     ====================================================================== */
  function docOf(s) {
    return { title: s.title, description: s.description || "", objects: s.objects || [], props: s.props || {} };
  }

  function openSheet(sheet, { quiet = false } = {}) {
    destroyAllContent();
    els.forEach((el) => el.remove());
    els.clear();
    st.sheet = sheet ? clone(sheet) : null;
    st.selectedId = null;
    st.history = [];
    st.future = [];
    if (sheet) localStorage.setItem(LS("last"), sheet.id);
    if (st.sheet) {
      st.sheet.props = { ...DEFAULT_SHEET_PROPS, ...(st.sheet.props || {}) };
      // Normaliza valores heredados ("adaptable" sin cellH, grid antiguo, etc.).
      if (!(st.sheet.props.grid in GRID_GUTTER) && st.sheet.props.grid !== "personalizado") st.sheet.props.grid = "medio";
      st.sheet.objects.forEach((o) => { o.props = { ...defaultProps(o.type), ...(o.props || {}), look: { ...defaultProps(o.type).look, ...((o.props || {}).look || {}) } }; });
    }
    renderChrome();
    relayout();
    if (typeof registerSheetMenu === "function") registerSheetMenu();
    if (!quiet) status("");
  }

  function scheduleSave() {
    if (!st.sheet) return;
    status("Guardando…");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 500);
  }

  async function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!st.sheet) return;
    const s = st.sheet;
    try {
      const saved = await api.updateSheet(ctx.appId, s.id, docOf(s));
      const i = st.sheets.findIndex((x) => x.id === s.id);
      if (i >= 0) st.sheets[i] = saved;
      status("Guardado");
      if (st.rail === "hojas") renderAssets();
    } catch (e) {
      status(`Error al guardar: ${e.message}`, true);
    }
  }

  async function createSheet(template) {
    const n = st.sheets.length + 1;
    const title = st.sheets.some((s) => s.title === "Mi nueva hoja") ? `Mi nueva hoja (${n})` : "Mi nueva hoja";
    const objects = (template?.objects || []).map((t) => ({ id: uid(), type: t.type, x: t.x, y: t.y, w: t.w, h: t.h, props: defaultProps(t.type) }));
    try {
      const created = await api.createSheet(ctx.appId, { title, objects, props: { ...DEFAULT_SHEET_PROPS } });
      st.sheets.push(created);
      if (template) rememberTemplate(template.key);
      openSheet(created);
      setEdit(true);
      st.rail = "graficos";
      renderChrome();
    } catch (e) {
      alert(`No se pudo crear la hoja: ${e.message}`);
    }
  }

  async function duplicateSheet(s) {
    try {
      const copy = await api.createSheet(ctx.appId, {
        title: `${s.title} (copia)`, description: s.description,
        objects: s.objects.map((o) => ({ ...clone(o), id: uid() })), props: clone(s.props || {}),
      });
      st.sheets.push(copy);
      renderAssets();
    } catch (e) { alert(`No se pudo duplicar: ${e.message}`); }
  }

  async function removeSheet(s) {
    if (!confirm(`¿Eliminar la hoja "${s.title}"? Esta acción no se puede deshacer.`)) return;
    try {
      await api.deleteSheet(ctx.appId, s.id);
      st.sheets = st.sheets.filter((x) => x.id !== s.id);
      if (st.sheet?.id === s.id) openSheet(st.sheets[0] || null);
      else renderAssets();
    } catch (e) { alert(`No se pudo eliminar: ${e.message}`); }
  }

  async function renameSheet(s) {
    const t = prompt("Nuevo título de la hoja:", s.title);
    if (!t || !t.trim()) return;
    if (st.sheet?.id === s.id) {
      pushHistory();
      st.sheet.title = t.trim();
      renderTitle();
      if (!st.selectedId) renderProps();
      await saveNow();
    } else {
      try {
        const saved = await api.updateSheet(ctx.appId, s.id, { ...docOf(s), title: t.trim() });
        st.sheets[st.sheets.findIndex((x) => x.id === s.id)] = saved;
      } catch (e) { alert(e.message); }
    }
    renderAssets();
  }

  /* ======================================================================
     Historial (deshacer / rehacer)
     ====================================================================== */
  function pushHistory() {
    if (!st.sheet) return;
    st.history.push(JSON.stringify(docOf(st.sheet)));
    if (st.history.length > 60) st.history.shift();
    st.future = [];
  }
  function restore(snapshot) {
    const doc = JSON.parse(snapshot);
    Object.assign(st.sheet, doc);
    if (st.selectedId && !st.sheet.objects.some((o) => o.id === st.selectedId)) st.selectedId = null;
    destroyAllContent();
    els.forEach((el) => el.remove());
    els.clear();
    renderTitle();
    relayout();
    renderProps();
    scheduleSave();
  }
  function undo() {
    if (!st.history.length) return;
    st.future.push(JSON.stringify(docOf(st.sheet)));
    restore(st.history.pop());
  }
  function redo() {
    if (!st.future.length) return;
    st.history.push(JSON.stringify(docOf(st.sheet)));
    restore(st.future.pop());
  }

  /* ======================================================================
     Modo edición / chrome
     ====================================================================== */
  function setEdit(v) {
    st.edit = !!v && canEdit;
    if (!st.edit) st.selectedId = null;
    renderChrome();
    relayout();
    rerenderAllContent();
  }

  function renderChrome() {
    root.classList.toggle("editing", st.edit);
    // El panel de activos (Hojas, Marcadores, Gráficos…) solo existe en "Editar hoja".
    root.classList.toggle("assets-closed", !st.edit || !st.assetsOpen);
    root.classList.toggle("props-closed", !st.propsOpen);
    const eb = $("#hoEditBtn");
    if (eb) {
      eb.classList.toggle("on", st.edit);
      eb.innerHTML = st.edit ? "✓ <span>Listo</span>" : "✎ <span>Editar hoja</span>";
      eb.disabled = !st.sheet;
    }
    mount.querySelectorAll(".ho-tb-btn[data-act='hojas'], .ho-tb-btn[data-act='marcadores']").forEach((b) =>
      b.classList.toggle("on", st.edit && st.assetsOpen && st.rail === b.dataset.act));
    renderRail();
    renderAssets();
    renderTitle();
    renderProps();
    renderSelbar();
    syncEstrellita();
  }

  /* ======================================================================
     Estrellita (asistente IA): analista en modo VISTA, diseñador en EDICION.
     Una sola instancia que cambia de personalidad según st.edit.
     ====================================================================== */
  function buildAnalistaContext() {
    const s = st.sheet;
    const objetos = (s?.objects || []).map((o) => ({
      tipo: o.type,
      titulo: (o.props && o.props.title) || "",
      dims: (o.props?.dims || []).map((d) => itemLabel(d)),
      medidas: (o.props?.measures || []).map((m) => itemLabel(m)),
      ...(o.type === "text" && o.props?.text ? { texto: o.props.text } : {}),
    }));
    const ctxOut = {
      tablero: { titulo: s?.title || "", descripcion: s?.description || "", objetos },
      selecciones: st.selections || {},
    };
    // Hoja generada desde Experimentos de ML ("Asociar a"): el analista recibe el
    // resumen del modelo (algoritmo, métricas, segmentos, lectura) para explicarlo.
    if (s?.props?.ml) ctxOut.modeloML = s.props.ml;
    return ctxOut;
  }
  function buildDisenadorContext() {
    return {
      campos: (st.fields || []).map((f) => ({ name: f.field, type: f.type, tables: f.tables })),
      modelo: {
        titulo: st.sheet?.title || "",
        objetos: (st.sheet?.objects || []).map((o) => ({ tipo: o.type, titulo: (o.props && o.props.title) || "" })),
      },
    };
  }
  function syncEstrellita() {
    if (!unmountStar || typeof unmountStar.setPersona !== "function") return;
    if (st.edit) {
      unmountStar.setPersona({
        persona: "diseñador de dashboards",
        title: "Diseñador",
        greeting: "Soy tu diseñador de dashboards. Te propongo gráficos, KPIs, qué visualización va mejor por campo y cómo estructurar la hoja. ¿Qué construimos?",
        sendFn: api.aiDisenar,
        buildContext: buildDisenadorContext,
        onAction: applyPlan, // EDICIÓN: el diseñador puede EJECUTAR el plan
      });
    } else {
      unmountStar.setPersona({
        persona: "analista de datos",
        title: "Analista",
        greeting: "Soy tu analista. Pregúntame sobre el tablero, los KPIs, los gráficos o las selecciones activas.",
        sendFn: api.aiAnalizar,
        buildContext: buildAnalistaContext,
        onAction: null, // VISTA: analista es de solo lectura, sin botón de acción
      });
    }
  }

  function renderRail() {
    $("#hoRail").innerHTML = RAIL.map((r) => `
      <button class="ho-rail-item ${st.rail === r.key && st.assetsOpen ? "active" : ""}" data-rail="${r.key}" title="${esc(r.label)}">
        <span class="ho-rail-ico">${svg(r.icon)}</span>
        <span class="ho-rail-label">${esc(r.label)}</span>
      </button>`).join("");
    $("#hoRail").querySelectorAll("[data-rail]").forEach((b) =>
      b.addEventListener("click", () => {
        const key = b.dataset.rail;
        if (key === "variables") { openVariables(); return; }
        if (st.rail === key && st.assetsOpen) st.assetsOpen = false;
        else { st.rail = key; st.assetsOpen = true; }
        renderChrome();
        relayout();
      }));
  }

  function renderTitle() {
    const t = $("#hoTitle");
    if (!st.sheet) { t.innerHTML = ""; t.hidden = true; return; }
    t.hidden = false;
    const i = st.sheets.findIndex((s) => s.id === st.sheet.id);
    t.innerHTML = `
      <span class="ho-brand">◆ DataSense</span>
      <span class="ho-title-text">${esc(st.sheet.title)}</span>
      <span class="ho-title-nav">
        <button data-nav="-1" ${i <= 0 ? "disabled" : ""} title="Hoja anterior">‹</button>
        <button data-nav="1" ${i >= st.sheets.length - 1 ? "disabled" : ""} title="Hoja siguiente">›</button>
      </span>`;
    t.querySelectorAll("[data-nav]").forEach((b) => b.addEventListener("click", async () => {
      if (saveTimer) await saveNow();
      const next = st.sheets[i + Number(b.dataset.nav)];
      if (next) { const keepEdit = st.edit; openSheet(next); if (keepEdit) setEdit(true); }
    }));
  }

  function status(text, isError = false) {
    const s = $("#hoStatus");
    if (!s) return;
    s.textContent = text;
    s.classList.toggle("err", !!isError);
  }

  /* ======================================================================
     Rejilla: medidas y distribución
     ====================================================================== */
  function snap() { return GRID_SNAP[st.sheet?.props?.grid] || 1; }

  /** Nº de columnas efectivas de la hoja (fijo en tamaño personalizado). */
  function cols() {
    const p = st.sheet?.props;
    if (p?.size === "personalizado" && p.cols) return Math.max(CUSTOM_COLS_MIN, Math.min(CUSTOM_COLS_MAX, p.cols | 0));
    return GRID_COLS;
  }

  /** Separación (gutter) en px entre celdas, según el espaciado configurado. */
  function gutter() {
    const p = st.sheet?.props;
    if (!p) return 4;
    if (p.grid === "personalizado") return Math.max(0, Math.min(24, p.gutterPx | 0));
    return GRID_GUTTER[p.grid] ?? 4;
  }
  function maxBottom() { return Math.max(0, ...(st.sheet?.objects || []).map((o) => o.y + o.h)); }

  /**
   * Nº de filas que la cuadrícula muestra para LLENAR el lienzo visible.
   *  · Adaptable → 12 filas base (como Qlik), repartidas en la altura visible.
   *  · Personalizado → tantas filas de alto fijo (cellH) como quepan en el
   *    lienzo, nunca menos de 12. Así la cuadrícula siempre ocupa todo el alto.
   * No confundir con "Ampliar hoja", que permite ir aún más abajo al arrastrar.
   */
  function baseRows() {
    const p = st.sheet?.props;
    if (p?.size === "personalizado") {
      const cellH = Math.max(CELLH_MIN, Math.min(CELLH_MAX, p.cellH | 0 || 40));
      const viewH = Math.max(scroll.clientHeight, 360);
      return Math.max(GRID_ROWS, Math.floor(viewH / cellH));
    }
    return GRID_ROWS;
  }
  function rowsShown() { return st.sheet?.props?.extend ? Math.max(baseRows(), maxBottom()) : baseRows(); }

  function fits(rect, ignoreId) {
    if (rect.x < 0 || rect.y < 0 || rect.w < 1 || rect.h < 1) return false;
    if (rect.x + rect.w > cols()) return false;
    const limit = st.sheet.props.extend ? MAX_ROWS : baseRows();
    if (rect.y + rect.h > limit) return false;
    return !st.sheet.objects.some((o) => o.id !== ignoreId && overlaps(o, rect));
  }

  /** Busca el mayor rectángulo libre a partir de (x,y), encogiendo hasta el mínimo. */
  function findFit(x, y, w, h, ignoreId) {
    const C = cols();
    for (let hh = h; hh >= MIN_H; hh--) {
      for (let ww = Math.min(w, C); ww >= MIN_W; ww--) {
        const rect = { x: Math.max(0, Math.min(x, C - ww)), y, w: ww, h: hh };
        if (fits(rect, ignoreId)) return rect;
      }
    }
    return null;
  }

  function relayout() {
    if (!st.sheet) {
      grid.innerHTML = `
        <div class="ho-nosheet">
          ${typeIcon("bar")}
          <p class="ho-nosheet-title">Esta aplicación todavía no tiene hojas.</p>
          ${canEdit ? `<button class="ho-btn primary" id="hoFirstSheet">+ Crear nueva hoja</button>` : `<p class="muted">Pide a un editor que cree una hoja.</p>`}
        </div>`;
      grid.style.height = "";
      grid.classList.remove("has-sheet");
      const b = grid.querySelector("#hoFirstSheet");
      if (b) b.addEventListener("click", () => openTemplates());
      return;
    }
    grid.querySelector(".ho-nosheet")?.remove();
    grid.classList.add("has-sheet");
    const p = st.sheet.props;
    const C = cols();
    const custom = p.size === "personalizado";
    const viewH = Math.max(scroll.clientHeight, 360);

    // La cuadrícula SIEMPRE llena el lienzo (100% de ancho; alto ≥ área visible).
    // Las propiedades solo cambian la DENSIDAD, nunca encogen el área:
    //  · Columnas → cuántas columnas dividen el mismo ancho (celdas más/menos anchas).
    //  · Alto de fila (cellH) → alto de cada fila; se muestran tantas filas como
    //    quepan para llenar el alto, y si hay más, el lienzo se desplaza.
    //  · Adaptable → 12 filas repartidas en la altura visible.
    const rows = rowsShown();
    if (custom) {
      rowH = Math.max(CELLH_MIN, Math.min(CELLH_MAX, p.cellH | 0 || 40));
    } else {
      rowH = Math.max(28, Math.floor(viewH / GRID_ROWS));
    }

    const extra = p.extend && st.edit ? 2 : 0;
    const totalH = (rows + extra) * rowH;
    grid.style.setProperty("--rowh", `${rowH}px`);
    grid.style.setProperty("--cols", C);
    grid.style.setProperty("--gutter", `${gutter()}px`);
    // El ancho lo gestiona el CSS (100%). El alto llena el lienzo como mínimo.
    grid.style.width = "";
    grid.style.maxWidth = "";
    grid.style.height = `${Math.max(totalH, viewH)}px`;
    grid.classList.toggle("extend", !!p.extend);
    grid.classList.toggle("small-list", p.small === "lista");

    let ext = grid.querySelector(".ho-extend-zone");
    if (st.sheet.props.extend && st.edit) {
      if (!ext) {
        ext = document.createElement("div");
        ext.className = "ho-extend-zone";
        ext.innerHTML = `${svg("plus")} Coloque el objeto aquí para ampliar la hoja.`;
        grid.appendChild(ext);
      }
      ext.style.top = `${rows * rowH}px`;
      ext.style.height = `${2 * rowH}px`;
    } else if (ext) ext.remove();

    const ids = new Set(st.sheet.objects.map((o) => o.id));
    els.forEach((el, id) => { if (!ids.has(id)) { destroyContent(id); el.remove(); els.delete(id); } });
    st.sheet.objects.forEach((o) => {
      let el = els.get(o.id);
      if (!el) { el = createObjEl(o); els.set(o.id, el); grid.appendChild(el); renderContent(o); }
      placeEl(el, o);
      el.classList.toggle("selected", st.edit && st.selectedId === o.id);
    });
  }

  function placeEl(el, r) {
    const C = cols();
    const g = gutter();
    const half = g / 2;
    el.style.left = `calc(${(r.x / C) * 100}% + ${half}px)`;
    el.style.width = `calc(${(r.w / C) * 100}% - ${g}px)`;
    el.style.top = `${r.y * rowH + half}px`;
    el.style.height = `${r.h * rowH - g}px`;
  }

  function cellFromEvent(e) {
    const rect = grid.getBoundingClientRect();
    const C = cols();
    const colW = rect.width / C;
    return {
      cx: Math.max(0, Math.min(C - 1, Math.floor((e.clientX - rect.left) / colW))),
      cy: Math.max(0, Math.floor((e.clientY - rect.top) / rowH)),
      colW,
    };
  }

  /* ======================================================================
     Objetos: elemento, contenido, interacción
     ====================================================================== */
  function createObjEl(o) {
    const el = document.createElement("div");
    el.className = "ho-obj";
    el.dataset.id = o.id;
    el.innerHTML = `
      <div class="ho-obj-inner"></div>
      <div class="ho-obj-tools">
        <button class="ho-obj-tool" data-tool="expand" title="Pantalla completa">⤢</button>
        <button class="ho-obj-tool" data-tool="menu" title="Más acciones">⋯</button>
      </div>
      ${["n", "s", "e", "w", "ne", "nw", "se", "sw"].map((h) => `<span class="ho-handle h-${h}" data-h="${h}"></span>`).join("")}
      <span class="ho-obj-size"></span>`;

    el.addEventListener("pointerdown", (e) => onObjPointerDown(e, o.id));
    el.querySelector("[data-tool='expand']").addEventListener("click", (e) => { e.stopPropagation(); expandObject(o.id); });
    el.querySelector("[data-tool='menu']").addEventListener("click", (e) => { e.stopPropagation(); openObjMenu(e.currentTarget, o.id); });

    // Soltar campos / elementos maestros sobre un objeto existente.
    el.addEventListener("dragover", (e) => {
      if (!st.edit || !dragPayload || dragPayload.kind === "type") return;
      e.preventDefault();
      e.stopPropagation();
      hideGhost();
      el.classList.add("drop-target");
    });
    el.addEventListener("dragleave", () => el.classList.remove("drop-target"));
    el.addEventListener("drop", (e) => {
      el.classList.remove("drop-target");
      if (!st.edit || !dragPayload || dragPayload.kind === "type") return;
      e.preventDefault();
      e.stopPropagation();
      const obj = objById(o.id);
      if (obj) addFromPayload(obj, dragPayload);
      dragPayload = null;
    });
    return el;
  }

  const objById = (id) => st.sheet?.objects.find((o) => o.id === id) || null;

  function destroyContent(id) {
    const fn = cleanups.get(id);
    if (fn) { try { fn(); } catch {} }
    cleanups.delete(id);
  }
  function destroyAllContent() { [...cleanups.keys()].forEach(destroyContent); }
  function rerenderAllContent() { st.sheet?.objects.forEach((o) => renderContent(o)); }

  function resolveItem(item) {
    if (!item) return null;
    if (item.source === "master") {
      const m = st.masters.find((x) => x.id === item.masterId);
      if (!m) return null;
      return { ...m.resolved, label: item.label || m.name };
    }
    if (!item.table || !item.field) return null;
    return { table: item.table, field: item.field, agg: item.agg, label: item.label || defaultLabel(item) };
  }

  function defaultLabel(item) {
    if (item.source === "master") return st.masters.find((m) => m.id === item.masterId)?.name || "Elemento eliminado";
    if (item.source === "expr") return item.expression;
    // Rótulo por DISPLAY del override (p.ej. "Ventas"->"Ingresos") manteniendo la
    // identidad física del campo. Si el usuario puso label propio, manda ese.
    const disp = displayOf(item.field);
    if (item.agg) return `${AGG_LABEL[item.agg]}(${disp})`;
    return disp;
  }

  function itemLabel(item) { return item.label || defaultLabel(item); }

  async function renderContent(o) {
    const el = els.get(o.id);
    if (!el) return;
    const inner = el.querySelector(".ho-obj-inner");
    const def = getType(o.type);
    const p = o.props;
    const token = (tokens.get(o.id) || 0) + 1;
    tokens.set(o.id, token);
    destroyContent(o.id);

    const titleOn = p.showTitles !== false && (p.title || p.subtitle);
    const footText = [p.showTitles !== false && p.footnote ? esc(p.footnote) : "", p.disclaimerOn && p.disclaimer ? `<span class="ho-obj-disc">${esc(p.disclaimer)}</span>` : ""].filter(Boolean).join(" ");
    // Menú activable: cuando está desactivado, no se muestran las herramientas
    // (expandir / ⋯) al pasar el cursor (coherente con Qlik).
    el.classList.toggle("no-hover-menu", p.hoverMenu === false);
    inner.innerHTML = `
      ${titleOn ? `<div class="ho-obj-head">${p.title ? `<div class="ho-obj-title">${esc(p.title)}</div>` : ""}${p.subtitle ? `<div class="ho-obj-sub">${esc(p.subtitle)}</div>` : ""}</div>` : ""}
      ${!titleOn && st.edit && def && !def.noData && o.type !== "filterpane" ? `<div class="ho-obj-addtitle">⊕ Haga clic para añadir un título</div>` : ""}
      <div class="ho-obj-body"></div>
      ${footText ? `<div class="ho-obj-foot">${footText}</div>` : ""}`;
    const body = inner.querySelector(".ho-obj-body");
    const addTitle = inner.querySelector(".ho-obj-addtitle");
    if (addTitle) addTitle.addEventListener("click", (e) => {
      e.stopPropagation();
      select(o.id);
      st.accordion = "aspecto";
      st.sub.general = true;
      renderProps();
      setTimeout(() => mount.querySelector("#pTitle")?.focus(), 0);
    });

    if (!def || !def.available) {
      body.innerHTML = `<div class="ho-obj-msg">Tipo de objeto no disponible.</div>`;
      return;
    }

    // Objetos sin datos (cuadro de mando) se dibujan directo.
    const r = def.render;
    if (r === "text") { renderText(body, p); return; }
    if (r === "note") { renderNote(body, p, def); return; }
    if (r === "button") { renderButton(body, p); return; }
    if (r === "divider") { renderDivider(body); return; }
    if (r === "container") { renderContainer(body, def); return; }
    if (r === "image") { renderImage(body, p); return; }
    if (r === "video") { renderVideo(body, p); return; }
    if (r === "navmenu") {
      renderNavMenu(body, st.sheets, st.edit ? null : (id) => { const s = st.sheets.find((x) => x.id === id); if (s) openSheet(s); }, st.sheet?.id);
      return;
    }
    if (r === "ml") {
      const ref = p.ml;
      if (!ref?.runId) {
        body.innerHTML = `<div class="mlv-empty"><span class="mlv-empty-ico">${typeIcon(def.icon)}</span><strong>${esc(def.label)}</strong>
          <span>${st.edit ? "Elige el experimento y la ejecución en Propiedades › Datos." : "Este gráfico no tiene una ejecución de ML asignada."}</span></div>`;
        return;
      }
      body.innerHTML = `<div class="ho-obj-loading">Cargando el resultado del modelo…</div>`;
      try {
        const res = await mlRun(ref.experimentId, ref.runId);
        if (tokens.get(o.id) !== token) return;
        cleanups.set(o.id, renderMlView(body, o.type, res, { look: p.look }));
      } catch (e) {
        if (tokens.get(o.id) !== token) return;
        body.innerHTML = `<div class="ho-obj-msg">No se pudo cargar la ejecución de ML: ${esc(e.message)}</div>`;
      }
      return;
    }

    if (!isComplete(def, p)) { renderEmptyState(body, o, def); return; }
    body.innerHTML = `<div class="ho-obj-loading">Calculando…</div>`;

    try {
      // Panel de filtrado: valores con estado asociativo.
      if (r === "filterpane") {
        const lists = await Promise.all(p.dims.map(async (d) => {
          const rr = resolveItem(d);
          if (!rr) return { label: itemLabel(d), field: "", values: [], error: "Dimensión no disponible." };
          try {
            const res = await api.getFieldValues(ctx.appId, rr.field, st.selections);
            return { label: rr.label || rr.field, field: rr.field, values: res.values };
          } catch (e) { return { label: rr.label || rr.field, field: rr.field, values: [], error: e.message }; }
        }));
        if (tokens.get(o.id) !== token) return;
        renderFilterPane(body, lists, { interactive: !st.edit, onToggle: toggleSelection });
        return;
      }

      const dimFields = p.dims.map(resolveItem).filter(Boolean);
      const sel = mergeSelections(st.selections, p.filters);

      // --- KPI / Gauge: escalar(es) ---
      if (r === "kpi") {
        const vals = await Promise.all(p.measures.map((m) => {
          const rr = resolveItem(m);
          return api.query(ctx.appId, { measures: [{ table: rr.table, field: rr.field, agg: rr.agg || "sum", label: rr.label }], selections: sel }).then((x) => x.value);
        }));
        if (tokens.get(o.id) !== token) return;
        renderKpi(body, p, { value: vals[0], compare: vals[1], label: itemLabel(p.measures[0]) });
        return;
      }
      if (r === "gauge") {
        const rr = resolveItem(p.measures[0]);
        const res = await api.query(ctx.appId, { measures: [{ table: rr.table, field: rr.field, agg: rr.agg || "sum" }], selections: sel });
        if (tokens.get(o.id) !== token) return;
        renderGauge(body, p, res.value);
        return;
      }

      // --- Histograma: valores crudos de la medida (agg none vía conteo de filas) ---
      if (r === "histogram") {
        const rr = resolveItem(p.measures[0]);
        const res = await api.query(ctx.appId, {
          dimension: { table: rr.table, field: rr.field },
          measures: [{ table: rr.table, field: rr.field, agg: "count" }], selections: sel,
        });
        if (tokens.get(o.id) !== token) return;
        // labels son los valores distintos; expandimos por su conteo para el histograma.
        const raw = [];
        (res.labels || []).forEach((lab, i) => { const n = res.values[i] || 0; for (let k = 0; k < n; k++) raw.push(Number(lab)); });
        renderHistogram(body, raw);
        return;
      }

      // --- Dos dimensiones: heatmap / pivot / gridchart ---
      if ((r === "heatmap" || r === "pivot") && dimFields.length >= 2) {
        const meas = resolveItem(p.measures[0]);
        const grid = {}; const xs = new Set(); const ys = new Set(); let max = 0;
        // Consulta por cada valor de la 2ª dimensión (filtro) agrupando por la 1ª.
        const yVals = (await api.getFieldValues(ctx.appId, dimFields[1].field, sel)).values.map((v) => v.value);
        for (const yv of yVals.slice(0, 40)) {
          const s2 = { ...sel, [dimFields[1].field]: [yv] };
          const res = await api.query(ctx.appId, {
            dimension: { table: dimFields[0].table, field: dimFields[0].field },
            measures: [{ table: meas.table, field: meas.field, agg: meas.agg || "sum" }], selections: s2,
          });
          (res.labels || []).forEach((xl, i) => { xs.add(String(xl)); ys.add(String(yv)); const val = res.values[i]; grid[`${yv}|${xl}`] = val; if (val > max) max = val; });
        }
        if (tokens.get(o.id) !== token) return;
        if (r === "heatmap") renderHeatmap(body, { xs: [...xs], ys: [...ys], grid, max });
        else renderPivot(body, { rows: [...ys], cols: [...xs], grid, rowLabel: itemLabel(p.dims[1]) });
        return;
      }

      // --- Orgchart / red: dos dimensiones como pares (nodo, padre) ---
      if (r === "orgchart") {
        const res = await api.query(ctx.appId, {
          dimension: { table: dimFields[0].table, field: dimFields[0].field },
          measures: [{ table: dimFields[0].table, field: dimFields[0].field, agg: "count" }], selections: sel,
        });
        const pairs = [];
        for (const nodeVal of (res.labels || [])) {
          const parents = (await api.query(ctx.appId, {
            dimension: { table: dimFields[1].table, field: dimFields[1].field },
            measures: [{ table: dimFields[1].table, field: dimFields[1].field, agg: "count" }],
            selections: { ...sel, [dimFields[0].field]: [nodeVal] },
          })).labels || [];
          pairs.push([String(nodeVal), parents.length ? String(parents[0]) : ""]);
        }
        if (tokens.get(o.id) !== token) return;
        renderOrg(body, pairs);
        return;
      }

      // --- Sankey: 2 dims + medida (origen, destino, flujo) ---
      if (r === "sankey") {
        const meas = resolveItem(p.measures[0]);
        const flows = [];
        const origins = (await api.getFieldValues(ctx.appId, dimFields[0].field, sel)).values.map((v) => v.value);
        for (const og of origins.slice(0, 30)) {
          const res = await api.query(ctx.appId, {
            dimension: { table: dimFields[1].table, field: dimFields[1].field },
            measures: [{ table: meas.table, field: meas.field, agg: meas.agg || "sum" }],
            selections: { ...sel, [dimFields[0].field]: [og] },
          });
          (res.labels || []).forEach((dst, i) => { if (res.values[i]) flows.push({ from: String(og), to: String(dst), value: res.values[i] }); });
        }
        if (tokens.get(o.id) !== token) return;
        flows.sort((a, b) => b.value - a.value);
        renderSankey(body, flows.slice(0, 40));
        return;
      }

      // --- Boxplot: resumen estadístico por grupo (min/q1/med/q3/max) ---
      if (r === "box") {
        const meas = resolveItem(p.measures[0]);
        const groups = (await api.getFieldValues(ctx.appId, dimFields[0].field, sel)).values.map((v) => v.value);
        const items = [];
        for (const g of groups.slice(0, 20)) {
          const s2 = { ...sel, [dimFields[0].field]: [g] };
          const [mn, q1, md, q3, mx] = await Promise.all(["min", "avg", "avg", "avg", "max"].map((agg) =>
            api.query(ctx.appId, { measures: [{ table: meas.table, field: meas.field, agg }], selections: s2 }).then((x) => x.value)));
          items.push({ label: String(g), min: mn, q1: (mn + md) / 2, med: md, q3: (md + mx) / 2, max: mx });
        }
        if (tokens.get(o.id) !== token) return;
        const lo = Math.min(...items.map((b) => b.min), 0);
        const hi = Math.max(...items.map((b) => b.max), 1);
        renderBoxplot(body, { items, lo, hi });
        return;
      }

      // --- El resto parte de una consulta dim + medidas estándar ---
      const spec = buildQuery(def, p, resolveItem, st.selections);
      if (!spec) { renderEmptyState(body, o, def); return; }
      const result = await api.query(ctx.appId, spec);
      if (tokens.get(o.id) !== token) return;

      const dimField = spec.dimension?.field;
      const onSelect = !st.edit && dimField ? (v) => toggleSelection(dimField, v) : null;
      const selectedValues = dimField ? st.selections[dimField] || [] : [];

      if (r === "table" || r === "pivot") {
        let totals = null;
        if (p.look.totals !== false && p.measures.length) {
          totals = await Promise.all(spec.measures.map((m) =>
            api.query(ctx.appId, { measures: [m], selections: spec.selections }).then((x) => x.value).catch(() => null)));
          if (tokens.get(o.id) !== token) return;
        }
        renderTable(body, p, result, totals, { onSelect, selectedValues, dimLabel: itemLabel(p.dims[0]), measureLabels: p.measures.map(itemLabel) });
        return;
      }
      if (r === "treemap") { renderTreemap(body, p, result); return; }
      if (r === "funnel") { renderFunnel(body, p, result); return; }
      if (r === "waterfall") { renderWaterfall(body, p, result); return; }
      if (r === "bullet") { renderBullet(body, p, result); return; }
      if (r === "map") { renderMap(body, p, result); return; }
      if (r === "wordcloud") { renderWordcloud(body, result); return; }

      // chartjs: barras, línea, área, tarta, dona, combinado, dispersión, radar, mekko
      const destroy = renderChart(body, def, p, result, { onSelect, selectedValues });
      if (destroy) cleanups.set(o.id, destroy);
    } catch (e) {
      if (tokens.get(o.id) !== token) return;
      body.innerHTML = `<div class="ho-obj-msg err">${esc(e.message)}</div>`;
    }
  }

  function renderEmptyState(body, o, def) {
    const p = o.props;
    const block = (kind, title) => {
      const r = def.roles[kind];
      if (!r || r.max === 0) return "";
      const have = p[kind === "dims" ? "dims" : "measures"].length;
      if (have >= r.min) return "";
      const slots = [];
      for (let i = have; i < r.min; i++) {
        slots.push(`<div class="ho-empty-role">${esc(roleLabel(def, kind, i))}</div>
          ${st.edit ? `<button class="ho-empty-add" data-add="${kind}">Añadir</button>` : ""}`);
      }
      return `<div class="ho-empty-block"><div class="ho-empty-title">${title}</div>${slots.join("")}</div>`;
    };
    body.innerHTML = `
      <div class="ho-empty">
        <span class="ho-empty-ico">${typeIcon(def.icon)}</span>
        ${block("dims", "Dimensiones")}
        ${block("measures", "Medidas")}
        ${st.edit ? "" : `<div class="ho-empty-note">Datos incompletos</div>`}
      </div>`;
    body.querySelectorAll("[data-add]").forEach((b) => {
      b.addEventListener("pointerdown", (e) => e.stopPropagation());
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        select(o.id);
        openCatalog(b, o.id, b.dataset.add === "dims" ? "dimension" : "measure");
      });
    });
  }

  /* ---------------- Selección del objeto, mover y redimensionar ---------------- */
  function select(id) {
    if (!st.edit) return;
    if (st.selectedId === id) return;
    st.selectedId = id;
    els.forEach((el, oid) => el.classList.toggle("selected", oid === id));
    if (id) st.accordion = st.accordion || "datos";
    renderProps();
  }

  function onObjPointerDown(e, id) {
    if (!st.edit || e.button !== 0) return;
    if (e.target.closest(".ho-obj-tool, .ho-empty-add, input, select, textarea, .ho-obj-addtitle")) return;
    e.stopPropagation();
    select(id);
    const obj = objById(id);
    const el = els.get(id);
    if (!obj || !el) return;
    const handle = e.target.closest(".ho-handle")?.dataset.h || null;
    const start = { x: obj.x, y: obj.y, w: obj.w, h: obj.h };
    const sx = e.clientX;
    const sy = e.clientY;
    const colW = grid.getBoundingClientRect().width / cols();
    const sn = snap();
    let moved = false;
    let cand = { ...start };

    try { el.setPointerCapture(e.pointerId); } catch { /* puntero no capturable: seguimos sin captura */ }
    const move = (ev) => {
      const dxPx = ev.clientX - sx;
      const dyPx = ev.clientY - sy;
      if (!moved && Math.abs(dxPx) < 4 && Math.abs(dyPx) < 4) return;
      moved = true;
      const dx = Math.round(dxPx / colW / sn) * sn;
      const dy = Math.round(dyPx / rowH / sn) * sn;
      let r = { ...start };
      if (!handle) { r.x = start.x + dx; r.y = start.y + dy; }
      else {
        if (handle.includes("e")) r.w = Math.max(MIN_W, start.w + dx);
        if (handle.includes("s")) r.h = Math.max(MIN_H, start.h + dy);
        if (handle.includes("w")) { const w = Math.max(MIN_W, start.w - dx); r.x = start.x + (start.w - w); r.w = w; }
        if (handle.includes("n")) { const h = Math.max(MIN_H, start.h - dy); r.y = start.y + (start.h - h); r.h = h; }
      }
      const ok = fits(r, id);
      el.classList.toggle("invalid", !ok);
      if (ok) cand = r;
      placeEl(el, ok ? r : cand);
      el.querySelector(".ho-obj-size").textContent = `(${(ok ? r : cand).x},${(ok ? r : cand).y}) ${(ok ? r : cand).w} x ${(ok ? r : cand).h}`;
      el.classList.add("dragging");
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.classList.remove("dragging", "invalid");
      if (!moved) return;
      if (cand.x !== start.x || cand.y !== start.y || cand.w !== start.w || cand.h !== start.h) {
        pushHistory();
        Object.assign(obj, cand);
        relayout();
        scheduleSave();
      } else placeEl(el, obj);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }

  // Clic en zona vacía de la rejilla: deselecciona (muestra Propiedades de hoja).
  grid.addEventListener("pointerdown", (e) => {
    if (e.target === grid || e.target.classList.contains("ho-extend-zone")) {
      if (st.selectedId) { st.selectedId = null; els.forEach((el) => el.classList.remove("selected")); renderProps(); }
    }
  });

  /* ---------------- Soltar gráficos desde el catálogo ---------------- */
  let ghost = null;
  function showGhost(rect, ok, label) {
    if (!ghost) {
      ghost = document.createElement("div");
      ghost.className = "ho-ghost";
      grid.appendChild(ghost);
    }
    ghost.classList.toggle("bad", !ok);
    ghost.innerHTML = ok ? `<span>${svg("plus")}</span><strong>Crear nuevo gráfico</strong><em>${esc(label)}</em>` : `<strong>No hay espacio libre aquí</strong>`;
    placeEl(ghost, rect);
  }
  function hideGhost() { ghost?.remove(); ghost = null; }

  function dropRect(e) {
    if (!dragPayload) return null;
    const { cx, cy } = cellFromEvent(e);
    let w;
    let h;
    if (dragPayload.kind === "type") {
      const def = getType(dragPayload.type);
      ({ w, h } = def.size);
    } else if (isMeasureLike(dragPayload)) { w = 6; h = 4; }
    else { w = 4; h = 6; }
    const rows = rowsShown();
    let y = cy;
    if (st.sheet.props.extend && cy >= rows) y = maxBottom();
    const sn = snap();
    const C = cols();
    const x = Math.floor(Math.min(cx, C - Math.min(w, C)) / sn) * sn;
    y = Math.floor(y / sn) * sn;
    return findFit(x, y, w, h) || { x, y, w, h, bad: true };
  }

  grid.addEventListener("dragover", (e) => {
    if (!st.edit || !st.sheet || !dragPayload) return;
    e.preventDefault();
    const r = dropRect(e);
    const label = dragPayload.kind === "type" ? getType(dragPayload.type).label : dragPayload.label;
    showGhost(r, !r.bad, label);
  });
  grid.addEventListener("dragleave", (e) => { if (e.target === grid) hideGhost(); });
  grid.addEventListener("drop", (e) => {
    if (!st.edit || !st.sheet || !dragPayload) return;
    e.preventDefault();
    const r = dropRect(e);
    hideGhost();
    const payload = dragPayload;
    dragPayload = null;
    if (!r || r.bad) { status("No hay espacio libre en esa posición. Reduzca o mueva otros objetos.", true); return; }
    let obj;
    if (payload.kind === "type") {
      obj = { id: uid(), type: payload.type, x: r.x, y: r.y, w: r.w, h: r.h, props: defaultProps(payload.type) };
      pushHistory();
      st.sheet.objects.push(obj);
      if (isMlType(obj.type)) assignMlDefault(obj);
    } else {
      // Campo o elemento maestro sobre la rejilla: panel de filtrado (dimensión) o KPI (medida).
      const type = isMeasureLike(payload) ? "kpi" : "filterpane";
      obj = { id: uid(), type, x: r.x, y: r.y, w: r.w, h: r.h, props: defaultProps(type) };
      pushHistory();
      st.sheet.objects.push(obj);
      addFromPayload(obj, payload, { noHistory: true });
    }
    relayout();
    st.selectedId = obj.id;
    st.accordion = "datos";
    relayout();
    renderProps();
    scheduleSave();
  });
  on(document, "dragend", () => { hideGhost(); dragPayload = null; });

  function isMeasureLike(p) {
    if (p.kind === "master") return p.masterKind === "measure";
    return p.type === "number";
  }

  /* ---------------- Añadir dimensiones / medidas ---------------- */
  function addFromPayload(obj, payload, { noHistory = false } = {}) {
    const def = getType(obj.type);
    if (!def || def.noData) return;
    let kind;
    if (payload.kind === "master") kind = payload.masterKind === "measure" ? "measure" : "dimension";
    else kind = payload.type === "number" && def.roles.measures.max > 0 ? "measure" : "dimension";
    if (kind === "measure" && def.roles.measures.max === 0) kind = "dimension";
    if (kind === "dimension" && def.roles.dims.max === 0) kind = "measure";
    const item = payload.kind === "master"
      ? { id: uid(), source: "master", masterId: payload.masterId }
      : kind === "measure"
        ? { id: uid(), source: "field", table: payload.table, field: payload.field, agg: payload.type === "number" ? "sum" : "count" }
        : { id: uid(), source: "field", table: payload.table, field: payload.field };
    addItem(obj, kind, item, { noHistory });
  }

  function addItem(obj, kind, item, { noHistory = false } = {}) {
    const def = getType(obj.type);
    const list = kind === "measure" ? obj.props.measures : obj.props.dims;
    const max = def.roles[kind === "measure" ? "measures" : "dims"].max;
    if (list.length >= max) {
      status(`Este gráfico admite como máximo ${max} ${kind === "measure" ? "medida(s)" : "dimensión(es)"}.`, true);
      return false;
    }
    if (!noHistory) pushHistory();
    list.push(item);
    renderContent(obj);
    if (st.selectedId === obj.id) renderProps();
    scheduleSave();
    return true;
  }

  /* ---------------- Ejecutar plan del asistente (FEAT-002) ---------------- */
  /**
   * EJECUTA el plan de acciones que devuelve el diseñador (backend FEAT-001):
   * crea objetos reales en la hoja a partir de action.objects[], usando campos
   * reales y colocándolos sin solapes. Devuelve un string de feedback para que
   * la estrellita lo muestre en el hilo.
   * @param {{kind:string, objects?:Array}} action
   * @returns {Promise<string>}
   */
  async function applyPlan(action) {
    if (!action || typeof action !== "object") return "No había un plan que aplicar.";
    // El script de carga es cosa del editor, no de la hoja.
    if (action.kind === "apply-script") return "Ese plan es para el editor de carga, no para la hoja.";

    const prefix = [];

    // Asegurar que existe una hoja abierta.
    if (!st.sheet) {
      await createSheet();
      if (!st.sheet) return "No se pudo crear una hoja para aplicar el plan.";
      prefix.push("Creé una hoja nueva");
    }
    // Asegurar modo edición.
    if (!st.edit) {
      setEdit(true);
      prefix.push("activé el modo edición");
    }

    const objects = Array.isArray(action.objects) ? action.objects : [];
    if (!objects.length) {
      return prefix.length ? `${capitalize(prefix.join(" y "))}.` : "El plan no traía objetos que crear.";
    }

    // Si la hoja ya tenía objetos, preguntar reemplazar vs añadir (solo build-sheet).
    if (action.kind === "build-sheet" && st.sheet.objects.length > 0) {
      const replace = confirm("La hoja ya tiene objetos. ¿Reemplazarlos por el nuevo dashboard?\n\nAceptar = Reemplazar · Cancelar = Añadir");
      if (replace) {
        st.sheet.objects.forEach((o) => { destroyContent(o.id); const el = els.get(o.id); if (el) { el.remove(); els.delete(o.id); } });
        st.sheet.objects = [];
      }
    }

    pushHistory();

    let created = 0;
    for (const spec of objects) {
      const def = getType(spec.type);
      if (!def || !def.available) continue; // tipo desconocido o no disponible → descartar

      // Posición: respetar x/y/w/h del plan si caben; si no, buscar hueco.
      const w = Math.max(1, Number(spec.w) || def.size.w);
      const h = Math.max(1, Number(spec.h) || def.size.h);
      let rect = { x: Number(spec.x) || 0, y: Number(spec.y) || 0, w, h };
      if (!fits(rect)) {
        rect = findFreeSlot(w, h);
        if (!rect) continue; // sin espacio → descartar este objeto
      }

      const obj = { id: uid(), type: def.type, x: rect.x, y: rect.y, w: rect.w, h: rect.h, props: defaultProps(def.type) };
      st.sheet.objects.push(obj);

      // Dimensión: resolver el campo real en st.fields (match por nombre).
      if (spec.dimension && def.roles.dims.max > 0) {
        const f = fieldByName(spec.dimension);
        if (f) addItem(obj, "dimension", { id: uid(), source: "field", table: f.tables[0], field: f.field }, { noHistory: true });
      }
      // Medida: measure.field existente.
      const measure = spec.measure && typeof spec.measure === "object" ? spec.measure : null;
      if (measure && measure.field && def.roles.measures.max > 0) {
        const f = fieldByName(measure.field);
        if (f) {
          const agg = ["sum", "count", "avg", "min", "max"].includes(measure.agg) ? measure.agg : "sum";
          addItem(obj, "measure", { id: uid(), source: "field", table: f.tables[0], field: f.field, agg }, { noHistory: true });
        }
      }
      created += 1;
    }

    relayout();
    scheduleSave();

    if (!created) {
      return prefix.length
        ? `${capitalize(prefix.join(" y "))}, pero no pude colocar ningún objeto del plan.`
        : "No pude colocar ningún objeto del plan (campos o tipos no válidos).";
    }
    const head = prefix.length ? `${capitalize(prefix.join(" y "))} y creé` : "Creé";
    return `${head} ${created} objeto${created === 1 ? "" : "s"} en la hoja.`;
  }

  function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  function fieldByName(name) {
    const n = String(name || "").trim().toLowerCase();
    if (!n) return null;
    return (st.fields || []).find((f) => String(f.field).toLowerCase() === n) || null;
  }

  /** Objeto ML recién creado: título por defecto y la ejecución más adecuada. */
  async function assignMlDefault(obj) {
    const def = getType(obj.type);
    if (!obj.props.title) obj.props.title = def.label;
    const ref = await mlDefaultRef(obj.type);
    if (!st.sheet?.objects.includes(obj)) return;
    if (ref) obj.props.ml = ref;
    renderContent(obj);
    if (st.selectedId === obj.id) renderProps();
    scheduleSave();
  }

  /** Clic en un gráfico del panel (Gráficos u Objetos personalizados): lo coloca en el primer hueco libre. */
  function addTypeObject(type) {
    const def = getType(type);
    if (!def || !def.available || !st.sheet || !st.edit) return;
    let slot = findFreeSlot(def.size.w, def.size.h);
    if (!slot && !st.sheet.props.extend) {
      // Sin hueco en la hoja fija: se amplía la hoja (como al soltar debajo del borde).
      st.sheet.props.extend = true;
      slot = findFreeSlot(def.size.w, def.size.h);
    }
    if (!slot) { status("No hay espacio libre en la hoja. Reduzca o mueva otros objetos.", true); return; }
    const obj = { id: uid(), type, ...slot, props: defaultProps(type) };
    pushHistory();
    st.sheet.objects.push(obj);
    if (isMlType(type)) assignMlDefault(obj);
    st.selectedId = obj.id;
    st.accordion = "datos";
    relayout();
    renderProps();
    scheduleSave();
    els.get(obj.id)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  /** Recorre la rejilla de 24 columnas buscando el primer hueco donde cabe w×h. */
  function findFreeSlot(w, h) {
    const C = cols();
    const ww = Math.min(w, C);
    const limit = st.sheet.props.extend ? MAX_ROWS : baseRows();
    for (let y = 0; y <= limit - h; y++) {
      for (let x = 0; x <= C - ww; x++) {
        const rect = { x, y, w: ww, h };
        if (fits(rect)) return rect;
      }
    }
    return null;
  }

  function updateObjProps(obj, fn, { history = true, rerender = true } = {}) {
    if (history) pushHistory();
    fn(obj.props);
    if (rerender) renderContent(obj);
    scheduleSave();
  }

  /**
   * Añade una dimensión/medida ALTERNATIVA (para intercambio en vivo). No afecta
   * la consulta: solo queda disponible para que el usuario la active al analizar.
   * @param {object} obj
   * @param {"measure"|"dimension"} baseKind
   * @param {object} item
   */
  function addAlt(obj, baseKind, item) {
    const altKey = baseKind === "measure" ? "altMeasures" : "altDims";
    pushHistory();
    if (!obj.props[altKey]) obj.props[altKey] = [];
    obj.props[altKey].push(item);
    scheduleSave();
    if (st.selectedId === obj.id) renderProps();
  }

  /**
   * Traduce el "Ordenar por este ítem" (por dimensión/medida i) al orden global
   * del objeto, que es el que consume el motor al construir la consulta. Solo la
   * primera dimensión/medida define el orden efectivo del gráfico (como Qlik).
   * @param {object} obj  objeto de la hoja
   * @param {"dimension"|"measure"} kind
   * @param {number} i  índice del ítem dentro de su lista
   */
  function applyItemSortToGlobal(obj, kind, i) {
    const list = kind === "measure" ? obj.props.measures : obj.props.dims;
    const spec = list[i]?.sort;
    if (!spec) return;
    const dir = spec.endsWith("desc") ? "desc" : "asc";
    const by = kind === "measure" ? "measure" : (spec.startsWith("num") ? "dim-num" : "dim");
    obj.props.sort = { by: by === "dim-num" ? "dim" : by, dir, numeric: spec.startsWith("num") };
    // Limpia el flag "ordenar por aquí" de los demás ítems del mismo tipo.
    list.forEach((it, j) => { if (j !== i) delete it.sort; });
  }

  /**
   * Reordena dimensiones/medidas arrastrando el "grip". Trabaja a nivel de DOM
   * para dar feedback inmediato y confirma el nuevo orden en el modelo al soltar.
   * @param {HTMLElement} grip  manija de arrastre
   * @param {HTMLElement} item  <details> del ítem
   * @param {object} obj
   * @param {"dimension"|"measure"} kind
   */
  function wireItemReorder(grip, item, obj, kind) {
    grip.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const block = item.parentElement; // .ho-role-block
      const items = () => [...block.querySelectorAll(".ho-item")];
      const startItems = items();
      const from = startItems.indexOf(item);
      item.classList.add("reordering");
      grip.setPointerCapture?.(e.pointerId);

      const onMove = (ev) => {
        const siblings = items().filter((el) => el !== item);
        let placed = false;
        for (const sib of siblings) {
          const r = sib.getBoundingClientRect();
          if (ev.clientY < r.top + r.height / 2) { block.insertBefore(item, sib); placed = true; break; }
        }
        if (!placed) {
          const addBtn = block.querySelector(".ho-add-btn, .ho-role-label");
          block.insertBefore(item, addBtn || null);
        }
      };
      const onUp = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        item.classList.remove("reordering");
        const to = items().indexOf(item);
        if (to >= 0 && to !== from) {
          updateObjProps(obj, () => {
            const list = kind === "measure" ? obj.props.measures : obj.props.dims;
            const [moved] = list.splice(from, 1);
            list.splice(to, 0, moved);
          });
        }
        renderProps();
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });
  }

  /* ---------------- Portapapeles ---------------- */
  function copySel() {
    const o = objById(st.selectedId);
    if (o) { st.clipboard = clone(o); status("Objeto copiado."); }
  }
  function cutSel() { copySel(); deleteSel(); }
  function deleteSel() {
    const o = objById(st.selectedId);
    if (!o) return;
    pushHistory();
    st.sheet.objects = st.sheet.objects.filter((x) => x.id !== o.id);
    st.selectedId = null;
    relayout();
    renderProps();
    scheduleSave();
  }
  function paste() {
    if (!st.clipboard || !st.sheet) return;
    const c = st.clipboard;
    let rect = null;
    const limit = st.sheet.props.extend ? MAX_ROWS : GRID_ROWS;
    const C = cols();
    for (let y = 0; y < limit && !rect; y++) {
      for (let x = 0; x <= C - Math.min(c.w, C) && !rect; x++) {
        const r = { x, y, w: c.w, h: c.h };
        if (fits(r)) rect = r;
      }
    }
    if (!rect) rect = findFit(0, st.sheet.props.extend ? maxBottom() : 0, c.w, c.h);
    if (!rect) { status("No hay espacio libre para pegar. Active «Ampliar hoja» o libere espacio.", true); return; }
    pushHistory();
    const obj = { ...clone(c), id: uid(), ...rect };
    st.sheet.objects.push(obj);
    st.selectedId = obj.id;
    relayout();
    renderProps();
    scheduleSave();
  }

  /* ======================================================================
     Panel de activos (izquierda)
     ====================================================================== */
  function renderAssets() {
    const a = $("#hoAssets");
    const key = st.rail;
    const head = (title, extra = "") => `<div class="ho-as-head"><span>${esc(title)}</span>${extra}</div>`;
    const search = (ph = "Buscar") => `<div class="ho-as-search"><input type="search" placeholder="${ph}" data-search /></div>`;
    let html = "";

    if (key === "hojas") {
      html = head("Hojas") + search() + `
        <div class="ho-as-group">Privado (${st.sheets.length})</div>
        <div class="ho-sheet-list">
          ${st.sheets.map((s) => `
            <div class="ho-sheet-card ${st.sheet?.id === s.id ? "active" : ""}" data-sheet="${s.id}" data-filter="${esc(s.title.toLowerCase())}">
              ${layoutThumb(s.id === st.sheet?.id ? st.sheet.objects : s.objects)}
              <div class="ho-sheet-card-foot">
                <span class="ho-sheet-card-title">${esc(s.title)}</span>
                ${canEdit ? `<button class="ho-mini" data-sheet-menu="${s.id}" title="Más acciones">⋯</button>` : ""}
              </div>
            </div>`).join("")}
          ${canEdit ? `<button class="ho-sheet-new" id="hoNewSheet"><span>+</span>Crear nueva hoja</button>` : ""}
        </div>`;
    } else if (key === "marcadores") {
      html = head("Marcadores") + search() + `
        <div class="ho-as-group">Público (0)</div>
        <div class="ho-as-empty"><strong>No tiene marcadores públicos</strong><span>Los marcadores guardarán selecciones y el estado de la hoja.</span></div>
        <div class="ho-as-group">Privado (0)</div>
        <button class="ho-as-soon" disabled title="${SOON}">+ Crear nuevo marcador · ${SOON}</button>`;
    } else if (key === "disparadores") {
      html = head("Disparadores de información") + search() + `
        <div class="ho-as-empty"><strong>Aún no hay grupos disponibles.</strong><span>Los grupos disparadores de información estarán disponibles cuando los añada el creador de una aplicación. ${SOON}.</span></div>`;
    } else if (key === "campos") {
      const tables = [...new Set(st.fields.flatMap((f) => f.tables))].sort();
      const shown = st.tableFilter ? st.fields.filter((f) => f.tables.includes(st.tableFilter)) : st.fields;
      html = head("Campos") + search() + `
        <div class="ho-as-sub">Mostrar por tabla</div>
        <select class="ho-as-select" id="hoTableFilter">
          <option value="">Todas las tablas</option>
          ${tables.map((t) => `<option value="${esc(t)}" ${st.tableFilter === t ? "selected" : ""}>${esc(t)}</option>`).join("")}
        </select>
        <div class="ho-field-list">
          ${shown.length ? shown.map((f) => `
            <div class="ho-field" draggable="true" data-field="${esc(f.field)}" data-filter="${esc((f.display || f.field).toLowerCase())} ${esc(f.field.toLowerCase())}" title="${esc(f.display || f.field)} · ${esc(f.tables.join(", "))}">
              <span class="ho-ftype t-${f.type}">${f.type === "number" ? "#" : f.type === "date" ? "📅" : "Abc"}</span>
              <span class="ho-field-name">${esc(f.display || f.field)}</span>
            </div>`).join("") : `<div class="ho-as-empty"><strong>No hay campos.</strong><span>Cargue datos en el Gestor de datos.</span></div>`}
        </div>`;
    } else if (key === "maestros") {
      const dims = st.masters.filter((m) => m.kind === "dimension");
      const meas = st.masters.filter((m) => m.kind === "measure");
      const list = (items) => items.map((m) => `
        <div class="ho-master" draggable="true" data-master="${m.id}" data-filter="${esc(m.name.toLowerCase())}" title="${esc(m.expression)}${m.description ? " · " + esc(m.description) : ""}">
          <span class="ho-master-name">${esc(m.name)}</span>
          ${canEdit ? `<button class="ho-mini" data-master-edit="${m.id}" title="Editar">✎</button>` : ""}
        </div>`).join("") || `<div class="ho-as-none">Sin elementos.</div>`;
      html = head("Elementos maestros") + search() + `
        <details open class="ho-as-sec"><summary>Dimensiones ${canEdit ? `<button class="ho-mini" data-master-new="dimension" title="Crear dimensión">+</button>` : ""}</summary>${list(dims)}</details>
        <details open class="ho-as-sec"><summary>Medidas ${canEdit ? `<button class="ho-mini" data-master-new="measure" title="Crear medida">+</button>` : ""}</summary>${list(meas)}</details>
        <details class="ho-as-sec"><summary>Visualizaciones</summary><div class="ho-as-none">${SOON}</div></details>
        <details open class="ho-as-sec"><summary>Estados alternos</summary><div class="ho-as-none">&lt;estado predeterminado&gt;</div></details>`;
    } else if (key === "graficos") {
      const item = (t, extra = "") => `
            <div class="ho-chart-item ${t.available ? "" : "soon"}" ${t.available ? `draggable="true" data-add-type="${t.type}"` : ""} data-type="${t.type}" data-filter="${esc((t.label + " " + extra + " " + (t.desc || "")).toLowerCase())}"
                 title="${t.available ? (t.desc ? esc(t.desc) + " · " : "") + "Clic para añadir o arrastre a la hoja" : SOON}">
              <span class="ho-chart-ico">${typeIcon(t.icon)}</span>
              <span>${esc(t.label)}</span>
              ${t.available ? `<span class="ho-grip">⋮⋮</span>` : `<span class="ho-soon-tag">${SOON}</span>`}
            </div>`;
      html = head("Gráficos") + search() + GROUPS.map((g) => {
        if (g.key === "ml") {
          return `<details open class="ho-as-sec"><summary>${esc(g.label)}</summary>
            ${ML_FAMILIES.map((fam) => {
              const items = CHART_TYPES.filter((t) => t.group === "ml" && t.mlFamily === fam.key);
              return items.length ? `<div class="ho-as-sub mlv-fam" data-filter="${esc(fam.label.toLowerCase())} ${items.map((t) => esc(t.label.toLowerCase())).join(" ")}">${esc(fam.label)}</div>${items.map((t) => item(t, "machine learning ml " + fam.label)).join("")}` : "";
            }).join("")}
          </details>`;
        }
        return `<details open class="ho-as-sec"><summary>${esc(g.label)}</summary>
          ${CHART_TYPES.filter((t) => t.group === g.key).map((t) => item(t)).join("")}
        </details>`;
      }).join("");
    } else if (key === "analisis") {
      html = head("Análisis") + search() + `<div class="ho-as-note">Los análisis asistidos llegarán con la capa de IA. ${SOON}.</div>` +
        ANALYSES.map((n) => `<div class="ho-chart-item soon" data-filter="${esc(n.toLowerCase())}"><span class="ho-chart-ico">${typeIcon("line")}</span><span>${esc(n)}</span></div>`).join("");
    } else if (key === "objetos") {
      // Stack de gráficos de Machine Learning: dibujan una ejecución guardada de Experimentos de ML.
      const sm = st.sheet?.props?.ml;
      html = head("Objetos personalizados") + search() + `
        <div class="ho-as-note mlv-as-note">Gráficos de <strong>Machine Learning</strong>. Arrástrelos a la hoja o haga clic para añadirlos; dibujan una ejecución de Experimentos de ML${sm ? ` (por defecto: <strong>${esc(sm.algoritmo || "")}</strong> de «${esc(sm.experimento || "")}»)` : ""}.</div>` +
        ML_FAMILIES.map((fam) => {
          const items = CHART_TYPES.filter((t) => t.group === "ml" && t.mlFamily === fam.key);
          if (!items.length) return "";
          return `<details open class="ho-as-sec"><summary>${esc(fam.label)}</summary>
            ${items.map((t) => `
              <div class="ho-chart-item mlv-item" draggable="true" data-type="${t.type}" data-ml-add="${t.type}" data-filter="${esc((t.label + " " + fam.label + " " + (t.desc || "")).toLowerCase())}" title="${esc(t.desc || "")}">
                <span class="ho-chart-ico">${typeIcon(t.icon)}</span>
                <span class="mlv-item-t"><span>${esc(t.label)}</span><em>${esc(t.desc || "")}</em></span>
                <span class="ho-grip">⋮⋮</span>
              </div>`).join("")}
          </details>`;
        }).join("");
    }
    a.innerHTML = html;
    wireAssets(a);
  }

  function wireAssets(a) {
    a.querySelector("[data-search]")?.addEventListener("input", (e) => {
      const q = e.target.value.trim().toLowerCase();
      a.querySelectorAll("[data-filter]").forEach((el) => { el.hidden = !!q && !el.dataset.filter.includes(q); });
    });
    a.querySelector("#hoTableFilter")?.addEventListener("change", (e) => { st.tableFilter = e.target.value; renderAssets(); });

    a.querySelectorAll("[data-sheet]").forEach((card) => card.addEventListener("click", async (e) => {
      if (e.target.closest("[data-sheet-menu]")) return;
      if (saveTimer) await saveNow();
      const s = st.sheets.find((x) => x.id === card.dataset.sheet);
      const keep = st.edit;
      if (s) { openSheet(s); if (keep) setEdit(true); }
    }));
    a.querySelectorAll("[data-sheet-menu]").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      const s = st.sheets.find((x) => x.id === b.dataset.sheetMenu);
      openMenu(b, [
        { label: "Cambiar título", fn: () => renameSheet(s) },
        { label: "Duplicar", fn: () => duplicateSheet(s) },
        { label: "Eliminar", danger: true, fn: () => removeSheet(s) },
      ]);
    }));
    a.querySelector("#hoNewSheet")?.addEventListener("click", () => openTemplates());

    a.querySelectorAll("[data-ml-add]").forEach((it) => it.addEventListener("click", () => addTypeObject(it.dataset.mlAdd)));
    a.querySelectorAll("[data-add-type]").forEach((it) => it.addEventListener("click", () => addTypeObject(it.dataset.addType)));
    a.querySelectorAll(".ho-chart-item[draggable='true']").forEach((it) => {
      it.addEventListener("dragstart", (e) => {
        dragPayload = { kind: "type", type: it.dataset.type };
        e.dataTransfer.effectAllowed = "copy";
        e.dataTransfer.setData("text/plain", it.dataset.type);
      });
    });
    a.querySelectorAll(".ho-field[draggable='true']").forEach((it) => {
      it.addEventListener("dragstart", (e) => {
        const f = st.fields.find((x) => x.field === it.dataset.field);
        dragPayload = { kind: "field", field: f.field, table: f.tables[0], type: f.type, label: f.display || f.field };
        e.dataTransfer.effectAllowed = "copy";
        e.dataTransfer.setData("text/plain", f.field);
      });
    });
    a.querySelectorAll(".ho-master[draggable='true']").forEach((it) => {
      it.addEventListener("dragstart", (e) => {
        const m = st.masters.find((x) => x.id === it.dataset.master);
        dragPayload = { kind: "master", masterId: m.id, masterKind: m.kind, label: m.name };
        e.dataTransfer.effectAllowed = "copy";
        e.dataTransfer.setData("text/plain", m.name);
      });
    });
    a.querySelectorAll("[data-master-new]").forEach((b) => b.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      openMasterModal(b.dataset.masterNew, null);
    }));
    a.querySelectorAll("[data-master-edit]").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      const m = st.masters.find((x) => x.id === b.dataset.masterEdit);
      openMasterModal(m.kind, m);
    }));
  }

  /* ======================================================================
     Panel de propiedades (derecha)
     ====================================================================== */
  function renderProps() {
    const pane = $("#hoProps");
    if (!st.edit || !st.sheet) { pane.innerHTML = ""; return; }
    const obj = objById(st.selectedId);
    if (!obj) { renderSheetProps(pane); return; }
    renderObjectProps(pane, obj);
  }

  const toggle = (id, label, checked, hint = "") => `
    <label class="ho-switch-row" for="${id}">
      <span><span class="ho-p-label">${esc(label)}</span><span class="ho-p-state">${checked ? "Activado" : "Desactivado"}</span></span>
      <input type="checkbox" id="${id}" ${checked ? "checked" : ""} /><span class="ho-switch"></span>
    </label>${hint ? `<p class="ho-p-hint">${esc(hint)}</p>` : ""}`;

  const fxInput = (id, label, value, { disabled = false, ph = "" } = {}) => `
    <div class="ho-p-field">
      <label class="ho-p-label" for="${id}">${esc(label)}</label>
      <div class="ho-fx-input">
        <input id="${id}" value="${esc(value || "")}" placeholder="${esc(ph)}" />
        <button class="ho-fx" type="button" ${disabled ? "disabled" : ""} title="Expresiones en este campo: ${SOON}">f<sub>x</sub></button>
      </div>
    </div>`;

  /**
   * Panel «Propiedades de hoja»: controles del lienzo (espaciado de cuadrícula,
   * tamaño de hoja, ampliar) que redimensionan de verdad las celdas. Al cambiar
   * cualquiera se llama a relayout(), que recoloca los objetos; los gráficos
   * (Chart.js responsive) se reajustan solos al nuevo tamaño de su celda.
   * @param {HTMLElement} pane
   */
  function renderSheetProps(pane) {
    const s = st.sheet;
    const p = s.props;
    const custom = p.size === "personalizado";
    const gridCustom = p.grid === "personalizado";
    pane.innerHTML = `
      <div class="ho-p-head">${svg("pages")}<span>${esc(s.title)}</span></div>
      <div class="ho-p-sec-title">Propiedades de hoja</div>
      <div class="ho-p-body">
        <div class="ho-p-field"><label class="ho-p-label" for="sTitle">Título</label><input id="sTitle" value="${esc(s.title)}" /></div>
        ${fxInput("sTitleExpr", "Expresión de título", "", { disabled: true, ph: SOON })}
        ${fxInput("sCond", "Condición para mostrar", "", { disabled: true, ph: SOON })}
        <div class="ho-p-field"><label class="ho-p-label" for="sDesc">Descripción</label><textarea id="sDesc" rows="3">${esc(s.description || "")}</textarea></div>
        <div class="ho-p-thumb">${layoutThumb(s.objects)}</div>
        <button class="ho-p-link" disabled title="${SOON}">🎨 Opciones de estilo <span>›</span></button>

        <div class="ho-p-field"><label class="ho-p-label" for="sGrid">Espaciado de líneas de cuadrícula</label>
          <select id="sGrid">
            <option value="estrecho" ${p.grid === "estrecho" ? "selected" : ""}>Estrecho</option>
            <option value="medio" ${p.grid === "medio" ? "selected" : ""}>Medio</option>
            <option value="ancho" ${p.grid === "ancho" ? "selected" : ""}>Ancho</option>
            <option value="personalizado" ${gridCustom ? "selected" : ""}>Personalizado</option>
          </select></div>
        ${gridCustom ? `
        <div class="ho-p-field"><label class="ho-p-label" for="sGutter">Separación entre celdas (px): <b>${gutter()}</b></label>
          <input type="range" id="sGutter" min="0" max="24" step="1" value="${gutter()}" /></div>` : ""}

        <div class="ho-p-field"><label class="ho-p-label" for="sSize">Tamaño de hoja</label>
          <select id="sSize">
            <option value="adaptable" ${!custom ? "selected" : ""}>Adaptable</option>
            <option value="personalizado" ${custom ? "selected" : ""}>Personalizado</option>
          </select></div>
        ${custom ? `
        <div class="ho-p-field"><label class="ho-p-label" for="sCols">Columnas: <b>${cols()}</b></label>
          <input type="range" id="sCols" min="${CUSTOM_COLS_MIN}" max="${CUSTOM_COLS_MAX}" step="1" value="${cols()}" /></div>
        <div class="ho-p-field"><label class="ho-p-label" for="sCellH">Alto de fila (px): <b>${Math.max(CELLH_MIN, Math.min(CELLH_MAX, p.cellH | 0 || 40))}</b></label>
          <input type="range" id="sCellH" min="${CELLH_MIN}" max="${CELLH_MAX}" step="2" value="${Math.max(CELLH_MIN, Math.min(CELLH_MAX, p.cellH | 0 || 40))}" /></div>
        <p class="ho-p-hint">En tamaño personalizado el lienzo es fijo y desplazable; en «Adaptable» se ajusta al tamaño de la ventana.</p>` : ""}

        <div class="ho-p-field"><label class="ho-p-label" for="sSmall">Formato de pequeña pantalla</label>
          <select id="sSmall">
            <option value="lista" ${p.small !== "cuadricula" ? "selected" : ""}>Vista de lista</option>
            <option value="cuadricula" ${p.small === "cuadricula" ? "selected" : ""}>Vista de cuadrícula</option>
          </select></div>
        ${toggle("sExtend", "Ampliar hoja", !!p.extend)}
      </div>
      <details class="ho-p-collapsed"><summary>Estados alternos</summary><div class="ho-p-soon">${SOON}</div></details>
      <details class="ho-p-collapsed"><summary>Acciones</summary><div class="ho-p-soon">${SOON}</div></details>`;

    const title = pane.querySelector("#sTitle");
    title.addEventListener("change", () => {
      const v = title.value.trim();
      if (!v) { title.value = s.title; return; }
      pushHistory(); s.title = v; renderTitle(); renderAssets(); scheduleSave();
      pane.querySelector(".ho-p-head span").textContent = v;
    });
    pane.querySelector("#sDesc").addEventListener("change", (e) => { pushHistory(); s.description = e.target.value; scheduleSave(); });

    // Espaciado de cuadrícula → gutter real entre celdas.
    pane.querySelector("#sGrid").addEventListener("change", (e) => {
      pushHistory();
      p.grid = e.target.value;
      if (p.grid === "personalizado" && !p.gutterPx) p.gutterPx = 4;
      relayout(); renderSheetProps(pane); scheduleSave();
    });
    pane.querySelector("#sGutter")?.addEventListener("input", (e) => {
      p.gutterPx = Number(e.target.value);
      e.target.previousElementSibling.querySelector("b").textContent = p.gutterPx;
      relayout();
    });
    pane.querySelector("#sGutter")?.addEventListener("change", () => { pushHistory(); scheduleSave(); });

    // Tamaño de hoja → adaptable (responsive) vs personalizado (lienzo fijo).
    pane.querySelector("#sSize").addEventListener("change", (e) => {
      pushHistory();
      p.size = e.target.value;
      if (p.size === "personalizado") { if (!p.cellH) p.cellH = 40; if (!p.cols) p.cols = GRID_COLS; }
      relayout(); renderSheetProps(pane); scheduleSave();
    });
    pane.querySelector("#sCols")?.addEventListener("input", (e) => {
      const next = Number(e.target.value);
      // No reducir columnas por debajo del borde derecho de algún objeto.
      const minNeeded = Math.max(CUSTOM_COLS_MIN, ...(s.objects.map((o) => o.x + o.w)));
      p.cols = Math.max(minNeeded, next);
      if (p.cols !== next) e.target.value = p.cols;
      e.target.previousElementSibling.querySelector("b").textContent = p.cols;
      relayout();
    });
    pane.querySelector("#sCols")?.addEventListener("change", () => { pushHistory(); scheduleSave(); });
    pane.querySelector("#sCellH")?.addEventListener("input", (e) => {
      p.cellH = Number(e.target.value);
      e.target.previousElementSibling.querySelector("b").textContent = p.cellH;
      relayout();
    });
    pane.querySelector("#sCellH")?.addEventListener("change", () => { pushHistory(); scheduleSave(); });

    pane.querySelector("#sSmall").addEventListener("change", (e) => { pushHistory(); p.small = e.target.value; relayout(); scheduleSave(); });

    pane.querySelector("#sExtend").addEventListener("change", (e) => {
      if (!e.target.checked && maxBottom() > GRID_ROWS) {
        e.target.checked = true;
        alert(`Hay objetos por debajo de la fila ${GRID_ROWS}. Muévalos hacia arriba antes de desactivar «Ampliar hoja».`);
        return;
      }
      pushHistory(); p.extend = e.target.checked; relayout(); renderSheetProps(pane); scheduleSave();
    });
  }

  function renderObjectProps(pane, obj) {
    const def = getType(obj.type);
    const p = obj.props;
    const complete = isComplete(def, p);
    const sec = (key, label, content) => `
      <div class="ho-acc ${st.accordion === key ? "open" : ""}">
        <button class="ho-acc-head" data-acc="${key}">${esc(label)}</button>
        ${st.accordion === key ? `<div class="ho-acc-body">${content}</div>` : ""}
      </div>`;
    const sub = (key, label, content) => `
      <div class="ho-sub ${st.sub[key] ? "open" : ""}">
        <button class="ho-sub-head" data-sub="${key}"><span class="ho-caret">${st.sub[key] ? "▾" : "▸"}</span>${esc(label)}</button>
        ${st.sub[key] ? `<div class="ho-sub-body">${content}</div>` : ""}
      </div>`;

    // ---------- Datos ----------
    const itemRow = (kind, item, i) => {
      const r = resolveItem(item);
      const isMeasure = kind === "measure";
      const role = roleLabel(def, isMeasure ? "measures" : "dims", i);
      return `
        <details class="ho-item" data-kind="${kind}" data-i="${i}">
          <summary><span class="ho-item-grip" data-grip title="Arrastrar para reordenar">⋮⋮</span><span class="ho-item-role">${esc(role)}</span><span class="ho-item-name ${r ? "" : "err"}">${esc(itemLabel(item))}</span></summary>
          <div class="ho-item-body">
            ${item.source === "master" ? `<p class="ho-p-hint">Elemento maestro${r ? "" : " · eliminado: quítelo o reemplácelo"}.</p>` : ""}
            ${item.source === "expr" ? `<p class="ho-p-hint">Expresión: <code>${esc(item.expression)}</code></p>` : ""}
            <div class="ho-p-field"><label class="ho-p-label">Etiqueta</label><input data-item-label value="${esc(item.label || "")}" placeholder="${esc(defaultLabel(item))}" /></div>
            ${isMeasure && item.source === "field" ? `
              <div class="ho-p-field"><label class="ho-p-label">Agregación</label>
                <select data-item-agg>${Object.entries(AGG_NAME).map(([k, v]) => `<option value="${k}" ${item.agg === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>` : ""}
            ${isMeasure ? `
              <div class="ho-p-field"><label class="ho-p-label">Modificador</label>
                <select data-item-mod>
                  <option value="" ${!item.modifier ? "selected" : ""}>Ninguno</option>
                  <option value="acc" ${item.modifier === "acc" ? "selected" : ""}>Acumulado</option>
                  <option value="diff" ${item.modifier === "diff" ? "selected" : ""}>Diferencia</option>
                  <option value="movavg" ${item.modifier === "movavg" ? "selected" : ""}>Media móvil</option>
                </select></div>
              <div class="ho-p-field"><label class="ho-p-label">Formato numérico</label>
                <select data-item-fmt>
                  <option value="auto" ${!item.fmt || item.fmt === "auto" ? "selected" : ""}>Automático</option>
                  <option value="number" ${item.fmt === "number" ? "selected" : ""}>Número (1.234,5)</option>
                  <option value="integer" ${item.fmt === "integer" ? "selected" : ""}>Entero (1.234)</option>
                  <option value="percent" ${item.fmt === "percent" ? "selected" : ""}>Porcentaje (12,3%)</option>
                  <option value="money" ${item.fmt === "money" ? "selected" : ""}>Moneda ($ 1.234,5)</option>
                </select></div>
              <div class="ho-p-field"><label class="ho-p-label">Mostrar medida si (expresión)</label>
                <div class="ho-fx-input"><input data-item-showif value="${esc(item.showIf || "")}" placeholder="p. ej. Sum(Ventas) > 0" />
                  <button class="ho-fx" type="button" disabled title="Editor de expresiones: ${SOON}">f<sub>x</sub></button></div></div>
              <label class="ho-check"><input type="checkbox" data-item-trend ${item.trend ? "checked" : ""}/> Mostrar línea de tendencia</label>
              ${item.trend ? `<div class="ho-p-field"><label class="ho-p-label">Tipo de tendencia</label>
                <select data-item-trendtype>
                  <option value="linear" ${!item.trendType || item.trendType === "linear" ? "selected" : ""}>Lineal</option>
                  <option value="avg" ${item.trendType === "avg" ? "selected" : ""}>Media</option>
                </select></div>` : ""}` : ""}
            <div class="ho-p-field"><label class="ho-p-label">Ordenar por este ${isMeasure ? "valor" : "campo"}</label>
              <select data-item-sort>
                <option value="" ${!item.sort ? "selected" : ""}>No ordenar por aquí</option>
                ${isMeasure
                  ? `<option value="num-desc" ${item.sort === "num-desc" ? "selected" : ""}>Numérico, mayor → menor</option>
                     <option value="num-asc" ${item.sort === "num-asc" ? "selected" : ""}>Numérico, menor → mayor</option>`
                  : `<option value="alpha-asc" ${item.sort === "alpha-asc" ? "selected" : ""}>Alfabético, A → Z</option>
                     <option value="alpha-desc" ${item.sort === "alpha-desc" ? "selected" : ""}>Alfabético, Z → A</option>
                     <option value="num-asc" ${item.sort === "num-asc" ? "selected" : ""}>Numérico, menor → mayor</option>
                     <option value="num-desc" ${item.sort === "num-desc" ? "selected" : ""}>Numérico, mayor → menor</option>`}
              </select></div>
            ${item.source === "field" ? `<p class="ho-p-hint">Campo: <code>${esc(item.field)}</code> · tabla <code>${esc(item.table)}</code></p>` : ""}
            <button class="ho-btn danger small" data-item-del>Eliminar</button>
          </div>
        </details>`;
    };
    // Fila de un ítem alternativo (más simple: etiqueta + quitar + promover).
    const altRow = (kind, item, i) => `
      <div class="ho-alt" data-alt-kind="${kind}" data-alt-i="${i}">
        <span class="ho-alt-name ${resolveItem(item) ? "" : "err"}">${esc(itemLabel(item))}</span>
        <button class="ho-mini" data-alt-use title="Usar ahora (intercambiar con la principal)">⇄</button>
        <button class="ho-mini" data-alt-del title="Quitar alternativa">✕</button>
      </div>`;

    const roleBlock = (kind, title) => {
      const key = kind === "measure" ? "measures" : "dims";
      const altKey = kind === "measure" ? "altMeasures" : "altDims";
      const r = def.roles[key];
      if (!r || r.max === 0) return "";
      const list = p[key];
      const alts = p[altKey] || [];
      // Las alternativas permiten que quien analiza intercambie dimensión/medida
      // en vivo sin editar la hoja (igual que Qlik). Disponibles cuando el rol
      // ya tiene al menos un ítem principal.
      const canAlt = !def.noData && list.length > 0;
      return `
        <div class="ho-role-block">
          <div class="ho-role-title">${title}</div>
          ${list.map((it, i) => itemRow(kind, it, i)).join("")}
          ${list.length < r.max ? `<div class="ho-role-label">${esc(roleLabel(def, key, list.length))}</div><button class="ho-add-btn" data-add-kind="${kind}">Añadir</button>` : ""}
          ${canAlt ? `
            <div class="ho-alt-block">
              <div class="ho-role-sublabel">${kind === "measure" ? "Medidas alternativas" : "Dimensiones alternativas"}</div>
              ${alts.map((it, i) => altRow(kind, it, i)).join("")}
              <button class="ho-add-btn ghost" data-add-alt="${kind}">Añadir alternativa</button>
              <p class="ho-p-hint">Quien analice la hoja podrá intercambiarlas desde el menú del objeto.</p>
            </div>` : ""}
        </div>`;
    };
    const filtersBlock = def.noData ? "" : `
      <div class="ho-role-block">
        <div class="ho-role-title">Filtros</div>
        ${(p.filters || []).map((f, i) => `
          <div class="ho-filter-chip"><span><strong>${esc(f.field)}</strong>: ${esc(f.values.slice(0, 3).map(fmt).join(", "))}${f.values.length > 3 ? ` +${f.values.length - 3}` : ""}</span>
            <button class="ho-mini" data-filter-edit="${i}" title="Editar">✎</button><button class="ho-mini" data-filter-del="${i}" title="Quitar">✕</button></div>`).join("")}
        <button class="ho-add-btn" data-add-filter ${complete ? "" : "disabled"}>Añadir</button>
      </div>`;
    const datos = def.ml ? `<div id="mlDatos"><p class="ho-p-hint">Cargando experimentos de ML…</p></div>`
      : def.noData ? `<p class="ho-p-hint">Este objeto no usa datos.</p>` : `${roleBlock("dimension", "Dimensiones")}${roleBlock("measure", "Medidas")}${filtersBlock}`;

    // ---------- Ordenar ----------
    const sort = p.sort || { by: "auto", dir: "asc" };
    const ordenar = !complete || def.noData || obj.type === "kpi" || obj.type === "filterpane"
      ? `<p class="ho-p-none">No hay datos</p>`
      : `
        <div class="ho-p-field"><label class="ho-p-label">Ordenar por</label>
          <select id="pSortBy">
            <option value="auto" ${sort.by === "auto" ? "selected" : ""}>Automático (orden del motor)</option>
            <option value="dim" ${sort.by === "dim" ? "selected" : ""}>${esc(itemLabel(p.dims[0] || {}))} (dimensión)</option>
            <option value="measure" ${sort.by === "measure" ? "selected" : ""}>${esc(itemLabel(p.measures[0] || {}))} (medida)</option>
          </select></div>
        ${sort.by !== "auto" ? `<div class="ho-seg">
          <button class="${sort.dir === "asc" ? "on" : ""}" data-sort-dir="asc">${sort.by === "dim" ? "A → Z" : "Ascendente"}</button>
          <button class="${sort.dir === "desc" ? "on" : ""}" data-sort-dir="desc">${sort.by === "dim" ? "Z → A" : "Descendente"}</button></div>` : ""}`;

    // ---------- Módulos adicionales ----------
    const refs = p.addons?.refLines || [];
    const modulos = def.noData || obj.type === "filterpane" || obj.type === "kpi"
      ? `<p class="ho-p-none">Este objeto no admite módulos adicionales.</p>`
      : sub("manejo", "Manejo de datos", `
          <div class="ho-p-field"><label class="ho-p-label" for="pLimit">Limitación</label>
            <select id="pLimitMode"><option value="0" ${!p.addons?.limit ? "selected" : ""}>Sin limitación</option><option value="n" ${p.addons?.limit ? "selected" : ""}>Valores fijos (Top N)</option></select></div>
          ${p.addons?.limit ? `<div class="ho-p-field"><label class="ho-p-label" for="pLimit">Número de valores</label><input id="pLimit" type="number" min="1" max="500" value="${Number(p.addons.limit)}" /></div>` : ""}
          <p class="ho-p-hint">La limitación se aplica sobre el orden elegido en «Ordenar».</p>
          <label class="ho-check"><input type="checkbox" id="pIncludeZero" ${p.addons?.includeZero ? "checked" : ""}/> Incluir valores cero</label>
          <p class="ho-p-hint">Con esta opción se muestran también las dimensiones cuyo valor de medida es 0 o nulo.</p>
          <div class="ho-p-field"><label class="ho-p-label" for="pCalcCond">Condición de cálculo (expresión)</label>
            <div class="ho-fx-input"><input id="pCalcCond" value="${esc(p.addons?.calcCond || "")}" placeholder="p. ej. Count(Pedido) > 10" />
              <button class="ho-fx" type="button" disabled title="Editor de expresiones: ${SOON}">f<sub>x</sub></button></div></div>
          <div class="ho-p-field"><label class="ho-p-label" for="pCalcMsg">Mensaje mostrado</label>
            <input id="pCalcMsg" value="${esc(p.addons?.calcMsg || "")}" placeholder="Condición de cálculo no cumplida" /></div>
          <p class="ho-p-hint">Si la condición no se cumple, el objeto muestra el mensaje en vez de los datos.</p>`) +
        (def.axes ? sub("reflines", "Líneas de referencia", `
          <div class="ho-role-sublabel">Líneas de referencia (valor)</div>
          ${refs.map((r, i) => `
            <div class="ho-ref"><input type="color" value="${esc(r.color || "#c0392b")}" data-ref-color="${i}" title="Color" />
              <input data-ref-label="${i}" value="${esc(r.label || "")}" placeholder="Etiqueta" />
              <input data-ref-value="${i}" type="number" value="${esc(r.value)}" placeholder="Valor" />
              <button class="ho-mini" data-ref-del="${i}" title="Quitar">✕</button></div>`).join("")}
          <button class="ho-add-btn" data-ref-add>Añadir línea de referencia</button>
          <div class="ho-role-sublabel">Líneas de referencia por dimensión</div>
          ${(p.addons?.dimRefLines || []).map((r, i) => `
            <div class="ho-ref"><input type="color" value="${esc(r.color || "#1f6feb")}" data-dimref-color="${i}" title="Color" />
              <input data-dimref-label="${i}" value="${esc(r.label || "")}" placeholder="Etiqueta" />
              <input data-dimref-value="${i}" value="${esc(r.value || "")}" placeholder="Valor de dimensión" />
              <button class="ho-mini" data-dimref-del="${i}" title="Quitar">✕</button></div>`).join("")}
          <button class="ho-add-btn" data-dimref-add>Añadir línea por dimensión</button>`) : "") +
        sub("formas", "Formas", `
          ${(p.addons?.shapes || []).map((s, i) => `
            <div class="ho-ref"><select data-shape-kind="${i}">
                <option value="rect" ${s.kind === "rect" ? "selected" : ""}>Rectángulo</option>
                <option value="band" ${s.kind === "band" ? "selected" : ""}>Banda</option></select>
              <input type="color" value="${esc(s.color || "#f0ad4e")}" data-shape-color="${i}" title="Color" />
              <input data-shape-from="${i}" type="number" value="${esc(s.from ?? "")}" placeholder="Desde" />
              <input data-shape-to="${i}" type="number" value="${esc(s.to ?? "")}" placeholder="Hasta" />
              <button class="ho-mini" data-shape-del="${i}" title="Quitar">✕</button></div>`).join("")}
          <button class="ho-add-btn" data-shape-add>Añadir forma</button>
          <p class="ho-p-hint">Resalta un rango de valores con una banda o rectángulo de color.</p>`) +
        sub("imagenes", "Imágenes", `<p class="ho-p-soon">${SOON}</p>`);

    // ---------- Aspecto ----------
    const look = p.look;
    const seg = (key, opts) => `<div class="ho-seg">${opts.map(([v, l]) => `<button class="${String(look[key]) === String(v) ? "on" : ""}" data-look="${key}" data-val="${v}">${l}</button>`).join("")}</div>`;
    const pres = [];
    (def.presentation || []).forEach((k) => {
      if (k === "barMode") pres.push(seg("barMode", [["grouped", "Agrupado"], ["stacked", "Apilado"]]));
      if (k === "orientation") pres.push(seg("orientation", [["vertical", "Vertical"], ["horizontal", "Horizontal"]]));
      if (k === "lineStyle") pres.push(seg("lineStyle", [["line", "Línea"], ["area", "Área"]]));
      if (k === "donut") pres.push(seg("donut", [["false", "Tarta"], ["true", "Dona"]]));
      if (k === "kpiAlign") pres.push(`<div class="ho-p-label">Alineación</div>` + seg("kpiAlign", [["left", "Izquierda"], ["center", "Centro"], ["right", "Derecha"]]));
      if (k === "textAlign") pres.push(`<div class="ho-p-label">Alineación</div>` + seg("textAlign", [["left", "Izquierda"], ["center", "Centro"], ["right", "Derecha"]]));
      if (k === "missing") pres.push(`<div class="ho-p-field"><label class="ho-p-label">Valores perdidos</label><select data-look-sel="missing">
          <option value="gaps" ${look.missing === "gaps" ? "selected" : ""}>Mostrar como huecos</option>
          <option value="connect" ${look.missing === "connect" ? "selected" : ""}>Mostrar como conexiones</option>
          <option value="zero" ${look.missing === "zero" ? "selected" : ""}>Mostrar como ceros</option></select></div>`);
      if (k === "points") pres.push(`<label class="ho-check"><input type="checkbox" data-look-chk="points" ${look.points ? "checked" : ""}/> Mostrar puntos de datos</label>`);
      if (k === "mlLegend") pres.push(`<label class="ho-check"><input type="checkbox" data-look-chk="legend" ${look.legend !== false ? "checked" : ""}/> Mostrar leyenda</label>
        <label class="ho-check"><input type="checkbox" data-look-chk="tooltip" ${look.tooltip !== false ? "checked" : ""}/> Mostrar información al pasar el cursor</label>`);
      if (k === "mlPalette") pres.push(`<div class="ho-p-field"><label class="ho-p-label">Paleta de colores</label><select data-look-sel="mlPalette">
          <option value="datasense" ${look.mlPalette !== "sense" ? "selected" : ""}>DataSense (azul, verde, ocre…)</option>
          <option value="sense" ${look.mlPalette === "sense" ? "selected" : ""}>Sense (verde, azul, naranja…)</option></select></div>`);
      if (k === "totals") pres.push(`<label class="ho-check"><input type="checkbox" data-look-chk="totals" ${look.totals !== false ? "checked" : ""}/> Mostrar totales (calculados por el motor)</label>`);
    });
    // Presentación común a los gráficos con datos (etiquetas de valores, barra
    // de desplazamiento y espaciado), independientes del tipo concreto.
    if (!def.noData && obj.type !== "filterpane" && obj.type !== "kpi") {
      pres.push(`<label class="ho-check"><input type="checkbox" data-look-chk="valueLabels" ${look.valueLabels ? "checked" : ""}/> Mostrar etiquetas de valores</label>`);
      if (def.axes) {
        pres.push(`<label class="ho-check"><input type="checkbox" data-look-chk="scrollbar" ${look.scrollbar ? "checked" : ""}/> Barra de desplazamiento</label>`);
      }
      pres.push(`<div class="ho-p-field"><label class="ho-p-label">Espaciado y relleno</label>
        <select data-look-sel="padding">
          <option value="normal" ${!look.padding || look.padding === "normal" ? "selected" : ""}>Normal</option>
          <option value="compact" ${look.padding === "compact" ? "selected" : ""}>Compacto</option>
          <option value="spacious" ${look.padding === "spacious" ? "selected" : ""}>Amplio</option>
        </select></div>`);
    }
    const aspecto =
      sub("general", "General", `
        ${toggle("pShowTitles", "Mostrar títulos", p.showTitles !== false)}
        ${fxInput("pTitle", "Título", p.title)}
        ${fxInput("pSubtitle", "Subtítulo", p.subtitle)}
        ${fxInput("pFootnote", "Nota a pie de página", p.footnote)}
        ${obj.type === "text" ? `<div class="ho-p-field"><label class="ho-p-label" for="pText">Texto</label><textarea id="pText" rows="5">${esc(p.text || "")}</textarea></div>` : ""}
        ${toggle("pShowDetails", "Mostrar detalles", p.showDetails !== false, "Permite a los usuarios ver las dimensiones y medidas del objeto.")}
        ${def.noData ? "" : toggle("pHoverMenu", "Menú activable", p.hoverMenu !== false, "Muestra el menú de acciones del objeto al pasar el cursor.")}
        ${def.noData ? "" : toggle("pDisclaimerOn", "Mostrar exención de responsabilidad", !!p.disclaimerOn)}
        ${!def.noData && p.disclaimerOn ? `<div class="ho-p-field"><label class="ho-p-label" for="pDisclaimer">Texto de exención</label><textarea id="pDisclaimer" rows="2">${esc(p.disclaimer || "")}</textarea></div>` : ""}`) +
      sub("estados", "Estados alternos", `<p class="ho-p-soon">${SOON}</p>`) +
      (pres.length ? sub("presentacion", "Presentación", pres.join("")) : "") +
      (def.noData ? "" : sub("colores", "Colores y leyenda", `
        <div class="ho-p-field"><label class="ho-p-label" for="pColor">Color</label>
          <div class="ho-colors">${PALETTE.map((c) => `<button class="ho-swatch ${look.color === c ? "on" : ""}" data-color="${c}" style="background:${c}" title="${c}"></button>`).join("")}
          <input type="color" id="pColor" value="${esc(look.color || PALETTE[0])}" title="Color personalizado" /></div></div>
        ${def.palette ? `<label class="ho-check"><input type="checkbox" data-look-chk="byDimension" ${look.byDimension ? "checked" : ""}/> Colorear por dimensión</label>` : ""}
        ${def.legend ? `${toggle("pLegend", "Mostrar leyenda", look.legend !== false)}
          <div class="ho-p-field"><label class="ho-p-label">Posición de la leyenda</label><select data-look-sel="legendPos">
            <option value="auto" ${look.legendPos === "auto" ? "selected" : ""}>Automático</option>
            <option value="bottom" ${look.legendPos === "bottom" ? "selected" : ""}>Abajo</option>
            <option value="right" ${look.legendPos === "right" ? "selected" : ""}>Derecha</option></select></div>` : ""}`)) +
      (def.axes ? sub("ejex", "Eje X", `
          <label class="ho-check"><input type="checkbox" data-look-chk="xLabels" ${look.xLabels !== false ? "checked" : ""}/> Mostrar etiquetas</label>
          <div class="ho-p-field"><label class="ho-p-label">Título del eje</label><input data-look-txt="xTitle" value="${esc(look.xTitle || "")}" /></div>`) +
        sub("ejey", "Eje Y", `
          <label class="ho-check"><input type="checkbox" data-look-chk="yLabels" ${look.yLabels !== false ? "checked" : ""}/> Mostrar etiquetas</label>
          <div class="ho-p-field"><label class="ho-p-label">Título del eje</label><input data-look-txt="yTitle" value="${esc(look.yTitle || "")}" /></div>`) : "") +
      (def.noData || obj.type === "filterpane" || obj.type === "kpi" ? "" : sub("tooltip", "Información sobre herramientas", `
        <label class="ho-check"><input type="checkbox" data-look-chk="tooltip" ${look.tooltip !== false ? "checked" : ""}/> Mostrar información al pasar el cursor</label>`));

    pane.innerHTML = `
      <div class="ho-p-head">${typeIcon(def.icon)}<span>${esc(def.label)}</span>
        <button class="ho-p-spark" disabled title="Sugerencias de gráfico: ${SOON}">✨</button></div>
      ${sec("datos", "Datos", datos)}
      ${sec("ordenar", "Ordenar", ordenar)}
      ${sec("modulos", "Módulos adicionales", modulos)}
      ${sec("aspecto", "Aspecto", aspecto)}`;

    wireObjectProps(pane, obj, def);
  }

  /** Datos de un gráfico ML: tipo de gráfico, experimento y ejecución (filtrados por compatibilidad). */
  async function wireMlDatos(pane, obj) {
    const box = pane.querySelector("#mlDatos");
    if (!box) return;
    let exps;
    try { exps = await mlExperiments(); } catch (e) { box.innerHTML = `<p class="ho-p-hint">No se pudieron cargar los experimentos: ${esc(e.message)}</p>`; return; }
    if (!pane.contains(box) || st.selectedId !== obj.id) return;
    const ref = obj.props.ml || {};
    const fitting = (e) => e.runs.filter((r) => runMatches(obj.type, r) || r.id === ref.runId);
    const expOpts = exps.filter((e) => fitting(e).length || e.id === ref.experimentId);
    const cur = exps.find((e) => e.id === ref.experimentId) || expOpts[0];
    const runs = cur ? fitting(cur) : [];
    const nf = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 3 });
    const runLabel = (r) => `${algoName(r.algorithm)}${r.label ? " · " + r.label : ""}${r.metric_name && r.metric_value != null ? ` — ${r.metric_name} ${nf.format(r.metric_value)}` : ""}`;
    box.innerHTML = `
      <div class="ho-p-field"><label class="ho-p-label" for="mlType">Gráfico de ML</label>
        <select id="mlType">${ML_FAMILIES.map((f) => {
          const vs = ML_VIEWS.filter((v) => v.fam === f.key);
          return vs.length ? `<optgroup label="${esc(f.label)}">${vs.map((v) => `<option value="${v.type}" ${v.type === obj.type ? "selected" : ""}>${esc(v.label)}</option>`).join("")}</optgroup>` : "";
        }).join("")}</select></div>
      <div class="ho-p-field"><label class="ho-p-label" for="mlExp">Experimento</label>
        <select id="mlExp" ${expOpts.length ? "" : "disabled"}>${expOpts.length ? expOpts.map((e) => `<option value="${esc(e.id)}" ${cur && e.id === cur.id ? "selected" : ""}>${esc(e.name)}${e.app_id !== ctx.appId ? ` · ${esc(e.app_name || "otra app")}` : ""}</option>`).join("") : `<option value="">Sin experimentos compatibles</option>`}</select></div>
      <div class="ho-p-field"><label class="ho-p-label" for="mlRunSel">Ejecución</label>
        <select id="mlRunSel" ${runs.length ? "" : "disabled"}>${runs.length ? `${ref.runId && runs.some((r) => r.id === ref.runId) ? "" : `<option value="">Elegir ejecución…</option>`}${runs.map((r) => `<option value="${esc(r.id)}" ${r.id === ref.runId ? "selected" : ""}>${esc(runLabel(r))}</option>`).join("")}` : `<option value="">—</option>`}</select></div>
      ${expOpts.length ? "" : `<p class="ho-p-hint">No hay ejecuciones guardadas que sirvan para este gráfico. Entrena un modelo en <a href="experimentos.html" target="_blank" rel="noopener">Experimentos de ML</a>.</p>`}
      <p class="ho-p-hint">${esc(getMlView(obj.type)?.desc || "")}</p>
      <div class="mlv-p-actions">
        ${ref.experimentId ? `<a class="ho-add-btn mlv-open" href="experimento.html?id=${encodeURIComponent(ref.experimentId)}" target="_blank" rel="noopener">Abrir experimento ↗</a>` : ""}
        <button class="ho-add-btn" id="mlRefresh" type="button" title="Vuelve a leer experimentos y resultados">Recargar</button>
      </div>`;

    const setRef = (experimentId, runId) => { updateObjProps(obj, (p) => { p.ml = runId ? { experimentId, runId } : null; }); renderProps(); };
    box.querySelector("#mlType").addEventListener("change", async (e) => {
      const oldDef = getType(obj.type), nt = e.target.value;
      pushHistory();
      obj.type = nt;
      if (!obj.props.title || obj.props.title === oldDef?.label) obj.props.title = getType(nt).label;
      const curRun = cur?.runs.find((r) => r.id === obj.props.ml?.runId);
      if (!curRun || !runMatches(nt, curRun)) obj.props.ml = await mlDefaultRef(nt);
      renderContent(obj); renderProps(); scheduleSave();
    });
    box.querySelector("#mlExp")?.addEventListener("change", (e) => {
      const ex = exps.find((x) => x.id === e.target.value);
      const run = ex?.runs.find((r) => runMatches(obj.type, r));
      setRef(ex?.id, run?.id);
    });
    box.querySelector("#mlRunSel")?.addEventListener("change", (e) => setRef(cur?.id, e.target.value));
    box.querySelector("#mlRefresh").addEventListener("click", () => {
      mlCache.clear(); mlExpsP = null;
      st.sheet.objects.filter((o) => isMlType(o.type)).forEach((o) => renderContent(o));
      renderProps();
    });
  }

  function wireObjectProps(pane, obj, def) {
    const p = obj.props;
    const rerenderPane = () => renderProps();
    pane.querySelectorAll("[data-acc]").forEach((b) => b.addEventListener("click", () => {
      st.accordion = st.accordion === b.dataset.acc ? "" : b.dataset.acc;
      rerenderPane();
    }));
    pane.querySelectorAll("[data-sub]").forEach((b) => b.addEventListener("click", () => {
      st.sub[b.dataset.sub] = !st.sub[b.dataset.sub];
      rerenderPane();
    }));
    if (def.ml) wireMlDatos(pane, obj);

    // Datos
    pane.querySelectorAll("[data-add-kind]").forEach((b) => b.addEventListener("click", () => openCatalog(b, obj.id, b.dataset.addKind)));
    pane.querySelectorAll(".ho-item").forEach((d) => {
      const kind = d.dataset.kind;
      const i = Number(d.dataset.i);
      const list = kind === "measure" ? p.measures : p.dims;
      d.querySelector("[data-item-label]")?.addEventListener("change", (e) => {
        updateObjProps(obj, () => { list[i].label = e.target.value.trim(); });
        rerenderPane();
      });
      d.querySelector("[data-item-agg]")?.addEventListener("change", (e) => {
        updateObjProps(obj, () => { list[i].agg = e.target.value; });
        rerenderPane();
      });
      d.querySelector("[data-item-fmt]")?.addEventListener("change", (e) => {
        updateObjProps(obj, () => { list[i].fmt = e.target.value; });
      });
      d.querySelector("[data-item-mod]")?.addEventListener("change", (e) => {
        updateObjProps(obj, () => { list[i].modifier = e.target.value; });
      });
      d.querySelector("[data-item-showif]")?.addEventListener("change", (e) => {
        updateObjProps(obj, () => { list[i].showIf = e.target.value.trim(); }, { rerender: false });
      });
      d.querySelector("[data-item-trend]")?.addEventListener("change", (e) => {
        updateObjProps(obj, () => { list[i].trend = e.target.checked; });
        rerenderPane();
      });
      d.querySelector("[data-item-trendtype]")?.addEventListener("change", (e) => {
        updateObjProps(obj, () => { list[i].trendType = e.target.value; });
      });
      d.querySelector("[data-item-sort]")?.addEventListener("change", (e) => {
        // Ordenar por un ítem concreto es equivalente a fijar el orden global
        // sobre esa dimensión/medida; mantenemos ambos coherentes.
        updateObjProps(obj, () => {
          list[i].sort = e.target.value;
          applyItemSortToGlobal(obj, kind, i);
        });
        rerenderPane();
      });
      d.querySelector("[data-item-del]")?.addEventListener("click", () => {
        updateObjProps(obj, () => { list.splice(i, 1); });
        rerenderPane();
      });
      // Reordenar arrastrando por el "grip".
      const grip = d.querySelector("[data-grip]");
      if (grip) wireItemReorder(grip, d, obj, kind);
    });
    // Alternativas: añadir, usar (intercambiar con la principal) y quitar.
    pane.querySelectorAll("[data-add-alt]").forEach((b) => b.addEventListener("click", (e) =>
      openCatalog(e.currentTarget, obj.id, b.dataset.addAlt === "measure" ? "alt-measure" : "alt-dimension")));
    pane.querySelectorAll(".ho-alt").forEach((row) => {
      const kind = row.dataset.altKind;
      const i = Number(row.dataset.altI);
      const altKey = kind === "measure" ? "altMeasures" : "altDims";
      const mainKey = kind === "measure" ? "measures" : "dims";
      row.querySelector("[data-alt-del]")?.addEventListener("click", () => {
        updateObjProps(obj, () => { (p[altKey] || []).splice(i, 1); }, { rerender: false });
        rerenderPane();
      });
      row.querySelector("[data-alt-use]")?.addEventListener("click", () => {
        updateObjProps(obj, () => {
          const alt = (p[altKey] || [])[i];
          if (!alt || !p[mainKey].length) return;
          const main = p[mainKey][0];
          p[mainKey][0] = alt;
          p[altKey][i] = main; // la principal pasa a ser alternativa
        });
        rerenderPane();
      });
    });

    pane.querySelector("[data-add-filter]")?.addEventListener("click", (e) => openCatalog(e.currentTarget, obj.id, "filter"));
    pane.querySelectorAll("[data-filter-del]").forEach((b) => b.addEventListener("click", () => {
      updateObjProps(obj, () => { p.filters.splice(Number(b.dataset.filterDel), 1); });
      rerenderPane();
    }));
    pane.querySelectorAll("[data-filter-edit]").forEach((b) => b.addEventListener("click", () => {
      const i = Number(b.dataset.filterEdit);
      openFilterValues(obj, p.filters[i].field, i);
    }));

    // Ordenar
    pane.querySelector("#pSortBy")?.addEventListener("change", (e) => {
      updateObjProps(obj, () => { p.sort = { by: e.target.value, dir: e.target.value === "measure" ? "desc" : "asc" }; });
      rerenderPane();
    });
    pane.querySelectorAll("[data-sort-dir]").forEach((b) => b.addEventListener("click", () => {
      updateObjProps(obj, () => { p.sort.dir = b.dataset.sortDir; });
      rerenderPane();
    }));

    // Módulos adicionales
    pane.querySelector("#pLimitMode")?.addEventListener("change", (e) => {
      updateObjProps(obj, () => { p.addons.limit = e.target.value === "n" ? 10 : 0; });
      rerenderPane();
    });
    pane.querySelector("#pLimit")?.addEventListener("change", (e) => {
      const n = Math.max(1, Math.min(500, Number(e.target.value) || 1));
      updateObjProps(obj, () => { p.addons.limit = n; });
    });
    pane.querySelector("[data-ref-add]")?.addEventListener("click", () => {
      updateObjProps(obj, () => { p.addons.refLines.push({ label: "Referencia", value: 0, color: "#c0392b" }); });
      rerenderPane();
    });
    pane.querySelectorAll("[data-ref-del]").forEach((b) => b.addEventListener("click", () => {
      updateObjProps(obj, () => { p.addons.refLines.splice(Number(b.dataset.refDel), 1); });
      rerenderPane();
    }));
    ["label", "value", "color"].forEach((k) => pane.querySelectorAll(`[data-ref-${k}]`).forEach((inp) =>
      inp.addEventListener("change", () => {
        const i = Number(inp.getAttribute(`data-ref-${k}`));
        updateObjProps(obj, () => { p.addons.refLines[i][k] = k === "value" ? Number(inp.value) : inp.value; });
      })));

    // Manejo de datos extra: incluir valores cero, condición de cálculo.
    const ensureAddons = () => { if (!p.addons) p.addons = {}; };
    pane.querySelector("#pIncludeZero")?.addEventListener("change", (e) => {
      updateObjProps(obj, () => { ensureAddons(); p.addons.includeZero = e.target.checked; });
    });
    pane.querySelector("#pCalcCond")?.addEventListener("change", (e) => {
      updateObjProps(obj, () => { ensureAddons(); p.addons.calcCond = e.target.value.trim(); });
    });
    pane.querySelector("#pCalcMsg")?.addEventListener("change", (e) => {
      updateObjProps(obj, () => { ensureAddons(); p.addons.calcMsg = e.target.value; }, { rerender: false });
    });

    // Líneas de referencia por dimensión.
    pane.querySelector("[data-dimref-add]")?.addEventListener("click", () => {
      updateObjProps(obj, () => { ensureAddons(); (p.addons.dimRefLines = p.addons.dimRefLines || []).push({ label: "", value: "", color: "#1f6feb" }); });
      rerenderPane();
    });
    pane.querySelectorAll("[data-dimref-del]").forEach((b) => b.addEventListener("click", () => {
      updateObjProps(obj, () => { p.addons.dimRefLines.splice(Number(b.dataset.dimrefDel), 1); });
      rerenderPane();
    }));
    ["label", "value", "color"].forEach((k) => pane.querySelectorAll(`[data-dimref-${k}]`).forEach((inp) =>
      inp.addEventListener("change", () => {
        const i = Number(inp.getAttribute(`data-dimref-${k}`));
        updateObjProps(obj, () => { p.addons.dimRefLines[i][k] = inp.value; });
      })));

    // Formas (bandas/rectángulos de color).
    pane.querySelector("[data-shape-add]")?.addEventListener("click", () => {
      updateObjProps(obj, () => { ensureAddons(); (p.addons.shapes = p.addons.shapes || []).push({ kind: "band", color: "#f0ad4e", from: 0, to: 0 }); });
      rerenderPane();
    });
    pane.querySelectorAll("[data-shape-del]").forEach((b) => b.addEventListener("click", () => {
      updateObjProps(obj, () => { p.addons.shapes.splice(Number(b.dataset.shapeDel), 1); });
      rerenderPane();
    }));
    pane.querySelectorAll("[data-shape-kind]").forEach((s) => s.addEventListener("change", () =>
      updateObjProps(obj, () => { p.addons.shapes[Number(s.dataset.shapeKind)].kind = s.value; })));
    ["from", "to", "color"].forEach((k) => pane.querySelectorAll(`[data-shape-${k}]`).forEach((inp) =>
      inp.addEventListener("change", () => {
        const i = Number(inp.getAttribute(`data-shape-${k}`));
        updateObjProps(obj, () => { p.addons.shapes[i][k] = k === "color" ? inp.value : Number(inp.value); });
      })));

    // Aspecto
    const bindText = (id, key) => pane.querySelector(`#${id}`)?.addEventListener("change", (e) => updateObjProps(obj, () => { p[key] = e.target.value; }));
    bindText("pTitle", "title");
    bindText("pSubtitle", "subtitle");
    bindText("pFootnote", "footnote");
    bindText("pText", "text");
    pane.querySelector("#pShowTitles")?.addEventListener("change", (e) => { updateObjProps(obj, () => { p.showTitles = e.target.checked; }); rerenderPane(); });
    pane.querySelector("#pShowDetails")?.addEventListener("change", (e) => { updateObjProps(obj, () => { p.showDetails = e.target.checked; }, { rerender: false }); rerenderPane(); });
    pane.querySelector("#pHoverMenu")?.addEventListener("change", (e) => { updateObjProps(obj, () => { p.hoverMenu = e.target.checked; }, { rerender: false }); rerenderPane(); });
    pane.querySelector("#pDisclaimerOn")?.addEventListener("change", (e) => { updateObjProps(obj, () => { p.disclaimerOn = e.target.checked; }); rerenderPane(); });
    pane.querySelector("#pDisclaimer")?.addEventListener("change", (e) => { updateObjProps(obj, () => { p.disclaimer = e.target.value; }); });
    pane.querySelector("#pLegend")?.addEventListener("change", (e) => { updateObjProps(obj, () => { p.look.legend = e.target.checked; }); rerenderPane(); });
    pane.querySelectorAll("[data-look]").forEach((b) => b.addEventListener("click", () => {
      const key = b.dataset.look;
      let v = b.dataset.val;
      if (v === "true" || v === "false") v = v === "true";
      updateObjProps(obj, () => { p.look[key] = v; });
      rerenderPane();
    }));
    pane.querySelectorAll("[data-look-sel]").forEach((s) => s.addEventListener("change", () => updateObjProps(obj, () => { p.look[s.dataset.lookSel] = s.value; })));
    pane.querySelectorAll("[data-look-chk]").forEach((c) => c.addEventListener("change", () => updateObjProps(obj, () => { p.look[c.dataset.lookChk] = c.checked; })));
    pane.querySelectorAll("[data-look-txt]").forEach((c) => c.addEventListener("change", () => updateObjProps(obj, () => { p.look[c.dataset.lookTxt] = c.value; })));
    pane.querySelectorAll("[data-color]").forEach((b) => b.addEventListener("click", () => { updateObjProps(obj, () => { p.look.color = b.dataset.color; }); rerenderPane(); }));
    pane.querySelector("#pColor")?.addEventListener("change", (e) => { updateObjProps(obj, () => { p.look.color = e.target.value; }); rerenderPane(); });
  }

  /* ======================================================================
     Catálogo de "Añadir" (popover): buscador + fx + maestros + campos
     ====================================================================== */
  function openCatalog(anchor, objId, kind) {
    const obj = objById(objId);
    if (!obj) return;
    // "alt-measure"/"alt-dimension" comparten catálogo con measure/dimension.
    const isAlt = kind === "alt-measure" || kind === "alt-dimension";
    const baseKind = kind === "alt-measure" ? "measure" : kind === "alt-dimension" ? "dimension" : kind;
    const masters = kind === "filter" ? [] : st.masters.filter((m) => m.kind === (baseKind === "measure" ? "measure" : "dimension"));
    pop.innerHTML = `
      <div class="ho-cat">
        <div class="ho-cat-top">
          <input class="ho-cat-search" placeholder="Buscar" autofocus />
          ${kind === "filter" ? "" : `<button class="ho-fx" data-cat-fx title="Escribir una expresión">f<sub>x</sub></button>`}
        </div>
        <div class="ho-cat-list">
          ${masters.length ? `<div class="ho-cat-group">${baseKind === "measure" ? "Medidas" : "Dimensiones"}</div>
            ${masters.map((m) => `<button class="ho-cat-item" data-cat-master="${m.id}" data-filter="${esc(m.name.toLowerCase())}">${esc(m.name)}</button>`).join("")}` : ""}
          <div class="ho-cat-group">Campos</div>
          ${st.fields.length ? st.fields.map((f) => `
            <button class="ho-cat-item" data-cat-field="${esc(f.field)}" data-filter="${esc((f.display || f.field).toLowerCase())} ${esc(f.field.toLowerCase())}">
              <span class="ho-ftype t-${f.type}">${f.type === "number" ? "#" : f.type === "date" ? "📅" : "Abc"}</span>${esc(f.display || f.field)}
            </button>`).join("") : `<div class="ho-cat-empty">No hay campos. Cargue datos en el Gestor de datos.</div>`}
        </div>
      </div>`;
    placePop(anchor);
    const search = pop.querySelector(".ho-cat-search");
    search.focus();
    search.addEventListener("input", () => {
      const q = search.value.trim().toLowerCase();
      pop.querySelectorAll("[data-filter]").forEach((el) => { el.hidden = !!q && !el.dataset.filter.includes(q); });
    });
    pop.querySelectorAll("[data-cat-master]").forEach((b) => b.addEventListener("click", () => {
      closePop();
      const it = { id: uid(), source: "master", masterId: b.dataset.catMaster };
      if (isAlt) addAlt(obj, baseKind, it); else addItem(obj, kind, it);
    }));
    pop.querySelectorAll("[data-cat-field]").forEach((b) => b.addEventListener("click", () => {
      const f = st.fields.find((x) => x.field === b.dataset.catField);
      closePop();
      if (kind === "filter") { openFilterValues(obj, f.field, -1); return; }
      const it = baseKind === "measure"
        ? { id: uid(), source: "field", table: f.tables[0], field: f.field, agg: f.type === "number" ? "sum" : "count" }
        : { id: uid(), source: "field", table: f.tables[0], field: f.field };
      if (isAlt) addAlt(obj, baseKind, it); else addItem(obj, baseKind, it);
    }));
    pop.querySelector("[data-cat-fx]")?.addEventListener("click", () => {
      closePop();
      openExpression(baseKind, "", async (expr, resolved) => {
        const it = { id: uid(), source: "expr", expression: expr, table: resolved.table, field: resolved.field, agg: resolved.agg };
        if (isAlt) addAlt(obj, baseKind, it); else addItem(obj, baseKind, it);
      });
    });
  }

  function placePop(anchor) {
    pop.hidden = false;
    const r = anchor.getBoundingClientRect();
    const rootR = root.getBoundingClientRect();
    const w = 280;
    let left = r.right - rootR.left + 6;
    if (left + w > rootR.width) left = Math.max(6, r.left - rootR.left - w - 6);
    let top = r.top - rootR.top;
    const maxTop = rootR.height - 340;
    if (top > maxTop) top = Math.max(6, maxTop);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    pop.style.width = `${w}px`;
  }
  function closePop() { pop.hidden = true; pop.innerHTML = ""; }
  on(document, "pointerdown", (e) => { if (!pop.hidden && !pop.contains(e.target)) closePop(); });

  function openMenu(anchor, items) {
    pop.innerHTML = `<div class="ho-menu">${items.map((it, i) => `<button class="ho-menu-item ${it.danger ? "danger" : ""}" data-mi="${i}" ${it.disabled ? "disabled" : ""}>${esc(it.label)}</button>`).join("")}</div>`;
    placePop(anchor);
    pop.style.width = "200px";
    pop.querySelectorAll("[data-mi]").forEach((b) => b.addEventListener("click", () => { closePop(); items[Number(b.dataset.mi)].fn(); }));
  }

  function openObjMenu(anchor, id) {
    const o = objById(id);
    if (!o) return;
    const def = getType(o.type);
    const details = () => {
      const lines = [
        ...o.props.dims.map((d) => `Dimensión: ${itemLabel(d)}`),
        ...o.props.measures.map((m) => `Medida: ${itemLabel(m)}`),
        ...(o.props.filters || []).map((f) => `Filtro: ${f.field} = ${f.values.join(", ")}`),
      ];
      openInfo(def.label, lines.length ? lines : ["Sin datos asignados."]);
    };
    openMenu(anchor, [
      ...(o.props.showDetails !== false ? [{ label: "Ver detalles", fn: details }] : []),
      { label: "Pantalla completa", fn: () => expandObject(id) },
      ...(st.edit ? [
        { label: "Copiar", fn: () => { select(id); copySel(); } },
        { label: "Duplicar", fn: () => { select(id); copySel(); paste(); } },
        { label: "Eliminar", danger: true, fn: () => { select(id); deleteSel(); } },
      ] : []),
    ]);
  }

  /* ======================================================================
     Modales: expresión fx, valores de filtro, elementos maestros,
     variables, pantalla completa, plantillas
     ====================================================================== */
  function openModalHtml(html, cls = "") {
    modal.innerHTML = `<div class="ho-modal ${cls}">${html}</div>`;
    modal.hidden = false;
    modal.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeModal));
    modal.addEventListener("pointerdown", (e) => { if (e.target === modal) closeModal(); }, { once: true });
  }
  function closeModal() {
    const fn = modal._cleanup;
    modal._cleanup = null;
    if (fn) { try { fn(); } catch {} }
    modal.hidden = true;
    modal.innerHTML = "";
  }

  function openInfo(title, lines) {
    openModalHtml(`
      <div class="ho-modal-head"><h3>${esc(title)}</h3><button class="ho-x" data-close>✕</button></div>
      <div class="ho-modal-body"><ul class="ho-info">${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></div>
      <div class="ho-modal-foot"><button class="ho-btn" data-close>Cerrar</button></div>`, "small");
  }

  function openExpression(kind, initial, onOk) {
    const isMeasure = kind === "measure";
    const fieldOpts = st.fields.map((f) => `<option value="${esc(f.field)}">${esc(f.field)}</option>`).join("");
    openModalHtml(`
      <div class="ho-modal-head"><h3>Editar expresión · ${isMeasure ? "Medida" : "Dimensión"}</h3><button class="ho-x" data-close>✕</button></div>
      <div class="ho-modal-body">
        <textarea class="ho-expr" id="exText" rows="4" spellcheck="false" placeholder="${isMeasure ? "Sum([Ventas])" : "[Sucursal]"}">${esc(initial)}</textarea>
        <div class="ho-expr-help">
          ${isMeasure ? `<select id="exAgg">${Object.entries(AGG_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>` : ""}
          <select id="exField"><option value="">Insertar campo…</option>${fieldOpts}</select>
          <button class="ho-btn small" id="exInsert">Insertar</button>
        </div>
        <p class="ho-expr-msg" id="exMsg">Sintaxis: ${isMeasure ? "Sum, Avg, Count, Min o Max sobre un campo, p. ej. <code>Sum([Ventas])</code>" : "un campo entre corchetes, p. ej. <code>[Sucursal]</code>"}. El motor valida la expresión antes de aplicarla.</p>
      </div>
      <div class="ho-modal-foot"><button class="ho-btn" data-close>Cancelar</button><button class="ho-btn primary" id="exOk">Aplicar</button></div>`);
    const text = modal.querySelector("#exText");
    const msg = modal.querySelector("#exMsg");
    text.focus();
    modal.querySelector("#exInsert").addEventListener("click", () => {
      const f = modal.querySelector("#exField").value;
      if (!f) return;
      text.value = isMeasure ? `${AGG_LABEL[modal.querySelector("#exAgg").value]}([${f}])` : `[${f}]`;
    });
    modal.querySelector("#exOk").addEventListener("click", async () => {
      const expr = text.value.trim();
      msg.classList.remove("err");
      msg.textContent = "Validando en el motor…";
      try {
        const resolved = await api.parseExpression(ctx.appId, kind, expr);
        closeModal();
        await onOk(expr, resolved);
      } catch (e) {
        msg.textContent = e.message;
        msg.classList.add("err");
      }
    });
  }

  async function openFilterValues(obj, field, index) {
    openModalHtml(`
      <div class="ho-modal-head"><h3>Filtro del objeto · ${esc(field)}</h3><button class="ho-x" data-close>✕</button></div>
      <div class="ho-modal-body"><p class="ho-p-hint">Seleccione los valores que este objeto debe mostrar. El filtro se combina con las selecciones de la hoja.</p>
        <input class="ho-cat-search" id="fvSearch" placeholder="Buscar valores" />
        <div class="ho-fv-list" id="fvList">Cargando valores…</div></div>
      <div class="ho-modal-foot"><button class="ho-btn" data-close>Cancelar</button><button class="ho-btn primary" id="fvOk">Aplicar</button></div>`);
    const current = index >= 0 ? new Set(obj.props.filters[index].values) : new Set();
    let values = [];
    try {
      values = (await api.getFieldValues(ctx.appId, field, {})).values.map((v) => v.value);
    } catch (e) {
      modal.querySelector("#fvList").innerHTML = `<div class="err">${esc(e.message)}</div>`;
      return;
    }
    const list = modal.querySelector("#fvList");
    list.innerHTML = values.map((v, i) => `<label class="ho-check" data-filter="${esc(String(v).toLowerCase())}"><input type="checkbox" data-fv="${i}" ${current.has(v) ? "checked" : ""}/> ${esc(fmt(v))}</label>`).join("");
    modal.querySelector("#fvSearch").addEventListener("input", (e) => {
      const q = e.target.value.toLowerCase();
      list.querySelectorAll("[data-filter]").forEach((el) => { el.hidden = !!q && !el.dataset.filter.includes(q); });
    });
    modal.querySelector("#fvOk").addEventListener("click", () => {
      const chosen = [...list.querySelectorAll("[data-fv]:checked")].map((c) => values[Number(c.dataset.fv)]);
      closeModal();
      updateObjProps(obj, (p) => {
        if (index >= 0) { if (chosen.length) p.filters[index] = { field, values: chosen }; else p.filters.splice(index, 1); }
        else if (chosen.length) p.filters.push({ field, values: chosen });
      });
      renderProps();
    });
  }

  function openMasterModal(kind, item) {
    const isMeasure = kind === "measure";
    const fieldOpts = st.fields.map((f) => `<option value="${esc(f.field)}" ${item && item.resolved.field === f.field ? "selected" : ""}>${esc(f.field)}</option>`).join("");
    openModalHtml(`
      <div class="ho-modal-head"><h3>${item ? "Editar" : "Crear"} ${isMeasure ? "medida" : "dimensión"} maestra</h3><button class="ho-x" data-close>✕</button></div>
      <div class="ho-modal-body">
        ${isMeasure ? `
          <div class="ho-p-field"><label class="ho-p-label" for="mExpr">Expresión</label>
            <div class="ho-fx-input"><input id="mExpr" value="${esc(item?.expression || "")}" placeholder="Sum([Ventas])" /><button class="ho-fx" id="mFx" title="Editor de expresiones">f<sub>x</sub></button></div></div>` : `
          <div class="ho-p-field"><label class="ho-p-label" for="mField">Campo</label><select id="mField"><option value="">Seleccione un campo…</option>${fieldOpts}</select></div>`}
        <div class="ho-p-field"><label class="ho-p-label" for="mName">Nombre</label><input id="mName" value="${esc(item?.name || "")}" /></div>
        <div class="ho-p-field"><label class="ho-p-label" for="mDesc">Descripción</label><textarea id="mDesc" rows="3">${esc(item?.description || "")}</textarea></div>
        <p class="ho-expr-msg" id="mMsg">${item ? "Si cambia la definición, todos los gráficos que usan este elemento se actualizan." : ""}</p>
      </div>
      <div class="ho-modal-foot">
        ${item ? `<button class="ho-btn danger" id="mDel">Eliminar</button>` : ""}
        <span style="flex:1"></span>
        <button class="ho-btn" data-close>Cancelar</button><button class="ho-btn primary" id="mOk">${item ? "Guardar" : "Crear"}</button>
      </div>`);
    const msg = modal.querySelector("#mMsg");
    const nameEl = modal.querySelector("#mName");
    if (!isMeasure) modal.querySelector("#mField").addEventListener("change", (e) => { if (!nameEl.value) nameEl.value = e.target.value; });
    modal.querySelector("#mFx")?.addEventListener("click", () => {
      const current = modal.querySelector("#mExpr").value;
      const name = nameEl.value;
      const desc = modal.querySelector("#mDesc").value;
      openExpression("measure", current, (expr) => {
        openMasterModal(kind, item ? { ...item, expression: expr, name, description: desc } : null);
        modal.querySelector("#mExpr").value = expr;
        modal.querySelector("#mName").value = name;
        modal.querySelector("#mDesc").value = desc;
      });
    });
    modal.querySelector("#mOk").addEventListener("click", async () => {
      const expression = isMeasure ? modal.querySelector("#mExpr").value.trim() : (modal.querySelector("#mField").value ? `[${modal.querySelector("#mField").value}]` : "");
      const name = nameEl.value.trim();
      const description = modal.querySelector("#mDesc").value.trim() || null;
      if (!expression) { msg.textContent = isMeasure ? "Escriba una expresión." : "Seleccione un campo."; msg.classList.add("err"); return; }
      if (!name) { msg.textContent = "Escriba un nombre."; msg.classList.add("err"); return; }
      msg.classList.remove("err");
      msg.textContent = "Validando en el motor…";
      try {
        if (item?.id) await api.updateMasterItem(ctx.appId, item.id, { name, expression, description });
        else await api.createMasterItem(ctx.appId, { kind, name, expression, description });
        closeModal();
        await loadMasters();
        renderAssets();
        rerenderAllContent();
        renderProps();
      } catch (e) { msg.textContent = e.message; msg.classList.add("err"); }
    });
    modal.querySelector("#mDel")?.addEventListener("click", async () => {
      if (!confirm(`¿Eliminar "${item.name}"? Los gráficos que lo usan mostrarán el elemento como eliminado.`)) return;
      try {
        await api.deleteMasterItem(ctx.appId, item.id);
        closeModal();
        await loadMasters();
        renderAssets();
        rerenderAllContent();
        renderProps();
      } catch (e) { msg.textContent = e.message; msg.classList.add("err"); }
    });
  }

  function openVariables() {
    openModalHtml(`
      <div class="ho-modal-head"><h3>Variables</h3><button class="ho-x" data-close>✕</button></div>
      <div class="ho-modal-body">
        <div class="ho-var-bar"><button class="ho-btn primary" disabled title="${SOON}">Crear nueva</button><button class="ho-btn" disabled>Eliminar</button></div>
        <table class="ho-var-table"><thead><tr><th>Nombre</th><th>Definición</th><th>Valor</th><th>Etiquetas</th><th>Incluir en los marcadores</th></tr></thead>
          <tbody><tr><td colspan="5" class="ho-var-empty">No hay variables. Las variables se definirán en el script de carga (<code>SET</code>/<code>LET</code>) cuando el motor ejecute el script. ${SOON}.</td></tr></tbody></table>
      </div>
      <div class="ho-modal-foot"><button class="ho-btn" data-close>Hecho</button></div>`, "wide");
  }

  function expandObject(id) {
    const o = objById(id);
    if (!o) return;
    const def = getType(o.type);
    openModalHtml(`
      <div class="ho-modal-head"><h3>${esc(o.props.title || def.label)}</h3><button class="ho-x" data-close>✕</button></div>
      <div class="ho-modal-body full"><div class="ho-full-host" id="fullHost"></div></div>`, "full");
    // Reutiliza el render del objeto en un contenedor temporal.
    const host = modal.querySelector("#fullHost");
    const tmp = document.createElement("div");
    tmp.className = "ho-obj full";
    tmp.innerHTML = `<div class="ho-obj-inner"></div>`;
    host.appendChild(tmp);
    const fakeId = `${id}__full`;
    els.set(fakeId, tmp);
    renderContent({ ...o, id: fakeId });
    modal._cleanup = () => { destroyContent(fakeId); els.delete(fakeId); tokens.delete(fakeId); };
  }

  /* ---------------- Plantillas ---------------- */
  const prefs = () => { try { return JSON.parse(localStorage.getItem("ds.tpl.prefs") || "{}"); } catch { return {}; } };
  const setPrefs = (p) => localStorage.setItem("ds.tpl.prefs", JSON.stringify(p));
  function rememberTemplate(key) {
    const p = prefs();
    p.recent = [key, ...(p.recent || []).filter((k) => k !== key)].slice(0, 6);
    setPrefs(p);
  }

  function openTemplates() {
    const p = prefs();
    if (p.skip) { createSheet(null); return; }
    let view = "highlights";
    const draw = () => {
      const pr = prefs();
      const fav = new Set(pr.fav || []);
      let list = TEMPLATES;
      if (view === "highlights") list = TEMPLATES.filter((t) => t.highlight);
      else if (view === "recent") list = (pr.recent || []).map((k) => TEMPLATES.find((t) => t.key === k)).filter(Boolean);
      else if (view === "fav") list = TEMPLATES.filter((t) => fav.has(t.key));
      else if (view.startsWith("cat:")) list = TEMPLATES.filter((t) => t.category === view.slice(4));
      const q = (modal.querySelector("#tplSearch")?.value || "").toLowerCase();
      if (q) list = list.filter((t) => t.label.toLowerCase().includes(q));
      const catLabel = (k) => TEMPLATE_CATEGORIES.find((c) => c.key === k)?.label || "";
      const navBtn = (key, label) => `<button class="ho-tpl-nav ${view === key ? "on" : ""}" data-view="${key}">${esc(label)}</button>`;
      modal.querySelector(".ho-tpl-side").innerHTML = `
        ${navBtn("highlights", "Destacadas")}${navBtn("all", "Todas las plantillas")}${navBtn("recent", "Usadas recientemente")}${navBtn("fav", "Favoritas")}
        <div class="ho-tpl-cats">CATEGORÍAS</div>
        ${TEMPLATE_CATEGORIES.map((c) => navBtn(`cat:${c.key}`, c.label)).join("")}`;
      modal.querySelector(".ho-tpl-grid").innerHTML = list.length ? list.map((t) => `
        <div class="ho-tpl-card" data-tpl="${t.key}">
          ${layoutThumb(t.objects)}
          <div class="ho-tpl-info">
            <div class="ho-tpl-name">${esc(t.label)}<button class="ho-tpl-star ${fav.has(t.key) ? "on" : ""}" data-star="${t.key}" title="Favorita">★</button></div>
            <div class="ho-tpl-author">◆ DataSense</div>
            ${t.category ? `<span class="ho-tpl-chip">${esc(catLabel(t.category))}</span>` : ""}
          </div>
        </div>`).join("") : `<div class="ho-tpl-empty">${view.startsWith("cat:") ? `No hay plantillas en esta categoría todavía. Las plantillas con menú de navegación llegarán cuando el objeto «Menú de navegación» esté disponible.` : "No hay plantillas para mostrar."}</div>`;
      modal.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => { view = b.dataset.view; draw(); }));
      modal.querySelectorAll("[data-star]").forEach((b) => b.addEventListener("click", (e) => {
        e.stopPropagation();
        const pp = prefs();
        const s = new Set(pp.fav || []);
        s.has(b.dataset.star) ? s.delete(b.dataset.star) : s.add(b.dataset.star);
        pp.fav = [...s];
        setPrefs(pp);
        draw();
      }));
      modal.querySelectorAll("[data-tpl]").forEach((c) => c.addEventListener("click", () => {
        const t = TEMPLATES.find((x) => x.key === c.dataset.tpl);
        closeModal();
        createSheet(t.key === "empty" ? null : t);
      }));
    };
    openModalHtml(`
      <div class="ho-modal-head"><h3>Plantillas</h3><button class="ho-x" data-close>✕</button></div>
      <div class="ho-tpl">
        <div class="ho-tpl-side"></div>
        <div class="ho-tpl-main">
          <div class="ho-tpl-top">
            <input class="ho-cat-search" id="tplSearch" placeholder="Buscar plantillas" />
            <label class="ho-check"><input type="checkbox" id="tplShow" ${prefs().skip ? "" : "checked"} /> Mostrar al crear una hoja</label>
          </div>
          <div class="ho-tpl-grid"></div>
        </div>
      </div>
      <div class="ho-modal-foot left"><button class="ho-btn" id="tplNone">Crear sin plantilla</button></div>`, "tpl");
    modal.querySelector("#tplSearch").addEventListener("input", draw);
    modal.querySelector("#tplShow").addEventListener("change", (e) => { const pp = prefs(); pp.skip = !e.target.checked; setPrefs(pp); });
    modal.querySelector("#tplNone").addEventListener("click", () => { closeModal(); createSheet(null); });
    draw();
  }

  /* ======================================================================
     Selecciones asociativas (barra superior)
     ====================================================================== */
  function setSelections(next, { record = true } = {}) {
    if (record) { st.selBack.push(JSON.stringify(st.selections)); st.selFwd = []; }
    st.selections = next;
    saveSelections();
    renderSelbar();
    rerenderAllContent();
  }
  function toggleSelection(field, value) {
    if (!field) return;
    const next = clone(st.selections);
    const cur = new Set(next[field] || []);
    cur.has(value) ? cur.delete(value) : cur.add(value);
    if (cur.size) next[field] = [...cur]; else delete next[field];
    setSelections(next);
  }
  function renderSelbar() {
    const bar = $("#hoSelbar");
    const entries = Object.entries(st.selections).filter(([, v]) => v && v.length);
    bar.hidden = !st.sheet || (!entries.length && !st.selBack.length);
    bar.innerHTML = `
      <button class="ho-sel-ico" data-sel="back" ${st.selBack.length ? "" : "disabled"} title="Atrás en las selecciones">↶</button>
      <button class="ho-sel-ico" data-sel="fwd" ${st.selFwd.length ? "" : "disabled"} title="Adelante en las selecciones">↷</button>
      <button class="ho-sel-ico" data-sel="clear" ${entries.length ? "" : "disabled"} title="Borrar todas las selecciones">⊘</button>
      <div class="ho-sel-chips">
        ${entries.length ? entries.map(([f, v]) => `
          <span class="ho-sel-chip"><span class="ho-sel-field">${esc(f)}</span><span class="ho-sel-vals">${esc(v.length > 2 ? `${v.length} de valores` : v.map(fmt).join(", "))}</span>
            <button data-sel-clear="${esc(f)}" title="Borrar selección">✕</button></span>`).join("") : `<span class="ho-sel-none">Sin selecciones</span>`}
      </div>`;
    bar.querySelector("[data-sel='back']").addEventListener("click", () => {
      if (!st.selBack.length) return;
      st.selFwd.push(JSON.stringify(st.selections));
      setSelections(JSON.parse(st.selBack.pop()), { record: false });
    });
    bar.querySelector("[data-sel='fwd']").addEventListener("click", () => {
      if (!st.selFwd.length) return;
      st.selBack.push(JSON.stringify(st.selections));
      setSelections(JSON.parse(st.selFwd.pop()), { record: false });
    });
    bar.querySelector("[data-sel='clear']").addEventListener("click", () => setSelections({}));
    bar.querySelectorAll("[data-sel-clear]").forEach((b) => b.addEventListener("click", () => {
      const next = clone(st.selections);
      delete next[b.dataset.selClear];
      setSelections(next);
    }));
  }

  /* ======================================================================
     Barra de herramientas, teclado y tamaño
     ====================================================================== */
  mount.querySelector(".ho-toolbar").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b || b.disabled) return;
    const act = b.dataset.act;
    if (act === "toggleEdit") { if (st.edit && saveTimer) saveNow(); setEdit(!st.edit); return; }
    if (act === "activos") { st.assetsOpen = !st.assetsOpen; renderChrome(); relayout(); return; }
    if (act === "props") { st.propsOpen = !st.propsOpen; renderChrome(); relayout(); return; }
    if (act === "hojas" || act === "marcadores") {
      if (!st.edit) return;
      if (st.rail === act && st.assetsOpen) st.assetsOpen = false;
      else { st.rail = act; st.assetsOpen = true; }
      renderChrome();
      relayout();
      return;
    }
    if (act === "cut") cutSel();
    if (act === "copy") copySel();
    if (act === "paste") paste();
    if (act === "delete") deleteSel();
    if (act === "undo") undo();
    if (act === "redo") redo();
  });

  on(document, "keydown", (e) => {
    if (!mount.isConnected) return;
    if (e.key === "Escape") { if (!modal.hidden) closeModal(); else if (!pop.hidden) closePop(); else if (st.selectedId) { st.selectedId = null; relayout(); renderProps(); } return; }
    if (!st.edit || !modal.hidden) return;
    if (e.target.closest && e.target.closest("input, textarea, select, .CodeMirror")) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if ((e.ctrlKey || e.metaKey) && k === "y") { e.preventDefault(); redo(); }
    else if ((e.ctrlKey || e.metaKey) && k === "c") copySel();
    else if ((e.ctrlKey || e.metaKey) && k === "x") cutSel();
    else if ((e.ctrlKey || e.metaKey) && k === "v") paste();
    else if (e.key === "Delete" || e.key === "Backspace") { if (st.selectedId) { e.preventDefault(); deleteSel(); } }
  });

  // Recalcula la rejilla solo si cambió el tamaño visible, en el siguiente frame
  // (evita el bucle "ResizeObserver loop" al cambiar la altura de la rejilla).
  let lastSize = "";
  let rafId = 0;
  /* ======================================================================
     Menú "···" de la hoja (montado por el shell, opera sobre esta vista)
     ====================================================================== */
  function registerSheetMenu() {
    if (typeof window.__dsRegisterSheetMenu !== "function") return;
    window.__dsRegisterSheetMenu({
      appId: () => ctx.appId,
      can: (perm) => ctx.can(perm),
      getSheet: () => (st.sheet ? { id: st.sheet.id, title: st.sheet.title, description: st.sheet.description, visibility: st.sheet.visibility } : null),
      toast: (msg, kind) => status(msg, kind === "error" || kind === "warn"),
      duplicateSheet: () => { if (st.sheet) return duplicateSheet(st.sheets.find((s) => s.id === st.sheet.id)); },
      deleteSheet: () => { if (st.sheet) return removeSheet(st.sheets.find((s) => s.id === st.sheet.id)); },
      setVisibility: async (v) => {
        if (!st.sheet) return;
        try {
          const saved = await api.setSheetVisibility(ctx.appId, st.sheet.id, v);
          st.sheet.visibility = saved.visibility;
          const i = st.sheets.findIndex((s) => s.id === st.sheet.id);
          if (i >= 0) st.sheets[i] = saved;
          status(v === "publica" ? "Hoja marcada como pública." : "Hoja marcada como privada.");
        } catch (e) { status("No se pudo cambiar la visibilidad: " + e.message, true); }
      },
      openDetails: () => openSheetDetails(),
      openEmbed: () => openEmbed(),
      openConfig: () => openSheetConfig(),
      setTouchMode: (on) => { st.touch = on; root.classList.toggle("touch", on); localStorage.setItem(LS("touch"), on ? "1" : "0"); },
      touchMode: () => !!st.touch,
    });
  }

  function openSheetDetails() {
    const s = st.sheet;
    if (!s) return;
    openModalHtml(`
      <div class="ho-modal-head"><h3>Detalles de la hoja</h3><button class="ho-x" data-close>✕</button></div>
      <div class="ho-modal-body">
        <dl class="ho-details">
          <dt>Título</dt><dd>${esc(s.title)}</dd>
          <dt>Descripción</dt><dd>${esc(s.description || "—")}</dd>
          <dt>Visibilidad</dt><dd>${s.visibility === "publica" ? "Pública" : "Privada"}</dd>
          <dt>Objetos</dt><dd>${s.objects.length}</dd>
          <dt>Aplicación</dt><dd>${esc(ctx.app?.name || ctx.appId)}</dd>
        </dl>
      </div>
      <div class="ho-modal-foot"><button class="ho-btn" data-close>Cerrar</button></div>`, "small");
  }

  function openEmbed() {
    const s = st.sheet;
    if (!s) return;
    const url = `${location.origin}${location.pathname}?app=${encodeURIComponent(ctx.appId)}#hoja`;
    const code = `<iframe src="${url}" width="900" height="600" frameborder="0"></iframe>`;
    openModalHtml(`
      <div class="ho-modal-head"><h3>Incluir hoja</h3><button class="ho-x" data-close>✕</button></div>
      <div class="ho-modal-body">
        <p class="ho-p-hint">Copia este código para incrustar la hoja en otra página (la sesión del visor debe tener acceso a la app).</p>
        <textarea class="ho-expr" id="embedCode" rows="3" readonly>${esc(code)}</textarea>
      </div>
      <div class="ho-modal-foot"><button class="ho-btn" data-close>Cerrar</button><button class="ho-btn primary" id="embedCopy">Copiar</button></div>`, "small");
    modal.querySelector("#embedCopy").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(code); status("Código de inclusión copiado."); closeModal(); }
      catch { modal.querySelector("#embedCode").select(); }
    });
  }

  function openSheetConfig() {
    const s = st.sheet;
    if (!s) return;
    const p = s.props;
    openModalHtml(`
      <div class="ho-modal-head"><h3>Configurar hoja <span class="ho-soon-tag">Preview</span></h3><button class="ho-x" data-close>✕</button></div>
      <div class="ho-modal-body">
        <label class="ho-check"><input type="checkbox" id="cfgTouch" ${st.touch ? "checked" : ""}/> Modo pantalla táctil</label>
        <div class="ho-p-field"><label class="ho-p-label">Formato de pequeña pantalla</label>
          <select id="cfgSmall"><option value="lista" ${p.small !== "cuadricula" ? "selected" : ""}>Vista de lista</option><option value="cuadricula" ${p.small === "cuadricula" ? "selected" : ""}>Vista de cuadrícula</option></select></div>
        <p class="ho-p-hint">Más opciones de configuración llegarán en próximas versiones.</p>
      </div>
      <div class="ho-modal-foot"><button class="ho-btn" data-close>Cerrar</button><button class="ho-btn primary" id="cfgOk">Aplicar</button></div>`, "small");
    modal.querySelector("#cfgOk").addEventListener("click", () => {
      st.touch = modal.querySelector("#cfgTouch").checked;
      root.classList.toggle("touch", st.touch);
      pushHistory();
      p.small = modal.querySelector("#cfgSmall").value;
      closeModal();
      relayout();
      scheduleSave();
    });
  }

  const ro = new ResizeObserver(() => {
    const size = `${scroll.clientWidth}x${scroll.clientHeight}`;
    if (size === lastSize) return;
    lastSize = size;
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => { if (st.sheet) relayout(); });
  });
  ro.observe(scroll);

  /* ======================================================================
     Carga inicial (al final: todas las funciones y constantes ya existen)
     ====================================================================== */
  await Promise.all([loadFields(), loadMasters()]);
  try { st.sheets = await api.listSheets(ctx.appId); } catch (e) { st.sheets = []; status(`No se pudieron cargar las hojas: ${e.message}`, true); }
  // ?sheet=<id> (p. ej. al venir de "Asociar a" en Experimentos de ML) gana sobre la última abierta.
  const wanted = new URLSearchParams(location.search).get("sheet");
  const lastId = localStorage.getItem(LS("last"));
  openSheet(st.sheets.find((s) => s.id === wanted) || st.sheets.find((s) => s.id === lastId) || st.sheets[0] || null, { quiet: true });

  // Registrar el menú "···" del crumb (acciones de la hoja activa).
  registerSheetMenu();

  // Estrellita: una sola instancia; su personalidad depende de st.edit.
  unmountStar = mountEstrellita({
    appId: ctx.appId,
    persona: "analista de datos",
    title: "Analista",
    greeting: "Soy tu analista. Pregúntame sobre el tablero, los KPIs, los gráficos o las selecciones activas.",
    sendFn: api.aiAnalizar,
    buildContext: buildAnalistaContext,
  });
  syncEstrellita();

  /* ======================================================================
     Limpieza al salir de la vista
     ====================================================================== */
  // Aplica el modo táctil guardado.
  root.classList.toggle("touch", !!st.touch);

  return () => {
    if (saveTimer) saveNow();
    cancelAnimationFrame(rafId);
    ro.disconnect();
    destroyAllContent();
    if (typeof window.__dsRegisterSheetMenu === "function") window.__dsRegisterSheetMenu(null);
    if (unmountStar) { try { unmountStar(); } catch {} }
    listeners.forEach(([t, ev, fn, opts]) => t.removeEventListener(ev, fn, opts));
  };
}

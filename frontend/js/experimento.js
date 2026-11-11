// experimento.js — Estudio de un experimento de ML.
// Pestañas: Datos (perfil de la tabla), Modelado (catálogo de 24 algoritmos,
// variables, hiperparámetros, entrenamiento, resultados, probar un caso) y
// Ejecuciones (historial guardado, reabrir, comparar, eliminar).

import { authService } from "./auth-service.js";
import { renderProfileMenu, wireAppsButton, DUO as D, BRAIN } from "./hub-nav.js";
import * as api from "./api.js";
import { FAMILIES, ALGOS, ALGO_BY_BACKEND, defaultsFor, validateCfg, payloadFor } from "./ml-catalog.js";
import { renderResult, exportRows, downloadCsv, keyMetrics, num, COLORS } from "./ml-render.js";

if (!authService.isAuthenticated()) location.replace("index.html");

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const NF0 = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });
const fmtDate = (iso) => { const d = new Date(iso); return isNaN(d) ? "—" : d.toLocaleString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); };
const SV = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const I = {
  back: SV(`<path d="M15 6l-6 6 6 6"/>`), play: SV(`<path d="M7 5l12 7-12 7z"/>`), edit: SV(`<path d="M4 20h4L19 9l-4-4L4 16v4z"/>`),
  download: SV(`<path d="M12 4v11M8 11l4 4 4-4"/><path d="M4 19h16"/>`), trash: SV(`<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>`),
  alert: SV(`<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17h.01"/>`), search: SV(`<circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4.5 4.5"/>`),
  open: SV(`<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>`), flask: SV(BRAIN),
  segment: SV(`<circle ${D} cx="6.5" cy="7.5" r="2.8"/><circle ${D} cx="17.5" cy="7" r="2.8"/><circle ${D} cx="12" cy="17" r="2.8"/><path d="M9 8.6 10.6 14.4M15 8.6l-1.6 5.8M9.3 7.3h5.4"/>`),
  explore: SV(`<rect ${D} x="4" y="4" width="16" height="16" rx="2.5"/><path d="M4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16"/>`),
  regression: SV(`<path d="M4 4v16h16"/><path d="M6.5 16.5 18 7.5"/><circle ${D} cx="8.5" cy="15" r="1.4"/><circle ${D} cx="12.5" cy="13" r="1.4"/><circle ${D} cx="16.5" cy="8.5" r="1.4"/>`),
  classification: SV(`<path ${D} stroke="none" d="M3 19c7 0 7-14 18-14v14z"/><path d="M3 19c7 0 7-14 18-14"/>`),
  series: SV(`<path ${D} stroke="none" d="M3 17l5-5 4 3 4-6v10H3z"/><path d="M3 17l5-5 4 3 4-6"/><path d="M16 9l5-4" stroke-dasharray="2 2.5"/>`),
  automl: SV(`<rect ${D} x="4" y="11" width="4" height="8" rx="1.2"/><rect ${D} x="10" y="5" width="4" height="14" rx="1.2"/><rect ${D} x="16" y="9" width="4" height="10" rx="1.2"/>`),
  link: SV(`<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>`),
};

wireAppsButton();
renderProfileMenu(authService);

const ID = new URLSearchParams(location.search).get("id");
if (!ID) location.replace("experimentos.html");

const root = document.getElementById("root");
const st = { exp: null, ds: null, tab: "modelado", algo: null, cfg: null, result: null, running: false, error: null,
  caseInput: {}, caseResult: null, caseError: null, filter: "", selected: new Set(), compare: null, positives: {}, assoc: null };
const charts = [];
const mk = (id, cfg) => { const el = document.getElementById(id); if (el && window.Chart) charts.push(new window.Chart(el, cfg)); };
const killCharts = () => charts.splice(0).forEach((c) => { try { c.destroy(); } catch { /* noop */ } });

const allFields = () => (st.ds ? [...st.ds.numeric, ...st.ds.categorical, ...st.ds.dates] : []);
const label = (f) => allFields().find((x) => x.field === f)?.display || f;

async function load() {
  st.exp = await api.getExperiment(ID);
  st.ds = st.exp.dataset;
  document.title = `DataSense · ${st.exp.name}`;
  document.getElementById("crumbName").textContent = st.exp.name;
}

/* ============================ Render principal ============================ */
function render() {
  killCharts();
  const e = st.exp, ds = st.ds;
  const runs = e.runList || [];
  root.innerHTML = `
    <div class="mx-top">
      <div class="mx-top-l">
        <a class="ml-back" href="experimentos.html"><span class="ml-ic">${I.back}</span>Experimentos</a>
        <div class="mx-name-row">
          <h2 class="mx-name" id="expName">${esc(e.name)}</h2>
          <button class="mx-icon" id="renameBtn" title="Renombrar">${I.edit}</button>
        </div>
        ${e.description ? `<p class="ml-sub">${esc(e.description)}</p>` : ""}
      </div>
      <div class="mx-top-r">
        <label class="ml-lab"><span>Aplicación</span><strong class="mx-app">${esc(e.app_name)}</strong></label>
        <label class="ml-lab"><span>Tabla</span>
          <select class="ml-input" id="tableSel" ${e.tables.length ? "" : "disabled"}>${e.tables.map((t) => `<option value="${esc(t.id)}" ${ds && t.id === ds.id ? "selected" : ""}>${esc(t.name)}</option>`).join("") || `<option>Sin tablas</option>`}</select></label>
        ${ds ? `<div class="ml-ds-stats"><strong>${NF0.format(ds.rows)}</strong> filas · <strong>${ds.numeric.length}</strong> numéricas · <strong>${ds.categorical.length + ds.dates.length}</strong> categóricas</div>` : ""}
      </div>
    </div>
    <div class="mx-tabs" role="tablist">
      ${[["datos", "Datos"], ["modelado", "Modelado"], ["ejecuciones", `Ejecuciones <span class="mx-count">${runs.length}</span>`]].map(([k, l]) => `<button class="mx-tab ${st.tab === k ? "active" : ""}" role="tab" data-tab="${k}">${l}</button>`).join("")}
    </div>
    <div id="tabBody"></div>`;
  root.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { st.tab = b.dataset.tab; st.compare = null; render(); }));
  root.querySelector("#renameBtn").addEventListener("click", rename);
  root.querySelector("#tableSel").addEventListener("change", changeTable);
  const body = root.querySelector("#tabBody");
  if (!ds) { body.innerHTML = emptyState("La aplicación no tiene tablas", "Carga datos en la aplicación para poder experimentar."); return; }
  if (st.tab === "datos") return tabData(body);
  if (st.tab === "ejecuciones") return tabRuns(body);
  return tabModel(body);
}

async function rename() {
  const name = prompt("Nombre del experimento:", st.exp.name);
  if (!name || !name.trim() || name.trim() === st.exp.name) return;
  try { st.exp = { ...(await api.updateExperiment(ID, { name: name.trim() })) }; st.ds = st.exp.dataset; document.getElementById("crumbName").textContent = st.exp.name; render(); }
  catch (err) { alert("No se pudo renombrar: " + err.message); }
}

async function changeTable(ev) {
  try {
    st.exp = await api.updateExperiment(ID, { table: ev.target.value });
    st.ds = st.exp.dataset;
    st.result = null; st.caseResult = null; st.caseInput = {};
    if (st.algo) st.cfg = defaultsFor(st.algo, st.ds);
    render();
  } catch (err) { alert("No se pudo cambiar la tabla: " + err.message); }
}

/* ============================ Datos ============================ */
function tabData(body) {
  const ds = st.ds;
  const typeChip = (t) => `<span class="dm-chip-t ${t}">${{ numeric: "Número", categorical: "Texto", dates: "Fecha" }[t]}</span>`;
  const rows = [
    ...ds.numeric.map((f) => [f, "numeric"]), ...ds.categorical.map((f) => [f, "categorical"]), ...ds.dates.map((f) => [f, "dates"]),
  ];
  const cols = rows.map(([f]) => f.field);
  body.innerHTML = `
    <div class="ml-metrics">
      <div class="ml-metric"><div class="ml-metric-v">${NF0.format(ds.rows)}</div><div class="ml-metric-l">Registros</div></div>
      <div class="ml-metric"><div class="ml-metric-v">${ds.numeric.length}</div><div class="ml-metric-l">Variables numéricas</div></div>
      <div class="ml-metric"><div class="ml-metric-v">${ds.categorical.length}</div><div class="ml-metric-l">Categóricas</div></div>
      <div class="ml-metric"><div class="ml-metric-v">${ds.dates.length}</div><div class="ml-metric-l">Fechas</div></div>
    </div>
    <div class="ml-two">
      <div class="ml-box"><div class="ml-box-t">Variables</div>
        <div class="ml-scroll"><table class="ml-table"><thead><tr><th>Campo</th><th>Tipo</th><th>Distintos</th><th>Vacíos</th><th>Uso típico</th></tr></thead>
        <tbody>${rows.map(([f, t]) => `<tr><td><strong>${esc(f.display)}</strong>${f.display !== f.field ? `<div class="mx-desc">${esc(f.field)}</div>` : ""}</td><td>${typeChip(t)}</td><td>${NF0.format(f.distinct)}</td><td>${f.nulls ? `<span class="ml-tag bad">${f.nulls}</span>` : "0"}</td><td class="ml-muted">${t === "numeric" ? "Medida, predictor u objetivo" : t === "dates" ? "Periodo de series" : f.distinct <= 50 ? "Clase, regla o periodo" : "Identificador"}</td></tr>`).join("")}</tbody></table></div></div>
      <div class="ml-box"><div class="ml-box-t">Vista previa <span>primeras filas</span></div>
        <div class="ml-scroll"><table class="ml-table"><thead><tr>${cols.map((c) => `<th>${esc(label(c))}</th>`).join("")}</tr></thead>
        <tbody>${ds.preview.map((r) => `<tr>${cols.map((c) => `<td>${esc(r[c] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>
    </div>`;
}

/* ============================ Modelado ============================ */
function tabModel(body) {
  const q = st.filter.trim().toLowerCase();
  body.innerHTML = `
    <div class="mx-studio">
      <aside class="mx-cat">
        <div class="mx-search"><span class="ml-ic">${I.search}</span><input id="algoSearch" placeholder="Buscar algoritmo" value="${esc(st.filter)}" /></div>
        ${FAMILIES.map((fam) => {
          const items = fam.algos.filter((k) => !q || (ALGOS[k].name + " " + ALGOS[k].desc + " " + fam.label).toLowerCase().includes(q));
          if (!items.length) return "";
          return `<div class="mx-fam"><div class="mx-fam-h"><span class="mx-fam-ico ${fam.id}">${I[fam.id]}</span>${esc(fam.label)}</div>
            ${items.map((k) => `<button class="mx-algo ${st.algo === k ? "active" : ""}" data-algo="${k}"><span>${esc(ALGOS[k].name)}</span><em>${esc(ALGOS[k].kind)}</em></button>`).join("")}</div>`;
        }).join("") || `<p class="ml-muted ml-pad">Sin coincidencias.</p>`}
      </aside>
      <section class="mx-work" id="work"></section>
    </div>`;
  const s = body.querySelector("#algoSearch");
  s.addEventListener("input", () => { st.filter = s.value; const pos = s.selectionStart; tabModel(body); const n = body.querySelector("#algoSearch"); n.focus(); n.setSelectionRange(pos, pos); });
  body.querySelectorAll("[data-algo]").forEach((b) => b.addEventListener("click", () => selectAlgo(b.dataset.algo)));
  drawWork(body.querySelector("#work"));
}

function selectAlgo(key, cfg) {
  st.algo = key;
  st.cfg = cfg || defaultsFor(key, st.ds);
  st.result = null; st.error = null; st.caseResult = null; st.caseError = null;
  st.caseInput = {};
  render();
}

function drawWork(work) {
  if (!st.algo) {
    work.innerHTML = `
      <div class="mx-intro">
        <h3 class="ml-h">Elige un algoritmo</h3>
        <p class="ml-sub">Selecciona en el panel izquierdo qué quieres hacer con <strong>${esc(st.ds.name)}</strong>. Cada ejecución queda guardada en la pestaña Ejecuciones para compararla después.</p>
        <div class="ml-grid">${FAMILIES.map((f) => `
          <button class="mx-fam-card" data-pick="${f.algos[0]}">
            <span class="mx-fam-ico big ${f.id}">${I[f.id]}</span>
            <strong>${esc(f.label)}</strong><span>${esc(f.desc)}</span>
            <em>${f.algos.map((k) => esc(ALGOS[k].name)).join(" · ")}</em>
          </button>`).join("")}</div>
      </div>`;
    work.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => selectAlgo(b.dataset.pick)));
    return;
  }
  const a = ALGOS[st.algo];
  work.innerHTML = `
    <div class="mx-cfg">
      <div class="mx-cfg-h">
        <div><h3 class="ml-h">${esc(a.name)} <span class="ml-badge">${esc(a.kind)}</span></h3><p class="ml-sub">${esc(a.desc)}</p></div>
      </div>
      <div class="mx-cfg-grid">
        <div class="mx-roles" id="roles"></div>
        <div class="mx-params" id="params"></div>
      </div>
      ${st.error ? `<div class="ml-note err"><span class="ml-ic">${I.alert}</span><span>${esc(st.error)}</span></div>` : ""}
      <div class="mx-run">
        <input class="ml-input" id="runLabel" placeholder="Etiqueta de la ejecución (opcional)" maxlength="80" />
        <button class="ml-btn primary" id="trainBtn" ${st.running ? "disabled" : ""}><span class="ml-ic">${I.play}</span>${st.running ? "Entrenando…" : "Entrenar y guardar"}</button>
      </div>
      ${st.running ? `<div class="ml-progress"><span></span></div>` : ""}
    </div>
    <div id="resultArea"></div>`;
  drawRoles(work.querySelector("#roles"));
  drawParams(work.querySelector("#params"));
  work.querySelector("#trainBtn").addEventListener("click", train);
  drawResult(work.querySelector("#resultArea"));
}

function chips(list, selected, role, multi) {
  if (!list.length) return `<p class="ml-muted">No hay variables de este tipo en la tabla.</p>`;
  return `<div class="ml-chips">${list.map((f) => {
    const on = multi ? (selected || []).includes(f.field) : selected === f.field;
    return `<button type="button" class="ml-chip ${on ? "on" : ""}" data-role="${role}" data-v="${esc(f.field)}" aria-pressed="${on}">${esc(f.display)}</button>`;
  }).join("")}</div>`;
}

function poolFor(kind, exclude) {
  const ds = st.ds;
  const base = kind === "numeric" ? ds.numeric : kind === "categorical" ? ds.categorical : kind === "period" ? [...ds.dates, ...ds.categorical] : [...ds.numeric, ...ds.categorical];
  return base.filter((f) => f.field !== exclude);
}

function drawRoles(host) {
  const r = ALGOS[st.algo].roles, c = st.cfg.roles;
  let html = "";
  for (const [role, def] of Object.entries(r)) {
    const multi = role === "features";
    const pool = poolFor(def.kind, multi ? c.target : null);
    html += `<div class="ml-field"><div class="ml-field-h">${esc(def.label)}${multi ? ` <span class="ml-req">mínimo ${def.min} · ${(c.features || []).length} elegidas</span>` : ""}</div>
      ${chips(pool, c[role], role, multi)}
      ${multi && pool.length > 1 ? `<div class="ml-inline-actions"><button class="ml-link" data-all="${def.kind}">Todas</button><button class="ml-link" data-none="1">Ninguna</button></div>` : ""}</div>`;
  }
  host.innerHTML = html;
  host.querySelectorAll("[data-role]").forEach((b) => b.addEventListener("click", () => {
    const role = b.dataset.role, v = b.dataset.v;
    if (role === "features") {
      const arr = c.features || (c.features = []);
      const i = arr.indexOf(v);
      if (i >= 0) arr.splice(i, 1); else arr.push(v);
    } else {
      c[role] = v;
      if (role === "target") { c.features = (c.features || []).filter((f) => f !== v); st.cfg.positive = ""; }
    }
    st.error = null; st.result = null;
    drawRoles(host);
    drawParams(document.getElementById("params"));
  }));
  host.querySelector("[data-all]")?.addEventListener("click", (ev) => { c.features = poolFor(ev.target.dataset.all, c.target).map((f) => f.field); drawRoles(host); });
  host.querySelector("[data-none]")?.addEventListener("click", () => { c.features = []; drawRoles(host); });
}

function isNumericField(f) { return st.ds.numeric.some((x) => x.field === f); }

async function drawParams(host) {
  if (!host) return;
  const a = ALGOS[st.algo], p = st.cfg.params;
  const numericTarget = a.roles.target && isNumericField(st.cfg.roles.target);
  const isCls = a.family === "classification" || a.task === "classification";
  const params = a.params.filter((x) => !(x.when === "numericTarget" && !numericTarget));
  const field = (x) => {
    if (x.type === "select") return `<select class="ml-input" data-p="${x.key}">${x.options.map(([v, l]) => `<option value="${esc(v)}" ${String(p[x.key]) === String(v) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
    return `<input class="ml-input" type="number" data-p="${x.key}" value="${esc(p[x.key] ?? "")}" ${x.min != null ? `min="${x.min}"` : ""} ${x.max != null ? `max="${x.max}"` : ""} step="${x.step ?? "any"}" placeholder="${esc(x.placeholder || "")}">`;
  };
  let positive = "";
  if (isCls && st.cfg.roles.target && !numericTarget) {
    const vals = await positiveOptions(st.cfg.roles.target);
    positive = `<label class="ml-lab"><span>Clase positiva</span><select class="ml-input" id="posSel"><option value="">Automática (la menos frecuente)</option>${vals.map((v) => `<option value="${esc(v)}" ${st.cfg.positive === v ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></label>`;
  }
  host.innerHTML = `<div class="ml-field-h">Hiperparámetros</div>
    ${params.length || positive ? `<div class="mx-pgrid">${params.map((x) => `<label class="ml-lab"><span>${esc(x.label)}</span>${field(x)}${x.help ? `<small class="mx-help">${esc(x.help)}</small>` : ""}</label>`).join("")}${positive}</div>` : `<p class="ml-muted">Sin hiperparámetros: usa valores estándar.</p>`}`;
  host.querySelectorAll("[data-p]").forEach((el) => el.addEventListener("change", () => { p[el.dataset.p] = el.value; }));
  host.querySelector("#posSel")?.addEventListener("change", (ev) => { st.cfg.positive = ev.target.value; });
}

async function positiveOptions(field) {
  if (st.positives[field]) return st.positives[field];
  try {
    const r = await api.getFieldValues(st.exp.app_id, field, {}, 200);
    st.positives[field] = (r.values || []).map((v) => v.value);
  } catch { st.positives[field] = []; }
  return st.positives[field];
}

async function train() {
  const err = validateCfg(st.algo, st.cfg);
  if (err) { st.error = err; render(); return; }
  const lab = document.getElementById("runLabel")?.value.trim();
  st.running = true; st.error = null; st.result = null; st.caseResult = null;
  render();
  try {
    const body = { ...payloadFor(st.algo, st.cfg), label: lab || undefined };
    st.result = await api.trainExperiment(ID, body);
    const fresh = await api.getExperiment(ID);
    st.exp.runList = fresh.runList;
  } catch (e) { st.error = e.message || String(e); }
  st.running = false;
  render();
  document.getElementById("resultArea")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function drawResult(host) {
  const r = st.result;
  if (!r) return;
  const out = renderResult(r, label);
  const a = ALGOS[st.algo];
  host.innerHTML = `
    <div class="ml-panel mx-result">
      <div class="ml-res-head">
        <h3 class="ml-h">Resultados</h3>
        <span class="ml-muted">${NF0.format(r.n)} registros · ${r.elapsedMs ?? "—"} ms${r.runId ? " · guardado en Ejecuciones" : ""}</span>
        <span class="ml-spacer"></span>
        <button class="ml-btn ghost small" id="csvBtn"><span class="ml-ic">${I.download}</span>Exportar CSV</button>
        ${r.runId ? `<button class="ml-btn primary small" id="assocBtn" title="Llevar este resultado a una aplicación como tabla del modelo y hoja nueva"><span class="ml-ic">${I.link}</span>Asociar a…</button>` : ""}
      </div>
      ${st.assoc && st.assoc.runId === r.runId ? `<div class="ml-note ok mx-assoc-ok"><span class="ml-ic">${I.link}</span><span>${esc(st.assoc.message)}</span>
        <a class="ml-btn ghost small" href="app.html?app=${encodeURIComponent(st.assoc.appId)}&sheet=${encodeURIComponent(st.assoc.sheet.id)}#hoja">Abrir hoja</a></div>` : ""}
      ${out.html}
      ${r.insights?.length ? `<div class="ml-insights"><div class="ml-insights-t">Lectura del resultado</div><ul>${r.insights.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></div>` : ""}
    </div>
    ${a.caseTest ? casePanel() : ""}`;
  out.draw?.(mk);
  host.querySelector("#csvBtn").addEventListener("click", () => { const x = exportRows(r, label); downloadCsv(x.name, x.head, x.rows); });
  host.querySelector("#assocBtn")?.addEventListener("click", () => openAssociate(r));
  if (a.caseTest) bindCase(host);
}

/* ---- Asociar a una aplicación: tabla del modelo + hoja nueva ---- */
const ASSOC_WHAT = {
  segment: "el grupo asignado a cada registro", regression: "el valor estimado y el error de cada registro",
  classification: "la probabilidad y la clase predicha de cada registro", anomaly: "la marca de atípico y su puntaje por registro",
  series: "el histórico y el pronóstico por periodo", explore: "la tabla de resultados del análisis",
};
const assocWhat = (key) => {
  const a = ALGOS[key];
  if (key === "anomaly") return ASSOC_WHAT.anomaly;
  if (a.family === "automl") return ASSOC_WHAT[a.task] || ASSOC_WHAT.regression;
  return ASSOC_WHAT[a.family] || ASSOC_WHAT.explore;
};

async function openAssociate(r) {
  const a = ALGOS[st.algo];
  let apps = [];
  try { apps = await api.listApps(); } catch { /* sigue con la del experimento */ }
  if (!apps.some((x) => x.id === st.exp.app_id)) apps.unshift({ id: st.exp.app_id, name: st.exp.app_name });
  const defTitle = `ML · ${a.name} · ${r.table || st.ds.name}`;
  const bd = document.createElement("div");
  bd.className = "mx-modal-bd";
  bd.innerHTML = `
    <div class="mx-modal" role="dialog" aria-modal="true" aria-labelledby="assocTitle">
      <div class="mx-modal-h"><h3 id="assocTitle">Asociar resultado a una aplicación</h3><button class="mx-x" data-x aria-label="Cerrar">✕</button></div>
      <div class="mx-modal-b">
        <p class="ml-sub" style="margin:0">Se crea en la aplicación una tabla del modelo de datos con ${esc(assocWhat(st.algo))}, enlazada a <strong>${esc(r.table || st.ds.name)}</strong>, y una hoja nueva con KPIs y gráficos. El agente analista de la hoja podrá explicar el modelo.</p>
        <label class="ml-lab"><span>Aplicación (catálogo)</span>
          <select class="ml-input" id="assocApp">${apps.map((x) => `<option value="${esc(x.id)}" ${x.id === st.exp.app_id ? "selected" : ""}>${esc(x.name)}${x.id === st.exp.app_id ? " (origen de los datos)" : ""}</option>`).join("")}</select></label>
        <p class="ml-muted" id="assocHint" style="margin:0;font-size:12.5px"></p>
        <label class="ml-lab"><span>Título de la hoja</span><input class="ml-input" id="assocSheet" value="${esc(defTitle)}" maxlength="120"></label>
        <p class="mx-err" id="assocErr" hidden></p>
      </div>
      <div class="mx-modal-f"><button class="ml-btn ghost" data-x>Cancelar</button><button class="ml-btn primary" id="assocGo"><span class="ml-ic">${I.link}</span>Asociar y crear hoja</button></div>
    </div>`;
  document.body.appendChild(bd);
  const close = () => bd.remove();
  bd.querySelectorAll("[data-x]").forEach((b) => b.addEventListener("click", close));
  bd.addEventListener("click", (ev) => { if (ev.target === bd) close(); });
  const sel = bd.querySelector("#assocApp"), hint = bd.querySelector("#assocHint");
  const syncHint = () => { hint.textContent = sel.value === st.exp.app_id ? "Misma aplicación: la tabla se enlaza a la de origen por su clave única." : "Otra aplicación: la tabla incluye las columnas de origen para que la hoja sea autónoma."; };
  sel.addEventListener("change", syncHint); syncHint();
  bd.querySelector("#assocSheet").focus();
  bd.querySelector("#assocGo").addEventListener("click", async (ev) => {
    const btn = ev.currentTarget, err = bd.querySelector("#assocErr");
    btn.disabled = true; btn.lastChild.textContent = "Asociando…"; err.hidden = true;
    try {
      const res = await api.associateExperimentRun(ID, r.runId, { appId: sel.value, sheetTitle: bd.querySelector("#assocSheet").value.trim() });
      st.assoc = { ...res, runId: r.runId };
      close();
      killCharts();
      drawResult(document.getElementById("resultArea"));
    } catch (e2) {
      err.textContent = e2.message || String(e2); err.hidden = false;
      btn.disabled = false; btn.lastChild.textContent = "Asociar y crear hoja";
    }
  });
}

/* ---- Probar un caso ---- */
function caseFeatures() { return st.cfg.roles.features || []; }

function casePanel() {
  const feats = caseFeatures();
  if (feats.length && feats.some((f) => st.caseInput[f] === undefined)) fillCase(0);
  const p = st.caseResult, a = ALGOS[st.algo];
  let res = "";
  if (st.caseError) res = `<div class="ml-note err"><span class="ml-ic">${I.alert}</span><span>${esc(st.caseError)}</span></div>`;
  else if (p) {
    if (st.algo === "kmeans") res = `<div class="ml-case-res"><div class="ml-case-k">Grupo asignado</div><div class="ml-case-v">${esc(p.name)}</div><div class="ml-case-s">Distancia al centro: ${num(p.distance)}</div></div>`;
    else if (p.probability != null) res = `<div class="ml-case-res"><div class="ml-case-k">Probabilidad de «${esc(st.result.positive || st.result.best?.positive || "")}»</div><div class="ml-case-v">${(p.probability * 100).toFixed(1)}%</div><div class="ml-bar big"><span style="width:${(p.probability * 100).toFixed(1)}%"></span></div><div class="ml-case-s">Clasificación: ${esc(p.label)}</div></div>`;
    else res = `<div class="ml-case-res"><div class="ml-case-k">${esc(label(st.cfg.roles.target))} estimado</div><div class="ml-case-v">${num(p.value)}</div><div class="ml-case-s">Rango esperado (95%): ${num(p.lower)} a ${num(p.upper)}</div></div>`;
  }
  return `
    <div class="ml-panel mx-case">
      <h3 class="ml-h">Probar un caso</h3>
      <p class="ml-sub">Ingresa valores (o carga una fila real) y el modelo ${a.family === "segment" ? "asigna el grupo" : a.family === "classification" || a.task === "classification" ? "estima la probabilidad" : "estima el valor"}. No se guarda en el historial.</p>
      <div class="ml-form wide">${feats.map((f) => `<label class="ml-lab"><span>${esc(label(f))}</span><input class="ml-input" type="number" step="any" data-case="${esc(f)}" value="${esc(st.caseInput[f] ?? "")}"></label>`).join("")}</div>
      <div class="ml-case-actions">
        <button class="ml-btn primary" id="predictBtn"><span class="ml-ic">${I.play}</span>Predecir</button>
        <button class="ml-btn ghost" id="rowBtn">Cargar otra fila real</button>
      </div>
      <div id="caseOut">${res}</div>
    </div>`;
}

function fillCase(i) {
  const row = st.ds.preview[i % Math.max(1, st.ds.preview.length)];
  if (!row) return;
  caseFeatures().forEach((f) => { st.caseInput[f] = row[f] ?? ""; });
}

function bindCase(host) {
  host.querySelectorAll("[data-case]").forEach((el) => el.addEventListener("input", () => { st.caseInput[el.dataset.case] = el.value; }));
  host.querySelector("#rowBtn").addEventListener("click", () => { st.rowPtr = ((st.rowPtr ?? 0) + 1) % Math.max(1, st.ds.preview.length); fillCase(st.rowPtr); st.caseResult = null; st.caseError = null; drawResult(document.getElementById("resultArea")); });
  host.querySelector("#predictBtn").addEventListener("click", async () => {
    const feats = caseFeatures();
    const missing = feats.filter((f) => st.caseInput[f] === "" || st.caseInput[f] == null || Number.isNaN(Number(st.caseInput[f])));
    st.caseError = null; st.caseResult = null;
    if (missing.length) { st.caseError = "Completa con números: " + missing.map(label).join(", "); host.querySelector("#caseOut").innerHTML = `<div class="ml-note err"><span>${esc(st.caseError)}</span></div>`; return; }
    host.querySelector("#caseOut").innerHTML = `<p class="ml-muted">Calculando…</p>`;
    const input = {};
    feats.forEach((f) => { input[f] = Number(st.caseInput[f]); });
    try {
      const res = await api.trainExperiment(ID, { ...payloadFor(st.algo, st.cfg, input), save: false });
      st.caseResult = res.prediction || null;
      if (!st.caseResult) st.caseError = "El modelo no devolvió una predicción.";
    } catch (e) { st.caseError = e.message; }
    const area = document.getElementById("resultArea");
    killCharts();
    drawResult(area);
  });
}

/* ============================ Ejecuciones ============================ */
function algoKeyOf(run, params) { return ALGO_BY_BACKEND(run.algorithm, params?.task) || ALGO_BY_BACKEND(run.algorithm); }

function tabRuns(body) {
  const runs = st.exp.runList || [];
  if (!runs.length) { body.innerHTML = emptyState("Sin ejecuciones", "Entrena un modelo en la pestaña Modelado; cada ejecución queda guardada aquí."); return; }
  body.innerHTML = `
    <div class="mx-runs-bar">
      <span class="ml-muted">${runs.length} ejecución(es). Selecciona 2 o más para compararlas.</span>
      <span class="ml-spacer"></span>
      <button class="ml-btn primary" id="cmpBtn" ${st.selected.size >= 2 ? "" : "disabled"}>Comparar seleccionadas (${st.selected.size})</button>
    </div>
    <div class="ml-scroll"><table class="ml-table mx-runs">
      <thead><tr><th></th><th>Fecha</th><th>Algoritmo</th><th>Etiqueta</th><th>Variables</th><th>Métrica principal</th><th></th></tr></thead>
      <tbody>${runs.map((r) => {
        let pr = {}; try { pr = JSON.parse(r.params_json || "{}"); } catch { /* noop */ }
        const k = algoKeyOf(r, pr);
        const vars = [pr.target && `→ ${label(pr.target)}`, pr.measure && `${label(pr.measure)}${pr.period ? " por " + label(pr.period) : ""}`, (pr.features || []).map(label).join(", ")].filter(Boolean).join(" · ");
        return `<tr>
          <td><input type="checkbox" data-sel="${esc(r.id)}" ${st.selected.has(r.id) ? "checked" : ""} aria-label="Seleccionar"></td>
          <td>${fmtDate(r.created_at)}</td>
          <td><strong>${esc(k ? ALGOS[k].name : r.algorithm)}</strong></td>
          <td>${esc(r.label || "—")}</td>
          <td class="mx-vars">${esc(vars)}</td>
          <td>${r.metric_name ? `${esc(r.metric_name)}: <strong>${num(r.metric_value)}</strong>` : "—"}</td>
          <td class="mx-actions"><button class="ml-btn ghost small" data-openrun="${esc(r.id)}"><span class="ml-ic">${I.open}</span>Abrir</button><button class="mx-icon danger" data-delrun="${esc(r.id)}" title="Eliminar">${I.trash}</button></td>
        </tr>`;
      }).join("")}</tbody></table></div>
    <div id="cmpArea"></div>`;
  body.querySelectorAll("[data-sel]").forEach((cb) => cb.addEventListener("change", () => {
    if (cb.checked) st.selected.add(cb.dataset.sel); else st.selected.delete(cb.dataset.sel);
    const b = body.querySelector("#cmpBtn"); b.disabled = st.selected.size < 2; b.textContent = `Comparar seleccionadas (${st.selected.size})`;
  }));
  body.querySelectorAll("[data-openrun]").forEach((b) => b.addEventListener("click", () => openRun(b.dataset.openrun)));
  body.querySelectorAll("[data-delrun]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("¿Eliminar esta ejecución?")) return;
    try { await api.deleteExperimentRun(ID, b.dataset.delrun); st.selected.delete(b.dataset.delrun); st.exp.runList = (await api.getExperiment(ID)).runList; render(); }
    catch (err) { alert("No se pudo eliminar: " + err.message); }
  }));
  body.querySelector("#cmpBtn").addEventListener("click", () => compare(body.querySelector("#cmpArea")));
  if (st.compare) drawCompare(body.querySelector("#cmpArea"));
}

async function openRun(runId) {
  try {
    const r = await api.getExperimentRun(ID, runId);
    const run = st.exp.runList.find((x) => x.id === runId);
    let pr = {}; try { pr = JSON.parse(run?.params_json || "{}"); } catch { /* noop */ }
    const key = algoKeyOf({ algorithm: r.algorithm }, { task: r.task || pr.task });
    if (!key) { alert("Algoritmo no reconocido."); return; }
    const cfg = defaultsFor(key, st.ds);
    Object.keys(ALGOS[key].roles).forEach((role) => { if (pr[role] !== undefined) cfg.roles[role] = pr[role]; });
    ALGOS[key].params.forEach((x) => { if (pr[x.key] !== undefined) cfg.params[x.key] = pr[x.key]; });
    if (pr.positive) cfg.positive = pr.positive;
    st.tab = "modelado";
    st.algo = key; st.cfg = cfg; st.error = null; st.caseResult = null; st.caseInput = {};
    st.result = r;
    render();
  } catch (err) { alert("No se pudo abrir la ejecución: " + err.message); }
}

async function compare(host) {
  host.innerHTML = `<p class="ml-muted ml-pad">Cargando ejecuciones…</p>`;
  try {
    const ids = [...st.selected];
    const results = await Promise.all(ids.map((i) => api.getExperimentRun(ID, i)));
    st.compare = ids.map((id, i) => ({ id, run: st.exp.runList.find((x) => x.id === id), result: results[i] }));
    drawCompare(host);
  } catch (err) { host.innerHTML = `<div class="ml-note err">${esc(err.message)}</div>`; }
}

function drawCompare(host) {
  killCharts();
  const items = st.compare;
  const name = (it) => { const k = ALGO_BY_BACKEND(it.result.algorithm, it.result.task); return (it.run?.label ? it.run.label + " · " : "") + (k ? ALGOS[k].name : it.result.algorithm); };
  const metrics = items.map((it) => keyMetrics(it.result));
  const keys = [...new Set(metrics.flatMap((m) => m.map(([k]) => k)))];
  // Gráfico con la primera métrica numérica que tengan TODAS las ejecuciones.
  const chartKey = keys.find((k) => metrics.every((m) => typeof m.find(([x]) => x === k)?.[2] === "number"));
  const chartVals = chartKey ? metrics.map((m) => m.find(([x]) => x === chartKey)[2]) : null;
  host.innerHTML = `
    <div class="ml-panel mx-cmp">
      <div class="ml-res-head"><h3 class="ml-h">Comparación de ejecuciones</h3><span class="ml-spacer"></span><button class="ml-btn ghost small" id="cmpClose">Cerrar</button></div>
      <div class="ml-scroll"><table class="ml-table"><thead><tr><th>Métrica</th>${items.map((it) => `<th>${esc(name(it))}</th>`).join("")}</tr></thead>
        <tbody>${keys.map((k) => `<tr><td><strong>${esc(k)}</strong></td>${metrics.map((m) => `<td>${esc(m.find(([x]) => x === k)?.[1] ?? "—")}</td>`).join("")}</tr>`).join("")}
        <tr><td><strong>Variables</strong></td>${items.map((it) => `<td class="mx-vars">${esc((it.result.features || []).map(label).join(", "))}</td>`).join("")}</tr></tbody></table></div>
      ${chartKey ? `<div class="ml-box"><div class="ml-box-t">${esc(chartKey)} por ejecución</div><div class="ml-chart" style="height:${Math.max(200, items.length * 40)}px"><canvas id="cmpChart"></canvas></div></div>` : `<p class="ml-foot">Las ejecuciones no comparten una métrica numérica; se comparan en la tabla.</p>`}
    </div>`;
  host.querySelector("#cmpClose").addEventListener("click", () => { st.compare = null; host.innerHTML = ""; });
  if (chartKey) mk("cmpChart", { type: "bar", data: { labels: items.map(name), datasets: [{ label: chartKey, data: chartVals, backgroundColor: items.map((_, i) => COLORS[i % COLORS.length]) }] }, options: { responsive: true, maintainAspectRatio: false, animation: false, indexAxis: "y", plugins: { legend: { display: false } } } });
}

function emptyState(t, h) {
  return `<div class="ml-empty"><span class="ml-empty-ico">${I.flask}</span><strong>${esc(t)}</strong><span class="ml-empty-hint">${esc(h)}</span></div>`;
}

try {
  await load();
  const algoParam = new URLSearchParams(location.search).get("algo");
  if (algoParam && ALGOS[algoParam] && st.ds) { st.algo = algoParam; st.cfg = defaultsFor(algoParam, st.ds); }
  render();
} catch (e) {
  root.innerHTML = `<div class="ml-note err"><span>No se pudo abrir el experimento: ${esc(e.message)}</span></div><a class="ml-btn ghost" href="experimentos.html">Volver a experimentos</a>`;
}

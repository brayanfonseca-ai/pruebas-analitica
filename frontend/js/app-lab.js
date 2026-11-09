// app-lab.js — Laboratorio de ML. Siete algoritmos organizados en tarjetas; cada
// tarjeta abre un flujo guiado: Datos → Variables → Parámetros → Entrenar →
// Resultados → Probar un caso / Muestra. Todo el cómputo corre en el backend
// (Java, /api/v1/apps/{id}/ml); aquí solo se configura, se dibuja y se interpreta.
// Cada tarjeta tiene además "Ejecutar ejemplo": configura y entrena sola con tus
// datos para ver el resultado completo en un clic.

import * as api from "./api.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const NF0 = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });
const NF3 = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 3 });
const num = (v) => (v == null || Number.isNaN(v) ? "—" : Math.abs(v) >= 1000 ? NF0.format(v) : NF3.format(v));
const pct = (v) => (v == null ? "—" : (v * 100).toFixed(1) + "%");

const COLORS = ["#172983", "#2e9e57", "#d6a52f", "#c0392b", "#6a4bd8", "#0e9db5", "#e07b39", "#7a869a", "#a23b72", "#3b7a57"];

const SV = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  kmeans: SV(`<circle cx="6.5" cy="7.5" r="2.4"/><circle cx="17.5" cy="7" r="2.4"/><circle cx="12" cy="17" r="2.4"/><path d="M8.6 8.9 10.3 14.8M15.4 8.9 13.6 14.8M9 7.3h6"/>`),
  pca: SV(`<path d="M4 20V4M4 20h16"/><path d="M7 17 18 7"/><circle cx="9" cy="14.5" r="1"/><circle cx="13" cy="11" r="1"/><circle cx="16" cy="8.5" r="1"/>`),
  correlation: SV(`<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16"/>`),
  anomaly: SV(`<path d="M3 13h4l2-6 3 12 2-8 2 4h5"/>`),
  linear: SV(`<path d="M4 20V4M4 20h16"/><path d="M6.5 16.5 18 7.5"/><circle cx="8" cy="15" r="1"/><circle cx="12" cy="12.5" r="1"/><circle cx="16" cy="9" r="1"/>`),
  forecast: SV(`<path d="M3 17l5-5 4 3 4-6"/><path d="M16 9l5-4" stroke-dasharray="2 2.5"/><path d="M3 21h18"/>`),
  logistic: SV(`<path d="M3 19c7 0 7-14 18-14"/><path d="M3 12h18" stroke-dasharray="2 3"/>`),
  back: SV(`<path d="M15 6l-6 6 6 6"/>`),
  play: SV(`<path d="M7 5l12 7-12 7z"/>`),
  check: SV(`<path d="M5 12.5l4.5 4.5L19 7.5"/>`),
  alert: SV(`<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17h.01"/>`),
  download: SV(`<path d="M12 4v11M8 11l4 4 4-4"/><path d="M4 19h16"/>`),
  flask: SV(`<path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3"/><path d="M7.5 15h9"/>`),
};

const ALGOS = [
  { id: "kmeans", group: "discover", title: "Segmentación", tech: "K-Means", kind: "No supervisado", icon: "kmeans",
    desc: "Agrupa registros parecidos entre sí y describe el perfil de cada grupo." },
  { id: "pca", group: "discover", title: "Reducción de dimensiones", tech: "PCA", kind: "No supervisado", icon: "pca",
    desc: "Resume muchas variables en pocos ejes que conservan la mayor parte de la información." },
  { id: "correlation", group: "discover", title: "Correlaciones", tech: "Pearson · Spearman", kind: "Exploratorio", icon: "correlation",
    desc: "Mide qué variables se mueven juntas y detecta redundancias." },
  { id: "anomaly", group: "discover", title: "Detección de anomalías", tech: "Z-score · IQR", kind: "No supervisado", icon: "anomaly",
    desc: "Encuentra registros que se salen del comportamiento normal." },
  { id: "linear", group: "predict", title: "Regresión lineal", tech: "Mínimos cuadrados", kind: "Supervisado", icon: "linear",
    desc: "Predice un valor numérico y cuantifica el peso de cada variable." },
  { id: "forecast", group: "predict", title: "Pronóstico de series", tech: "Tendencia · Holt", kind: "Series de tiempo", icon: "forecast",
    desc: "Proyecta una medida hacia los próximos periodos con banda de confianza." },
  { id: "logistic", group: "predict", title: "Clasificación", tech: "Regresión logística", kind: "Supervisado", icon: "logistic",
    desc: "Estima la probabilidad de que un registro pertenezca a una clase." },
];
const GROUPS = { discover: "Descubrir patrones", predict: "Predecir" };

const STEPS = ["Datos", "Variables", "Parámetros", "Entrenar", "Resultados", "Probar"];
const CASE_ALGOS = new Set(["kmeans", "linear", "logistic"]);

const PREF_TARGET = /venta|ingreso|revenue|total|precio|monto|importe/i;
const PREF_PERIOD = /mes|periodo|per[ií]odo|fecha|date|month|a[nñ]o|year|trimestre|semana/i;

export async function render(mount, ctx) {
  const appId = ctx.appId;
  let datasets = [];
  let ds = null;
  const previews = {};
  let st = null;
  const charts = [];

  window.Chart?.defaults && (window.Chart.defaults.font.family = "inherit");
  mount.innerHTML = `<div class="ml-wrap" id="mlRoot"><p class="ml-muted">Cargando laboratorio…</p></div>`;
  const root = mount.querySelector("#mlRoot");

  function destroyCharts() { charts.splice(0).forEach((c) => { try { c.destroy(); } catch { /* noop */ } }); }
  function mkChart(canvasId, cfg) {
    const el = root.querySelector("#" + canvasId);
    if (!el || !window.Chart) return;
    charts.push(new window.Chart(el, cfg));
  }

  try {
    datasets = await api.getMlDatasets(appId);
    const tl = await api.listTables(appId).catch(() => []);
    (tl || []).forEach((t) => { previews[t.name] = t.preview || []; });
  } catch (e) {
    root.innerHTML = emptyState("flask", "No se pudo cargar el laboratorio", e.message || String(e));
    return () => {};
  }
  ds = datasets[0] || null;
  renderHome();

  /* ===================================================================== */
  /* Home: tarjetas                                                         */
  /* ===================================================================== */
  function renderHome() {
    destroyCharts();
    st = null;
    if (!ds) {
      root.innerHTML = `${header()}${emptyState("flask", "Sin datos para experimentar", "Carga una tabla en el Gestor de datos para usar el laboratorio.")}`;
      return;
    }
    const nNum = ds.numeric.length;
    root.innerHTML = `
      ${header()}
      ${Object.entries(GROUPS).map(([g, label]) => `
        <section class="ml-section">
          <h3 class="ml-section-title">${label}</h3>
          <div class="ml-grid">
            ${ALGOS.filter((a) => a.group === g).map((a) => cardHtml(a)).join("")}
          </div>
        </section>`).join("")}`;
    bindHeader();
    root.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => openAlgo(b.dataset.open, false)));
    root.querySelectorAll("[data-example]").forEach((b) => b.addEventListener("click", () => openAlgo(b.dataset.example, true)));
    if (nNum < 1) root.insertAdjacentHTML("afterbegin", `<div class="ml-note warn">La tabla <strong>${esc(ds.name)}</strong> no tiene variables numéricas; la mayoría de algoritmos no podrán ejecutarse.</div>`);
  }

  function header() {
    return `
      <div class="ml-head">
        <div>
          <h2 class="ml-title">Laboratorio de ML</h2>
          <p class="ml-sub">Algoritmos de aprendizaje automático sobre tus datos, con flujo guiado y resultados interpretados.</p>
        </div>
        ${ds ? `<div class="ml-ds">
          <label class="ml-lab"><span>Tabla</span>
            <select id="mlDs" class="ml-input">${datasets.map((d) => `<option value="${esc(d.id)}" ${d.id === ds.id ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select></label>
          <div class="ml-ds-stats"><strong>${NF0.format(ds.rows)}</strong> filas · <strong>${ds.numeric.length}</strong> numéricas · <strong>${ds.categorical.length + ds.dates.length}</strong> categóricas</div>
        </div>` : ""}
      </div>`;
  }
  function bindHeader() {
    const sel = root.querySelector("#mlDs");
    if (sel) sel.addEventListener("change", () => { ds = datasets.find((d) => d.id === sel.value) || ds; renderHome(); });
  }

  function cardHtml(a) {
    return `
      <article class="ml-card ${a.group}">
        <div class="ml-card-top">
          <span class="ml-card-ico ${a.group}">${ICON[a.icon]}</span>
          <span class="ml-badge">${esc(a.kind)}</span>
        </div>
        <h4 class="ml-card-title">${esc(a.title)}</h4>
        <div class="ml-card-tech">${esc(a.tech)}</div>
        <p class="ml-card-desc">${esc(a.desc)}</p>
        <div class="ml-card-actions">
          <button class="ml-btn primary" data-open="${a.id}">Abrir</button>
          <button class="ml-btn ghost" data-example="${a.id}"><span class="ml-ic">${ICON.play}</span>Ejecutar ejemplo</button>
        </div>
      </article>`;
  }

  /* ===================================================================== */
  /* Asistente (wizard)                                                     */
  /* ===================================================================== */
  function defaultCfg() {
    return { features: [], target: "", measure: "", period: "", k: 0, standardize: true, testSize: 0.2,
      horizon: 3, aggregation: "sum", method: "both", threshold: 2.5, caseInput: {}, caseResult: null };
  }

  function openAlgo(id, example) {
    destroyCharts();
    st = { algo: ALGOS.find((a) => a.id === id), step: 0, maxStep: 0, cfg: defaultCfg(), result: null, running: false, error: null, example: false };
    if (example) {
      const ex = exampleConfig(id);
      if (ex.error) { st.step = 0; st.error = ex.error; renderWizard(); return; }
      st.cfg = { ...st.cfg, ...ex.cfg };
      st.example = true;
      st.step = 3; st.maxStep = 3;
      renderWizard();
      train();
      return;
    }
    renderWizard();
  }

  // Configuración automática para "Ejecutar ejemplo".
  function exampleConfig(id) {
    const N = ds.numeric.map((f) => f.field);
    const C = ds.categorical.map((f) => f.field);
    const D = ds.dates.map((f) => f.field);
    const target = N.find((f) => PREF_TARGET.test(f)) || N[0];
    const others = N.filter((f) => f !== target);
    const need = (cond, msg) => (cond ? null : msg);
    switch (id) {
      case "kmeans": return pick(need(N.length >= 2, "El ejemplo de segmentación necesita al menos 2 variables numéricas."), { features: N.slice(0, 4) });
      case "pca": return pick(need(N.length >= 2, "El ejemplo de PCA necesita al menos 2 variables numéricas."), { features: N.slice(0, 6) });
      case "correlation": return pick(need(N.length >= 2, "El ejemplo de correlaciones necesita al menos 2 variables numéricas."), { features: N.slice(0, 8) });
      case "anomaly": return pick(need(N.length >= 1, "El ejemplo de anomalías necesita al menos 1 variable numérica."), { features: N.slice(0, 2), threshold: 2 });
      case "linear": return pick(need(N.length >= 2, "El ejemplo de regresión necesita al menos 2 variables numéricas."), { target, features: others.slice(0, 5) });
      case "logistic": return pick(need(N.length >= 2, "El ejemplo de clasificación necesita al menos 2 variables numéricas."), { target, features: others.slice(0, 5) });
      case "forecast": {
        const period = D[0] || C.find((f) => PREF_PERIOD.test(f)) || C[0];
        return pick(need(N.length >= 1 && period, "El ejemplo de pronóstico necesita una medida numérica y un campo de periodo (mes, fecha...)."), { measure: target, period, horizon: 3 });
      }
      default: return { error: "Algoritmo desconocido." };
    }
    function pick(err, cfg) { return err ? { error: err } : { cfg }; }
  }

  function validate() {
    const c = st.cfg, a = st.algo.id;
    if (["kmeans", "pca", "correlation"].includes(a) && c.features.length < 2) return "Selecciona al menos 2 variables numéricas.";
    if (a === "anomaly" && c.features.length < 1) return "Selecciona al menos 1 variable numérica.";
    if ((a === "linear" || a === "logistic") && !c.target) return "Elige la variable objetivo.";
    if ((a === "linear" || a === "logistic") && c.features.length < 1) return "Selecciona al menos 1 variable predictora.";
    if (a === "forecast" && (!c.measure || !c.period)) return "Elige la medida y el campo de periodo.";
    return null;
  }

  function paramsFor(withInput) {
    const c = st.cfg, a = st.algo.id;
    const p = {};
    switch (a) {
      case "kmeans": Object.assign(p, { features: c.features, k: +c.k || 0, standardize: !!c.standardize }); break;
      case "pca": case "correlation": p.features = c.features; break;
      case "anomaly": Object.assign(p, { features: c.features, method: c.method, threshold: +c.threshold || 2.5 }); break;
      case "linear": Object.assign(p, { target: c.target, features: c.features, testSize: +c.testSize }); break;
      case "logistic": Object.assign(p, { target: c.target, features: c.features, testSize: +c.testSize }); if (c.positive) p.positive = c.positive; if (c.thresholdValue !== "" && c.thresholdValue != null && !Number.isNaN(+c.thresholdValue)) p.threshold = +c.thresholdValue; break;
      case "forecast": Object.assign(p, { measure: c.measure, period: c.period, horizon: +c.horizon || 3, aggregation: c.aggregation }); break;
    }
    if (withInput) p.input = c.caseInput;
    return p;
  }

  async function train() {
    const err = validate();
    if (err) { st.error = err; renderWizard(); return; }
    st.running = true; st.error = null; st.step = 3; st.maxStep = Math.max(st.maxStep, 3);
    renderWizard();
    try {
      st.result = await api.runMl(appId, { table: ds.name, algorithm: st.algo.id, params: paramsFor(false) });
      st.running = false;
      st.step = 4; st.maxStep = Math.max(st.maxStep, 5);
    } catch (e) {
      st.running = false;
      st.error = e.message || String(e);
      st.result = null;
    }
    renderWizard();
  }

  function renderWizard() {
    destroyCharts();
    const a = st.algo;
    root.innerHTML = `
      <div class="ml-crumbs">
        <button class="ml-back" id="mlBack"><span class="ml-ic">${ICON.back}</span>Laboratorio</button>
        <span class="ml-crumb-sep">/</span>
        <span class="ml-crumb-cur"><span class="ml-ic ${a.group}">${ICON[a.icon]}</span>${esc(a.title)}<em>${esc(a.tech)}</em></span>
        <span class="ml-spacer"></span>
        <label class="ml-lab inline"><span>Tabla</span><strong>${esc(ds.name)}</strong></label>
      </div>
      <ol class="ml-stepper">
        ${STEPS.map((s, i) => {
          const label = i === 5 && !CASE_ALGOS.has(a.id) ? "Muestra" : s;
          const cls = i === st.step ? "active" : i < st.step || i <= st.maxStep ? "done" : "";
          const clickable = i <= st.maxStep && !st.running;
          return `<li class="ml-step ${cls}"><button ${clickable ? "" : "disabled"} data-go="${i}"><span class="ml-step-n">${i < st.step && i <= st.maxStep ? ICON.check : i + 1}</span><span class="ml-step-l">${label}</span></button></li>`;
        }).join("")}
      </ol>
      ${st.example && st.step >= 4 ? `<div class="ml-note info"><span>Ejemplo automático con <strong>${esc(ds.name)}</strong>: ${esc(configSummary())}. <button class="ml-link" id="mlCustom">Personalizar</button></span></div>` : ""}
      ${st.error ? `<div class="ml-note err"><span class="ml-ic">${ICON.alert}</span><span>${esc(st.error)}</span></div>` : ""}
      <div class="ml-panel" id="mlPanel"></div>
      <div class="ml-nav">
        <button class="ml-btn ghost" id="mlPrev" ${st.step === 0 || st.running ? "disabled" : ""}>Atrás</button>
        <span class="ml-spacer"></span>
        ${navNext()}
      </div>`;
    root.querySelector("#mlBack").addEventListener("click", () => { if (!st.running) renderHome(); });
    root.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => { st.step = +b.dataset.go; st.error = null; renderWizard(); }));
    root.querySelector("#mlPrev").addEventListener("click", () => { st.step = Math.max(0, st.step - 1); st.error = null; renderWizard(); });
    root.querySelector("#mlCustom")?.addEventListener("click", () => { st.example = false; st.step = 1; st.error = null; renderWizard(); });
    const next = root.querySelector("#mlNext");
    if (next) next.addEventListener("click", onNext);
    drawStep();
  }

  function navNext() {
    if (st.running) return `<button class="ml-btn primary" disabled>Entrenando…</button>`;
    if (st.step === 3) return `<button class="ml-btn primary" id="mlNext"><span class="ml-ic">${ICON.play}</span>Entrenar modelo</button>`;
    if (st.step === 4) return st.result ? `<button class="ml-btn primary" id="mlNext">${CASE_ALGOS.has(st.algo.id) ? "Probar un caso" : "Ver muestra"}</button>` : "";
    if (st.step === 5) return `<button class="ml-btn ghost" id="mlNext">Ajustar y re-entrenar</button>`;
    return `<button class="ml-btn primary" id="mlNext">Siguiente</button>`;
  }

  function onNext() {
    st.error = null;
    if (st.step === 1 || st.step === 2) {
      const err = validate();
      if (err) { st.error = err; renderWizard(); return; }
    }
    if (st.step === 3) return train();
    if (st.step === 5) { st.step = 1; renderWizard(); return; }
    st.step += 1;
    st.maxStep = Math.max(st.maxStep, st.step);
    renderWizard();
  }

  function configSummary() {
    const c = st.cfg, a = st.algo.id;
    const lab = (f) => fieldLabel(f);
    if (a === "forecast") return `medida ${lab(c.measure)} por ${lab(c.period)}, ${c.horizon} periodos`;
    if (a === "linear" || a === "logistic") return `objetivo ${lab(c.target)} con ${c.features.length} variable(s)`;
    return `${c.features.length} variable(s): ${c.features.map(lab).join(", ")}`;
  }

  function fieldLabel(f) {
    const all = [...ds.numeric, ...ds.categorical, ...ds.dates];
    const m = all.find((x) => x.field === f);
    return m ? m.display || m.field : f;
  }

  function drawStep() {
    const panel = root.querySelector("#mlPanel");
    switch (st.step) {
      case 0: return stepData(panel);
      case 1: return stepVars(panel);
      case 2: return stepParams(panel);
      case 3: return stepTrain(panel);
      case 4: return stepResults(panel);
      default: return stepCase(panel);
    }
  }

  /* ---- Paso 1: Datos ---- */
  function stepData(panel) {
    const rows = previews[ds.name] || [];
    const cols = [...ds.numeric, ...ds.categorical, ...ds.dates];
    panel.innerHTML = `
      <h3 class="ml-h">Datos de entrada</h3>
      <div class="ml-metrics">
        ${metric("Registros", NF0.format(ds.rows))}
        ${metric("Variables numéricas", ds.numeric.length)}
        ${metric("Categóricas", ds.categorical.length)}
        ${metric("Fechas", ds.dates.length)}
      </div>
      ${rows.length ? `<div class="ml-scroll"><table class="ml-table"><thead><tr>${cols.map((c) => `<th>${esc(c.display || c.field)}</th>`).join("")}</tr></thead>
        <tbody>${rows.slice(0, 6).map((r) => `<tr>${cols.map((c) => `<td>${esc(r[c.field] ?? r[c.display] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
        <p class="ml-foot">Primeras ${Math.min(6, rows.length)} filas de ${NF0.format(ds.rows)}.</p>` : ""}`;
  }

  /* ---- Paso 2: Variables ---- */
  function chips(list, selected, name, multi) {
    return `<div class="ml-chips">${list.map((f) => {
      const on = multi ? selected.includes(f.field) : selected === f.field;
      return `<button type="button" class="ml-chip ${on ? "on" : ""}" data-chip="${name}" data-v="${esc(f.field)}">${esc(f.display || f.field)}</button>`;
    }).join("")}</div>`;
  }

  function stepVars(panel) {
    const a = st.algo.id, c = st.cfg;
    const numNoTarget = ds.numeric.filter((f) => f.field !== c.target);
    let html = `<h3 class="ml-h">Variables</h3>`;
    if (a === "forecast") {
      html += `<div class="ml-field"><div class="ml-field-h">Medida a pronosticar</div>${chips(ds.numeric, c.measure, "measure", false)}</div>
        <div class="ml-field"><div class="ml-field-h">Campo de periodo</div>${chips([...ds.dates, ...ds.categorical], c.period, "period", false)}</div>`;
    } else if (a === "linear") {
      html += `<div class="ml-field"><div class="ml-field-h">Variable a predecir (objetivo)</div>${chips(ds.numeric, c.target, "target", false)}</div>
        <div class="ml-field"><div class="ml-field-h">Variables predictoras</div>${chips(numNoTarget, c.features, "features", true)}</div>`;
    } else if (a === "logistic") {
      html += `<div class="ml-field"><div class="ml-field-h">Qué clasificar (objetivo)</div>${chips([...ds.numeric, ...ds.categorical], c.target, "target", false)}
        <p class="ml-hint">Numérico: se separa en alto/bajo por umbral. Categórico: se predice una clase frente al resto.</p></div>
        <div class="ml-field"><div class="ml-field-h">Variables predictoras</div>${chips(numNoTarget, c.features, "features", true)}</div>`;
    } else {
      const min = a === "anomaly" ? 1 : 2;
      html += `<div class="ml-field"><div class="ml-field-h">Variables numéricas <span class="ml-req">mínimo ${min}</span></div>
        ${chips(ds.numeric, c.features, "features", true)}
        <div class="ml-inline-actions"><button class="ml-link" id="mlAll">Todas</button><button class="ml-link" id="mlNone">Ninguna</button></div></div>`;
    }
    panel.innerHTML = html;
    panel.querySelectorAll("[data-chip]").forEach((b) => b.addEventListener("click", () => {
      const name = b.dataset.chip, v = b.dataset.v;
      if (name === "features") {
        const i = c.features.indexOf(v);
        if (i >= 0) c.features.splice(i, 1); else c.features.push(v);
      } else {
        c[name] = v;
        if (name === "target") c.features = c.features.filter((f) => f !== v);
      }
      st.error = null; stepVars(panel);
    }));
    panel.querySelector("#mlAll")?.addEventListener("click", () => { c.features = ds.numeric.map((f) => f.field); stepVars(panel); });
    panel.querySelector("#mlNone")?.addEventListener("click", () => { c.features = []; stepVars(panel); });
  }

  /* ---- Paso 3: Parámetros ---- */
  function stepParams(panel) {
    const a = st.algo.id, c = st.cfg;
    let body = "";
    if (a === "kmeans") {
      body = `<div class="ml-form">
        <label class="ml-lab"><span>Número de segmentos (k)</span>
          <select class="ml-input" data-p="k"><option value="0" ${!+c.k ? "selected" : ""}>Automático (mejor silueta)</option>${[2, 3, 4, 5, 6, 7, 8].map((k) => `<option value="${k}" ${+c.k === k ? "selected" : ""}>${k}</option>`).join("")}</select></label>
        <label class="ml-lab"><span>Estandarizar variables</span>
          <select class="ml-input" data-p="standardize"><option value="true" ${c.standardize ? "selected" : ""}>Sí (recomendado)</option><option value="false" ${!c.standardize ? "selected" : ""}>No</option></select></label>
      </div>`;
    } else if (a === "linear" || a === "logistic") {
      body = `<div class="ml-form">
        <label class="ml-lab"><span>Proporción de prueba</span>
          <select class="ml-input" data-p="testSize">${[0.1, 0.2, 0.25, 0.3].map((v) => `<option value="${v}" ${+c.testSize === v ? "selected" : ""}>${v * 100}%</option>`).join("")}</select></label>
        ${a === "logistic" ? `<label class="ml-lab"><span>Umbral del objetivo (opcional)</span><input class="ml-input" data-p="thresholdValue" type="number" step="any" placeholder="Mediana" value="${esc(c.thresholdValue ?? "")}"></label>` : ""}
      </div>`;
    } else if (a === "forecast") {
      body = `<div class="ml-form">
        <label class="ml-lab"><span>Periodos a pronosticar</span><input class="ml-input" data-p="horizon" type="number" min="1" max="24" value="${esc(c.horizon)}"></label>
        <label class="ml-lab"><span>Agregación por periodo</span>
          <select class="ml-input" data-p="aggregation"><option value="sum" ${c.aggregation === "sum" ? "selected" : ""}>Suma</option><option value="avg" ${c.aggregation === "avg" ? "selected" : ""}>Promedio</option></select></label>
      </div>`;
    } else if (a === "anomaly") {
      body = `<div class="ml-form">
        <label class="ml-lab"><span>Criterio</span>
          <select class="ml-input" data-p="method"><option value="both" ${c.method === "both" ? "selected" : ""}>Z-score o IQR</option><option value="zscore" ${c.method === "zscore" ? "selected" : ""}>Solo Z-score</option><option value="iqr" ${c.method === "iqr" ? "selected" : ""}>Solo IQR</option></select></label>
        <label class="ml-lab"><span>Umbral Z (desviaciones)</span><input class="ml-input" data-p="threshold" type="number" min="1" step="0.1" value="${esc(c.threshold)}"></label>
      </div>`;
    } else {
      body = `<p class="ml-muted">Este algoritmo no requiere parámetros: usa valores estándar.</p>`;
    }
    panel.innerHTML = `<h3 class="ml-h">Parámetros</h3>${body}`;
    panel.querySelectorAll("[data-p]").forEach((el) => el.addEventListener("change", () => {
      const k = el.dataset.p;
      c[k] = el.value === "true" ? true : el.value === "false" ? false : el.value;
    }));
  }

  /* ---- Paso 4: Entrenar ---- */
  function stepTrain(panel) {
    const c = st.cfg;
    const rows = [["Algoritmo", `${st.algo.title} (${st.algo.tech})`], ["Tabla", ds.name]];
    if (c.target) rows.push(["Objetivo", fieldLabel(c.target)]);
    if (c.measure) rows.push(["Medida", fieldLabel(c.measure)], ["Periodo", fieldLabel(c.period)], ["Horizonte", c.horizon + " periodos"]);
    if (c.features.length) rows.push(["Variables", c.features.map(fieldLabel).join(", ")]);
    panel.innerHTML = `<h3 class="ml-h">${st.running ? "Entrenando…" : "Resumen del experimento"}</h3>
      <dl class="ml-dl">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
      ${st.running ? `<div class="ml-progress"><span></span></div>` : ""}`;
  }

  /* ===================================================================== */
  /* Paso 5: Resultados                                                     */
  /* ===================================================================== */
  function stepResults(panel) {
    const r = st.result;
    if (!r) { panel.innerHTML = emptyState("flask", "Aún no hay resultados", "Entrena el modelo para ver los resultados."); return; }
    const body = {
      kmeans: resKmeans, pca: resPca, correlation: resCorrelation, anomaly: resAnomaly,
      linear: resLinear, forecast: resForecast, logistic: resLogistic,
    }[r.algorithm](r);
    panel.innerHTML = `
      <div class="ml-res-head"><h3 class="ml-h">Resultados</h3><span class="ml-muted">${NF0.format(r.n)} registros · ${r.elapsedMs} ms</span></div>
      ${body.html}
      ${r.insights?.length ? `<div class="ml-insights"><div class="ml-insights-t">Lectura del resultado</div><ul>${r.insights.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></div>` : ""}`;
    body.draw?.();
  }

  const metric = (label, value, hint) => `<div class="ml-metric"><div class="ml-metric-v">${value}</div><div class="ml-metric-l">${esc(label)}</div>${hint ? `<div class="ml-metric-h">${esc(hint)}</div>` : ""}</div>`;
  const tableHtml = (head, rows, cls = "") => `<div class="ml-scroll"><table class="ml-table ${cls}"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  const canvas = (id, h = 280) => `<div class="ml-chart" style="height:${h}px"><canvas id="${id}"></canvas></div>`;
  const chartOpts = (extra = {}) => ({ responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { position: "bottom", labels: { boxWidth: 10, usePointStyle: true } } }, ...extra });

  /* ---- K-Means ---- */
  function resKmeans(r) {
    const sil = r.silhouette;
    const html = `
      <div class="ml-metrics">
        ${metric("Segmentos", r.k)}
        ${metric("Silueta", num(sil), sil >= 0.5 ? "separación fuerte" : sil >= 0.25 ? "razonable" : "débil")}
        ${metric("Registros", NF0.format(r.n))}
        ${metric("Inercia", num(r.inertia))}
      </div>
      <div class="ml-two">
        <div class="ml-box"><div class="ml-box-t">Mapa de segmentos <span>PC1 ${pct(r.explained[0])} · PC2 ${pct(r.explained[1])}</span></div>${canvas("cScatter", 300)}</div>
        <div class="ml-box"><div class="ml-box-t">Elección de k <span>inercia y silueta</span></div>${canvas("cElbow", 300)}</div>
      </div>
      <div class="ml-seg-grid">
        ${r.clusters.map((c, i) => `
          <div class="ml-seg">
            <div class="ml-seg-h"><span class="ml-dot" style="background:${COLORS[i % COLORS.length]}"></span><strong>${esc(c.name)}</strong></div>
            <div class="ml-seg-size">${NF0.format(c.size)} registros · ${pct(c.share)}</div>
            <div class="ml-bar"><span style="width:${(c.share * 100).toFixed(1)}%;background:${COLORS[i % COLORS.length]}"></span></div>
            <div class="ml-prof">${r.features.map((f) => `
              <div class="ml-prof-row"><span class="ml-prof-f">${esc(fieldLabel(f))}</span><span class="ml-prof-v">${num(c.centroid[f])}</span>${zbar(c.profile[f])}</div>`).join("")}</div>
          </div>`).join("")}
      </div>
      <div class="ml-box"><div class="ml-box-t">Muestra de asignaciones</div>
        ${tableHtml(["Fila", ...r.features.map(fieldLabel), "Segmento"], r.sample.map((s) => [s.row, ...r.features.map((f) => num(s.values[f])), esc(s.name)]))}</div>`;
    const draw = () => {
      mkChart("cScatter", { type: "scatter", data: { datasets: r.clusters.map((c, i) => ({ label: c.name, data: r.projection.filter((p) => p.c === c.id).map((p) => ({ x: p.x, y: p.y })), backgroundColor: COLORS[i % COLORS.length] + "cc", pointRadius: 4 })) }, options: chartOpts({ scales: { x: { title: { display: true, text: "Componente 1" } }, y: { title: { display: true, text: "Componente 2" } } } }) });
      mkChart("cElbow", { type: "line", data: { labels: r.elbow.map((e) => e.k), datasets: [
        { label: "Inercia", data: r.elbow.map((e) => e.inertia), borderColor: COLORS[0], backgroundColor: COLORS[0], yAxisID: "y", tension: 0.2 },
        { label: "Silueta", data: r.elbow.map((e) => e.silhouette), borderColor: COLORS[1], backgroundColor: COLORS[1], yAxisID: "y1", tension: 0.2, borderDash: [5, 4] }] },
        options: chartOpts({ scales: { x: { title: { display: true, text: "k" } }, y: { position: "left" }, y1: { position: "right", grid: { drawOnChartArea: false }, min: -0.2, max: 1 } } }) });
    };
    return { html, draw };
  }

  function zbar(z) {
    const v = Math.max(-2, Math.min(2, z ?? 0)) / 2;
    const w = Math.abs(v) * 50;
    const style = v >= 0 ? `left:50%;width:${w}%;background:#172983` : `left:${50 - w}%;width:${w}%;background:#d6a52f`;
    return `<span class="ml-zbar" title="z = ${num(z)}"><i style="${style}"></i></span>`;
  }

  /* ---- PCA ---- */
  function resPca(r) {
    const k = Math.min(4, r.components.length);
    const html = `
      <div class="ml-metrics">
        ${metric("Variables", r.features.length)}
        ${metric("Componentes al 80%", r.components80)}
        ${metric("PC1 explica", pct(r.components[0].explained))}
        ${metric("PC1 + PC2", pct(r.components[0].explained + (r.components[1]?.explained || 0)))}
      </div>
      <div class="ml-two">
        <div class="ml-box"><div class="ml-box-t">Varianza explicada</div>${canvas("cVar", 280)}</div>
        <div class="ml-box"><div class="ml-box-t">Proyección en PC1 y PC2</div>${canvas("cProj", 280)}</div>
      </div>
      <div class="ml-box"><div class="ml-box-t">Cargas por componente <span>peso de cada variable</span></div>
        ${tableHtml(["Variable", ...r.components.slice(0, k).map((c) => `${c.name} (${pct(c.explained)})`)],
          r.features.map((f) => [esc(fieldLabel(f)), ...r.components.slice(0, k).map((c) => heatCell(c.loadings[f]))]), "ml-heat")}</div>`;
    const draw = () => {
      mkChart("cVar", { type: "bar", data: { labels: r.components.map((c) => c.name), datasets: [
        { type: "bar", label: "Individual", data: r.components.map((c) => +(c.explained * 100).toFixed(2)), backgroundColor: COLORS[0] },
        { type: "line", label: "Acumulada", data: r.components.map((c) => +(c.cumulative * 100).toFixed(2)), borderColor: COLORS[2], backgroundColor: COLORS[2], tension: 0.2 }] },
        options: chartOpts({ scales: { y: { max: 100, title: { display: true, text: "% de varianza" } } } }) });
      mkChart("cProj", { type: "scatter", data: { datasets: [{ label: "Registros", data: r.projection, backgroundColor: COLORS[0] + "aa", pointRadius: 4 }] }, options: chartOpts({ plugins: { legend: { display: false } }, scales: { x: { title: { display: true, text: "PC1" } }, y: { title: { display: true, text: "PC2" } } } }) });
    };
    return { html, draw };
  }

  function heatCell(v) {
    if (v == null) return "—";
    const a = Math.min(1, Math.abs(v));
    const bg = v >= 0 ? `rgba(23,41,131,${(a * 0.85).toFixed(2)})` : `rgba(214,165,47,${(a * 0.85).toFixed(2)})`;
    return `<span class="ml-heat-c" style="background:${bg};color:${a > 0.5 ? "#fff" : "#1b2330"}">${num(v)}</span>`;
  }

  /* ---- Correlaciones ---- */
  function resCorrelation(r) {
    const html = `
      <div class="ml-metrics">
        ${metric("Variables", r.features.length)}
        ${metric("Pares analizados", r.pairs.length)}
        ${metric("Relación más fuerte", num(r.pairs[0]?.r), r.pairs[0] ? `${fieldLabel(r.pairs[0].a)} · ${fieldLabel(r.pairs[0].b)}` : "")}
      </div>
      <div class="ml-box"><div class="ml-box-t">Matriz de Pearson</div>
        ${tableHtml(["", ...r.features.map(fieldLabel)], r.features.map((f, i) => [`<strong>${esc(fieldLabel(f))}</strong>`, ...r.pearson[i].map((v) => heatCell(v))]), "ml-heat")}</div>
      <div class="ml-box"><div class="ml-box-t">Pares ordenados por fuerza</div>
        ${tableHtml(["Variable A", "Variable B", "Pearson", "Spearman", "R²", "Fuerza", "Significativa"],
          r.pairs.slice(0, 12).map((p) => [esc(fieldLabel(p.a)), esc(fieldLabel(p.b)), heatCell(p.r), num(p.spearman), num(p.r2), `${esc(p.strength)} ${esc(p.direction)}`, p.significant ? "Sí" : "No"]))}</div>`;
    return { html };
  }

  /* ---- Anomalías ---- */
  function resAnomaly(r) {
    const f0 = fieldLabel(r.features[0]);
    const html = `
      <div class="ml-metrics">
        ${metric("Registros", NF0.format(r.n))}
        ${metric("Atípicos", r.total)}
        ${metric("% del total", pct(r.total / r.n))}
        ${metric("Umbral Z", num(r.threshold))}
      </div>
      <div class="ml-two">
        <div class="ml-box"><div class="ml-box-t">Distribución de ${esc(f0)}</div>${canvas("cHist", 280)}</div>
        <div class="ml-box"><div class="ml-box-t">${r.features.length > 1 ? `${esc(f0)} vs ${esc(fieldLabel(r.features[1]))}` : `${esc(f0)} por fila`}</div>${canvas("cAnom", 280)}</div>
      </div>
      <div class="ml-box"><div class="ml-box-t">Registros atípicos <span>más extremos primero</span></div>
        ${r.anomalies.length ? tableHtml(["Fila", ...r.features.map(fieldLabel), "Puntaje σ", "Motivo"],
          r.anomalies.slice(0, 15).map((a) => [a.row, ...r.features.map((f) => num(a.values[f])), num(a.score), a.reasons.map((x) => `${esc(fieldLabel(x.feature))} (${esc(x.rule)})`).join(", ")]))
          : `<p class="ml-muted ml-pad">Ningún registro supera el umbral.</p>`}</div>
      <div class="ml-box"><div class="ml-box-t">Estadísticos y límites</div>
        ${tableHtml(["Variable", "Media", "Desv.", "Mín", "Q1", "Mediana", "Q3", "Máx", "Límite inf.", "Límite sup."],
          r.stats.map((s) => [esc(fieldLabel(s.feature)), num(s.mean), num(s.sd), num(s.min), num(s.q1), num(s.median), num(s.q3), num(s.max), num(s.lowFence), num(s.highFence)]))}</div>`;
    const draw = () => {
      mkChart("cHist", { type: "bar", data: { labels: r.histogram.map((b) => num(b.from)), datasets: [
        { label: "Normales", data: r.histogram.map((b) => b.count - b.anomalies), backgroundColor: COLORS[0] },
        { label: "Atípicos", data: r.histogram.map((b) => b.anomalies), backgroundColor: COLORS[3] }] },
        options: chartOpts({ scales: { x: { stacked: true }, y: { stacked: true, title: { display: true, text: "Registros" } } } }) });
      mkChart("cAnom", { type: "scatter", data: { datasets: [
        { label: "Normales", data: r.scatter.filter((p) => !p.a).map((p) => ({ x: p.x, y: p.y })), backgroundColor: COLORS[0] + "99", pointRadius: 4 },
        { label: "Atípicos", data: r.scatter.filter((p) => p.a).map((p) => ({ x: p.x, y: p.y })), backgroundColor: COLORS[3], pointRadius: 6 }] }, options: chartOpts() });
    };
    return { html, draw };
  }

  /* ---- Regresión lineal ---- */
  function resLinear(r) {
    const t = r.test || r.train;
    const html = `
      <div class="ml-metrics">
        ${metric("R² " + (r.test ? "(prueba)" : "(entrenamiento)"), num(t.r2), "variación explicada")}
        ${metric("R² ajustado", num(r.adjR2))}
        ${metric("RMSE", num(t.rmse), "error típico")}
        ${metric("MAE", num(t.mae), "error absoluto medio")}
      </div>
      <div class="ml-eq"><span>Ecuación</span><code>${esc(r.equation)}</code></div>
      <div class="ml-two">
        <div class="ml-box"><div class="ml-box-t">Real vs predicho</div>${canvas("cReg", 300)}</div>
        <div class="ml-box"><div class="ml-box-t">Coeficientes</div>
          ${tableHtml(["Variable", "Coef.", "Error est.", "t", "Peso estd.", "Signif."],
            r.coefficients.map((c) => [esc(c.name === "Intercepto" ? c.name : fieldLabel(c.name)), num(c.value), num(c.stdError), num(c.t), c.name === "Intercepto" ? "—" : num(c.standardized), c.significant ? `<span class="ml-tag ok">Sí</span>` : `<span class="ml-tag">No</span>`]))}
          ${r.test ? `<p class="ml-foot">Entrenamiento: R² ${num(r.train.r2)} · RMSE ${num(r.train.rmse)} (${r.train.n} filas). Prueba: ${r.test.n} filas.</p>` : ""}</div>
      </div>`;
    const draw = () => {
      const all = r.scatter.flatMap((p) => [p.actual, p.pred]);
      const mn = Math.min(...all), mx = Math.max(...all);
      mkChart("cReg", { type: "scatter", data: { datasets: [
        { label: "Entrenamiento", data: r.scatter.filter((p) => p.set === "train").map((p) => ({ x: p.actual, y: p.pred })), backgroundColor: COLORS[0] + "aa", pointRadius: 4 },
        { label: "Prueba", data: r.scatter.filter((p) => p.set === "test").map((p) => ({ x: p.actual, y: p.pred })), backgroundColor: COLORS[2], pointRadius: 6 },
        { type: "line", label: "Predicción perfecta", data: [{ x: mn, y: mn }, { x: mx, y: mx }], borderColor: "#9aa3b2", borderDash: [5, 4], pointRadius: 0 }] },
        options: chartOpts({ scales: { x: { title: { display: true, text: "Real" } }, y: { title: { display: true, text: "Predicho" } } } }) });
    };
    return { html, draw };
  }

  /* ---- Pronóstico ---- */
  function resForecast(r) {
    const html = `
      <div class="ml-metrics">
        ${metric("Periodos históricos", r.n)}
        ${metric("Mejor modelo", esc(r.best))}
        ${metric("Próximo periodo", num(r.forecast[0]?.value))}
        ${metric("Horizonte", r.horizon)}
      </div>
      ${r.warnings?.length ? r.warnings.map((w) => `<div class="ml-note warn"><span class="ml-ic">${ICON.alert}</span>${esc(w)}</div>`).join("") : ""}
      <div class="ml-box"><div class="ml-box-t">${esc(fieldLabel(r.measure))} por ${esc(fieldLabel(r.period))}</div>${canvas("cFc", 320)}</div>
      <div class="ml-two">
        <div class="ml-box"><div class="ml-box-t">Pronóstico</div>
          ${tableHtml(["Periodo", "Valor", "Mínimo", "Máximo"], r.forecast.map((f) => [esc(f.label), `<strong>${num(f.value)}</strong>`, num(f.lower), num(f.upper)]))}</div>
        <div class="ml-box"><div class="ml-box-t">Comparación de modelos</div>
          ${tableHtml(["Modelo", "RMSE", "MAE", "Evaluación"], r.models.map((m) => [m.name === r.best ? `<strong>${esc(m.name)}</strong>` : esc(m.name), num(m.rmse), num(m.mae), m.evaluation === "holdout" ? "Periodos reservados" : "Sobre los mismos datos"]))}</div>
      </div>`;
    const draw = () => {
      const hl = r.history.map((h) => h.label), fl = r.forecast.map((f) => f.label);
      const labels = [...hl, ...fl];
      const padH = (arr) => [...arr, ...fl.map(() => null)];
      const padF = (arr, join) => [...hl.map((_, i) => (join && i === hl.length - 1 ? join : null)), ...arr];
      const last = r.history[r.history.length - 1].value;
      mkChart("cFc", { type: "line", data: { labels, datasets: [
        { label: "Real", data: padH(r.history.map((h) => h.value)), borderColor: COLORS[0], backgroundColor: COLORS[0], tension: 0.15 },
        { label: "Ajuste", data: padH(r.history.map((h) => h.fitted)), borderColor: "#9aa3b2", borderDash: [4, 4], pointRadius: 0 },
        { label: "Pronóstico", data: padF(r.forecast.map((f) => f.value), last), borderColor: COLORS[2], backgroundColor: COLORS[2], borderDash: [6, 4] },
        { label: "Máximo", data: padF(r.forecast.map((f) => f.upper), last), borderColor: COLORS[2] + "66", pointRadius: 0, fill: false },
        { label: "Mínimo", data: padF(r.forecast.map((f) => f.lower), last), borderColor: COLORS[2] + "66", pointRadius: 0, fill: "-1", backgroundColor: COLORS[2] + "22" }] },
        options: chartOpts() });
    };
    return { html, draw };
  }

  /* ---- Clasificación ---- */
  function resLogistic(r) {
    const m = r.metrics, cf = r.confusion;
    const html = `
      <div class="ml-metrics">
        ${metric("Exactitud", pct(m.accuracy), "base " + pct(m.baseline))}
        ${metric("Precisión", pct(m.precision))}
        ${metric("Sensibilidad", pct(m.recall))}
        ${metric("F1", num(m.f1))}
        ${metric("AUC", num(m.auc))}
      </div>
      <p class="ml-foot ml-top">Clase positiva: <strong>${esc(r.positive)}</strong> · evaluado sobre ${esc(r.evaluatedOn)}.</p>
      <div class="ml-two">
        <div class="ml-box"><div class="ml-box-t">Matriz de confusión</div>
          <div class="ml-conf">
            <div></div><div class="ml-conf-h">Predice positivo</div><div class="ml-conf-h">Predice negativo</div>
            <div class="ml-conf-h side">Real positivo</div><div class="ml-conf-c good">${cf.tp}<small>verdaderos +</small></div><div class="ml-conf-c bad">${cf.fn}<small>falsos −</small></div>
            <div class="ml-conf-h side">Real negativo</div><div class="ml-conf-c bad">${cf.fp}<small>falsos +</small></div><div class="ml-conf-c good">${cf.tn}<small>verdaderos −</small></div>
          </div></div>
        <div class="ml-box"><div class="ml-box-t">Curva ROC</div>${canvas("cRoc", 260)}</div>
      </div>
      <div class="ml-box"><div class="ml-box-t">Influencia de cada variable</div>
        ${tableHtml(["Variable", "Coef. (estandarizado)", "Razón de momios por +1σ"], r.coefficients.map((c) => [esc(fieldLabel(c.name)), heatCell(c.coef), num(c.oddsRatio)]), "ml-heat")}</div>`;
    const draw = () => {
      mkChart("cRoc", { type: "line", data: { datasets: [
        { label: "Modelo", data: (r.roc || []).map((p) => ({ x: p.fpr, y: p.tpr })), borderColor: COLORS[0], backgroundColor: COLORS[0] + "22", fill: true, pointRadius: 0, stepped: false },
        { label: "Azar", data: [{ x: 0, y: 0 }, { x: 1, y: 1 }], borderColor: "#9aa3b2", borderDash: [5, 4], pointRadius: 0 }] },
        options: chartOpts({ scales: { x: { type: "linear", min: 0, max: 1, title: { display: true, text: "Falsos positivos" } }, y: { min: 0, max: 1, title: { display: true, text: "Verdaderos positivos" } } } }) });
    };
    return { html, draw };
  }

  /* ===================================================================== */
  /* Paso 6: Probar un caso / Muestra                                       */
  /* ===================================================================== */
  function stepCase(panel) {
    const a = st.algo.id;
    if (!CASE_ALGOS.has(a)) return stepSample(panel);
    const c = st.cfg;
    const rows = previews[ds.name] || [];
    const missing = c.features.some((f) => c.caseInput[f] === undefined || c.caseInput[f] === "");
    if (missing && rows.length && !st.caseFilled) { fillFromRow(0); st.caseFilled = true; }
    panel.innerHTML = `
      <h3 class="ml-h">Probar un caso</h3>
      <div class="ml-form wide">
        ${c.features.map((f) => `<label class="ml-lab"><span>${esc(fieldLabel(f))}</span><input class="ml-input" type="number" step="any" data-case="${esc(f)}" value="${esc(c.caseInput[f] ?? "")}"></label>`).join("")}
      </div>
      <div class="ml-case-actions">
        <button class="ml-btn primary" id="mlPredict"><span class="ml-ic">${ICON.play}</span>${a === "kmeans" ? "Asignar segmento" : a === "linear" ? "Predecir valor" : "Calcular probabilidad"}</button>
        ${rows.length ? `<button class="ml-btn ghost" id="mlRow">Cargar otra fila de ejemplo</button>` : ""}
      </div>
      <div id="mlCaseOut">${caseOut()}</div>`;
    panel.querySelectorAll("[data-case]").forEach((el) => el.addEventListener("input", () => { c.caseInput[el.dataset.case] = el.value; }));
    panel.querySelector("#mlRow")?.addEventListener("click", () => { st.rowPtr = ((st.rowPtr ?? 0) + 1) % rows.length; fillFromRow(st.rowPtr); stepCase(panel); });
    panel.querySelector("#mlPredict").addEventListener("click", async () => {
      const out = panel.querySelector("#mlCaseOut");
      out.innerHTML = `<p class="ml-muted">Calculando…</p>`;
      try {
        const res = await api.runMl(appId, { table: ds.name, algorithm: a, params: paramsFor(true) });
        c.caseResult = res.prediction || null;
        out.innerHTML = caseOut();
      } catch (e) { out.innerHTML = `<div class="ml-note err"><span class="ml-ic">${ICON.alert}</span>${esc(e.message)}</div>`; }
    });
  }

  function fillFromRow(i) {
    const rows = previews[ds.name] || [];
    const row = rows[i];
    if (!row) return;
    // Las filas de vista previa llegan con el nombre renombrado (override); se busca por ambos.
    st.cfg.features.forEach((f) => { st.cfg.caseInput[f] = row[f] ?? row[fieldLabel(f)] ?? ""; });
    st.cfg.caseResult = null;
  }

  function caseOut() {
    const p = st.cfg.caseResult, a = st.algo.id;
    if (!p) return "";
    if (a === "kmeans") return `<div class="ml-case-res"><div class="ml-case-k">Segmento asignado</div><div class="ml-case-v">${esc(p.name)}</div><div class="ml-case-s">Distancia al centro: ${num(p.distance)}</div></div>`;
    if (a === "linear") return `<div class="ml-case-res"><div class="ml-case-k">${esc(fieldLabel(st.cfg.target))} estimado</div><div class="ml-case-v">${num(p.value)}</div><div class="ml-case-s">Rango esperado (95%): ${num(p.lower)} a ${num(p.upper)}</div></div>`;
    return `<div class="ml-case-res"><div class="ml-case-k">Probabilidad de «${esc(st.result.positive)}»</div><div class="ml-case-v">${pct(p.probability)}</div>
      <div class="ml-bar big"><span style="width:${(p.probability * 100).toFixed(1)}%"></span></div><div class="ml-case-s">Clasificación: ${esc(p.label)}</div></div>`;
  }

  function stepSample(panel) {
    const r = st.result;
    if (!r) { panel.innerHTML = emptyState("flask", "Sin resultados", "Entrena el modelo primero."); return; }
    let title = "Muestra", head = [], rows = [];
    if (r.algorithm === "forecast") {
      title = "Muestra del pronóstico"; head = ["Periodo", "Valor", "Mínimo", "Máximo"];
      rows = r.forecast.map((f) => [f.label, f.value, f.lower, f.upper]);
    } else if (r.algorithm === "anomaly") {
      title = "Muestra de registros atípicos"; head = ["Fila", ...r.features.map(fieldLabel), "Puntaje σ"];
      rows = r.anomalies.map((a) => [a.row, ...r.features.map((f) => a.values[f]), a.score]);
    } else if (r.algorithm === "correlation") {
      title = "Muestra de relaciones"; head = ["Variable A", "Variable B", "Pearson", "Spearman", "Fuerza"];
      rows = r.pairs.map((p) => [fieldLabel(p.a), fieldLabel(p.b), p.r, p.spearman, p.strength]);
    } else {
      title = "Muestra de la proyección"; head = ["Registro", "PC1", "PC2"];
      rows = r.projection.slice(0, 20).map((p, i) => [i + 1, p.x, p.y]);
    }
    panel.innerHTML = `<h3 class="ml-h">${title}</h3>
      ${rows.length ? tableHtml(head, rows.map((row) => row.map((v) => (typeof v === "number" ? num(v) : esc(v))))) : `<p class="ml-muted">Sin filas para mostrar.</p>`}
      <div class="ml-case-actions"><button class="ml-btn ghost" id="mlCsv"><span class="ml-ic">${ICON.download}</span>Exportar CSV</button></div>`;
    panel.querySelector("#mlCsv")?.addEventListener("click", () => downloadCsv(`${r.algorithm}_muestra.csv`, head, rows));
  }

  function downloadCsv(name, head, rows) {
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [head.map(q).join(","), ...rows.map((r) => r.map(q).join(","))].join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function emptyState(icon, title, hint) {
    return `<div class="ml-empty"><span class="ml-empty-ico">${ICON[icon] || ICON.flask}</span><strong>${esc(title)}</strong><span class="ml-empty-hint">${esc(hint)}</span></div>`;
  }

  return () => { destroyCharts(); };
}

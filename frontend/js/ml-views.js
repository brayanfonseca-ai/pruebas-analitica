// ml-views.js — gráficos de Machine Learning como OBJETOS DE HOJA.
//
// Cada vista dibuja UNA pieza del resultado de una ejecución guardada de
// Experimentos de ML (mapa de clusters, elección de k, silhouette score,
// perfiles de segmentos, real vs predicho, ROC, matriz de confusión, pronóstico,
// correlaciones…). El objeto de hoja guarda props.ml = {experimentId, runId} y se
// edita como cualquier otro gráfico (título, tamaño, posición, ejecución,
// leyenda y paleta). Los números vienen del backend: aquí solo se dibujan.

import { num, pct, heat, keyMetrics, COLORS } from "./ml-render.js";

// Paleta "Sense" (la misma de chart-types.js; copiada para no crear un import circular).
const PALETTE = ["#0a8f3c", "#1f6feb", "#f0a132", "#c0392b", "#8e44ad", "#16a085", "#d35400", "#2c3e50", "#7f8c8d", "#b8860b"];

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const NF0 = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });
const NOISE = "#a7adbd";

export const ML_FAMILIES = [
  { key: "cluster", label: "Clusterización" },
  { key: "regression", label: "Regresión y predicción" },
  { key: "classification", label: "Clasificación" },
  { key: "series", label: "Series de tiempo" },
  { key: "explore", label: "Exploración" },
  { key: "general", label: "Cualquier modelo" },
];

const ALGO_NAMES = {
  kmeans: "K-Means", hierarchical: "Clúster jerárquico", dbscan: "DBSCAN", linear: "Regresión lineal", logistic: "Regresión logística",
  ridge: "Ridge", lasso: "Lasso", poly: "Regresión polinómica", tree: "Árbol de decisión", forest: "Random Forest", gbm: "Gradient Boosting",
  knn: "K vecinos", bayes: "Naive Bayes", automl: "AutoML", anomaly: "Detección de anomalías", forecast: "Pronóstico",
  correlation: "Correlaciones", pca: "PCA", rules: "Reglas de asociación",
};
export const algoName = (a) => ALGO_NAMES[a] || a;

/** Resultado "base" (AutoML -> modelo ganador) para las vistas de modelo. */
const base = (r) => (r?.algorithm === "automl" && r.best ? r.best : r);
const isCluster = (r) => ["kmeans", "hierarchical", "dbscan"].includes(base(r)?.algorithm);
const isCls = (r) => { const b = base(r); return b?.task === "classification" || b?.algorithm === "logistic"; };
const isReg = (r) => { const b = base(r); return !isCls(r) && (b?.task === "regression" || b?.algorithm === "linear"); };

/* --------------------------------------------------------------------------
   Catálogo de vistas. type = tipo del objeto de hoja (chart-types.js).
   -------------------------------------------------------------------------- */
export const ML_VIEWS = [
  { type: "ml-clustermap", fam: "cluster", icon: "mlcluster", label: "Mapa de clusters", desc: "Registros proyectados en 2 componentes, coloreados por grupo.", size: { w: 12, h: 9 }, fits: isCluster },
  { type: "ml-elbow", fam: "cluster", icon: "mlelbow", label: "Elección de k (inercia y silueta)", desc: "Curva del codo y silueta por k; altura de fusión (jerárquico) o k-distancia (DBSCAN).", size: { w: 12, h: 9 }, fits: isCluster },
  { type: "ml-silhouette", fam: "cluster", icon: "mlsil", label: "Silhouette score", desc: "Calidad de la separación de los grupos (−1 a 1).", size: { w: 6, h: 4 }, fits: (r) => isCluster(r) && base(r).silhouette != null },
  { type: "ml-segments", fam: "cluster", icon: "mlseg", label: "Perfiles de segmentos", desc: "Tarjeta por grupo con tamaño, centroide y desviación frente a la media.", size: { w: 24, h: 8 }, fits: isCluster },
  { type: "ml-profile", fam: "cluster", icon: "mlprofile", label: "Perfil z por segmento", desc: "Cuánto se aleja cada grupo de la media en cada variable.", size: { w: 12, h: 8 }, fits: isCluster },
  { type: "ml-sizes", fam: "cluster", icon: "mlsizes", label: "Tamaño de segmentos", desc: "Registros por grupo según el modelo.", size: { w: 12, h: 8 }, fits: isCluster },
  { type: "ml-actualpred", fam: "regression", icon: "mlactual", label: "Real vs predicho", desc: "Dispersión de valores reales frente a estimados, con la diagonal ideal.", size: { w: 12, h: 9 }, fits: (r) => isReg(r) && !!base(r).scatter?.length },
  { type: "ml-importance", fam: "regression", icon: "mlimp", label: "Importancia de variables", desc: "Peso de cada variable (permutación).", size: { w: 12, h: 8 }, fits: (r) => !!base(r)?.importance?.length },
  { type: "ml-coefs", fam: "regression", icon: "mlcoef", label: "Coeficientes", desc: "Coeficientes del modelo lineal o logístico.", size: { w: 12, h: 8 }, fits: (r) => !!base(r)?.coefficients?.length },
  { type: "ml-roc", fam: "classification", icon: "mlroc", label: "Curva ROC", desc: "Verdaderos vs falsos positivos y AUC.", size: { w: 12, h: 9 }, fits: (r) => isCls(r) && !!base(r).roc?.length },
  { type: "ml-confusion", fam: "classification", icon: "mlconf", label: "Matriz de confusión", desc: "Aciertos y errores por clase.", size: { w: 10, h: 8 }, fits: (r) => isCls(r) && !!base(r).confusion },
  { type: "ml-leaderboard", fam: "general", icon: "mlboard", label: "Ranking AutoML", desc: "Comparación de los modelos entrenados por AutoML.", size: { w: 12, h: 9 }, fits: (r) => r?.algorithm === "automl" },
  { type: "ml-forecast", fam: "series", icon: "mlforecast", label: "Pronóstico", desc: "Histórico, ajuste y proyección con banda de 95%.", size: { w: 24, h: 9 }, fits: (r) => r?.algorithm === "forecast" },
  { type: "ml-corr", fam: "explore", icon: "mlcorr", label: "Matriz de correlación", desc: "Pearson entre todas las variables.", size: { w: 12, h: 9 }, fits: (r) => r?.algorithm === "correlation" },
  { type: "ml-pca", fam: "explore", icon: "mlpca", label: "Varianza explicada (PCA)", desc: "Varianza individual y acumulada por componente.", size: { w: 12, h: 8 }, fits: (r) => r?.algorithm === "pca" },
  { type: "ml-anomaly", fam: "explore", icon: "mlanom", label: "Distribución de atípicos", desc: "Histograma con normales y atípicos.", size: { w: 12, h: 8 }, fits: (r) => r?.algorithm === "anomaly" },
  { type: "ml-rules", fam: "explore", icon: "mlrules", label: "Reglas de asociación", desc: "Si… entonces… con soporte, confianza y lift.", size: { w: 24, h: 8 }, fits: (r) => r?.algorithm === "rules" },
  { type: "ml-metrics", fam: "general", icon: "mlmetrics", label: "Métricas del modelo", desc: "Tarjetas con las métricas clave de la ejecución.", size: { w: 24, h: 3 }, fits: () => true },
  { type: "ml-insights", fam: "general", icon: "mlinsight", label: "Lectura del resultado", desc: "Interpretación en lenguaje claro.", size: { w: 12, h: 5 }, fits: () => true },
];
export const getMlView = (type) => ML_VIEWS.find((v) => v.type === type) || null;
export const isMlType = (type) => typeof type === "string" && type.startsWith("ml-");
/** ¿Se puede dibujar esta vista con el resultado r? */
export const viewFits = (type, r) => { const v = getMlView(type); return !!(v && r && v.fits(r)); };

/** Familia "natural" de un resultado (para preseleccionar ejecuciones compatibles). */
export function runFamily(algorithm, task) {
  if (["kmeans", "hierarchical", "dbscan"].includes(algorithm)) return "cluster";
  if (algorithm === "forecast") return "series";
  if (["correlation", "pca", "anomaly", "rules"].includes(algorithm)) return "explore";
  if (algorithm === "logistic" || algorithm === "bayes" || task === "classification") return "classification";
  return "regression";
}

/** ¿Una ejecución (fila de runList, sin cargar su resultado) sirve para la vista? */
export function runMatches(type, run) {
  const v = getMlView(type);
  if (!v || !run) return false;
  let task;
  try { task = JSON.parse(run.params_json || "{}").task; } catch { /* noop */ }
  const fam = runFamily(run.algorithm, task);
  switch (type) {
    case "ml-leaderboard": return run.algorithm === "automl";
    case "ml-forecast": return run.algorithm === "forecast";
    case "ml-corr": return run.algorithm === "correlation";
    case "ml-pca": return run.algorithm === "pca";
    case "ml-anomaly": return run.algorithm === "anomaly";
    case "ml-rules": return run.algorithm === "rules";
    case "ml-silhouette": return run.algorithm === "kmeans" || run.algorithm === "hierarchical";
    case "ml-importance": return (fam === "regression" || fam === "classification") && run.algorithm !== "linear" && !(run.algorithm === "logistic");
    case "ml-coefs": return ["linear", "ridge", "lasso", "poly", "logistic", "automl"].includes(run.algorithm);
    case "ml-actualpred": return fam === "regression";
    default: return v.fam === "general" ? true : fam === v.fam;
  }
}

/* --------------------------------------------------------------------------
   Dibujo
   -------------------------------------------------------------------------- */
const palette = (look) => (look?.mlPalette === "sense" ? PALETTE : COLORS);

function chartOpts(look, extra = {}) {
  const legend = look?.legend !== false;
  return {
    responsive: true, maintainAspectRatio: false, animation: false,
    ...extra,
    plugins: { legend: { display: legend, position: "bottom", labels: { boxWidth: 10, usePointStyle: true, font: { size: 11 } } }, tooltip: { enabled: look?.tooltip !== false } },
  };
}
function mergePlugins(o, plugins) { o.plugins = { ...o.plugins, ...plugins, legend: { ...o.plugins.legend, ...(plugins?.legend || {}) } }; return o; }

function canvasIn(host) {
  host.innerHTML = `<div class="mlv mlv-chart"><canvas></canvas></div>`;
  return host.querySelector("canvas");
}

function chart(host, cfg) {
  if (!window.Chart) { host.innerHTML = `<div class="mlv-msg">Chart.js no está disponible.</div>`; return () => {}; }
  const c = new window.Chart(canvasIn(host), cfg);
  return () => { try { c.destroy(); } catch { /* noop */ } };
}

const quality = (v, good, ok) => (v == null ? "" : v >= good ? "good" : v >= ok ? "mid" : "low");
const metricCard = (label, value, hint, tone) => `<div class="ml-metric ${tone || ""}"><div class="ml-metric-v">${value}</div><div class="ml-metric-l">${esc(label)}</div>${hint ? `<div class="ml-metric-h">${esc(hint)}</div>` : ""}</div>`;

function zbar(z, C) {
  const v = Math.max(-2, Math.min(2, z ?? 0)) / 2, w = Math.abs(v) * 50;
  const style = v >= 0 ? `left:50%;width:${w}%;background:${C[0]}` : `left:${50 - w}%;width:${w}%;background:${C[2]}`;
  return `<span class="ml-zbar" title="z = ${num(z)}"><i style="${style}"></i></span>`;
}

function groupColors(r, C) {
  const kind = r.algorithm;
  return (r.clusters || []).map((c, i) => (kind === "kmeans" ? C[i % C.length] : c.id === 0 ? NOISE : C[(c.id - 1) % C.length]));
}

/**
 * Dibuja la vista `type` del resultado `r` en `host`. Devuelve la función de limpieza.
 * @param {HTMLElement} host
 * @param {string} type
 * @param {object} r resultado completo de la ejecución
 * @param {{look?: object, label?: (f:string)=>string}} opts
 */
export function renderMlView(host, type, r, opts = {}) {
  const look = opts.look || {};
  const L = opts.label || ((f) => f);
  const C = palette(look);
  const b = base(r);
  if (!viewFits(type, r)) {
    host.innerHTML = `<div class="mlv-msg">Esta vista no aplica a una ejecución de <strong>${esc(algoName(r?.algorithm))}</strong>. Elige otra ejecución o cambia el tipo de gráfico ML en Propiedades.</div>`;
    return () => {};
  }

  switch (type) {
    /* ------------------------------ Clusterización ------------------------------ */
    case "ml-clustermap": {
      const cols = groupColors(b, C);
      const datasets = b.clusters.map((c, i) => ({ label: c.name, data: b.projection.filter((p) => p.c === c.id).map((p) => ({ x: p.x, y: p.y })), backgroundColor: cols[i] + "cc", pointRadius: 3.5 }));
      const ex = b.explained ? ` (${pct(b.explained[0])})` : "";
      const ey = b.explained ? ` (${pct(b.explained[1])})` : "";
      return chart(host, { type: "scatter", data: { datasets }, options: chartOpts(look, { scales: { x: { title: { display: true, text: "Componente 1" + ex } }, y: { title: { display: true, text: "Componente 2" + ey } } } }) });
    }
    case "ml-elbow": {
      if (b.algorithm === "kmeans") return chart(host, { type: "line", data: { labels: b.elbow.map((e) => e.k), datasets: [
        { label: "Inercia", data: b.elbow.map((e) => e.inertia), borderColor: C[0], backgroundColor: C[0], yAxisID: "y", tension: 0.2 },
        { label: "Silueta", data: b.elbow.map((e) => e.silhouette), borderColor: C[1], backgroundColor: C[1], yAxisID: "y1", tension: 0.2, borderDash: [5, 4] },
        { label: `k elegido (${b.k})`, data: b.elbow.map((e) => (e.k === b.k ? e.silhouette : null)), borderColor: C[3], backgroundColor: C[3], yAxisID: "y1", pointRadius: 7, showLine: false }] },
        options: chartOpts(look, { scales: { x: { title: { display: true, text: "k (número de grupos)" } }, y: { position: "left", title: { display: true, text: "Inercia" } }, y1: { position: "right", grid: { drawOnChartArea: false }, min: -0.2, max: 1, title: { display: true, text: "Silueta" } } } }) });
      if (b.algorithm === "hierarchical") return chart(host, { type: "bar", data: { labels: b.heights.map((h) => h.k + " grupos"), datasets: [{ label: "Altura al unir", data: b.heights.map((h) => h.height), backgroundColor: b.heights.map((h) => (h.k === b.k ? C[2] : C[0])) }] }, options: mergePlugins(chartOpts(look), { legend: { display: false } }) });
      return chart(host, { type: "line", data: { labels: b.kdistance.map((p) => p.i), datasets: [{ label: "Distancia al k-ésimo vecino", data: b.kdistance.map((p) => p.d), borderColor: C[0], pointRadius: 0, tension: 0.2 }, { label: "eps elegido", data: b.kdistance.map(() => b.eps), borderColor: C[3], borderDash: [5, 4], pointRadius: 0 }] }, options: chartOpts(look, { scales: { x: { title: { display: true, text: "Registros ordenados" } } } }) });
    }
    case "ml-silhouette": {
      const s = b.silhouette;
      const tone = quality(s, 0.5, 0.25);
      const txt = s >= 0.5 ? "Separación fuerte: grupos bien definidos" : s >= 0.25 ? "Estructura razonable, con algo de solapamiento" : "Estructura débil: los grupos se mezclan";
      const pos = ((Math.max(-1, Math.min(1, s)) + 1) / 2) * 100;
      host.innerHTML = `<div class="mlv mlv-sil ${tone}">
        <div class="mlv-sil-v">${num(s)}</div>
        <div class="mlv-sil-l">${esc(txt)}</div>
        <div class="mlv-sil-scale"><span class="z1"></span><span class="z2"></span><span class="z3"></span><span class="z4"></span><i style="left:${pos.toFixed(1)}%"></i></div>
        <div class="mlv-sil-ticks"><span>−1</span><span>0</span><span>0,25</span><span>0,5</span><span>1</span></div>
        <div class="mlv-sil-k">${b.k ?? b.clustersFound} grupos · ${NF0.format(b.n)} registros</div></div>`;
      return () => {};
    }
    case "ml-segments": {
      const cols = groupColors(b, C);
      host.innerHTML = `<div class="mlv mlv-scroll"><div class="ml-seg-grid mlv-seg-grid">${b.clusters.map((c, i) => `
        <div class="ml-seg">
          <div class="ml-seg-h"><span class="ml-dot" style="background:${cols[i]}"></span><strong>${esc(c.name)}</strong></div>
          <div class="ml-seg-size">${NF0.format(c.size)} registros · ${pct(c.share)}</div>
          <div class="ml-bar"><span style="width:${(c.share * 100).toFixed(1)}%;background:${cols[i]}"></span></div>
          <div class="ml-prof">${b.features.map((f) => `<div class="ml-prof-row"><span class="ml-prof-f">${esc(L(f))}</span><span class="ml-prof-v">${num(c.centroid[f])}</span>${zbar(c.profile[f], C)}</div>`).join("")}</div>
        </div>`).join("")}</div></div>`;
      return () => {};
    }
    case "ml-profile": {
      const cols = groupColors(b, C);
      return chart(host, { type: "bar", data: { labels: b.features.map(L), datasets: b.clusters.map((c, i) => ({ label: c.name, data: b.features.map((f) => c.profile[f]), backgroundColor: cols[i] })) },
        options: chartOpts(look, { indexAxis: "y", scales: { x: { title: { display: true, text: "Desviaciones estándar frente a la media (z)" } } } }) });
    }
    case "ml-sizes": {
      const cols = groupColors(b, C);
      return chart(host, { type: "bar", data: { labels: b.clusters.map((c) => c.name), datasets: [{ label: "Registros", data: b.clusters.map((c) => c.size), backgroundColor: cols }] },
        options: mergePlugins(chartOpts(look, { scales: { y: { title: { display: true, text: "Registros" } } } }), { legend: { display: false } }) });
    }

    /* ------------------------------ Supervisado ------------------------------ */
    case "ml-actualpred": {
      const all = b.scatter.flatMap((p) => [p.actual, p.pred]);
      const mn = Math.min(...all), mx = Math.max(...all);
      return chart(host, { type: "scatter", data: { datasets: [
        { label: "Entrenamiento", data: b.scatter.filter((p) => p.set === "train").map((p) => ({ x: p.actual, y: p.pred })), backgroundColor: C[0] + "aa", pointRadius: 3.5 },
        { label: "Prueba", data: b.scatter.filter((p) => p.set === "test").map((p) => ({ x: p.actual, y: p.pred })), backgroundColor: C[2], pointRadius: 5 },
        { type: "line", label: "Predicción perfecta", data: [{ x: mn, y: mn }, { x: mx, y: mx }], borderColor: "#9aa3b2", borderDash: [5, 4], pointRadius: 0 }] },
        options: chartOpts(look, { scales: { x: { title: { display: true, text: "Real" + (b.target ? " · " + L(b.target) : "") } }, y: { title: { display: true, text: "Predicho" } } } }) });
    }
    case "ml-importance":
      return chart(host, { type: "bar", data: { labels: b.importance.map((i) => L(i.name)), datasets: [{ label: "Importancia", data: b.importance.map((i) => +(i.share * 100).toFixed(1)), backgroundColor: C[1] }] },
        options: mergePlugins(chartOpts(look, { indexAxis: "y", scales: { x: { max: 100, title: { display: true, text: "% de la importancia" } } } }), { legend: { display: false } }) });
    case "ml-coefs": {
      const cf = b.coefficients.filter((c) => c.name !== "Intercepto");
      const val = (c) => c.standardized ?? c.coef ?? c.value;
      return chart(host, { type: "bar", data: { labels: cf.map((c) => L(c.name)), datasets: [{ label: cf[0]?.standardized != null ? "Coeficiente estandarizado" : "Coeficiente", data: cf.map(val), backgroundColor: cf.map((c) => (val(c) >= 0 ? C[0] : C[2])) }] },
        options: mergePlugins(chartOpts(look, { indexAxis: "y" }), { legend: { display: false } }) });
    }
    case "ml-roc": {
      const auc = b.metrics?.auc;
      return chart(host, { type: "line", data: { datasets: [
        { label: `Modelo${auc != null ? " (AUC " + num(auc) + ")" : ""}`, data: b.roc.map((p) => ({ x: p.fpr, y: p.tpr })), borderColor: C[0], backgroundColor: C[0] + "22", fill: true, pointRadius: 0 },
        { label: "Azar", data: [{ x: 0, y: 0 }, { x: 1, y: 1 }], borderColor: "#9aa3b2", borderDash: [5, 4], pointRadius: 0 }] },
        options: chartOpts(look, { scales: { x: { type: "linear", min: 0, max: 1, title: { display: true, text: "Falsos positivos" } }, y: { min: 0, max: 1, title: { display: true, text: "Verdaderos positivos" } } } }) });
    }
    case "ml-confusion": {
      const cf = b.confusion;
      host.innerHTML = `<div class="mlv mlv-pad">
        <div class="ml-conf">
          <div></div><div class="ml-conf-h">Predice positivo</div><div class="ml-conf-h">Predice negativo</div>
          <div class="ml-conf-h side">Real positivo</div><div class="ml-conf-c good">${cf.tp}<small>verdaderos +</small></div><div class="ml-conf-c bad">${cf.fn}<small>falsos −</small></div>
          <div class="ml-conf-h side">Real negativo</div><div class="ml-conf-c bad">${cf.fp}<small>falsos +</small></div><div class="ml-conf-c good">${cf.tn}<small>verdaderos −</small></div>
        </div>
        <p class="mlv-foot">Clase positiva: <strong>${esc(b.positive || "")}</strong></p></div>`;
      return () => {};
    }
    case "ml-leaderboard": {
      const cls = r.task === "classification";
      const ok = r.leaderboard.filter((e) => !e.error);
      return chart(host, { type: "bar", data: { labels: ok.map((e) => e.name), datasets: [{ label: r.metric, data: ok.map((e) => (cls ? e.auc ?? e.accuracy : e.rmse)), backgroundColor: ok.map((e) => (e.rank === 1 ? C[1] : C[0])) }] },
        options: mergePlugins(chartOpts(look, { indexAxis: "y", scales: { x: { title: { display: true, text: `${r.metric} (${cls ? "mayor es mejor" : "menor es mejor"})` } } } }), { legend: { display: false } }) });
    }

    /* ------------------------------ Series ------------------------------ */
    case "ml-forecast": {
      const hl = r.history.map((h) => h.label), fl = r.forecast.map((f) => f.label);
      const last = r.history[r.history.length - 1]?.value;
      const padH = (a) => [...a, ...fl.map(() => null)];
      const padF = (a) => [...hl.map((_, i) => (i === hl.length - 1 ? last : null)), ...a];
      return chart(host, { type: "line", data: { labels: [...hl, ...fl], datasets: [
        { label: "Real", data: padH(r.history.map((h) => h.value)), borderColor: C[0], backgroundColor: C[0], tension: 0.15 },
        { label: "Ajuste", data: padH(r.history.map((h) => h.fitted)), borderColor: "#9aa3b2", borderDash: [4, 4], pointRadius: 0 },
        { label: "Pronóstico", data: padF(r.forecast.map((f) => f.value)), borderColor: C[2], backgroundColor: C[2], borderDash: [6, 4] },
        { label: "Máximo (95%)", data: padF(r.forecast.map((f) => f.upper)), borderColor: C[2] + "66", pointRadius: 0, fill: false },
        { label: "Mínimo (95%)", data: padF(r.forecast.map((f) => f.lower)), borderColor: C[2] + "66", pointRadius: 0, fill: "-1", backgroundColor: C[2] + "22" }] }, options: chartOpts(look) });
    }

    /* ------------------------------ Exploración ------------------------------ */
    case "ml-corr":
      host.innerHTML = `<div class="mlv mlv-scroll"><table class="ml-table ml-heat"><thead><tr><th></th>${r.features.map((f) => `<th>${esc(L(f))}</th>`).join("")}</tr></thead>
        <tbody>${r.features.map((f, i) => `<tr><td><strong>${esc(L(f))}</strong></td>${r.pearson[i].map((v) => `<td>${heat(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
      return () => {};
    case "ml-pca":
      return chart(host, { type: "bar", data: { labels: r.components.map((c) => c.name), datasets: [
        { type: "bar", label: "Individual", data: r.components.map((c) => +(c.explained * 100).toFixed(2)), backgroundColor: C[0] },
        { type: "line", label: "Acumulada", data: r.components.map((c) => +(c.cumulative * 100).toFixed(2)), borderColor: C[2], backgroundColor: C[2], tension: 0.2 }] },
        options: chartOpts(look, { scales: { y: { max: 100, title: { display: true, text: "% de varianza" } } } }) });
    case "ml-anomaly":
      return chart(host, { type: "bar", data: { labels: r.histogram.map((x) => num(x.from)), datasets: [{ label: "Normales", data: r.histogram.map((x) => x.count - x.anomalies), backgroundColor: C[0] }, { label: "Atípicos", data: r.histogram.map((x) => x.anomalies), backgroundColor: C[3] }] },
        options: chartOpts(look, { scales: { x: { stacked: true, title: { display: true, text: L(r.features[0]) } }, y: { stacked: true } } }) });
    case "ml-rules": {
      const side = (arr) => arr.map((s) => `<span class="ml-item">${esc(s)}</span>`).join(" <span class='ml-and'>y</span> ");
      host.innerHTML = `<div class="mlv mlv-scroll">${r.rules.length ? `<table class="ml-table"><thead><tr><th>Si…</th><th>Entonces…</th><th>Soporte</th><th>Confianza</th><th>Lift</th><th>Casos</th></tr></thead>
        <tbody>${r.rules.slice(0, 40).map((x) => `<tr><td>${side(x.if)}</td><td>${side(x.then)}</td><td>${pct(x.support)}</td><td>${pct(x.confidence)}</td><td><span class="ml-tag ${x.lift > 1.1 ? "ok" : x.lift < 0.9 ? "bad" : ""}">${num(x.lift)}</span></td><td>${x.count}</td></tr>`).join("")}</tbody></table>` : `<div class="mlv-msg">No hay reglas con estos umbrales.</div>`}</div>`;
      return () => {};
    }

    /* ------------------------------ General ------------------------------ */
    case "ml-metrics": {
      const km = keyMetrics(r);
      const cards = [metricCard("Modelo", esc(r.algorithm === "automl" ? "AutoML · " + (r.bestName || "") : algoName(r.algorithm))), metricCard("Registros", NF0.format(r.n ?? b?.n ?? 0))];
      km.forEach(([k, txt, v]) => {
        const tone = /silueta/i.test(k) ? quality(v, 0.5, 0.25) : /AUC/.test(k) ? quality(v, 0.8, 0.7) : /R²/.test(k) ? quality(v, 0.7, 0.4) : "";
        cards.push(metricCard(k, esc(txt), "", tone));
      });
      host.innerHTML = `<div class="mlv mlv-metrics"><div class="ml-metrics">${cards.join("")}</div></div>`;
      return () => {};
    }
    case "ml-insights": {
      const ins = r.insights || [];
      host.innerHTML = `<div class="mlv mlv-scroll mlv-pad">${ins.length ? `<ul class="mlv-ins">${ins.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : `<div class="mlv-msg">Esta ejecución no trae lectura.</div>`}</div>`;
      return () => {};
    }
    default:
      host.innerHTML = `<div class="mlv-msg">Vista de ML desconocida.</div>`;
      return () => {};
  }
}

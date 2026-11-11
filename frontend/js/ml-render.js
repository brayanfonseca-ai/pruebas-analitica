// ml-render.js — renderizadores de resultados de ML (HTML + gráficos Chart.js).
// renderResult(r, label) -> { html, draw(mkChart) }. label(field) traduce el
// nombre físico al alias visible. exportRows(r, label) -> {name, head, rows}.

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const NF0 = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });
const NF3 = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 3 });
export const num = (v) => (v == null || Number.isNaN(v) ? "—" : Math.abs(v) >= 1000 ? NF0.format(v)
  : v !== 0 && Math.abs(v) < 0.001 ? v.toExponential(2).replace(".", ",") : NF3.format(v));
const ms = (v) => (v == null ? "—" : v < 1 ? "< 1 ms" : NF0.format(v) + " ms");
export const pct = (v) => (v == null ? "—" : (v * 100).toFixed(1) + "%");
export const COLORS = ["#6366f1", "#10b981", "#f59e0b", "#f43f5e", "#8b5cf6", "#06b6d4", "#ec4899", "#64748b", "#0ea5e9", "#84cc16"];
const NOISE = "#a7adbd";

const metric = (label, value, hint, tone) => `<div class="ml-metric ${tone || ""}"><div class="ml-metric-v">${value}</div><div class="ml-metric-l">${esc(label)}</div>${hint ? `<div class="ml-metric-h">${esc(hint)}</div>` : ""}</div>`;
const table = (head, rows, cls = "") => `<div class="ml-scroll"><table class="ml-table ${cls}"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
const canvas = (id, h = 280) => `<div class="ml-chart" style="height:${h}px"><canvas id="${id}"></canvas></div>`;
const box = (title, sub, inner) => `<div class="ml-box"><div class="ml-box-t">${esc(title)}${sub ? `<span>${esc(sub)}</span>` : ""}</div>${inner}</div>`;
const opts = (extra = {}) => ({ responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { position: "bottom", labels: { boxWidth: 10, usePointStyle: true } } }, ...extra });

export function heat(v) {
  if (v == null) return "—";
  const a = Math.min(1, Math.abs(v));
  const bg = v >= 0 ? `rgba(23,41,131,${(a * 0.85).toFixed(2)})` : `rgba(214,165,47,${(a * 0.85).toFixed(2)})`;
  return `<span class="ml-heat-c" style="background:${bg};color:${a > 0.5 ? "#fff" : "#1b2330"}">${num(v)}</span>`;
}
function zbar(z) {
  const v = Math.max(-2, Math.min(2, z ?? 0)) / 2, w = Math.abs(v) * 50;
  const style = v >= 0 ? `left:50%;width:${w}%;background:#6366f1` : `left:${50 - w}%;width:${w}%;background:#d6a52f`;
  return `<span class="ml-zbar" title="z = ${num(z)}"><i style="${style}"></i></span>`;
}
const quality = (v, good, ok) => (v == null ? "" : v >= good ? "good" : v >= ok ? "mid" : "low");

let seq = 0;
const uid = (p) => `${p}${++seq}`;

/* ============================ Despachador ============================ */
export function renderResult(r, label = (f) => f) {
  const L = label;
  switch (r.algorithm) {
    case "kmeans": return clusters(r, L, "kmeans");
    case "hierarchical": return clusters(r, L, "hierarchical");
    case "dbscan": return clusters(r, L, "dbscan");
    case "pca": return pcaR(r, L);
    case "correlation": return corrR(r, L);
    case "anomaly": return anomR(r, L);
    case "rules": return rulesR(r, L);
    case "forecast": return fcR(r, L);
    case "linear": return linearR(r, L);
    // La logística "clásica" trae coeficientes con razón de momios; la de AutoML usa el motor genérico.
    case "logistic": return r.coefficients?.length ? logisticR(r, L) : clsSup(r, L);
    case "automl": return automlR(r, L);
    default: return r.task === "classification" ? clsSup(r, L) : regSup(r, L);
  }
}

/* ============================ Segmentación ============================ */
function clusters(r, L, kind) {
  const ids = { sc: uid("c"), aux: uid("c") };
  const groups = r.clusters || [];
  const colorOf = (id) => (id === 0 ? NOISE : COLORS[(id - 1) % COLORS.length]);
  const groupColor = (c, i) => (kind === "kmeans" ? COLORS[i % COLORS.length] : colorOf(c.id));
  let head;
  if (kind === "kmeans") head = [metric("Grupos", r.k), metric("Silueta", num(r.silhouette), r.silhouette >= 0.5 ? "separación fuerte" : r.silhouette >= 0.25 ? "razonable" : "débil", quality(r.silhouette, 0.5, 0.25)), metric("Registros", NF0.format(r.n)), metric("Inercia", num(r.inertia))];
  else if (kind === "hierarchical") head = [metric("Grupos", r.k), metric("Silueta", num(r.silhouette), "", quality(r.silhouette, 0.5, 0.25)), metric("Enlace", esc({ ward: "Ward", average: "Promedio", complete: "Completo", single: "Simple" }[r.linkage] || r.linkage)), metric("Registros", NF0.format(r.n))];
  else head = [metric("Grupos densos", r.clustersFound), metric("Ruido", NF0.format(r.noise), pct(r.noise / r.n)), metric("Radio eps", num(r.eps)), metric("Mín. vecinos", r.minPts)];
  const auxTitle = kind === "kmeans" ? ["Elección de k", "inercia y silueta"] : kind === "hierarchical" ? ["Altura de fusión", "saltos grandes = grupos separados"] : ["Distancia al k-ésimo vecino", "el codo sugiere eps"];
  const html = `
    <div class="ml-metrics">${head.join("")}</div>
    <div class="ml-two">
      ${box("Mapa de grupos", r.explained ? `PC1 ${pct(r.explained[0])} · PC2 ${pct(r.explained[1])}` : "proyección en 2 componentes", canvas(ids.sc, 300))}
      ${box(auxTitle[0], auxTitle[1], canvas(ids.aux, 300))}
    </div>
    <div class="ml-seg-grid">${groups.map((c, i) => `
      <div class="ml-seg">
        <div class="ml-seg-h"><span class="ml-dot" style="background:${groupColor(c, i)}"></span><strong>${esc(c.name)}</strong></div>
        <div class="ml-seg-size">${NF0.format(c.size)} registros · ${pct(c.share)}</div>
        <div class="ml-bar"><span style="width:${(c.share * 100).toFixed(1)}%;background:${groupColor(c, i)}"></span></div>
        <div class="ml-prof">${r.features.map((f) => `<div class="ml-prof-row"><span class="ml-prof-f">${esc(L(f))}</span><span class="ml-prof-v">${num(c.centroid[f])}</span>${zbar(c.profile[f])}</div>`).join("")}</div>
      </div>`).join("")}</div>
    ${r.sample?.length ? box("Muestra de asignaciones", "", table(["Fila", ...r.features.map(L), "Grupo"], r.sample.map((s) => [s.row, ...r.features.map((f) => num(s.values[f])), esc(s.name || (groups.find((g) => g.id === s.cluster)?.name ?? s.cluster))]))) : ""}`;
  const draw = (mk) => {
    const datasets = groups.map((c, i) => {
      const id = kind === "kmeans" ? c.id : c.id;
      return { label: c.name, data: r.projection.filter((p) => p.c === id).map((p) => ({ x: p.x, y: p.y })), backgroundColor: groupColor(c, i) + "cc", pointRadius: 4 };
    });
    mk(ids.sc, { type: "scatter", data: { datasets }, options: opts({ scales: { x: { title: { display: true, text: "Componente 1" } }, y: { title: { display: true, text: "Componente 2" } } } }) });
    if (kind === "kmeans") mk(ids.aux, { type: "line", data: { labels: r.elbow.map((e) => e.k), datasets: [
      { label: "Inercia", data: r.elbow.map((e) => e.inertia), borderColor: COLORS[0], backgroundColor: COLORS[0], yAxisID: "y", tension: 0.2 },
      { label: "Silueta", data: r.elbow.map((e) => e.silhouette), borderColor: COLORS[1], backgroundColor: COLORS[1], yAxisID: "y1", tension: 0.2, borderDash: [5, 4] }] },
      options: opts({ scales: { x: { title: { display: true, text: "k" } }, y: { position: "left" }, y1: { position: "right", grid: { drawOnChartArea: false }, min: -0.2, max: 1 } } }) });
    else if (kind === "hierarchical") mk(ids.aux, { type: "bar", data: { labels: r.heights.map((h) => h.k + " grupos"), datasets: [{ label: "Altura al unir", data: r.heights.map((h) => h.height), backgroundColor: r.heights.map((h) => (h.k === r.k ? COLORS[2] : COLORS[0])) }] }, options: opts({ plugins: { legend: { display: false } } }) });
    else mk(ids.aux, { type: "line", data: { labels: r.kdistance.map((p) => p.i), datasets: [{ label: "Distancia", data: r.kdistance.map((p) => p.d), borderColor: COLORS[0], pointRadius: 0, tension: 0.2 }, { label: "eps elegido", data: r.kdistance.map(() => r.eps), borderColor: COLORS[3], borderDash: [5, 4], pointRadius: 0 }] }, options: opts({ scales: { x: { title: { display: true, text: "Registros ordenados" } } } }) });
  };
  return { html, draw };
}

/* ============================ Exploración ============================ */
function pcaR(r, L) {
  const ids = { v: uid("c"), p: uid("c") };
  const k = Math.min(4, r.components.length);
  const html = `
    <div class="ml-metrics">${metric("Variables", r.features.length)}${metric("Componentes al 80%", r.components80)}${metric("PC1 explica", pct(r.components[0].explained))}${metric("PC1 + PC2", pct(r.components[0].explained + (r.components[1]?.explained || 0)))}</div>
    <div class="ml-two">${box("Varianza explicada", "", canvas(ids.v))}${box("Proyección en PC1 y PC2", "", canvas(ids.p))}</div>
    ${box("Cargas por componente", "peso de cada variable", table(["Variable", ...r.components.slice(0, k).map((c) => `${c.name} (${pct(c.explained)})`)], r.features.map((f) => [esc(L(f)), ...r.components.slice(0, k).map((c) => heat(c.loadings[f]))]), "ml-heat"))}`;
  const draw = (mk) => {
    mk(ids.v, { type: "bar", data: { labels: r.components.map((c) => c.name), datasets: [
      { type: "bar", label: "Individual", data: r.components.map((c) => +(c.explained * 100).toFixed(2)), backgroundColor: COLORS[0] },
      { type: "line", label: "Acumulada", data: r.components.map((c) => +(c.cumulative * 100).toFixed(2)), borderColor: COLORS[2], backgroundColor: COLORS[2], tension: 0.2 }] },
      options: opts({ scales: { y: { max: 100, title: { display: true, text: "% de varianza" } } } }) });
    mk(ids.p, { type: "scatter", data: { datasets: [{ label: "Registros", data: r.projection, backgroundColor: COLORS[0] + "aa", pointRadius: 4 }] }, options: opts({ plugins: { legend: { display: false } }, scales: { x: { title: { display: true, text: "PC1" } }, y: { title: { display: true, text: "PC2" } } } }) });
  };
  return { html, draw };
}

function corrR(r, L) {
  const html = `
    <div class="ml-metrics">${metric("Variables", r.features.length)}${metric("Pares", r.pairs.length)}${metric("Relación más fuerte", num(r.pairs[0]?.r), r.pairs[0] ? `${L(r.pairs[0].a)} · ${L(r.pairs[0].b)}` : "")}</div>
    ${box("Matriz de Pearson", "", table(["", ...r.features.map(L)], r.features.map((f, i) => [`<strong>${esc(L(f))}</strong>`, ...r.pearson[i].map(heat)]), "ml-heat"))}
    ${box("Matriz de Spearman", "por rangos, robusta a valores extremos", table(["", ...r.features.map(L)], r.features.map((f, i) => [`<strong>${esc(L(f))}</strong>`, ...r.spearman[i].map(heat)]), "ml-heat"))}
    ${box("Pares ordenados por fuerza", "", table(["Variable A", "Variable B", "Pearson", "Spearman", "R²", "Fuerza", "Significativa"], r.pairs.slice(0, 20).map((p) => [esc(L(p.a)), esc(L(p.b)), heat(p.r), num(p.spearman), num(p.r2), `${esc(p.strength)} ${esc(p.direction)}`, p.significant ? `<span class="ml-tag ok">Sí</span>` : `<span class="ml-tag">No</span>`])))}`;
  return { html };
}

function anomR(r, L) {
  const ids = { h: uid("c"), s: uid("c") };
  const f0 = L(r.features[0]);
  const html = `
    <div class="ml-metrics">${metric("Registros", NF0.format(r.n))}${metric("Atípicos", r.total, "", r.total ? "mid" : "good")}${metric("% del total", pct(r.total / r.n))}${metric("Umbral Z", num(r.threshold))}</div>
    <div class="ml-two">${box(`Distribución de ${f0}`, "", canvas(ids.h))}${box(r.features.length > 1 ? `${f0} vs ${L(r.features[1])}` : `${f0} por fila`, "", canvas(ids.s))}</div>
    ${box("Registros atípicos", "más extremos primero", r.anomalies.length ? table(["Fila", ...r.features.map(L), "Puntaje σ", "Motivo"], r.anomalies.slice(0, 20).map((a) => [a.row, ...r.features.map((f) => num(a.values[f])), num(a.score), a.reasons.map((x) => `${esc(L(x.feature))} (${esc(x.rule)})`).join(", ")])) : `<p class="ml-muted ml-pad">Ningún registro supera el umbral.</p>`)}
    ${box("Estadísticos y límites", "", table(["Variable", "Media", "Desv.", "Mín", "Q1", "Mediana", "Q3", "Máx", "Límite inf.", "Límite sup."], r.stats.map((s) => [esc(L(s.feature)), num(s.mean), num(s.sd), num(s.min), num(s.q1), num(s.median), num(s.q3), num(s.max), num(s.lowFence), num(s.highFence)])))}`;
  const draw = (mk) => {
    mk(ids.h, { type: "bar", data: { labels: r.histogram.map((b) => num(b.from)), datasets: [{ label: "Normales", data: r.histogram.map((b) => b.count - b.anomalies), backgroundColor: COLORS[0] }, { label: "Atípicos", data: r.histogram.map((b) => b.anomalies), backgroundColor: COLORS[3] }] }, options: opts({ scales: { x: { stacked: true }, y: { stacked: true } } }) });
    mk(ids.s, { type: "scatter", data: { datasets: [{ label: "Normales", data: r.scatter.filter((p) => !p.a).map((p) => ({ x: p.x, y: p.y })), backgroundColor: COLORS[0] + "99", pointRadius: 4 }, { label: "Atípicos", data: r.scatter.filter((p) => p.a).map((p) => ({ x: p.x, y: p.y })), backgroundColor: COLORS[3], pointRadius: 6 }] }, options: opts() });
  };
  return { html, draw };
}

function rulesR(r, L) {
  const id = uid("c");
  const side = (arr) => arr.map((s) => `<span class="ml-item">${esc(s)}</span>`).join(" <span class='ml-and'>y</span> ");
  const html = `
    <div class="ml-metrics">${metric("Reglas", r.total)}${metric("Registros", NF0.format(r.n))}${metric("Soporte mínimo", pct(r.minSupport))}${metric("Confianza mínima", pct(r.minConfidence))}</div>
    ${box("Reglas encontradas", "ordenadas por lift", r.rules.length ? table(["Si…", "Entonces…", "Soporte", "Confianza", "Lift", "Casos"], r.rules.slice(0, 40).map((x) => [side(x.if), side(x.then), pct(x.support), pct(x.confidence), `<span class="ml-tag ${x.lift > 1.1 ? "ok" : x.lift < 0.9 ? "bad" : ""}">${num(x.lift)}</span>`, x.count])) : `<p class="ml-muted ml-pad">No hay reglas con estos umbrales.</p>`)}
    ${box("Valores más frecuentes", "soporte individual", canvas(id, Math.max(220, r.items.length * 24)))}`;
  const draw = (mk) => mk(id, { type: "bar", data: { labels: r.items.map((i) => i.item), datasets: [{ label: "Soporte", data: r.items.map((i) => +(i.support * 100).toFixed(1)), backgroundColor: COLORS[0] }] }, options: opts({ indexAxis: "y", plugins: { legend: { display: false } }, scales: { x: { title: { display: true, text: "% de registros" } } } }) });
  return { html, draw };
}

/* ============================ Series ============================ */
function fcR(r, L) {
  const id = uid("c");
  const html = `
    <div class="ml-metrics">${metric("Periodos históricos", r.n)}${metric("Mejor modelo", esc(r.best))}${metric("Próximo periodo", num(r.forecast[0]?.value))}${metric("Horizonte", r.horizon)}</div>
    ${(r.warnings || []).map((w) => `<div class="ml-note warn">${esc(w)}</div>`).join("")}
    ${box(`${L(r.measure)} por ${L(r.period)}`, "", canvas(id, 320))}
    <div class="ml-two">
      ${box("Pronóstico", "banda de 95%", table(["Periodo", "Valor", "Mínimo", "Máximo"], r.forecast.map((f) => [esc(f.label), `<strong>${num(f.value)}</strong>`, num(f.lower), num(f.upper)])))}
      ${box("Comparación de modelos", "", table(["Modelo", "RMSE", "MAE", "Evaluación"], r.models.map((m) => [m.name === r.best ? `<strong>${esc(m.name)}</strong>` : esc(m.name), num(m.rmse), num(m.mae), m.evaluation === "holdout" ? "Periodos reservados" : "Sobre los mismos datos"])))}
    </div>`;
  const draw = (mk) => {
    const hl = r.history.map((h) => h.label), fl = r.forecast.map((f) => f.label);
    const last = r.history[r.history.length - 1].value;
    const padH = (a) => [...a, ...fl.map(() => null)];
    const padF = (a) => [...hl.map((_, i) => (i === hl.length - 1 ? last : null)), ...a];
    mk(id, { type: "line", data: { labels: [...hl, ...fl], datasets: [
      { label: "Real", data: padH(r.history.map((h) => h.value)), borderColor: COLORS[0], backgroundColor: COLORS[0], tension: 0.15 },
      { label: "Ajuste", data: padH(r.history.map((h) => h.fitted)), borderColor: "#9aa3b2", borderDash: [4, 4], pointRadius: 0 },
      { label: "Pronóstico", data: padF(r.forecast.map((f) => f.value)), borderColor: COLORS[2], backgroundColor: COLORS[2], borderDash: [6, 4] },
      { label: "Máximo", data: padF(r.forecast.map((f) => f.upper)), borderColor: COLORS[2] + "66", pointRadius: 0, fill: false },
      { label: "Mínimo", data: padF(r.forecast.map((f) => f.lower)), borderColor: COLORS[2] + "66", pointRadius: 0, fill: "-1", backgroundColor: COLORS[2] + "22" }] }, options: opts() });
  };
  return { html, draw };
}

/* ============================ Supervisado ============================ */
function actualPred(id, r, mk) {
  const all = r.scatter.flatMap((p) => [p.actual, p.pred]);
  const mn = Math.min(...all), mx = Math.max(...all);
  mk(id, { type: "scatter", data: { datasets: [
    { label: "Entrenamiento", data: r.scatter.filter((p) => p.set === "train").map((p) => ({ x: p.actual, y: p.pred })), backgroundColor: COLORS[0] + "aa", pointRadius: 4 },
    { label: "Prueba", data: r.scatter.filter((p) => p.set === "test").map((p) => ({ x: p.actual, y: p.pred })), backgroundColor: COLORS[2], pointRadius: 6 },
    { type: "line", label: "Predicción perfecta", data: [{ x: mn, y: mn }, { x: mx, y: mx }], borderColor: "#9aa3b2", borderDash: [5, 4], pointRadius: 0 }] },
    options: opts({ scales: { x: { title: { display: true, text: "Real" } }, y: { title: { display: true, text: "Predicho" } } } }) });
}
function importanceChart(id, r, L, mk) {
  mk(id, { type: "bar", data: { labels: r.importance.map((i) => L(i.name)), datasets: [{ label: "Importancia", data: r.importance.map((i) => +(i.share * 100).toFixed(1)), backgroundColor: COLORS[1] }] }, options: opts({ indexAxis: "y", plugins: { legend: { display: false } }, scales: { x: { max: 100, title: { display: true, text: "% de la importancia (permutación)" } } } }) });
}
function rocChart(id, r, mk) {
  mk(id, { type: "line", data: { datasets: [{ label: "Modelo", data: (r.roc || []).map((p) => ({ x: p.fpr, y: p.tpr })), borderColor: COLORS[0], backgroundColor: COLORS[0] + "22", fill: true, pointRadius: 0 }, { label: "Azar", data: [{ x: 0, y: 0 }, { x: 1, y: 1 }], borderColor: "#9aa3b2", borderDash: [5, 4], pointRadius: 0 }] },
    options: opts({ scales: { x: { type: "linear", min: 0, max: 1, title: { display: true, text: "Falsos positivos" } }, y: { min: 0, max: 1, title: { display: true, text: "Verdaderos positivos" } } } }) });
}
const confusion = (cf) => `
  <div class="ml-conf">
    <div></div><div class="ml-conf-h">Predice positivo</div><div class="ml-conf-h">Predice negativo</div>
    <div class="ml-conf-h side">Real positivo</div><div class="ml-conf-c good">${cf.tp}<small>verdaderos +</small></div><div class="ml-conf-c bad">${cf.fn}<small>falsos −</small></div>
    <div class="ml-conf-h side">Real negativo</div><div class="ml-conf-c bad">${cf.fp}<small>falsos +</small></div><div class="ml-conf-c good">${cf.tn}<small>verdaderos −</small></div>
  </div>`;

function regSup(r, L) {
  const ids = { s: uid("c"), i: uid("c") };
  const t = r.test || r.train;
  const gap = r.test ? r.train.r2 - r.test.r2 : null;
  const html = `
    <div class="ml-metrics">
      ${metric("R² " + (r.test ? "(prueba)" : "(entrenamiento)"), num(t.r2), "variación explicada", quality(t.r2, 0.7, 0.4))}
      ${metric("RMSE", num(t.rmse), "error típico")}
      ${metric("MAE", num(t.mae), "error absoluto medio")}
      ${metric("R² entrenamiento", num(r.train.r2), gap != null ? (gap > 0.12 ? "posible sobreajuste" : "sin sobreajuste notable") : "", gap != null && gap > 0.12 ? "low" : "")}
    </div>
    <div class="ml-two">${box("Real vs predicho", "", canvas(ids.s, 300))}${box("Importancia de variables", "caída de rendimiento al desordenar cada variable", canvas(ids.i, 300))}</div>
    ${r.coefficients ? box("Coeficientes", "en unidades originales", table(["Término", "Coeficiente", "Peso estandarizado"], r.coefficients.map((c) => [esc(c.name === "Intercepto" ? c.name : L(c.name)), num(c.value), c.standardized == null ? "—" : c.zero ? `<span class="ml-tag">descartado</span>` : heat(c.standardized)]), "ml-heat")) : ""}`;
  return { html, draw: (mk) => { actualPred(ids.s, r, mk); importanceChart(ids.i, r, L, mk); } };
}

function clsSup(r, L) {
  const ids = { roc: uid("c"), i: uid("c") };
  const m = r.metrics;
  const html = `
    <div class="ml-metrics">
      ${metric("Exactitud", pct(m.accuracy), "base " + pct(m.baseline), m.accuracy > m.baseline + 0.02 ? "good" : "low")}
      ${metric("Precisión", pct(m.precision))}${metric("Sensibilidad", pct(m.recall))}${metric("F1", num(m.f1))}
      ${metric("AUC", num(m.auc), "", quality(m.auc, 0.8, 0.7))}
    </div>
    <p class="ml-foot ml-top">Clase positiva: <strong>${esc(r.positive)}</strong> · evaluado sobre ${esc(r.evaluatedOn)}${r.test ? ` (${r.test.n} filas)` : ""}.</p>
    <div class="ml-two">${box("Matriz de confusión", "", confusion(r.confusion))}${box("Curva ROC", "", canvas(ids.roc, 260))}</div>
    ${box("Importancia de variables", "caída del AUC al desordenar cada variable", canvas(ids.i, Math.max(200, r.importance.length * 34)))}`;
  return { html, draw: (mk) => { rocChart(ids.roc, r, mk); importanceChart(ids.i, r, L, mk); } };
}

function linearR(r, L) {
  const id = uid("c");
  const t = r.test || r.train;
  const html = `
    <div class="ml-metrics">${metric("R² " + (r.test ? "(prueba)" : "(entrenamiento)"), num(t.r2), "variación explicada", quality(t.r2, 0.7, 0.4))}${metric("R² ajustado", num(r.adjR2))}${metric("RMSE", num(t.rmse), "error típico")}${metric("MAE", num(t.mae))}</div>
    <div class="ml-eq"><span>Ecuación</span><code>${esc(r.equation)}</code></div>
    <div class="ml-two">${box("Real vs predicho", "", canvas(id, 300))}
      ${box("Coeficientes", "", table(["Variable", "Coef.", "Error est.", "t", "Peso estd.", "Signif."], r.coefficients.map((c) => [esc(c.name === "Intercepto" ? c.name : L(c.name)), num(c.value), num(c.stdError), num(c.t), c.name === "Intercepto" ? "—" : num(c.standardized), c.significant ? `<span class="ml-tag ok">Sí</span>` : `<span class="ml-tag">No</span>`])))}</div>`;
  return { html, draw: (mk) => actualPred(id, r, mk) };
}

function logisticR(r, L) {
  const id = uid("c");
  const m = r.metrics;
  const html = `
    <div class="ml-metrics">${metric("Exactitud", pct(m.accuracy), "base " + pct(m.baseline), m.accuracy > m.baseline + 0.02 ? "good" : "low")}${metric("Precisión", pct(m.precision))}${metric("Sensibilidad", pct(m.recall))}${metric("F1", num(m.f1))}${metric("AUC", num(m.auc), "", quality(m.auc, 0.8, 0.7))}</div>
    <p class="ml-foot ml-top">Clase positiva: <strong>${esc(r.positive)}</strong> · evaluado sobre ${esc(r.evaluatedOn)}.</p>
    <div class="ml-two">${box("Matriz de confusión", "", confusion(r.confusion))}${box("Curva ROC", "", canvas(id, 260))}</div>
    ${box("Influencia de cada variable", "", table(["Variable", "Coef. estandarizado", "Razón de momios por +1σ"], r.coefficients.map((c) => [esc(L(c.name)), heat(c.coef), num(c.oddsRatio)]), "ml-heat"))}`;
  return { html, draw: (mk) => rocChart(id, r, mk) };
}

function automlR(r, L) {
  const id = uid("c");
  const cls = r.task === "classification";
  const ok = r.leaderboard.filter((e) => !e.error);
  const head = cls ? ["#", "Modelo", "AUC", "Exactitud", "F1", "Precisión", "Sensibilidad", "Exactitud entren.", "Tiempo"] : ["#", "Modelo", "RMSE", "MAE", "R²", "R² entren.", "Tiempo"];
  const rows = r.leaderboard.map((e) => e.error
    ? ["—", esc(e.name), `<span class="ml-tag bad">${esc(e.error)}</span>`, ...Array(head.length - 3).fill("")]
    : cls ? [e.rank, e.rank === 1 ? `<strong>${esc(e.name)}</strong> <span class="ml-tag ok">ganador</span>` : esc(e.name), num(e.auc), pct(e.accuracy), num(e.f1), pct(e.precision), pct(e.recall), pct(e.trainAccuracy), ms(e.trainMs)]
      : [e.rank, e.rank === 1 ? `<strong>${esc(e.name)}</strong> <span class="ml-tag ok">ganador</span>` : esc(e.name), num(e.rmse), num(e.mae), num(e.r2), num(e.trainR2), ms(e.trainMs)]);
  const best = renderResult(r.best, L);
  const html = `
    <div class="ml-metrics">${metric("Modelos comparados", r.leaderboard.length)}${metric("Ganador", esc(r.bestName))}${metric("Métrica de selección", r.metric)}${metric(cls ? "AUC del ganador" : "RMSE del ganador", num(cls ? ok[0]?.auc : ok[0]?.rmse))}</div>
    ${box("Tabla de posiciones", "misma partición de entrenamiento y prueba para todos", table(head, rows, "ml-full"))}
    ${box(r.metric + " por modelo", cls ? "mayor es mejor" : "menor es mejor", canvas(id, Math.max(240, ok.length * 32)))}
    <div class="ml-sub-h">Detalle del modelo ganador · ${esc(r.bestName)}</div>
    ${best.html}`;
  const draw = (mk) => {
    mk(id, { type: "bar", data: { labels: ok.map((e) => e.name), datasets: [{ label: r.metric, data: ok.map((e) => (cls ? e.auc ?? e.accuracy : e.rmse)), backgroundColor: ok.map((e) => (e.rank === 1 ? COLORS[1] : COLORS[0])) }] }, options: opts({ indexAxis: "y", plugins: { legend: { display: false } } }) });
    best.draw?.(mk);
  };
  return { html, draw };
}

/* ============================ Exportación ============================ */
export function exportRows(r, L = (f) => f) {
  switch (r.algorithm) {
    case "kmeans": case "hierarchical": case "dbscan":
      return { name: `${r.algorithm}_grupos`, head: ["Grupo", "Registros", "Participación", ...r.features.map(L)], rows: r.clusters.map((c) => [c.name, c.size, c.share, ...r.features.map((f) => c.centroid[f])]) };
    case "pca": return { name: "pca_componentes", head: ["Componente", "Varianza", "Acumulada", ...r.features.map(L)], rows: r.components.map((c) => [c.name, c.explained, c.cumulative, ...r.features.map((f) => c.loadings[f])]) };
    case "correlation": return { name: "correlaciones", head: ["A", "B", "Pearson", "Spearman", "R2", "Fuerza"], rows: r.pairs.map((p) => [L(p.a), L(p.b), p.r, p.spearman, p.r2, p.strength]) };
    case "anomaly": return { name: "anomalias", head: ["Fila", ...r.features.map(L), "Puntaje"], rows: r.anomalies.map((a) => [a.row, ...r.features.map((f) => a.values[f]), a.score]) };
    case "rules": return { name: "reglas", head: ["Si", "Entonces", "Soporte", "Confianza", "Lift", "Casos"], rows: r.rules.map((x) => [x.if.join(" y "), x.then.join(" y "), x.support, x.confidence, x.lift, x.count]) };
    case "forecast": return { name: "pronostico", head: ["Periodo", "Valor", "Mínimo", "Máximo"], rows: r.forecast.map((f) => [f.label, f.value, f.lower, f.upper]) };
    case "automl": return { name: "automl_posiciones", head: ["Posición", "Modelo", "RMSE", "MAE", "R2", "AUC", "Exactitud", "F1"], rows: r.leaderboard.map((e) => [e.rank ?? "", e.name, e.rmse ?? "", e.mae ?? "", e.r2 ?? "", e.auc ?? "", e.accuracy ?? "", e.f1 ?? ""]) };
    default:
      if (r.task === "classification" || r.algorithm === "logistic") return { name: `${r.algorithm}_metricas`, head: ["Métrica", "Valor"], rows: Object.entries(r.metrics).filter(([, v]) => typeof v === "number").map(([k, v]) => [k, v]) };
      return { name: `${r.algorithm}_predicciones`, head: ["Real", "Predicho", "Conjunto"], rows: (r.scatter || []).map((p) => [p.actual, p.pred, p.set]) };
  }
}

export function downloadCsv(name, head, rows) {
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [head.map(q).join(","), ...rows.map((r) => r.map(q).join(","))].join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name + ".csv"; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Métricas clave de un resultado: [etiqueta, texto, valor numérico|null] (para comparar ejecuciones). */
export function keyMetrics(r) {
  const out = [];
  const add = (k, v, f = num) => out.push([k, v == null ? "—" : f(v), typeof v === "number" ? v : null]);
  if (r.algorithm === "automl") return [["Ganador", r.bestName, null], ...keyMetrics(r.best)];
  if (r.task === "classification" || r.algorithm === "logistic") { const m = r.metrics; add("AUC", m.auc); add("Exactitud", m.accuracy, pct); add("F1", m.f1); add("Precisión", m.precision, pct); add("Sensibilidad", m.recall, pct); return out; }
  if (r.task === "regression" || r.algorithm === "linear") { const t = r.test || r.train; add("R²", t.r2); add("RMSE", t.rmse); add("MAE", t.mae); return out; }
  if (["kmeans", "hierarchical"].includes(r.algorithm)) { add("Grupos", r.k); add("Silueta", r.silhouette); return out; }
  if (r.algorithm === "dbscan") { add("Grupos", r.clustersFound); add("Ruido", r.noise); add("eps", r.eps); return out; }
  if (r.algorithm === "pca") { add("Comp. al 80%", r.components80); add("PC1", r.components[0]?.explained, pct); return out; }
  if (r.algorithm === "anomaly") { add("Atípicos", r.total); return out; }
  if (r.algorithm === "rules") { add("Reglas", r.total); return out; }
  if (r.algorithm === "forecast") { add("Próximo", r.forecast[0]?.value); out.push(["Modelo", r.best, null]); return out; }
  if (r.algorithm === "correlation") { add("|r| máx", r.pairs[0] ? Math.abs(r.pairs[0].r) : null); return out; }
  return out;
}

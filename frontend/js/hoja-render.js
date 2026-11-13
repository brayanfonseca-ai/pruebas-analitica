// hoja-render.js — dibuja el contenido de un objeto de la Hoja a partir de lo
// que devuelve el motor Python. No calcula agregaciones: solo ordena/limita la
// PRESENTACIÓN del resultado (orden, Top N) y pinta con Chart.js o HTML.

import { PALETTE, themeColor } from "./chart-types.js";

const NF = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 });
export const fmt = (v) =>
  v === null || v === undefined || Number.isNaN(v) ? "-" : typeof v === "number" ? NF.format(v) : String(v);

const NF_INT = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });
const NF_PCT = new Intl.NumberFormat("es-CO", { style: "percent", maximumFractionDigits: 1 });
const NF_MONEY = new Intl.NumberFormat("es-CO", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

/**
 * Formatea un valor de medida según el "Formato numérico" del ítem.
 * @param {*} v
 * @param {"auto"|"number"|"integer"|"percent"|"money"} [mode]
 * @returns {string}
 */
export function fmtAs(v, mode) {
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  if (typeof v !== "number") return String(v);
  switch (mode) {
    case "integer": return NF_INT.format(v);
    case "percent": return NF_PCT.format(v > 1.5 ? v / 100 : v);
    case "money": return NF_MONEY.format(v);
    case "number": return NF.format(v);
    default: return NF.format(v);
  }
}

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* --------------------------------------------------------------------------
   Consulta: traduce los props del objeto a la especificación del motor.
   resolve(item) -> {table, field, agg?} | null (null = no resuelto todavía).
   -------------------------------------------------------------------------- */
export function buildQuery(def, props, resolve, selections) {
  const dims = props.dims.map(resolve).filter(Boolean);
  const measures = props.measures
    .map((m) => {
      const r = resolve(m);
      if (!r) return null;
      const spec = { table: r.table, field: r.field, agg: r.agg || "sum", label: m.label || r.label || r.field };
      // Medida compuesta (aritmética entre agregaciones, Count DISTINCT…): el motor necesita la fórmula y sus partes.
      if (r.formula && r.parts) { spec.formula = r.formula; spec.parts = r.parts; }
      return spec;
    })
    .filter(Boolean);
  if (!measures.length) return null;
  const spec = { measures, chart_type: def.type, selections: mergeSelections(selections, props.filters) };
  if (def.roles.dims.max > 0 && dims[0]) {
    spec.dimension = { table: dims[0].table, field: dims[0].field };
    if (dims[0].expr) spec.dimension.expr = dims[0].expr; // dimensión calculada: el motor la evalúa por fila
  }
  return spec;
}

/** Une selecciones globales con los filtros propios del objeto (intersección por campo). */
export function mergeSelections(global, filters) {
  const out = {};
  Object.entries(global || {}).forEach(([k, v]) => { if (v && v.length) out[k] = [...v]; });
  (filters || []).forEach((f) => {
    if (!f.field || !f.values || !f.values.length) return;
    out[f.field] = out[f.field] ? out[f.field].filter((v) => f.values.includes(v)) : [...f.values];
  });
  return out;
}

/* --------------------------------------------------------------------------
   Orden y límite (presentación)
   -------------------------------------------------------------------------- */
function shape(result) {
  const labels = result.labels || [];
  const series = result.series
    ? result.series.map((s) => ({ label: s.label, values: s.values }))
    : [{ label: "", values: result.values || [] }];
  return { labels, series };
}

export function applySortLimit(result, props) {
  const { labels, series } = shape(result);
  let idx = labels.map((_, i) => i);
  const { by, dir } = props.sort || {};
  const sign = dir === "desc" ? -1 : 1;
  if (by === "dim") {
    if (props.sort?.numeric) {
      idx.sort((a, b) => sign * ((Number(labels[a]) || 0) - (Number(labels[b]) || 0)));
    } else {
      idx.sort((a, b) => sign * String(labels[a]).localeCompare(String(labels[b]), "es", { numeric: true }));
    }
  } else if (by === "measure") {
    idx.sort((a, b) => sign * ((series[0].values[a] ?? 0) - (series[0].values[b] ?? 0)));
  } else if (by === "auto" && props._autoSortMeasure) {
    idx.sort((a, b) => (series[0].values[b] ?? 0) - (series[0].values[a] ?? 0));
  }
  const limit = Number(props.addons?.limit) || 0;
  if (limit > 0) idx = idx.slice(0, limit);
  return {
    labels: idx.map((i) => labels[i]),
    series: series.map((s) => ({ label: s.label, values: idx.map((i) => s.values[i]) })),
  };
}

/* --------------------------------------------------------------------------
   Plugin de líneas de referencia (Módulos adicionales)
   -------------------------------------------------------------------------- */
function refLinesPlugin(lines, horizontal) {
  return {
    id: "dsRefLines",
    afterDatasetsDraw(chart) {
      if (!lines || !lines.length) return;
      const { ctx, chartArea } = chart;
      const scale = horizontal ? chart.scales.x : chart.scales.y;
      if (!scale) return;
      lines.forEach((l) => {
        const v = Number(l.value);
        if (!Number.isFinite(v)) return;
        const pos = scale.getPixelForValue(v);
        ctx.save();
        ctx.strokeStyle = l.color || "#c0392b";
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        if (horizontal) { ctx.moveTo(pos, chartArea.top); ctx.lineTo(pos, chartArea.bottom); }
        else { ctx.moveTo(chartArea.left, pos); ctx.lineTo(chartArea.right, pos); }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = l.color || "#c0392b";
        ctx.font = "11px Segoe UI, sans-serif";
        const text = `${l.label ? l.label + ": " : ""}${fmt(v)}`;
        if (horizontal) ctx.fillText(text, pos + 4, chartArea.top + 12);
        else ctx.fillText(text, chartArea.right - ctx.measureText(text).width - 4, pos - 4);
        ctx.restore();
      });
    },
  };
}

/* --------------------------------------------------------------------------
   Gráficos Chart.js
   -------------------------------------------------------------------------- */
export function renderChart(host, def, props, rawResult, { onSelect, selectedValues = [] } = {}) {
  const data = applySortLimit(rawResult, props);
  const look = props.look || {};
  const canvas = document.createElement("canvas");
  host.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "ho-canvas-wrap";
  wrap.appendChild(canvas);
  host.appendChild(wrap);

  const horizontal = look.orientation === "horizontal" && def.type !== "pie";
  const dimColor = (i) => PALETTE[i % PALETTE.length];
  const dim = (i) => (selectedValues.length && !selectedValues.includes(data.labels[i]) ? 0.35 : 1);

  let type = def.type;
  let datasets;

  if (def.type === "radar") {
    type = "radar";
    datasets = data.series.map((s, si) => {
      const base = dimColor(si);
      return {
        label: s.label, data: s.values,
        backgroundColor: withAlpha(base, 0.2), borderColor: base, borderWidth: 2, pointBackgroundColor: base,
      };
    });
  } else if (def.type === "mekko") {
    type = "bar";
    datasets = data.series.map((s, si) => ({
      label: s.label, data: s.values,
      backgroundColor: withAlpha(dimColor(si), 0.85), borderWidth: 0,
    }));
  } else if (def.type === "pie") {
    datasets = [{
      data: data.series[0].values,
      backgroundColor: data.labels.map((_, i) => withAlpha(dimColor(i), dim(i))),
      borderColor: "#fff",
      borderWidth: 1,
    }];
  } else if (def.type === "scatter") {
    const xs = data.series[0]?.values || [];
    const ys = data.series[1]?.values || [];
    datasets = [{
      label: props.dims[0]?.label || "",
      data: data.labels.map((l, i) => ({ x: xs[i], y: ys[i], label: l })),
      backgroundColor: data.labels.map((_, i) => withAlpha(themeColor(look.color), dim(i))),
      pointRadius: 5,
    }];
  } else if (def.type === "combo") {
    type = "bar";
    datasets = data.series.map((s, i) => ({
      type: i === 0 ? "bar" : "line",
      label: s.label,
      data: s.values,
      backgroundColor: i === 0 ? withAlpha(themeColor(look.color), 0.85) : PALETTE[1],
      borderColor: i === 0 ? themeColor(look.color) : PALETTE[1],
      borderWidth: i === 0 ? 0 : 2,
      tension: 0.25,
      order: i === 0 ? 2 : 1,
    }));
  } else {
    const isLine = def.type === "line";
    datasets = data.series.map((s, si) => {
      const base = data.series.length > 1 ? PALETTE[si % PALETTE.length] : themeColor(look.color);
      const values = isLine && look.missing === "zero" ? s.values.map((v) => v ?? 0) : s.values;
      return {
        label: s.label,
        data: values,
        backgroundColor: isLine
          ? withAlpha(base, look.lineStyle === "area" ? 0.25 : 1)
          : data.labels.map((_, i) => withAlpha(look.byDimension && data.series.length === 1 ? dimColor(i) : base, dim(i))),
        borderColor: base,
        borderWidth: isLine ? 2 : 0,
        fill: isLine && look.lineStyle === "area",
        pointRadius: isLine ? (look.points ? 3 : 0) : undefined,
        spanGaps: isLine && look.missing === "connect",
        tension: 0.25,
        borderRadius: isLine ? 0 : 2,
      };
    });
  }

  const showLegend = def.legend && look.legend !== false && (def.type === "pie" || def.type === "radar" || data.series.length > 1 || def.type === "combo");
  if (def.type === "radar") {
    return _finishChart(canvas, { type: "radar", data: { labels: data.labels, datasets },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: showLegend, labels: { boxWidth: 10, font: { size: 11 } } } },
        scales: { r: { ticks: { font: { size: 10 } } } } } });
  }
  const axisScales = def.axes
    ? {
        x: {
          stacked: look.barMode === "stacked",
          ticks: { display: look.xLabels !== false, font: { size: 11 } },
          title: { display: !!look.xTitle, text: look.xTitle },
          grid: { display: false },
        },
        y: {
          stacked: look.barMode === "stacked",
          beginAtZero: true,
          ticks: { display: look.yLabels !== false, font: { size: 11 } },
          title: { display: !!look.yTitle, text: look.yTitle },
        },
      }
    : undefined;

  const chart = new window.Chart(canvas, {
    type,
    data: { labels: def.type === "scatter" ? undefined : data.labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 250 },
      indexAxis: horizontal ? "y" : "x",
      cutout: def.type === "pie" && look.donut ? "55%" : undefined,
      scales: axisScales,
      plugins: {
        legend: { display: !!showLegend, position: look.legendPos === "bottom" ? "bottom" : look.legendPos === "right" ? "right" : "top", labels: { boxWidth: 10, font: { size: 11 } } },
        tooltip: {
          enabled: look.tooltip !== false,
          callbacks: def.type === "scatter"
            ? { label: (c) => `${c.raw.label}: (${fmt(c.raw.x)}, ${fmt(c.raw.y)})` }
            : {
                label: (c) => {
                  const p = c.parsed;
                  const v = typeof p === "number" ? p : horizontal ? p.x : p.y;
                  return `${c.dataset.label ? c.dataset.label + ": " : ""}${fmt(v)}`;
                },
              },
        },
      },
      onClick: (evt, elements) => {
        if (!onSelect || !elements.length) return;
        const i = elements[0].index;
        onSelect(data.labels[i]);
      },
    },
    plugins: [
      refLinesPlugin(props.addons?.refLines, horizontal),
      trendPlugin(props.measures, horizontal),
      valueLabelsPlugin(look.valueLabels && !isLineArea(def, look), props.measures),
    ],
  });
  return () => chart.destroy();
}

function isLineArea(def, look) { return def.type === "line" && look.lineStyle === "area"; }

/**
 * Dibuja líneas de tendencia por medida (measure.trend). "linear" = regresión
 * por mínimos cuadrados; "avg" = media horizontal.
 */
function trendPlugin(measures, horizontal) {
  return {
    id: "dsTrend",
    afterDatasetsDraw(chart) {
      (measures || []).forEach((m, si) => {
        if (!m?.trend) return;
        const ds = chart.data.datasets[si];
        const meta = chart.getDatasetMeta(si);
        if (!ds || !meta || meta.hidden) return;
        const pts = (ds.data || []).map((v, i) => ({ x: i, y: Number(v) })).filter((p) => Number.isFinite(p.y));
        if (pts.length < 2) return;
        let fn;
        if (m.trendType === "avg") {
          const mean = pts.reduce((a, p) => a + p.y, 0) / pts.length;
          fn = () => mean;
        } else {
          const n = pts.length;
          const sx = pts.reduce((a, p) => a + p.x, 0);
          const sy = pts.reduce((a, p) => a + p.y, 0);
          const sxx = pts.reduce((a, p) => a + p.x * p.x, 0);
          const sxy = pts.reduce((a, p) => a + p.x * p.y, 0);
          const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1);
          const intercept = (sy - slope * sx) / n;
          fn = (x) => slope * x + intercept;
        }
        const { ctx, scales } = chart;
        const xScale = horizontal ? scales.y : scales.x;
        const yScale = horizontal ? scales.x : scales.y;
        if (!xScale || !yScale) return;
        const x0 = 0, x1 = pts.length - 1;
        const p0 = { px: xScale.getPixelForValue(x0), py: yScale.getPixelForValue(fn(x0)) };
        const p1 = { px: xScale.getPixelForValue(x1), py: yScale.getPixelForValue(fn(x1)) };
        ctx.save();
        ctx.strokeStyle = ds.borderColor || "#555";
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        if (horizontal) { ctx.moveTo(p0.py, p0.px); ctx.lineTo(p1.py, p1.px); }
        else { ctx.moveTo(p0.px, p0.py); ctx.lineTo(p1.px, p1.py); }
        ctx.stroke();
        ctx.restore();
      });
    },
  };
}

/** Dibuja etiquetas de valores sobre cada punto de dato (barras/líneas). */
function valueLabelsPlugin(on, measures) {
  return {
    id: "dsValueLabels",
    afterDatasetsDraw(chart) {
      if (!on) return;
      const { ctx } = chart;
      chart.data.datasets.forEach((ds, si) => {
        const meta = chart.getDatasetMeta(si);
        if (!meta || meta.hidden) return;
        const mode = measures?.[si]?.fmt;
        ctx.save();
        ctx.font = "10px Segoe UI, sans-serif";
        ctx.fillStyle = "#333";
        ctx.textAlign = "center";
        meta.data.forEach((el, i) => {
          const v = ds.data[i];
          if (v == null) return;
          ctx.fillText(fmtAs(v, mode), el.x, el.y - 4);
        });
        ctx.restore();
      });
    },
  };
}

function _finishChart(canvas, config) {
  const chart = new window.Chart(canvas, config);
  return () => chart.destroy();
}

function withAlpha(hex, a) {
  if (a >= 1 || !/^#([0-9a-f]{6})$/i.test(hex)) return hex;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/* --------------------------------------------------------------------------
   KPI
   -------------------------------------------------------------------------- */
export function renderKpi(host, props, result) {
  const look = props.look || {};
  const m0 = props.measures[0];
  const label = m0?.label || result.label || "";
  const mode = m0?.fmt;
  let cmp = "";
  if (result.compare != null && Number(result.compare)) {
    const delta = (Number(result.value) - Number(result.compare)) / Number(result.compare) * 100;
    const up = delta >= 0;
    cmp = `<div class="ho-kpi-cmp ${up ? "up" : "down"}">${up ? "▲" : "▼"} ${fmt(Math.abs(delta))}%</div>`;
  }
  host.innerHTML = `
    <div class="ho-kpi" style="text-align:${esc(look.kpiAlign || "center")};">
      <div class="ho-kpi-label">${esc(label)}</div>
      <div class="ho-kpi-value" style="color:${esc(themeColor(look.color))};">${esc(fmtAs(result.value, mode))}</div>
      ${cmp}
    </div>`;
  return null;
}

/* --------------------------------------------------------------------------
   Tabla simple. totals: [valor por medida] calculados por el motor (KPI).
   -------------------------------------------------------------------------- */
export function renderTable(host, props, result, totals, { onSelect, selectedValues = [], dimLabel: dimName, measureLabels = [] } = {}) {
  const data = applySortLimit(result, props);
  const dimLabel = dimName || props.dims[0]?.label || "Dimensión";
  const heads = data.series.map((s, i) => measureLabels[i] || props.measures[i]?.label || s.label || `Medida ${i + 1}`);
  const mFmt = data.series.map((_, i) => props.measures[i]?.fmt); // formato por medida
  const showTotals = props.look?.totals !== false && totals;
  host.innerHTML = `
    <div class="ho-table-wrap">
      <table class="ho-table">
        <thead><tr><th>${esc(dimLabel)}</th>${heads.map((h) => `<th class="num">${esc(h)}</th>`).join("")}</tr></thead>
        <tbody>
          ${showTotals ? `<tr class="ho-total"><td>Totales</td>${totals.map((t, mi) => `<td class="num">${esc(fmtAs(t, mFmt[mi]))}</td>`).join("")}</tr>` : ""}
          ${data.labels.map((l, i) => `
            <tr data-i="${i}" class="${selectedValues.includes(l) ? "sel" : ""}">
              <td>${esc(fmt(l))}</td>
              ${data.series.map((s, mi) => `<td class="num">${esc(fmtAs(s.values[i], mFmt[mi]))}</td>`).join("")}
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
  if (onSelect) {
    host.querySelectorAll("tbody tr[data-i]").forEach((tr) =>
      tr.addEventListener("click", () => onSelect(data.labels[Number(tr.dataset.i)])));
  }
  return null;
}

/* --------------------------------------------------------------------------
   Panel de filtrado. lists: [{label, field, values:[{value, state}]}]
   -------------------------------------------------------------------------- */
export function renderFilterPane(host, lists, { onToggle, interactive }) {
  host.innerHTML = `<div class="ho-fp">${lists.map((l, li) => `
    <div class="ho-fp-list" data-li="${li}">
      <div class="ho-fp-head">
        <span class="ho-fp-title">${esc(l.label)}</span>
        <input class="ho-fp-search" placeholder="Buscar" aria-label="Buscar en ${esc(l.label)}" />
      </div>
      <div class="ho-fp-values">
        ${l.error ? `<div class="ho-fp-err">${esc(l.error)}</div>` : l.values.map((v, vi) => `
          <div class="ho-fp-val st-${esc(v.state)}" data-vi="${vi}" title="${esc(fmt(v.value))}">${esc(fmt(v.value))}</div>`).join("")}
      </div>
    </div>`).join("")}</div>`;

  host.querySelectorAll(".ho-fp-list").forEach((listEl) => {
    const l = lists[Number(listEl.dataset.li)];
    const search = listEl.querySelector(".ho-fp-search");
    search.addEventListener("input", () => {
      const q = search.value.toLowerCase();
      listEl.querySelectorAll(".ho-fp-val").forEach((el) => {
        el.hidden = q && !el.textContent.toLowerCase().includes(q);
      });
    });
    search.addEventListener("mousedown", (e) => e.stopPropagation());
    if (!interactive) return;
    listEl.querySelectorAll(".ho-fp-val").forEach((el) =>
      el.addEventListener("click", () => onToggle(l.field, l.values[Number(el.dataset.vi)].value)));
  });
  return null;
}

/* --------------------------------------------------------------------------
   Texto
   -------------------------------------------------------------------------- */
export function renderText(host, props) {
  host.innerHTML = `<div class="ho-text" style="text-align:${esc(props.look?.textAlign || "left")};">${esc(props.text || "").replace(/\n/g, "<br>")}</div>`;
  return null;
}


/* ==========================================================================
   Tipos adicionales de gráfico. Todos dibujan con lo que devuelve el motor.
   Firma común: (host, def, props, payload, opts) -> cleanup|null.
   payload según el tipo: result de /query, {rows}, {scalar}, etc.
   ========================================================================== */
import { PALETTE as _PAL } from "./chart-types.js";

function _c(i) { return _PAL[i % _PAL.length]; }

/* --- Treemap / bloques --- */
export function renderTreemap(host, props, result) {
  const d = applySortLimit(result, props);
  const vals = d.series[0].values.map((v) => Math.max(0, Number(v) || 0));
  const total = vals.reduce((a, b) => a + b, 0) || 1;
  // Squarified simple por filas.
  const items = d.labels.map((l, i) => ({ l, v: vals[i], i })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
  host.innerHTML = `<div class="ho-treemap"></div>`;
  const box = host.querySelector(".ho-treemap");
  box.innerHTML = items.map((it) => {
    const pct = (it.v / total) * 100;
    return `<div class="ho-tm-cell" style="flex-grow:${it.v}; background:${_c(it.i)}" title="${esc(it.l)}: ${fmt(it.v)}">
      <span>${esc(it.l)}</span><small>${props.look?.valueLabels !== false ? fmt(it.v) : pct.toFixed(1) + "%"}</small></div>`;
  }).join("");
  return null;
}

/* --- Heatmap / cuadrícula (2 dimensiones + 1 medida) --- */
export function renderHeatmap(host, matrix) {
  // matrix: {xs, ys, grid: {`y|x`: value}, max}
  const { xs, ys, grid, max } = matrix;
  host.innerHTML = `<div class="ho-heatmap"><table><thead><tr><th></th>${xs.map((x) => `<th>${esc(x)}</th>`).join("")}</tr></thead>
    <tbody>${ys.map((y) => `<tr><th>${esc(y)}</th>${xs.map((x) => {
      const v = grid[`${y}|${x}`];
      const a = v == null ? 0 : 0.15 + 0.85 * (v / (max || 1));
      return `<td style="background:rgba(10,143,60,${v == null ? 0 : a})" title="${esc(y)} · ${esc(x)}: ${fmt(v)}">${v == null ? "" : fmt(v)}</td>`;
    }).join("")}</tr>`).join("")}</tbody></table></div>`;
  return null;
}

/* --- Funnel / embudo --- */
export function renderFunnel(host, props, result) {
  const d = applySortLimit(result, props);
  const vals = d.series[0].values.map((v) => Number(v) || 0);
  const max = Math.max(...vals, 1);
  host.innerHTML = `<div class="ho-funnel">${d.labels.map((l, i) => `
    <div class="ho-funnel-row"><span class="ho-funnel-label">${esc(l)}</span>
      <span class="ho-funnel-bar" style="width:${(vals[i] / max) * 100}%; background:${_c(i)}">${props.look?.valueLabels !== false ? fmt(vals[i]) : ""}</span></div>`).join("")}</div>`;
  return null;
}

/* --- Waterfall / cascada --- */
export function renderWaterfall(host, props, result) {
  const d = applySortLimit(result, props);
  const vals = d.series[0].values.map((v) => Number(v) || 0);
  let run = 0;
  const steps = vals.map((v, i) => { const start = run; run += v; return { l: d.labels[i], v, start, end: run }; });
  const lo = Math.min(0, ...steps.map((s) => Math.min(s.start, s.end)));
  const hi = Math.max(0, ...steps.map((s) => Math.max(s.start, s.end)));
  const span = (hi - lo) || 1;
  host.innerHTML = `<div class="ho-waterfall">${steps.map((s) => {
    const bottom = ((Math.min(s.start, s.end) - lo) / span) * 100;
    const h = (Math.abs(s.v) / span) * 100;
    return `<div class="ho-wf-col"><div class="ho-wf-bar ${s.v >= 0 ? "up" : "down"}" style="bottom:${bottom}%; height:${h}%" title="${esc(s.l)}: ${fmt(s.v)}"></div><span>${esc(s.l)}</span></div>`;
  }).join("")}</div>`;
  return null;
}

/* --- Boxplot (resumen por grupo calculado por el motor: min/q1/med/q3/max) --- */
export function renderBoxplot(host, stats) {
  // stats: [{label, min, q1, med, q3, max}], global {lo, hi}
  const { items, lo, hi } = stats;
  const span = (hi - lo) || 1;
  const pos = (v) => ((v - lo) / span) * 100;
  host.innerHTML = `<div class="ho-box">${items.map((b) => `
    <div class="ho-box-col" title="${esc(b.label)}  min ${fmt(b.min)} · Q1 ${fmt(b.q1)} · mediana ${fmt(b.med)} · Q3 ${fmt(b.q3)} · max ${fmt(b.max)}">
      <div class="ho-box-plot">
        <div class="ho-box-whisker" style="bottom:${pos(b.min)}%; height:${pos(b.max) - pos(b.min)}%"></div>
        <div class="ho-box-iqr" style="bottom:${pos(b.q1)}%; height:${Math.max(1, pos(b.q3) - pos(b.q1))}%"></div>
        <div class="ho-box-med" style="bottom:${pos(b.med)}%"></div>
      </div><span>${esc(b.label)}</span></div>`).join("")}</div>`;
  return null;
}

/* --- Histograma (bins calculados en cliente a partir de valores crudos) --- */
export function renderHistogram(host, values) {
  const nums = values.map(Number).filter((v) => isFinite(v));
  if (!nums.length) { host.innerHTML = `<div class="ho-obj-msg">Sin datos numéricos.</div>`; return null; }
  const lo = Math.min(...nums), hi = Math.max(...nums);
  const bins = Math.min(12, Math.max(4, Math.round(Math.sqrt(nums.length))));
  const w = (hi - lo) / bins || 1;
  const counts = new Array(bins).fill(0);
  nums.forEach((v) => { const i = Math.min(bins - 1, Math.floor((v - lo) / w)); counts[i]++; });
  const max = Math.max(...counts, 1);
  host.innerHTML = `<div class="ho-hist">${counts.map((c, i) => `
    <div class="ho-hist-col" title="[${fmt(lo + i * w)}, ${fmt(lo + (i + 1) * w)}): ${c}"><div class="ho-hist-bar" style="height:${(c / max) * 100}%"></div></div>`).join("")}</div>
    <div class="ho-hist-axis"><span>${fmt(lo)}</span><span>${fmt(hi)}</span></div>`;
  return null;
}

/* --- Gauge / indicador (escalar) --- */
export function renderGauge(host, props, scalar) {
  const val = Number(scalar) || 0;
  const min = Number(props.look?.gaugeMin) || 0;
  const max = Number(props.look?.gaugeMax) || Math.max(val * 1.25, 100);
  const frac = Math.max(0, Math.min(1, (val - min) / ((max - min) || 1)));
  const ang = -90 + frac * 180;
  host.innerHTML = `<div class="ho-gauge">
    <svg viewBox="0 0 120 70"><path d="M10 60 A50 50 0 0 1 110 60" fill="none" stroke="#e3e6ea" stroke-width="12"/>
      <path d="M10 60 A50 50 0 0 1 110 60" fill="none" stroke="${esc(props.look?.color || _PAL[0])}" stroke-width="12" stroke-dasharray="${frac * 157} 999"/>
      <line x1="60" y1="60" x2="${60 + 42 * Math.cos((ang) * Math.PI / 180)}" y2="${60 + 42 * Math.sin((ang) * Math.PI / 180)}" stroke="#333" stroke-width="2"/></svg>
    <div class="ho-gauge-val">${fmt(val)}</div></div>`;
  return null;
}

/* --- Bullet --- */
export function renderBullet(host, props, result) {
  const d = applySortLimit(result, props);
  const vals = d.series[0].values.map((v) => Number(v) || 0);
  const max = Math.max(...vals, 1);
  host.innerHTML = `<div class="ho-bullet">${d.labels.map((l, i) => `
    <div class="ho-bullet-row"><span class="ho-bullet-label">${esc(l)}</span>
      <div class="ho-bullet-track"><div class="ho-bullet-fill" style="width:${(vals[i] / max) * 100}%; background:${esc(props.look?.color || _PAL[0])}"></div></div>
      <span class="ho-bullet-val">${fmt(vals[i])}</span></div>`).join("")}</div>`;
  return null;
}

/* --- Sankey (2 dims + medida): origen -> destino --- */
export function renderSankey(host, flows) {
  // flows: [{from, to, value}]
  const nodes = [...new Set(flows.flatMap((f) => [f.from, f.to]))];
  host.innerHTML = `<div class="ho-sankey">${flows.map((f) => {
    const w = Math.max(2, Math.min(28, f.value / (flows[0]?.value || 1) * 10));
    return `<div class="ho-sankey-row" title="${esc(f.from)} → ${esc(f.to)}: ${fmt(f.value)}">
      <span class="ho-sk-node">${esc(f.from)}</span><span class="ho-sk-link" style="height:${w}px"></span><span class="ho-sk-node">${esc(f.to)}</span><em>${fmt(f.value)}</em></div>`;
  }).join("")}</div>`;
  return null;
}

/* --- Pivot (2 dims + medida) --- */
export function renderPivot(host, pivot) {
  const { rows, cols, grid, rowLabel } = pivot;
  host.innerHTML = `<div class="ho-table-wrap"><table class="ho-table"><thead><tr><th>${esc(rowLabel)}</th>${cols.map((c) => `<th class="num">${esc(c)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r) => `<tr><td>${esc(r)}</td>${cols.map((c) => `<td class="num">${fmt(grid[`${r}|${c}`])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  return null;
}

/* --- Orgchart / red (2 dims: nodo, padre) --- */
export function renderOrg(host, pairs) {
  // Agrupa hijos por padre y pinta niveles simples.
  const children = {};
  const all = new Set();
  pairs.forEach(([node, parent]) => { all.add(node); (children[parent] = children[parent] || []).push(node); });
  const roots = [...all].filter((n) => !pairs.some(([c]) => c === n && pairs.find(([x, p]) => x === n && p))) ;
  const top = pairs.filter(([, p]) => !all.has(p) || p == null || p === "").map(([n]) => n);
  const seedRoots = top.length ? [...new Set(top)] : [...new Set(pairs.map(([, p]) => p))].slice(0, 1);
  const node = (n, depth) => `<div class="ho-org-node" style="margin-left:${depth * 18}px">${esc(n)}</div>${(children[n] || []).map((c) => node(c, depth + 1)).join("")}`;
  host.innerHTML = `<div class="ho-org">${seedRoots.map((r) => node(r, 0)).join("")}</div>`;
  return null;
}

/* --- Mapa (sin tiles: lista de ubicaciones con barra proporcional) --- */
export function renderMap(host, props, result) {
  const d = applySortLimit(result, props);
  const vals = d.series[0].values.map((v) => Number(v) || 0);
  const max = Math.max(...vals, 1);
  host.innerHTML = `<div class="ho-map"><div class="ho-map-note">🗺 Mapa (vista de lista; los tiles geográficos llegan después)</div>
    ${d.labels.map((l, i) => `<div class="ho-map-row"><span>${esc(l)}</span><span class="ho-map-bar" style="width:${(vals[i] / max) * 100}%"></span><em>${fmt(vals[i])}</em></div>`).join("")}</div>`;
  return null;
}

/* --- Nube de palabras --- */
export function renderWordcloud(host, result) {
  const d = applySortLimit(result, { sort: { by: "measure", dir: "desc" }, look: {} });
  const vals = d.series[0].values.map((v) => Number(v) || 0);
  const max = Math.max(...vals, 1);
  host.innerHTML = `<div class="ho-cloud">${d.labels.map((l, i) => `
    <span class="ho-cloud-word" style="font-size:${12 + (vals[i] / max) * 30}px; color:${_c(i)}" title="${esc(l)}: ${fmt(vals[i])}">${esc(l)}</span>`).join(" ")}</div>`;
  return null;
}

/* --- Objetos del cuadro de mando (sin datos) --- */
export function renderNote(host, props, def) {
  host.innerHTML = `<div class="ho-placeholder"><strong>${esc(def.label)}</strong><span>${esc(props.text || "Objeto de interacción. Configúralo en Propiedades.")}</span></div>`;
  return null;
}
export function renderButton(host, props) {
  host.innerHTML = `<div class="ho-btnobj"><button type="button">${esc(props.title || props.text || "Botón")}</button></div>`;
  return null;
}
export function renderDivider(host) { host.innerHTML = `<div class="ho-divider"></div>`; return null; }
export function renderContainer(host, def) {
  host.innerHTML = `<div class="ho-container"><span>${esc(def.label)}</span><small>Arrastra objetos dentro (contenedor)</small></div>`;
  return null;
}
export function renderImage(host, props) {
  const url = props.imageUrl || "";
  host.innerHTML = url ? `<img class="ho-image" src="${esc(url)}" alt="${esc(props.title || "imagen")}" />`
    : `<div class="ho-placeholder"><strong>Imagen</strong><span>Define la URL en Propiedades → General.</span></div>`;
  return null;
}
export function renderVideo(host, props) {
  const url = props.videoUrl || "";
  host.innerHTML = url ? `<video class="ho-video" src="${esc(url)}" controls></video>`
    : `<div class="ho-placeholder"><strong>Reproductor de vídeo</strong><span>Define la URL en Propiedades → General.</span></div>`;
  return null;
}
export function renderNavMenu(host, sheets, onGo, currentId) {
  host.innerHTML = `<div class="ho-navmenu">${(sheets || []).map((s) => `<button type="button" data-go="${s.id}" class="${s.id === currentId ? "active" : ""}">${esc(s.title)}</button>`).join("")}</div>`;
  if (onGo) host.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => onGo(b.dataset.go)));
  return null;
}

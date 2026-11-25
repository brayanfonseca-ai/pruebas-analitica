// informe-historia.js — «Historia de datos»: el informe como una secuencia de MENSAJES, no como un volcado de KPIs.
//
// Cada diapositiva responde UNA pregunta y trae: un titular con la conclusión (ya calculada), la gráfica que la
// prueba, 2-3 hallazgos y una explicación de «cómo leerlo» (modo didáctico) + notas del presentador.
//   1. Portada            · nombre, periodo cubierto.
//   2. Lo esencial        · como máximo 4 cifras (medidas maestras oficiales), con su variación vs el periodo anterior.
//   3. Tendencia          · la medida principal en el tiempo: último vs anterior, mejor y peor periodo.
//   4. Concentración      · Pareto de la medida principal: cuántos elementos explican el 80 %.
//   5. Mezcla             · participación por la dimensión principal.
//   6. Rendimiento        · una TASA (p. ej. % Margen) por dimensión, con el promedio como referencia.
//   7. Alerta             · la tasa «de riesgo» (devoluciones, abandono…) donde más se dispara.
//   8. Hallazgos          · lo anterior en 4 tarjetas + recomendaciones (opcional: resumen redactado por la IA).
//   9. Anexo              · tabla de detalle.
// La misma historia alimenta: el MODO PRESENTACIÓN (pantalla completa, tarjetas animadas, teclado, notas,
// vista general, cómo leerlo) y el PDF apaisado 16:9 (una idea por página, mismo orden y mismos textos).
// Todo sale del motor (POST /query con las medidas maestras ya compiladas por /expressions/parse).

import * as api from "./api.js";
import { formatValue } from "./num-format.js";
import { PALETTE } from "./chart-types.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nat = (a, b) => String(a).localeCompare(String(b), "es", { numeric: true });
const pctTxt = (p, d = 1) => (p == null || !isFinite(p) ? "—" : `${p.toLocaleString("es-CO", { maximumFractionDigits: d })} %`);
const signPct = (p) => (p == null || !isFinite(p) ? "" : `${p >= 0 ? "+" : "−"}${Math.abs(p).toLocaleString("es-CO", { maximumFractionDigits: 1 })} %`);
const TIME_RX = /^(mes|month|periodo|período|fecha|date|a[nñ]o|anio|year|semana|week|trimestre|quarter)\b/i;
const ID_RX = /(^|[\s_])(id|cod|codigo|código|cedula|cédula|nit|documento|telefono|celular|email|correo)($|[\s_])/i;
const RATIO_RX = /%|porcentaje|tasa|ratio|promedio|media|ticket|margen %|tiempo medio/i;
const RISK_RX = /devoluci|cancelaci|abandono|rotaci|retiro|churn|reclamo|queja|error|falla|mora|riesgo|p[eé]rdida|bajas/i;

/* ======================================================================
   1) Construir la historia
   ====================================================================== */

async function loadMeasures(appId, fields) {
  let masters = [];
  try { masters = (await api.listMasterItems(appId)).filter((m) => m.kind === "measure"); } catch { masters = []; }
  masters.sort((a, b) => (b.certified ? 1 : 0) - (a.certified ? 1 : 0));
  const out = [];
  for (const m of masters.slice(0, 10)) {
    try {
      const r = await api.parseExpression(appId, "measure", m.expression);
      const fmt = m.format || null;
      const pctFmt = fmt && (fmt.type === "percent" || String(fmt.suffix || "").includes("%"));
      out.push({
        id: m.id, name: m.name, fmt, desc: m.description || "",
        spec: { table: r.table, field: r.field, agg: r.agg || "sum", label: m.name, ...(r.formula ? { formula: r.formula, parts: r.parts } : {}) },
        additive: !pctFmt && !RATIO_RX.test(m.name),
        percent: !!pctFmt || /%|porcentaje|tasa/i.test(m.name),
        risk: RISK_RX.test(m.name),
      });
    } catch { /* medida que no compila: se omite */ }
  }
  if (!out.length) {
    for (const f of (fields.measures || []).slice(0, 6)) {
      out.push({ id: `f:${f.table}.${f.field}`, name: f.display || f.field, fmt: null, desc: "", spec: { table: f.table, field: f.field, agg: "sum", label: f.display || f.field },
        additive: !RATIO_RX.test(f.field), percent: /%|porcentaje|tasa/i.test(f.field), risk: RISK_RX.test(f.field) });
    }
  }
  return out;
}

const fv = (m, v) => formatValue(v, m?.fmt);
/** Plural en español del nombre de una dimensión («ciudad» → «ciudades», «región» → «regiones»). */
function plural(w) {
  const s = String(w || "").toLowerCase().trim();
  if (!s) return s;
  if (/[aeiouáéó]$/.test(s)) return s + "s";
  if (/z$/.test(s)) return s.slice(0, -1) + "ces";
  return s.replace(/ón$/, "on").replace(/án$/, "an").replace(/és$/, "es") + "es";
}

async function q(appId, dim, measures) {
  const spec = { measures: measures.map((m) => m.spec) };
  if (dim) spec.dimension = { table: dim.table, field: dim.field };
  const r = await api.query(appId, spec);
  // Sin dimensión el motor devuelve un total por medida en «values» (y el primero en «value»).
  if (!dim) {
    const vals = r.series?.length ? r.series.map((s) => s.values?.[0] ?? null) : Array.isArray(r.values) && r.values.length ? r.values : [r.value];
    return { value: r.value, values: vals };
  }
  const labels = (r.labels || []).map(String);
  const series = r.series?.length ? r.series.map((s) => s.values) : [r.values || []];
  return { labels, series };
}

/** Toma la historia ya armada y aplica selecciones del usuario (orden, incluir/excluir). */
export function visibleSlides(story) { return story.slides.filter((s) => !s.off); }

/**
 * Arma la historia. opts: {title?, mainMeasureId?, mainDim?, useAI?, onStep?(texto)}.
 */
export async function buildStory(appId, appName, fields, opts = {}) {
  const step = opts.onStep || (() => {});
  step("Leyendo las medidas oficiales…");
  const measures = await loadMeasures(appId, fields);
  if (!measures.length) throw new Error("La app no tiene medidas para contar una historia (crea medidas maestras o carga datos numéricos).");
  // Medida principal por SIGNIFICADO (ventas/ingresos primero), no por orden alfabético.
  const score = (m) => (m.additive ? 10 : 0) + (/venta|ingreso|facturaci|revenue|sales|importe/i.test(m.name) ? 8 : 0) + (m.fmt?.type === "currency" ? 3 : 0) - (/margen|costo|utilidad|gasto/i.test(m.name) ? 2 : 0) - (m.risk ? 6 : 0);
  const main = measures.find((m) => m.id === opts.mainMeasureId) || [...measures].sort((a, b) => score(b) - score(a))[0];
  const sameTable = (d) => d.table === main.spec.table;
  const dimsAll = (fields.dimensions || []).filter((d) => !ID_RX.test(d.field));
  const dims = dimsAll.filter(sameTable).length ? dimsAll.filter(sameTable) : dimsAll;

  // Tiempo: el campo de periodo más útil (texto AAAA-MM > fecha diaria > año).
  const timeCands = dims.filter((d) => TIME_RX.test(d.field) || d.type === "date");
  const timeRank = (d) => (/^mes|month|periodo|período/i.test(d.field) ? 0 : /trimestre|quarter|semana|week/i.test(d.field) ? 1 : /a[nñ]o|anio|year/i.test(d.field) ? 3 : 2);
  timeCands.sort((a, b) => timeRank(a) - timeRank(b));

  step("Midiendo cada dimensión…");
  const cats = [];
  for (const d of dims.filter((x) => !timeCands.includes(x)).slice(0, 10)) {
    try {
      const r = await q(appId, d, [main]);
      const vals = r.series[0].map((v) => Number(v) || 0);
      const total = vals.reduce((a, b) => a + b, 0);
      if (r.labels.length >= 2 && total) cats.push({ dim: d, n: r.labels.length, r, total });
    } catch { /* dimensión no compatible con la medida */ }
  }
  const byPref = (lo, hi) => cats.filter((c) => c.n >= lo && c.n <= hi);
  const primary = cats.find((c) => c.dim.field === opts.mainDim) || byPref(3, 8)[0] || byPref(2, 15)[0] || cats[0];
  const detail = cats.filter((c) => c !== primary).sort((a, b) => b.n - a.n).find((c) => c.n >= 6 && c.n <= 60) || (primary && primary.n >= 6 ? primary : null);
  const secondary = cats.find((c) => c !== primary && c !== detail && c.n >= 2 && c.n <= 8) || cats.find((c) => c !== primary && c !== detail) || null;
  let time = null;
  for (const t of timeCands) {
    try { const r = await q(appId, t, [main]); if (r.labels.length >= 3) { time = { dim: t, r }; break; } } catch { /* sigue */ }
  }

  const label = (d) => d?.display || d?.field || "";
  const slides = [];
  const facts = [];
  // Orden de lectura: principal → otras sumables → tasas de rendimiento → riesgo.
  const kRank = (m) => (m.additive ? 0 : m.risk ? 3 : 2) + (m.additive && /margen|utilidad/i.test(m.name) ? -0.5 : 0);
  const kpiMeasures = [main, ...measures.filter((m) => m !== main).sort((a, b) => kRank(a) - kRank(b))].slice(0, 4);

  // ---- Periodo y variación de las cifras esenciales ----
  step("Calculando las cifras esenciales…");
  let period = "", lastLbl = "", prevLbl = "";
  let kpiTime = null;
  if (time) {
    const order = time.r.labels.map((l, i) => [l, i]).sort((a, b) => nat(a[0], b[0]));
    period = `${order[0][0]} – ${order.at(-1)[0]}`;
    try { kpiTime = await q(appId, time.dim, kpiMeasures); } catch { kpiTime = null; }
  }
  const totals = await q(appId, null, kpiMeasures).catch(() => ({ values: [] }));
  const kpis = kpiMeasures.map((m, i) => {
    const item = { name: m.name, raw: totals.values[i], value: fv(m, totals.values[i]), fmt: m.fmt, desc: m.desc };
    if (kpiTime) {
      const pairs = kpiTime.labels.map((l, k) => [l, kpiTime.series[i]?.[k]]).sort((a, b) => nat(a[0], b[0])).filter((p) => p[1] != null);
      if (pairs.length >= 2) {
        const [pl, pv] = pairs.at(-2), [ll, lv] = pairs.at(-1);
        lastLbl = ll; prevLbl = pl;
        item.spark = pairs.slice(-12).map((p) => Number(p[1]) || 0);
        if (m.percent) { item.delta = (Number(lv) - Number(pv)); item.deltaTxt = `${item.delta >= 0 ? "+" : "−"}${Math.abs(item.delta).toLocaleString("es-CO", { maximumFractionDigits: 1 })} pts`; }
        else if (Number(pv)) { item.delta = ((Number(lv) - Number(pv)) / Math.abs(Number(pv))) * 100; item.deltaTxt = signPct(item.delta); }
        item.good = m.risk ? item.delta <= 0 : item.delta >= 0;
      }
    }
    return item;
  });

  const title = opts.title || `${main.name}: lo que dicen los datos`;
  slides.push({ id: "cover", type: "cover", kicker: appName, title, sub: period ? `Periodo analizado: ${period}` : "Informe generado con datos reales", notes: `Presenta el objetivo: entender cómo se comporta ${main.name}, dónde se concentra y qué conviene hacer.` });

  const k0 = kpis[0];
  slides.push({ id: "kpis", type: "kpis", kicker: "Lo esencial", title: `${main.name}: ${k0.value}${k0.deltaTxt && lastLbl ? `, ${k0.delta >= 0 ? "sube" : "baja"} ${k0.deltaTxt.replace(/^[+−]/, "")} en ${lastLbl}` : ""}`,
    sub: kpis.length > 1 ? `Las ${kpis.length} cifras oficiales de la app${lastLbl ? `; la variación compara ${lastLbl} con ${prevLbl}` : ""}.` : "",
    items: kpis,
    how: "Cada tarjeta es una medida oficial (definida una sola vez en la Capa de negocio). La flecha compara el último periodo con el anterior: verde = mejora, rojo = empeora (en medidas de riesgo, bajar es bueno).",
    notes: `Quédate con una sola idea: ${main.name} vale ${k0.value}. Las demás cifras dan contexto.` });
  facts.push(`${main.name} total: ${k0.value}${k0.deltaTxt ? ` (${k0.deltaTxt} en ${lastLbl} vs ${prevLbl})` : ""}.`);

  // ---- Tendencia ----
  if (time) {
    const pairs = time.r.labels.map((l, i) => [l, Number(time.r.series[0][i]) || 0]).sort((a, b) => nat(a[0], b[0]));
    const vals = pairs.map((p) => p[1]);
    const best = pairs.reduce((a, b) => (b[1] > a[1] ? b : a)), worst = pairs.reduce((a, b) => (b[1] < a[1] ? b : a));
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const half = Math.floor(vals.length / 2);
    const h1 = vals.slice(0, half).reduce((a, b) => a + b, 0) / Math.max(1, half), h2 = vals.slice(half).reduce((a, b) => a + b, 0) / Math.max(1, vals.length - half);
    const growth = h1 ? ((h2 - h1) / Math.abs(h1)) * 100 : null;
    const dir = growth == null ? "se mantiene" : growth > 3 ? "crece" : growth < -3 ? "cae" : "se mantiene estable";
    slides.push({ id: "trend", type: "chart", kicker: "Tendencia", title: `${main.name} ${dir}${growth != null && Math.abs(growth) > 3 ? ` ${pctTxt(Math.abs(growth))} en la segunda mitad del periodo` : ""}`,
      sub: `Evolución por ${label(time.dim).toLowerCase()} · ${pairs.length} periodos`,
      chart: { kind: "line", labels: pairs.map((p) => p[0]), series: [{ label: main.name, values: vals }], fmt: main.fmt, ref: avg, refLabel: "Promedio", mark: [pairs.indexOf(best), pairs.indexOf(worst)] },
      bullets: [`Mejor periodo: ${best[0]} con ${fv(main, best[1])}.`, `Periodo más bajo: ${worst[0]} con ${fv(main, worst[1])}.`, `Promedio por periodo: ${fv(main, avg)}.`],
      how: "La línea muestra el valor de cada periodo; la línea punteada es el promedio. Busca la dirección general (sube o baja) antes que los picos aislados: un pico puede ser estacional.",
      notes: `Señala ${best[0]} (máximo) y ${worst[0]} (mínimo). La comparación entre mitades evita sacar conclusiones de un solo mes.` });
    facts.push(`Tendencia: ${dir}${growth != null ? ` (${signPct(growth)} entre mitades)` : ""}; mejor ${best[0]}, peor ${worst[0]}.`);
  }

  // ---- Concentración (Pareto) ----
  const conc = detail || primary;
  if (conc && main.additive) {
    const rows = conc.r.labels.map((l, i) => [l, Number(conc.r.series[0][i]) || 0]).filter((r) => r[1] > 0).sort((a, b) => b[1] - a[1]);
    const total = rows.reduce((a, b) => a + b[1], 0);
    let acc = 0, n80 = 0;
    const cum = rows.map((r) => { acc += r[1]; if (acc / total < 0.8 + 1e-9 || n80 === 0) n80++; return (acc / total) * 100; });
    n80 = Math.min(rows.length, cum.findIndex((c) => c >= 80) + 1 || rows.length);
    const top = rows[0], topShare = (top[1] / total) * 100;
    const shareN = (n80 / rows.length) * 100;
    slides.push({ id: "pareto", type: "chart", kicker: "Concentración", title: `${n80} de ${rows.length} ${plural(label(conc.dim))} explican el 80 % de ${main.name}`,
      sub: `${top[0]} solo aporta ${pctTxt(topShare)} · ${shareN <= 30 ? "muy concentrado" : shareN <= 50 ? "concentrado" : "repartido"}`,
      chart: { kind: "pareto", labels: rows.slice(0, 20).map((r) => r[0]), series: [{ label: main.name, values: rows.slice(0, 20).map((r) => r[1]) }], cum: cum.slice(0, 20), fmt: main.fmt, highlight: n80 },
      bullets: [`${top[0]} lidera con ${fv(main, top[1])} (${pctTxt(topShare)}).`, `Los ${n80} primeros suman el 80 %: son el ${pctTxt(shareN, 0)} del total de ${plural(label(conc.dim))}.`, rows.length > 3 ? `Los ${rows.length - n80} restantes aportan el ${pctTxt(100 - (cum[n80 - 1] || 0))}.` : ""].filter(Boolean),
      how: "Barras ordenadas de mayor a menor; la línea naranja acumula el %. Donde la línea cruza el 80 % están los elementos que mueven el resultado (regla 80/20).",
      notes: "Si pocos elementos explican casi todo, el riesgo está en depender de ellos; si está repartido, las mejoras deben ser transversales." });
    facts.push(`Concentración: ${n80} de ${rows.length} ${label(conc.dim)} explican el 80 %; lidera ${top[0]} (${pctTxt(topShare)}).`);
  }

  // ---- Mezcla por la dimensión principal ----
  if (primary && primary !== conc && main.additive) {
    const rows = primary.r.labels.map((l, i) => [l, Number(primary.r.series[0][i]) || 0]).filter((r) => r[1] > 0).sort((a, b) => b[1] - a[1]);
    const total = rows.reduce((a, b) => a + b[1], 0);
    const lead = rows[0], last = rows.at(-1);
    slides.push({ id: "mix", type: "chart", kicker: "Mezcla", title: `${lead[0]} pesa ${pctTxt((lead[1] / total) * 100)} de ${main.name}`,
      sub: `Participación por ${label(primary.dim).toLowerCase()}`,
      chart: { kind: "doughnut", labels: rows.map((r) => r[0]), series: [{ label: main.name, values: rows.map((r) => r[1]) }], fmt: main.fmt },
      bullets: rows.slice(0, 3).map((r) => `${r[0]}: ${fv(main, r[1])} · ${pctTxt((r[1] / total) * 100)}`).concat(rows.length > 3 ? [`El menor, ${last[0]}, aporta ${pctTxt((last[1] / total) * 100)}.`] : []),
      how: "Cada sector es la parte del total. Compara tamaños, no colores; si dos sectores se parecen, mira los porcentajes de la derecha.",
      notes: `Pregunta clave: ¿la mezcla actual es la deseada? ${last[0]} tiene el menor peso.` });
    facts.push(`Mezcla por ${label(primary.dim)}: ${lead[0]} ${pctTxt((lead[1] / total) * 100)}, ${last[0]} ${pctTxt((last[1] / total) * 100)}.`);
  }

  // ---- Rendimiento (tasa) y alerta (tasa de riesgo) ----
  const rates = measures.filter((m) => m.percent || !m.additive);
  const perf = rates.find((m) => !m.risk && m.percent) || rates.find((m) => !m.risk);
  const risk = rates.find((m) => m.risk);
  async function rateSlide(m, kind) {
    const candidates = [primary, secondary, detail].filter(Boolean);
    let best = null;
    for (const c of candidates) {
      try {
        const r = await q(appId, c.dim, [m]);
        const rows = r.labels.map((l, i) => [l, Number(r.series[0][i])]).filter((x) => isFinite(x[1]));
        if (rows.length < 2) continue;
        const vals = rows.map((x) => x[1]);
        const spread = Math.max(...vals) - Math.min(...vals);
        if (!best || spread > best.spread) best = { c, rows, spread };
      } catch { /* sigue */ }
    }
    if (!best) return;
    const rows = best.rows.sort((a, b) => b[1] - a[1]);
    const tot = await q(appId, null, [m]).catch(() => ({ value: null }));
    const avg = Number(tot.value);
    const hi = rows[0], lo = rows.at(-1);
    const dl = label(best.c.dim).toLowerCase();
    if (kind === "perf") {
      slides.push({ id: "perf", type: "chart", kicker: "Rendimiento", title: `${m.name}: ${hi[0]} lidera con ${fv(m, hi[1])}; ${lo[0]} queda en ${fv(m, lo[1])}`,
        sub: `Por ${dl} · promedio general ${fv(m, avg)}`,
        chart: { kind: "bar", labels: rows.map((r) => r[0]), series: [{ label: m.name, values: rows.map((r) => r[1]) }], fmt: m.fmt, ref: isFinite(avg) ? avg : null, refLabel: "Promedio", goodHigh: true },
        bullets: [`Brecha entre el mejor y el peor: ${fv(m, hi[1] - lo[1])}.`, `${rows.filter((r) => r[1] >= avg).length} de ${rows.length} están en o por encima del promedio.`, `Subir ${lo[0]} al promedio es la mejora más directa.`],
        how: "Cada barra es el valor de la tasa en un grupo; la línea punteada es el promedio de todo el negocio. Las barras por debajo de la línea son las oportunidades.",
        notes: `Enfoca la conversación en ${lo[0]}: es donde una mejora pequeña mueve el promedio.` });
      facts.push(`${m.name}: mejor ${hi[0]} (${fv(m, hi[1])}), peor ${lo[0]} (${fv(m, lo[1])}), promedio ${fv(m, avg)}.`);
    } else {
      slides.push({ id: "risk", type: "chart", kicker: "Alerta", tone: "warn", title: `${m.name} se dispara en ${hi[0]}: ${fv(m, hi[1])}`,
        sub: `Por ${dl} · promedio general ${fv(m, avg)}`,
        chart: { kind: "bar", labels: rows.map((r) => r[0]), series: [{ label: m.name, values: rows.map((r) => r[1]) }], fmt: m.fmt, ref: isFinite(avg) ? avg : null, refLabel: "Promedio", goodHigh: false },
        bullets: [`${hi[0]} está ${fv(m, hi[1] - avg)} por encima del promedio.`, `El nivel más sano lo tiene ${lo[0]} (${fv(m, lo[1])}).`, `Revisar las causas en ${hi[0]} antes de crecer ahí.`],
        how: "Es una medida de riesgo: aquí más alto es PEOR. Las barras sobre el promedio (rojas) piden revisión.",
        notes: `No es un problema general sino localizado en ${hi[0]}.` });
      facts.push(`Alerta ${m.name}: alto en ${hi[0]} (${fv(m, hi[1])}) vs promedio ${fv(m, avg)}.`);
    }
  }
  step("Comparando tasas y alertas…");
  if (perf) await rateSlide(perf, "perf");
  if (risk) await rateSlide(risk, "risk");

  // ---- Hallazgos y recomendaciones ----
  const cards = slides.filter((s) => s.type === "chart").slice(0, 4).map((s) => ({ kicker: s.kicker, text: s.title, tone: s.tone || (s.kicker === "Rendimiento" ? "ok" : "info") }));
  const recs = [];
  const sp = slides.find((s) => s.id === "pareto");
  if (sp) recs.push(`Proteger a los líderes de la concentración (${sp.chart.labels.slice(0, Math.min(3, sp.chart.highlight)).join(", ")}): son el 80 % del resultado.`);
  const pf = slides.find((s) => s.id === "perf");
  if (pf) recs.push(`Plan de mejora para ${pf.chart.labels.at(-1)}: llevarlo al promedio en ${pf.chart.series[0].label}.`);
  const rk = slides.find((s) => s.id === "risk");
  if (rk) recs.push(`Investigar la causa de ${rk.chart.series[0].label} en ${rk.chart.labels[0]} y medirla cada periodo.`);
  const tr = slides.find((s) => s.id === "trend");
  if (tr) recs.push(`Seguir la tendencia mes a mes con una alerta si ${main.name} cae por debajo del promedio.`);
  let summary = "";
  if (opts.useAI) {
    step("Redactando el resumen con la IA…");
    try {
      const pregunta = "Eres consultor senior. Con SOLO estos hallazgos (no inventes cifras), redacta un resumen ejecutivo de 3 frases para dirección: qué pasa, por qué importa y qué hacer. Español, tono directo, sin viñetas ni markdown.";
      const res = await Promise.race([api.aiAnalizar(appId, { pregunta, contexto: { hallazgos: facts } }), new Promise((r) => setTimeout(() => r(null), 18000))]);
      if (res && res.ok && res.message) summary = String(res.message).replace(/[#*`]/g, "").trim();
    } catch { /* sin IA: resumen por reglas */ }
  }
  if (!summary) summary = facts.slice(0, 3).join(" ");
  slides.push({ id: "findings", type: "findings", kicker: "Hallazgos", title: "Lo que hay que llevarse", sub: summary, cards, recs,
    how: "Cada tarjeta resume una diapositiva anterior. Las recomendaciones salen de esos mismos números.",
    notes: "Cierra con las recomendaciones y pide una decisión concreta para la siguiente reunión." });

  // ---- Anexo ----
  const ann = primary || conc;
  if (ann) {
    const extra = [perf, risk].filter(Boolean);
    let cols = [main, ...extra];
    let data;
    try { data = await q(appId, ann.dim, cols); } catch { cols = [main]; data = { labels: ann.r.labels, series: [ann.r.series[0]] }; }
    const rows = data.labels.map((l, i) => [l, ...cols.map((_, k) => data.series[k]?.[i])]).sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0)).slice(0, 12);
    slides.push({ id: "annex", type: "table", kicker: "Anexo", title: `Detalle por ${label(ann.dim).toLowerCase()}`, sub: "Las cifras completas para consultar", head: [label(ann.dim), ...cols.map((m) => m.name)],
      rows: rows.map((r) => [r[0], ...cols.map((m, k) => fv(m, r[k + 1]))]), notes: "Deja esta diapositiva para preguntas." });
  }
  return { appName, title, period, measure: main.name, slides, measures: measures.map((m) => ({ id: m.id, name: m.name })), dims: cats.map((c) => c.dim.field), facts, created: new Date() };
}

/* ======================================================================
   2) Gráficos (los mismos en la presentación y en el PDF)
   ====================================================================== */
function css(v, fb) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim() || fb; }

function chartConfig(ch, { animate = true, dark = false, print = false } = {}) {
  const ink = print ? "#475569" : dark ? "#cbd5e1" : "#475569";
  const grid = print ? "rgba(15,23,42,.08)" : dark ? "rgba(255,255,255,.08)" : "rgba(15,23,42,.08)";
  const A = css("--ds-a", "#6366f1"), B = css("--ds-b", "#06b6d4");
  const f = (v) => formatValue(v, ch.fmt);
  const base = {
    responsive: !print, maintainAspectRatio: false, devicePixelRatio: print ? 2 : undefined,
    animation: animate ? { duration: 900, easing: "easeOutQuart" } : false,
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${f(c.parsed.y ?? c.parsed)}` } } },
    scales: {
      x: { ticks: { color: ink, font: { size: print ? 13 : 12 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 }, grid: { display: false } },
      y: { ticks: { color: ink, font: { size: print ? 12 : 11 }, callback: (v) => f(v), maxTicksLimit: 6 }, grid: { color: grid }, beginAtZero: true },
    },
  };
  const refPlugin = {
    id: "stRef",
    afterDatasetsDraw(c) {
      if (ch.ref == null || !c.scales.y) return;
      const y = c.scales.y.getPixelForValue(ch.ref), { left, right } = c.chartArea, x = c.ctx;
      x.save(); x.setLineDash([6, 5]); x.strokeStyle = print ? "#64748b" : dark ? "#e2e8f0" : "#64748b"; x.lineWidth = 1.5;
      x.beginPath(); x.moveTo(left, y); x.lineTo(right, y); x.stroke(); x.setLineDash([]);
      x.fillStyle = x.strokeStyle; x.font = `600 ${print ? 13 : 11}px Segoe UI, sans-serif`; x.textAlign = "right";
      x.fillText(`${ch.refLabel || "Ref."} ${f(ch.ref)}`, right, y - 6); x.restore();
    },
  };
  if (ch.kind === "doughnut") {
    return { type: "doughnut", data: { labels: ch.labels, datasets: [{ data: ch.series[0].values, backgroundColor: ch.labels.map((_, i) => PALETTE[i % PALETTE.length]), borderColor: print ? "#fff" : dark ? "#0b1124" : "#fff", borderWidth: 3, hoverOffset: 10 }] },
      options: { ...base, cutout: "62%", scales: {}, plugins: { ...base.plugins, legend: { display: true, position: "right", labels: { color: ink, boxWidth: 12, padding: 14, font: { size: print ? 14 : 13 } } },
        tooltip: { callbacks: { label: (c) => ` ${c.label}: ${f(c.parsed)}` } } } } };
  }
  if (ch.kind === "line") {
    const ctxGrad = (c) => { const { ctx, chartArea } = c.chart; if (!chartArea) return A + "33"; const g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom); g.addColorStop(0, A + "55"); g.addColorStop(1, A + "00"); return g; };
    return { type: "line", data: { labels: ch.labels, datasets: [{ label: ch.series[0].label, data: ch.series[0].values, borderColor: A, backgroundColor: ctxGrad, fill: true, tension: .35, borderWidth: 3,
      pointRadius: ch.labels.map((_, i) => (ch.mark?.includes(i) ? 6 : 0)), pointBackgroundColor: ch.labels.map((_, i) => (i === ch.mark?.[0] ? "#10b981" : i === ch.mark?.[1] ? "#ef4444" : A)), pointBorderColor: "#fff", pointBorderWidth: 2 }] },
      options: base, plugins: [refPlugin] };
  }
  if (ch.kind === "pareto") {
    return { type: "bar", data: { labels: ch.labels, datasets: [
      { type: "bar", label: ch.series[0].label, data: ch.series[0].values, backgroundColor: ch.labels.map((_, i) => (i < ch.highlight ? A : (dark ? "#334155" : "#cbd5e1"))), borderRadius: 6, yAxisID: "y", order: 2 },
      { type: "line", label: "% acumulado", data: ch.cum, borderColor: "#f59e0b", backgroundColor: "#f59e0b", pointRadius: 0, borderWidth: 2.5, tension: .25, yAxisID: "y2", order: 1 },
    ] }, options: { ...base, scales: { ...base.scales, y2: { position: "right", min: 0, max: 100, grid: { display: false }, ticks: { color: ink, callback: (v) => `${v} %`, font: { size: print ? 12 : 11 } } } },
      plugins: { ...base.plugins, tooltip: { callbacks: { label: (c) => (c.dataset.yAxisID === "y2" ? ` Acumulado: ${pctTxt(c.parsed.y)}` : ` ${c.dataset.label}: ${f(c.parsed.y)}`) } } } } };
  }
  // barras con referencia (verde/rojo según si «alto es bueno»)
  const vals = ch.series[0].values;
  const colors = vals.map((v) => (ch.ref == null ? A : (ch.goodHigh ? v >= ch.ref : v <= ch.ref) ? "#10b981" : "#ef4444"));
  return { type: "bar", data: { labels: ch.labels, datasets: [{ label: ch.series[0].label, data: vals, backgroundColor: colors.map((c) => c + "dd"), borderRadius: 8, maxBarThickness: 70 }] },
    // Barras siempre desde cero: un eje recortado exagera diferencias pequeñas (estándar de visualización honesta).
    options: base, plugins: [refPlugin] };
}

/* ======================================================================
   3) Modo presentación
   ====================================================================== */
function slideHtml(s, i, n, { thumb = false } = {}) {
  const k = `<div class="st-kicker" data-anim style="--d:0"><span>${esc(s.kicker || "")}</span>${thumb ? "" : `<em>${i + 1} / ${n}</em>`}</div>`;
  const head = `<h2 class="st-h" data-anim style="--d:1">${esc(s.title)}</h2>${s.sub ? `<p class="st-sub" data-anim style="--d:2">${esc(s.sub)}</p>` : ""}`;
  const how = s.how && !thumb ? `<button class="st-how" type="button" data-how>¿Cómo leerlo?</button><div class="st-howcard" hidden><b>Cómo leer esta diapositiva</b><p>${esc(s.how)}</p></div>` : "";
  if (s.type === "cover") {
    return `<section class="st-slide t-cover"><div class="st-cover-orb"></div><div class="st-cover-in">
      <div class="st-kicker" data-anim style="--d:0"><span>${esc(s.kicker)}</span></div>
      <h1 class="st-cover-h" data-anim style="--d:1">${esc(s.title)}</h1>
      <p class="st-cover-sub" data-anim style="--d:2">${esc(s.sub)}</p>
      <p class="st-cover-meta" data-anim style="--d:3">${n - 1} mensajes · ${new Date().toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric" })}</p></div></section>`;
  }
  if (s.type === "kpis") {
    return `<section class="st-slide t-kpis">${k}${head}<div class="st-kpis n${s.items.length}">${s.items.map((it, j) => `
      <div class="st-kpi ${j === 0 ? "lead" : ""}" data-anim style="--d:${3 + j}">
        <span class="st-kpi-l">${esc(it.name)}</span>
        <b class="st-kpi-v" data-count="${j}">${esc(it.value)}</b>
        ${it.deltaTxt ? `<span class="st-kpi-d ${it.good ? "up" : "down"}">${it.delta >= 0 ? "▲" : "▼"} ${esc(it.deltaTxt)}</span>` : ""}
        ${it.spark ? sparkSvg(it.spark, it.good) : ""}
        ${it.desc && !thumb ? `<small>${esc(it.desc)}</small>` : ""}
      </div>`).join("")}</div>${how}</section>`;
  }
  if (s.type === "chart") {
    return `<section class="st-slide t-chart ${s.tone ? "tone-" + s.tone : ""}">${k}${head}<div class="st-body">
      <div class="st-chart" data-anim style="--d:3"><canvas></canvas></div>
      <ul class="st-bullets">${(s.bullets || []).map((b, j) => `<li data-anim style="--d:${4 + j}"><i>${j + 1}</i><span>${esc(b)}</span></li>`).join("")}</ul>
    </div>${how}</section>`;
  }
  if (s.type === "findings") {
    return `<section class="st-slide t-findings">${k}${head}<div class="st-cards">${s.cards.map((c, j) => `
      <div class="st-card tone-${c.tone}" data-anim style="--d:${3 + j}"><span>${esc(c.kicker)}</span><p>${esc(c.text)}</p></div>`).join("")}</div>
      ${s.recs?.length ? `<div class="st-recs" data-anim style="--d:${4 + s.cards.length}"><b>Qué hacer</b><ol>${s.recs.map((r) => `<li>${esc(r)}</li>`).join("")}</ol></div>` : ""}${how}</section>`;
  }
  return `<section class="st-slide t-table">${k}${head}<div class="st-table" data-anim style="--d:3"><table><thead><tr>${s.head.map((h, j) => `<th class="${j ? "num" : ""}">${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>${s.rows.map((r) => `<tr>${r.map((v, j) => `<td class="${j ? "num" : ""}">${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></section>`;
}

function sparkSvg(vals, good) {
  const w = 120, h = 34, mx = Math.max(...vals), mn = Math.min(...vals), span = mx - mn || 1;
  const pts = vals.map((v, i) => `${(i / Math.max(1, vals.length - 1)) * w},${h - 3 - ((v - mn) / span) * (h - 6)}`).join(" ");
  return `<svg class="st-spark ${good ? "up" : "down"}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}"/></svg>`;
}

/** Abre la presentación a pantalla completa. */
export function openPresentation(story, startAt = 0) {
  const slides = visibleSlides(story);
  let cur = Math.max(0, Math.min(startAt, slides.length - 1));
  let chart = null;
  const root = document.createElement("div");
  root.className = "st-deck";
  root.tabIndex = 0;
  root.innerHTML = `
    <div class="st-top"><span class="st-top-t">${esc(story.title)}</span><span class="st-top-sp"></span>
      <button type="button" data-a="grid" title="Vista general (O)">▦</button>
      <button type="button" data-a="notes" title="Notas del presentador (N)">✎</button>
      <button type="button" data-a="fs" title="Pantalla completa (F)">⛶</button>
      <button type="button" data-a="close" title="Salir (Esc)">✕</button></div>
    <div class="st-stage"><div class="st-frame"></div></div>
    <button type="button" class="st-nav prev" data-a="prev" aria-label="Anterior">‹</button>
    <button type="button" class="st-nav next" data-a="next" aria-label="Siguiente">›</button>
    <div class="st-dots">${slides.map((s, i) => `<button type="button" data-go="${i}" title="${esc(s.kicker || s.title)}"></button>`).join("")}</div>
    <div class="st-bar"><i></i></div>
    <aside class="st-notes" hidden><b>Notas del presentador</b><p></p></aside>
    <div class="st-grid" hidden></div>`;
  document.body.appendChild(root);
  document.body.classList.add("st-open");
  const frame = root.querySelector(".st-frame");

  const fit = () => {
    const st = root.querySelector(".st-stage"), W = st.clientWidth - 40, H = st.clientHeight - 30;
    const k = Math.min(W / 1280, H / 720);
    frame.style.transform = `scale(${k})`;
  };
  function countUp(el, item) {
    const raw = Number(item.raw);
    if (!isFinite(raw)) return;
    const t0 = performance.now(), dur = 900;
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = formatValue(raw * e, item.fmt);
      if (p < 1 && el.isConnected) requestAnimationFrame(tick); else el.textContent = item.value;
    };
    requestAnimationFrame(tick);
  }
  function show(i, dir = 1) {
    cur = (i + slides.length) % slides.length;
    const s = slides[cur];
    if (chart) { try { chart.destroy(); } catch {} chart = null; }
    frame.innerHTML = slideHtml(s, cur, slides.length);
    const el = frame.firstElementChild;
    el.classList.add(dir >= 0 ? "from-r" : "from-l");
    requestAnimationFrame(() => requestAnimationFrame(() => { el.classList.add("in"); el.querySelectorAll("[data-anim]").forEach((a) => a.classList.add("in")); }));
    if (s.type === "chart" && window.Chart) {
      setTimeout(() => { const cv = el.querySelector("canvas"); if (cv && el.isConnected) chart = new window.Chart(cv, chartConfig(s.chart, { dark: true })); }, 250);
    }
    if (s.type === "kpis") el.querySelectorAll("[data-count]").forEach((b) => setTimeout(() => countUp(b, s.items[Number(b.dataset.count)]), 300 + Number(b.dataset.count) * 120));
    el.querySelector("[data-how]")?.addEventListener("click", (e) => { e.stopPropagation(); const c = el.querySelector(".st-howcard"); c.hidden = !c.hidden; });
    root.querySelector(".st-bar i").style.width = `${((cur + 1) / slides.length) * 100}%`;
    root.querySelectorAll(".st-dots button").forEach((b, k) => b.classList.toggle("on", k === cur));
    root.querySelector(".st-notes p").textContent = s.notes || "Sin notas.";
    root.querySelector(".prev").disabled = cur === 0;
    root.querySelector(".next").disabled = cur === slides.length - 1;
  }
  function grid(open) {
    const g = root.querySelector(".st-grid");
    g.hidden = !open;
    if (!open) return;
    g.innerHTML = slides.map((s, i) => `<div class="st-gitem ${i === cur ? "on" : ""}"><button type="button" class="st-thumb" data-go="${i}"><div class="st-thumb-in">${slideHtml(s, i, slides.length, { thumb: true })}</div></button><span>${i + 1}. ${esc(s.kicker || "")}</span></div>`).join("");
    g.querySelectorAll(".st-thumb-in [data-anim], .st-thumb-in .st-slide").forEach((a) => a.classList.add("in"));
    fitThumbs(g);
  }
  function close() {
    if (chart) { try { chart.destroy(); } catch {} }
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", fit);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    document.body.classList.remove("st-open");
    root.remove();
  }
  const onKey = (e) => {
    if (!root.isConnected) return;
    const g = root.querySelector(".st-grid");
    if (e.key === "Escape") { e.preventDefault(); if (!g.hidden) grid(false); else close(); return; }
    if (["ArrowRight", "PageDown", " ", "Enter"].includes(e.key)) { e.preventDefault(); if (cur < slides.length - 1) show(cur + 1, 1); }
    else if (["ArrowLeft", "PageUp", "Backspace"].includes(e.key)) { e.preventDefault(); if (cur > 0) show(cur - 1, -1); }
    else if (e.key === "Home") { e.preventDefault(); show(0, -1); }
    else if (e.key === "End") { e.preventDefault(); show(slides.length - 1, 1); }
    else if (e.key.toLowerCase() === "n") root.querySelector(".st-notes").hidden ^= true;
    else if (e.key.toLowerCase() === "o") grid(g.hidden);
    else if (e.key.toLowerCase() === "f") toggleFs();
  };
  const toggleFs = () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else root.requestFullscreen?.().catch(() => {}); };
  root.addEventListener("click", (e) => {
    const go = e.target.closest("[data-go]");
    if (go) { const i = Number(go.dataset.go); grid(false); show(i, i >= cur ? 1 : -1); return; }
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (a === "close") close();
    else if (a === "prev" && cur > 0) show(cur - 1, -1);
    else if (a === "next" && cur < slides.length - 1) show(cur + 1, 1);
    else if (a === "notes") root.querySelector(".st-notes").hidden ^= true;
    else if (a === "grid") grid(root.querySelector(".st-grid").hidden);
    else if (a === "fs") toggleFs();
  });
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", fit);
  fit(); show(cur, 1); root.focus();
  return { close, go: (i) => show(i, 1), get index() { return cur; } };
}

/** Escala cada miniatura (diapositiva de 1280 px) al ancho real de su marco. */
function fitThumbs(root) {
  root.querySelectorAll(".st-thumb").forEach((t) => { if (t.clientWidth) t.style.setProperty("--k", String(t.clientWidth / 1280)); });
}

/** Miniaturas para el estudio (sin animación). */
export function slideThumb(s, i, n) {
  const html = slideHtml(s, i, n, { thumb: true });
  return html;
}

/* ======================================================================
   4) PDF apaisado 16:9 (una idea por página)
   ====================================================================== */
async function chartPng(ch, w = 1180, h = 560) {
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-99999px;top:0;width:${w}px;height:${h}px;background:#fff`;
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h; cv.style.width = w + "px"; cv.style.height = h + "px";
  host.appendChild(cv); document.body.appendChild(host);
  const cfg = chartConfig(ch, { animate: false, print: true });
  cfg.options.responsive = false;
  cfg.options.devicePixelRatio = 1;   // el lienzo ya es 2× el tamaño impreso
  // Fondo blanco: el JPEG (mucho más liviano que PNG) no tiene transparencia.
  cfg.plugins = [...(cfg.plugins || []), { id: "stWhite", beforeDraw(c) { const x = c.ctx; x.save(); x.globalCompositeOperation = "destination-over"; x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.restore(); } }];
  const c = new window.Chart(cv, cfg);
  await new Promise((r) => setTimeout(r, 60));
  const url = cv.toDataURL("image/jpeg", 0.9);
  c.destroy(); host.remove();
  return url;
}

const rgb = (hex) => { const n = parseInt(hex.replace("#", ""), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

export async function exportStoryPdf(story, fileName) {
  const { jsPDF } = window.jspdf;
  const W = 960, H = 540, M = 44;
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: [W, H] });
  // Helvetica (WinAnsi) no tiene «−» (U+2212) ni espacios finos: se normalizan en un único punto.
  const clean = (t) => (Array.isArray(t) ? t.map(clean) : String(t ?? "").replace(/\u2212/g, "-").replace(/[\u2009\u202f]/g, " "));
  const _text = doc.text.bind(doc), _split = doc.splitTextToSize.bind(doc);
  doc.text = (t, ...a) => _text(clean(t), ...a);
  doc.splitTextToSize = (t, ...a) => _split(clean(t), ...a);
  const A = rgb(css("--ds-a", "#6366f1").startsWith("#") ? css("--ds-a", "#6366f1") : "#6366f1");
  const INK = [15, 23, 42], MUT = [100, 116, 139], SOFT = [244, 246, 251];
  const slides = visibleSlides(story);
  const foot = (i) => {
    doc.setDrawColor(226, 232, 240); doc.setLineWidth(.6); doc.line(M, H - 30, W - M, H - 30);
    doc.setFontSize(8.5); doc.setTextColor(...MUT); doc.setFont("helvetica", "normal");
    doc.text(`${story.appName} · ${story.title}`, M, H - 16);
    doc.text(`${i + 1} / ${slides.length}`, W - M, H - 16, { align: "right" });
  };
  const header = (s, i) => {
    doc.setFillColor(...A); doc.rect(0, 0, 6, H, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(...A);
    doc.text(String(s.kicker || "").toUpperCase(), M, 46, { charSpace: 1.2 });
    doc.setTextColor(...INK); doc.setFontSize(21);
    const lines = doc.splitTextToSize(s.title, W - 2 * M);
    doc.text(lines.slice(0, 2), M, 74);
    let y = 74 + Math.min(2, lines.length) * 24;
    if (s.sub) { doc.setFont("helvetica", "normal"); doc.setFontSize(11.5); doc.setTextColor(...MUT); const sl = doc.splitTextToSize(s.sub, W - 2 * M); doc.text(sl.slice(0, 3), M, y); y += Math.min(3, sl.length) * 14 + 6; }
    return y + 8;
  };
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    if (i) doc.addPage([W, H], "landscape");
    if (s.type === "cover") {
      doc.setFillColor(15, 23, 42); doc.rect(0, 0, W, H, "F");
      doc.setFillColor(...A); doc.circle(W - 120, 110, 190, "F");
      doc.setFillColor(6, 182, 212); doc.circle(W - 40, 300, 90, "F");
      doc.setFillColor(15, 23, 42); doc.rect(0, 0, W * 0.62, H, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(165, 180, 252); doc.text(String(s.kicker || "").toUpperCase(), M + 6, 150, { charSpace: 1.4 });
      doc.setFontSize(34); doc.setTextColor(255, 255, 255); doc.text(doc.splitTextToSize(s.title, W * 0.55).slice(0, 3), M + 6, 196);
      doc.setFont("helvetica", "normal"); doc.setFontSize(13); doc.setTextColor(203, 213, 225); doc.text(s.sub || "", M + 6, 330);
      doc.setFontSize(10); doc.setTextColor(148, 163, 184); doc.text(`Generado el ${new Date().toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric" })} · datos reales de la app`, M + 6, 352);
      continue;
    }
    let y = header(s, i);
    if (s.type === "kpis") {
      const n = s.items.length, gap = 14, w = (W - 2 * M - gap * (n - 1)) / n, h = 128;
      s.items.forEach((it, j) => {
        const x = M + j * (w + gap);
        doc.setFillColor(...(j === 0 ? A : SOFT)); doc.roundedRect(x, y, w, h, 10, 10, "F");
        doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); doc.setTextColor(...(j === 0 ? [224, 231, 255] : MUT)); doc.text(doc.splitTextToSize(it.name, w - 28).slice(0, 2), x + 16, y + 26);
        doc.setFont("helvetica", "bold"); doc.setFontSize(n > 3 ? 22 : 26); doc.setTextColor(...(j === 0 ? [255, 255, 255] : INK)); doc.text(String(it.value), x + 16, y + 82);
        if (it.deltaTxt) {
          const c = j === 0 ? [255, 255, 255] : it.good ? [5, 150, 105] : [220, 38, 38];
          doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.setTextColor(...c);
          doc.text(`${it.deltaTxt} vs periodo anterior`, x + 16, y + 106);
        }
      });
      if (s.how) { doc.setFont("helvetica", "italic"); doc.setFontSize(9.5); doc.setTextColor(...MUT); doc.text(doc.splitTextToSize(s.how, W - 2 * M), M, y + h + 30); }
    } else if (s.type === "chart") {
      const cw = 560, chh = Math.min(300, H - y - 50);
      const png = await chartPng(s.chart, 1120, Math.round(chh * 2));
      doc.addImage(png, "JPEG", M, y, cw, chh, undefined, "FAST");
      let by = y + 6; const bx = M + cw + 26, bw = W - M - bx;
      (s.bullets || []).forEach((b, j) => {
        doc.setFillColor(...A); doc.circle(bx + 9, by + 8, 9, "F");
        doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(255, 255, 255); doc.text(String(j + 1), bx + 9, by + 11.5, { align: "center" });
        doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.setTextColor(...INK);
        const t = doc.splitTextToSize(b, bw - 28); doc.text(t, bx + 26, by + 12); by += t.length * 14 + 16;
      });
      if (s.how) {
        const t = doc.splitTextToSize(`Cómo leerlo: ${s.how}`, bw - 20);
        const hh = t.length * 12 + 18;
        doc.setFillColor(...SOFT); doc.roundedRect(bx, Math.max(by + 6, y + chh - hh), bw, hh, 8, 8, "F");
        doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...MUT); doc.text(t, bx + 10, Math.max(by + 6, y + chh - hh) + 16);
      }
    } else if (s.type === "findings") {
      const cols = 2, gap = 14, w = (W - 2 * M - gap) / cols, h = 64;
      s.cards.forEach((c, j) => {
        const x = M + (j % cols) * (w + gap), yy = y + Math.floor(j / cols) * (h + 10);
        const tone = c.tone === "warn" ? [254, 243, 199] : c.tone === "ok" ? [209, 250, 229] : SOFT;
        doc.setFillColor(...tone); doc.roundedRect(x, yy, w, h, 8, 8, "F");
        doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(...A); doc.text(String(c.kicker).toUpperCase(), x + 12, yy + 17, { charSpace: 1 });
        doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); doc.setTextColor(...INK); doc.text(doc.splitTextToSize(c.text, w - 24).slice(0, 2), x + 12, yy + 34);
      });
      let ry = y + Math.ceil(s.cards.length / cols) * (h + 10) + 14;
      if (s.recs?.length) {
        doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(...INK); doc.text("Qué hacer", M, ry); ry += 16;
        doc.setFont("helvetica", "normal"); doc.setFontSize(10.5);
        s.recs.forEach((r, j) => { const t = doc.splitTextToSize(`${j + 1}. ${r}`, W - 2 * M); if (ry + t.length * 13 < H - 40) { doc.text(t, M, ry); ry += t.length * 13 + 4; } });
      }
    } else if (s.type === "table") {
      doc.autoTable({ startY: y, head: [clean(s.head)], body: s.rows.map(clean), margin: { left: M, right: M }, theme: "plain",
        styles: { fontSize: 10, cellPadding: 6, textColor: INK }, headStyles: { fillColor: A, textColor: [255, 255, 255], fontStyle: "bold" },
        alternateRowStyles: { fillColor: SOFT }, columnStyles: Object.fromEntries(s.head.map((_, j) => [j, { halign: j ? "right" : "left" }])) });
    }
    foot(i);
  }
  doc.save(fileName || `${story.title.replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 60)}.pdf`);
}

/* ======================================================================
   5) Estudio (pestaña «Historia de datos» en Informes)
   ====================================================================== */
export function mountStoryStudio(pane, { appId, appName, fields }) {
  const st = { story: null, busy: false, measures: [], cfg: { title: "", mainMeasureId: "", mainDim: "", useAI: true } };
  pane.innerHTML = `
    <div class="st-studio">
      <div class="st-intro">
        <div><h3>Historia de datos</h3>
          <p>Un informe que <b>cuenta algo</b>: cada diapositiva responde una pregunta con su conclusión ya calculada, la gráfica que la prueba y qué hacer. Preséntalo a pantalla completa o descárgalo en PDF apaisado (una idea por página).</p></div>
      </div>
      <div class="st-config">
        <label>Título<input id="stTitle" placeholder="Se propone uno a partir de la medida principal" maxlength="90"></label>
        <label>Medida principal<select id="stMeas"><option value="">Automática (la oficial más relevante)</option></select></label>
        <label>Dimensión principal<select id="stDim"><option value="">Automática</option>${(fields.dimensions || []).map((d) => `<option value="${esc(d.field)}">${esc(d.display || d.field)}</option>`).join("")}</select></label>
        <label class="st-chk"><input type="checkbox" id="stAI" checked> Resumen redactado por la IA</label>
        <button class="q-btn primary" id="stBuild">Armar historia</button>
      </div>
      <div class="st-out" id="stOut"><div class="st-empty">Pulsa <b>Armar historia</b>: en unos segundos tendrás las diapositivas listas para presentar.</div></div>
    </div>`;
  const $ = (s) => pane.querySelector(s);
  loadMeasures(appId, fields).then((ms) => {
    st.measures = ms;
    $("#stMeas").insertAdjacentHTML("beforeend", ms.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join(""));
  }).catch(() => {});
  $("#stBuild").addEventListener("click", build);

  async function build() {
    if (st.busy) return;
    st.busy = true;
    const b = $("#stBuild"); b.disabled = true;
    const out = $("#stOut");
    out.innerHTML = `<div class="st-empty"><span class="in-spin"></span> <span id="stStep">Preparando…</span></div>`;
    try {
      st.story = await buildStory(appId, appName, fields, {
        title: $("#stTitle").value.trim(), mainMeasureId: $("#stMeas").value, mainDim: $("#stDim").value, useAI: $("#stAI").checked,
        onStep: (t) => { const e = $("#stStep"); if (e) e.textContent = t; },
      });
      paint();
      // Base de conocimiento (solo guarda si la persona la tiene activa): titulares y hallazgos de la historia.
      const s = st.story;
      api.kbCapture({
        kind: "report", app_id: appId, ref: `story:${appId}:${s.measure}`, title: `Historia de datos · ${s.title}`,
        text: [s.period ? `Periodo: ${s.period}` : "", ...s.slides.filter((x) => x.type !== "cover").map((x) => `${x.kicker}: ${x.title}`), ...(s.facts || [])].filter(Boolean).join("\n"),
        entities: [{ label: s.measure, type: "measure" }],
      }).catch(() => {});
    } catch (e) { out.innerHTML = `<div class="st-empty err">${esc(e.message)}</div>`; }
    st.busy = false; b.disabled = false;
  }

  function paint() {
    const s = st.story, n = s.slides.length;
    $("#stOut").innerHTML = `
      <div class="st-actions">
        <div><b>${esc(s.title)}</b><span>${visibleSlides(s).length} diapositivas · ${esc(s.period || "sin dimensión de tiempo")}</span></div>
        <button class="q-btn primary" id="stPlay">▶ Presentar</button>
        <button class="q-btn" id="stPdf">⤓ PDF apaisado</button>
      </div>
      <p class="st-help">Clic en una diapositiva para presentar desde ahí · interruptor para quitarla · en la presentación: ← → para avanzar, <b>O</b> vista general, <b>N</b> notas, <b>F</b> pantalla completa.</p>
      <div class="st-strip">${s.slides.map((sl, i) => `
        <div class="st-tcard ${sl.off ? "off" : ""}">
          <button type="button" class="st-thumb" data-play="${i}"><div class="st-thumb-in">${slideThumb(sl, i, n)}</div></button>
          <div class="st-tcard-f"><span>${i + 1}. ${esc(sl.kicker || sl.type)}</span>
            <label class="st-sw" title="Incluir en la presentación y el PDF"><input type="checkbox" data-tog="${i}" ${sl.off ? "" : "checked"} ${sl.type === "cover" ? "disabled" : ""}><i></i></label></div>
        </div>`).join("")}</div>`;
    pane.querySelectorAll(".st-thumb-in [data-anim], .st-thumb-in .st-slide").forEach((a) => a.classList.add("in"));
    fitThumbs(pane);
    if (!st.ro && window.ResizeObserver) { st.ro = new ResizeObserver(() => fitThumbs(pane)); st.ro.observe(pane); }
    // Gráficas reales también en las miniaturas (sin animación).
    pane.querySelectorAll(".st-tcard").forEach((card, i) => {
      const sl = s.slides[i], cv = card.querySelector("canvas");
      if (sl.type === "chart" && cv && window.Chart) { try { new window.Chart(cv, chartConfig(sl.chart, { animate: false, dark: true })); } catch { /* miniatura sin gráfico */ } }
    });
    pane.querySelectorAll("[data-tog]").forEach((c) => c.addEventListener("change", () => { s.slides[Number(c.dataset.tog)].off = !c.checked; paint(); }));
    pane.querySelectorAll("[data-play]").forEach((bt) => bt.addEventListener("click", () => {
      const i = Number(bt.dataset.play);
      if (s.slides[i].off) return;
      openPresentation(s, visibleSlides(s).indexOf(s.slides[i]));
    }));
    $("#stPlay").addEventListener("click", () => openPresentation(s, 0));
    $("#stPdf").addEventListener("click", async (e) => {
      const btn = e.currentTarget; btn.disabled = true; btn.textContent = "Generando…";
      try { await exportStoryPdf(s); } catch (err) { alert("No se pudo generar el PDF: " + err.message); }
      btn.disabled = false; btn.textContent = "⤓ PDF apaisado";
    });
  }
  return () => {};
}

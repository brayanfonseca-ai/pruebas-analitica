/**
 * «Historia de datos» (Informes → Historia y presentación) para el MCP.
 *
 * Port de buildStory() de frontend/js/informe-historia.js: arma la misma secuencia
 * de diapositivas (portada, KPIs, tendencia, Pareto, mezcla, rendimiento, alerta,
 * hallazgos, anexo) con las medidas maestras de la app y el motor de consultas.
 * Devuelve JSON (titulares, viñetas, datos de cada gráfico, notas); el PDF y la
 * presentación se generan en el navegador.
 */

import { get, post } from "../http-client.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const A = (appId: unknown) => `/api/v1/apps/${encodeURIComponent(String(appId))}`;
const nat = (a: unknown, b: unknown) => String(a).localeCompare(String(b), "es", { numeric: true });
const pctTxt = (p: number | null | undefined, d = 1) => (p == null || !isFinite(p) ? "—" : `${p.toLocaleString("es-CO", { maximumFractionDigits: d })} %`);
const signPct = (p: number | null | undefined) => (p == null || !isFinite(p) ? "" : `${p >= 0 ? "+" : "−"}${Math.abs(p).toLocaleString("es-CO", { maximumFractionDigits: 1 })} %`);
const TIME_RX = /^(mes|month|periodo|período|fecha|date|a[nñ]o|anio|year|semana|week|trimestre|quarter)\b/i;
const ID_RX = /(^|[\s_])(id|cod|codigo|código|cedula|cédula|nit|documento|telefono|celular|email|correo)($|[\s_])/i;
const RATIO_RX = /%|porcentaje|tasa|ratio|promedio|media|ticket|margen %|tiempo medio/i;
const RISK_RX = /devoluci|cancelaci|abandono|rotaci|retiro|churn|reclamo|queja|error|falla|mora|riesgo|p[eé]rdida|bajas/i;

/* ---------------- Formato (mismo criterio que frontend/js/num-format.js) ---------------- */
const CUR: Record<string, string> = { COP: "$", USD: "US$", EUR: "€" };
const SCALE: Record<string, [number, string]> = { K: [1e3, " mil"], M: [1e6, " M"], B: [1e9, " mil M"] };
const LEGACY: Record<string, Any> = { number: { type: "number", decimals: 2 }, integer: { type: "integer", decimals: 0 }, percent: { type: "percent", decimals: 1 }, money: { type: "currency", currency: "USD", decimals: 2 } };
function normFormat(f: Any): Any {
  if (!f) return null;
  if (typeof f === "string") return f === "auto" ? null : LEGACY[f] || null;
  if (typeof f === "object" && (!f.type || f.type === "auto") && !f.prefix && !f.suffix) return null;
  return f;
}
function formatValue(v: Any, fmt: Any): string {
  const f = normFormat(fmt);
  if (v === null || v === undefined || (typeof v === "number" && Number.isNaN(v))) return "-";
  if (!f) return typeof v === "number" ? v.toLocaleString("es-CO", { maximumFractionDigits: 2 }) : String(v);
  if (f.type === "text" || f.type === "date") return String(v);
  let n = typeof v === "number" ? v : Number(v);
  if (Number.isNaN(n)) return String(v);
  const dec = Math.max(0, Math.min(4, Number.isFinite(Number(f.decimals)) ? Number(f.decimals) : f.type === "integer" ? 0 : 2));
  let suffix = f.suffix || "";
  let pre = f.prefix || "";
  if (f.type === "percent") { n = Math.abs(n) > 1.5 ? n : n * 100; suffix = suffix || " %"; }
  let sc = f.scale;
  if (sc === "auto") { const a = Math.abs(n); sc = a >= 1e9 ? "B" : a >= 1e6 ? "M" : a >= 1e3 ? "K" : "none"; }
  if (SCALE[sc]) { n = n / SCALE[sc][0]; suffix = SCALE[sc][1] + suffix; }
  if (f.type === "currency") pre = pre || (CUR[f.currency || "COP"] || "$") + " ";
  const d = f.type === "integer" ? 0 : dec;
  return pre + n.toLocaleString("es-CO", { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: f.thousands !== false }) + suffix;
}
const fv = (m: Any, v: Any) => formatValue(v, m?.fmt);

function plural(w: string): string {
  const s = String(w || "").toLowerCase().trim();
  if (!s) return s;
  if (/[aeiouáéó]$/.test(s)) return s + "s";
  if (/z$/.test(s)) return s.slice(0, -1) + "ces";
  return s.replace(/ón$/, "on").replace(/án$/, "an").replace(/és$/, "es") + "es";
}

async function loadMeasures(appId: string, fields: Any): Promise<Any[]> {
  let masters: Any[] = [];
  try { masters = ((await get(`${A(appId)}/master-items`)) as Any[]).filter((m) => m.kind === "measure"); } catch { masters = []; }
  masters.sort((a, b) => (b.certified ? 1 : 0) - (a.certified ? 1 : 0));
  const out: Any[] = [];
  for (const m of masters.slice(0, 10)) {
    try {
      const r = (await post(`${A(appId)}/expressions/parse`, { kind: "measure", expression: m.expression })) as Any;
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

async function q(appId: string, dim: Any, measures: Any[]): Promise<Any> {
  const spec: Any = { measures: measures.map((m) => m.spec) };
  if (dim) spec.dimension = { table: dim.table, field: dim.field };
  const r = (await post(`${A(appId)}/query`, spec)) as Any;
  if (!dim) {
    const vals = r.series?.length ? r.series.map((s: Any) => s.values?.[0] ?? null) : Array.isArray(r.values) && r.values.length ? r.values : [r.value];
    return { value: r.value, values: vals };
  }
  const labels = (r.labels || []).map(String);
  const series = r.series?.length ? r.series.map((s: Any) => s.values) : [r.values || []];
  return { labels, series };
}

export interface StoryOptions { title?: string; mainMeasureId?: string; mainDim?: string; useAI?: boolean }

/** Arma la historia de datos de una app. Misma lógica que la UI. */
export async function buildStory(appId: string, opts: StoryOptions = {}): Promise<Any> {
  const app = (await get(A(appId)).catch(() => ({}))) as Any;
  const appName = String(app?.name || app?.app?.name || "");
  const fields = (await get(`${A(appId)}/fields`)) as Any;
  const measures = await loadMeasures(appId, fields);
  if (!measures.length) throw new Error("La app no tiene medidas para contar una historia (crea medidas maestras o carga datos numéricos).");
  const score = (m: Any) => (m.additive ? 10 : 0) + (/venta|ingreso|facturaci|revenue|sales|importe/i.test(m.name) ? 8 : 0) + (m.fmt?.type === "currency" ? 3 : 0) - (/margen|costo|utilidad|gasto/i.test(m.name) ? 2 : 0) - (m.risk ? 6 : 0);
  const main = measures.find((m) => m.id === opts.mainMeasureId) || [...measures].sort((a, b) => score(b) - score(a))[0];
  const sameTable = (d: Any) => d.table === main.spec.table;
  const dimsAll: Any[] = (fields.dimensions || []).filter((d: Any) => !ID_RX.test(d.field));
  const dims = dimsAll.filter(sameTable).length ? dimsAll.filter(sameTable) : dimsAll;

  const timeCands = dims.filter((d) => TIME_RX.test(d.field) || d.type === "date");
  const timeRank = (d: Any) => (/^mes|month|periodo|período/i.test(d.field) ? 0 : /trimestre|quarter|semana|week/i.test(d.field) ? 1 : /a[nñ]o|anio|year/i.test(d.field) ? 3 : 2);
  timeCands.sort((a, b) => timeRank(a) - timeRank(b));

  const cats: Any[] = [];
  for (const d of dims.filter((x) => !timeCands.includes(x)).slice(0, 10)) {
    try {
      const r = await q(appId, d, [main]);
      const vals = r.series[0].map((v: Any) => Number(v) || 0);
      const total = vals.reduce((a: number, b: number) => a + b, 0);
      if (r.labels.length >= 2 && total) cats.push({ dim: d, n: r.labels.length, r, total });
    } catch { /* dimensión no compatible con la medida */ }
  }
  const byPref = (lo: number, hi: number) => cats.filter((c) => c.n >= lo && c.n <= hi);
  const primary = cats.find((c) => c.dim.field === opts.mainDim) || byPref(3, 8)[0] || byPref(2, 15)[0] || cats[0];
  const detail = cats.filter((c) => c !== primary).sort((a, b) => b.n - a.n).find((c) => c.n >= 6 && c.n <= 60) || (primary && primary.n >= 6 ? primary : null);
  const secondary = cats.find((c) => c !== primary && c !== detail && c.n >= 2 && c.n <= 8) || cats.find((c) => c !== primary && c !== detail) || null;
  let time: Any = null;
  for (const t of timeCands) {
    try { const r = await q(appId, t, [main]); if (r.labels.length >= 3) { time = { dim: t, r }; break; } } catch { /* sigue */ }
  }

  const label = (d: Any) => d?.display || d?.field || "";
  const slides: Any[] = [];
  const facts: string[] = [];
  const kRank = (m: Any) => (m.additive ? 0 : m.risk ? 3 : 2) + (m.additive && /margen|utilidad/i.test(m.name) ? -0.5 : 0);
  const kpiMeasures = [main, ...measures.filter((m) => m !== main).sort((a, b) => kRank(a) - kRank(b))].slice(0, 4);

  let period = "", lastLbl = "", prevLbl = "";
  let kpiTime: Any = null;
  if (time) {
    const order = time.r.labels.map((l: Any, i: number) => [l, i]).sort((a: Any, b: Any) => nat(a[0], b[0]));
    period = `${order[0][0]} – ${order.at(-1)[0]}`;
    try { kpiTime = await q(appId, time.dim, kpiMeasures); } catch { kpiTime = null; }
  }
  const totals = await q(appId, null, kpiMeasures).catch(() => ({ values: [] }));
  const kpis = kpiMeasures.map((m, i) => {
    const item: Any = { name: m.name, raw: totals.values[i], value: fv(m, totals.values[i]), desc: m.desc };
    if (kpiTime) {
      const pairs = kpiTime.labels.map((l: Any, k: number) => [l, kpiTime.series[i]?.[k]]).sort((a: Any, b: Any) => nat(a[0], b[0])).filter((p: Any) => p[1] != null);
      if (pairs.length >= 2) {
        const [pl, pv] = pairs.at(-2), [ll, lv] = pairs.at(-1);
        lastLbl = ll; prevLbl = pl;
        item.spark = pairs.slice(-12).map((p: Any) => Number(p[1]) || 0);
        if (m.percent) { item.delta = Number(lv) - Number(pv); item.deltaTxt = `${item.delta >= 0 ? "+" : "−"}${Math.abs(item.delta).toLocaleString("es-CO", { maximumFractionDigits: 1 })} pts`; }
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

  if (time) {
    const pairs: Any[] = time.r.labels.map((l: Any, i: number) => [l, Number(time.r.series[0][i]) || 0]).sort((a: Any, b: Any) => nat(a[0], b[0]));
    const vals: number[] = pairs.map((p) => p[1]);
    const best = pairs.reduce((a, b) => (b[1] > a[1] ? b : a)), worst = pairs.reduce((a, b) => (b[1] < a[1] ? b : a));
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const half = Math.floor(vals.length / 2);
    const h1 = vals.slice(0, half).reduce((a, b) => a + b, 0) / Math.max(1, half), h2 = vals.slice(half).reduce((a, b) => a + b, 0) / Math.max(1, vals.length - half);
    const growth = h1 ? ((h2 - h1) / Math.abs(h1)) * 100 : null;
    const dir = growth == null ? "se mantiene" : growth > 3 ? "crece" : growth < -3 ? "cae" : "se mantiene estable";
    slides.push({ id: "trend", type: "chart", kicker: "Tendencia", title: `${main.name} ${dir}${growth != null && Math.abs(growth) > 3 ? ` ${pctTxt(Math.abs(growth))} en la segunda mitad del periodo` : ""}`,
      sub: `Evolución por ${label(time.dim).toLowerCase()} · ${pairs.length} periodos`,
      chart: { kind: "line", labels: pairs.map((p) => p[0]), series: [{ label: main.name, values: vals }], ref: avg, refLabel: "Promedio" },
      bullets: [`Mejor periodo: ${best[0]} con ${fv(main, best[1])}.`, `Periodo más bajo: ${worst[0]} con ${fv(main, worst[1])}.`, `Promedio por periodo: ${fv(main, avg)}.`],
      how: "La línea muestra el valor de cada periodo; la línea punteada es el promedio. Busca la dirección general (sube o baja) antes que los picos aislados: un pico puede ser estacional.",
      notes: `Señala ${best[0]} (máximo) y ${worst[0]} (mínimo). La comparación entre mitades evita sacar conclusiones de un solo mes.` });
    facts.push(`Tendencia: ${dir}${growth != null ? ` (${signPct(growth)} entre mitades)` : ""}; mejor ${best[0]}, peor ${worst[0]}.`);
  }

  const conc = detail || primary;
  if (conc && main.additive) {
    const rows: Any[] = conc.r.labels.map((l: Any, i: number) => [l, Number(conc.r.series[0][i]) || 0]).filter((r: Any) => r[1] > 0).sort((a: Any, b: Any) => b[1] - a[1]);
    const total = rows.reduce((a, b) => a + b[1], 0);
    let acc = 0;
    const cum = rows.map((r) => { acc += r[1]; return (acc / total) * 100; });
    const n80 = Math.min(rows.length, cum.findIndex((c) => c >= 80) + 1 || rows.length);
    const top = rows[0], topShare = (top[1] / total) * 100;
    const shareN = (n80 / rows.length) * 100;
    slides.push({ id: "pareto", type: "chart", kicker: "Concentración", title: `${n80} de ${rows.length} ${plural(label(conc.dim))} explican el 80 % de ${main.name}`,
      sub: `${top[0]} solo aporta ${pctTxt(topShare)} · ${shareN <= 30 ? "muy concentrado" : shareN <= 50 ? "concentrado" : "repartido"}`,
      chart: { kind: "pareto", labels: rows.slice(0, 20).map((r) => r[0]), series: [{ label: main.name, values: rows.slice(0, 20).map((r) => r[1]) }], cum: cum.slice(0, 20), highlight: n80 },
      bullets: [`${top[0]} lidera con ${fv(main, top[1])} (${pctTxt(topShare)}).`, `Los ${n80} primeros suman el 80 %: son el ${pctTxt(shareN, 0)} del total de ${plural(label(conc.dim))}.`, rows.length > 3 ? `Los ${rows.length - n80} restantes aportan el ${pctTxt(100 - (cum[n80 - 1] || 0))}.` : ""].filter(Boolean),
      how: "Barras ordenadas de mayor a menor; la línea naranja acumula el %. Donde la línea cruza el 80 % están los elementos que mueven el resultado (regla 80/20).",
      notes: "Si pocos elementos explican casi todo, el riesgo está en depender de ellos; si está repartido, las mejoras deben ser transversales." });
    facts.push(`Concentración: ${n80} de ${rows.length} ${label(conc.dim)} explican el 80 %; lidera ${top[0]} (${pctTxt(topShare)}).`);
  }

  if (primary && primary !== conc && main.additive) {
    const rows: Any[] = primary.r.labels.map((l: Any, i: number) => [l, Number(primary.r.series[0][i]) || 0]).filter((r: Any) => r[1] > 0).sort((a: Any, b: Any) => b[1] - a[1]);
    const total = rows.reduce((a, b) => a + b[1], 0);
    const lead = rows[0], last = rows.at(-1);
    slides.push({ id: "mix", type: "chart", kicker: "Mezcla", title: `${lead[0]} pesa ${pctTxt((lead[1] / total) * 100)} de ${main.name}`,
      sub: `Participación por ${label(primary.dim).toLowerCase()}`,
      chart: { kind: "doughnut", labels: rows.map((r) => r[0]), series: [{ label: main.name, values: rows.map((r) => r[1]) }] },
      bullets: rows.slice(0, 3).map((r) => `${r[0]}: ${fv(main, r[1])} · ${pctTxt((r[1] / total) * 100)}`).concat(rows.length > 3 ? [`El menor, ${last[0]}, aporta ${pctTxt((last[1] / total) * 100)}.`] : []),
      how: "Cada sector es la parte del total. Compara tamaños, no colores; si dos sectores se parecen, mira los porcentajes de la derecha.",
      notes: `Pregunta clave: ¿la mezcla actual es la deseada? ${last[0]} tiene el menor peso.` });
    facts.push(`Mezcla por ${label(primary.dim)}: ${lead[0]} ${pctTxt((lead[1] / total) * 100)}, ${last[0]} ${pctTxt((last[1] / total) * 100)}.`);
  }

  const rates = measures.filter((m) => m.percent || !m.additive);
  const perf = rates.find((m) => !m.risk && m.percent) || rates.find((m) => !m.risk);
  const risk = rates.find((m) => m.risk);
  async function rateSlide(m: Any, kind: "perf" | "risk") {
    let best: Any = null;
    for (const c of [primary, secondary, detail].filter(Boolean)) {
      try {
        const r = await q(appId, c.dim, [m]);
        const rows = r.labels.map((l: Any, i: number) => [l, Number(r.series[0][i])]).filter((x: Any) => isFinite(x[1]));
        if (rows.length < 2) continue;
        const vals = rows.map((x: Any) => x[1]);
        const spread = Math.max(...vals) - Math.min(...vals);
        if (!best || spread > best.spread) best = { c, rows, spread };
      } catch { /* sigue */ }
    }
    if (!best) return;
    const rows: Any[] = best.rows.sort((a: Any, b: Any) => b[1] - a[1]);
    const tot = await q(appId, null, [m]).catch(() => ({ value: null }));
    const avg = Number(tot.value);
    const hi = rows[0], lo = rows.at(-1);
    const dl = label(best.c.dim).toLowerCase();
    const chart = { kind: "bar", labels: rows.map((r) => r[0]), series: [{ label: m.name, values: rows.map((r) => r[1]) }], ref: isFinite(avg) ? avg : null, refLabel: "Promedio", goodHigh: kind === "perf" };
    if (kind === "perf") {
      slides.push({ id: "perf", type: "chart", kicker: "Rendimiento", title: `${m.name}: ${hi[0]} lidera con ${fv(m, hi[1])}; ${lo[0]} queda en ${fv(m, lo[1])}`,
        sub: `Por ${dl} · promedio general ${fv(m, avg)}`, chart,
        bullets: [`Brecha entre el mejor y el peor: ${fv(m, hi[1] - lo[1])}.`, `${rows.filter((r) => r[1] >= avg).length} de ${rows.length} están en o por encima del promedio.`, `Subir ${lo[0]} al promedio es la mejora más directa.`],
        how: "Cada barra es el valor de la tasa en un grupo; la línea punteada es el promedio de todo el negocio. Las barras por debajo de la línea son las oportunidades.",
        notes: `Enfoca la conversación en ${lo[0]}: es donde una mejora pequeña mueve el promedio.` });
      facts.push(`${m.name}: mejor ${hi[0]} (${fv(m, hi[1])}), peor ${lo[0]} (${fv(m, lo[1])}), promedio ${fv(m, avg)}.`);
    } else {
      slides.push({ id: "risk", type: "chart", kicker: "Alerta", tone: "warn", title: `${m.name} se dispara en ${hi[0]}: ${fv(m, hi[1])}`,
        sub: `Por ${dl} · promedio general ${fv(m, avg)}`, chart,
        bullets: [`${hi[0]} está ${fv(m, hi[1] - avg)} por encima del promedio.`, `El nivel más sano lo tiene ${lo[0]} (${fv(m, lo[1])}).`, `Revisar las causas en ${hi[0]} antes de crecer ahí.`],
        how: "Es una medida de riesgo: aquí más alto es PEOR. Las barras sobre el promedio (rojas) piden revisión.",
        notes: `No es un problema general sino localizado en ${hi[0]}.` });
      facts.push(`Alerta ${m.name}: alto en ${hi[0]} (${fv(m, hi[1])}) vs promedio ${fv(m, avg)}.`);
    }
  }
  if (perf) await rateSlide(perf, "perf");
  if (risk) await rateSlide(risk, "risk");

  const cards = slides.filter((s) => s.type === "chart").slice(0, 4).map((s) => ({ kicker: s.kicker, text: s.title, tone: s.tone || (s.kicker === "Rendimiento" ? "ok" : "info") }));
  const recs: string[] = [];
  const sp = slides.find((s) => s.id === "pareto");
  if (sp) recs.push(`Proteger a los líderes de la concentración (${sp.chart.labels.slice(0, Math.min(3, sp.chart.highlight)).join(", ")}): son el 80 % del resultado.`);
  const pf = slides.find((s) => s.id === "perf");
  if (pf) recs.push(`Plan de mejora para ${pf.chart.labels.at(-1)}: llevarlo al promedio en ${pf.chart.series[0].label}.`);
  const rk = slides.find((s) => s.id === "risk");
  if (rk) recs.push(`Investigar la causa de ${rk.chart.series[0].label} en ${rk.chart.labels[0]} y medirla cada periodo.`);
  if (slides.some((s) => s.id === "trend")) recs.push(`Seguir la tendencia mes a mes con una alerta si ${main.name} cae por debajo del promedio.`);
  let summary = "";
  let summarySource = "reglas";
  if (opts.useAI) {
    try {
      const pregunta = "Eres consultor senior. Con SOLO estos hallazgos (no inventes cifras), redacta un resumen ejecutivo de 3 frases para dirección: qué pasa, por qué importa y qué hacer. Español, tono directo, sin viñetas ni markdown.";
      const res = (await Promise.race([post("/api/v1/ai/analizar", { appId, pregunta, contexto: { hallazgos: facts } }), new Promise((r) => setTimeout(() => r(null), 18000))])) as Any;
      if (res && res.ok && res.message) { summary = String(res.message).replace(/[#*`]/g, "").trim(); summarySource = "ia"; }
    } catch { /* sin IA: resumen por reglas */ }
  }
  if (!summary) summary = facts.slice(0, 3).join(" ");
  slides.push({ id: "findings", type: "findings", kicker: "Hallazgos", title: "Lo que hay que llevarse", sub: summary, cards, recs,
    how: "Cada tarjeta resume una diapositiva anterior. Las recomendaciones salen de esos mismos números.",
    notes: "Cierra con las recomendaciones y pide una decisión concreta para la siguiente reunión." });

  const ann = primary || conc;
  if (ann) {
    let cols = [main, ...[perf, risk].filter(Boolean)];
    let data: Any;
    try { data = await q(appId, ann.dim, cols); } catch { cols = [main]; data = { labels: ann.r.labels, series: [ann.r.series[0]] }; }
    const rows = data.labels.map((l: Any, i: number) => [l, ...cols.map((_, k) => data.series[k]?.[i])]).sort((a: Any, b: Any) => (Number(b[1]) || 0) - (Number(a[1]) || 0)).slice(0, 12);
    slides.push({ id: "annex", type: "table", kicker: "Anexo", title: `Detalle por ${label(ann.dim).toLowerCase()}`, sub: "Las cifras completas para consultar", head: [label(ann.dim), ...cols.map((m) => m.name)],
      rows: rows.map((r: Any) => [r[0], ...cols.map((m, k) => fv(m, r[k + 1]))]), notes: "Deja esta diapositiva para preguntas." });
  }
  return {
    appName, title, period, measure: main.name, summarySource,
    slides, measures: measures.map((m) => ({ id: m.id, name: m.name })), dims: cats.map((c) => c.dim.field), facts,
    created: new Date().toISOString(),
  };
}

// notebook-builder.js — constructor visual de consultas del cuaderno de análisis.
//
// Una celda SQL en modo visual guarda su intención en cell.builder:
//   {table, dims: [campo], metrics: [{agg, field}], filters: [{field, op, value}], order: {by, dir}, limit}
// y el SQL se genera aquí (toSql) para ejecutarlo en el motor. La frase describe() explica en lenguaje
// natural qué responde la consulta. En modo SQL (builder.manual = true) se edita el texto a mano.

export const AGGS = [
  { v: "count", l: "Contar registros", needs: false },
  { v: "sum", l: "Suma de", needs: "number" },
  { v: "avg", l: "Promedio de", needs: "number" },
  { v: "min", l: "Mínimo de", needs: true },
  { v: "max", l: "Máximo de", needs: true },
  { v: "median", l: "Mediana de", needs: "number" },
  { v: "distinct", l: "Valores distintos de", needs: true },
];
export const OPS = [
  { v: "eq", l: "es igual a" }, { v: "ne", l: "es distinto de" },
  { v: "gt", l: "es mayor que" }, { v: "gte", l: "es mayor o igual a" },
  { v: "lt", l: "es menor que" }, { v: "lte", l: "es menor o igual a" },
  { v: "contains", l: "contiene" }, { v: "starts", l: "empieza por" },
  { v: "in", l: "es uno de (separa con comas)" },
  { v: "null", l: "está vacío" }, { v: "notnull", l: "no está vacío" },
];
const NOVALUE = new Set(["null", "notnull"]);

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const ident = (n) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(n) ? n : `"${String(n).replace(/"/g, '""')}"`);
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;

const colOf = (tbl, name) => tbl?.columns.find((c) => c.name === name);
const shown = (tbl, name) => colOf(tbl, name)?.display || name;

/** Nombre de la columna que produce una métrica. */
export function metricLabel(m, tbl) {
  if (m.agg === "count" || !m.field) return "Registros";
  const a = AGGS.find((x) => x.v === m.agg);
  return `${a ? a.l : m.agg} ${shown(tbl, m.field)}`;
}

function metricSql(m) {
  if (m.agg === "count" || !m.field) return "COUNT(*)";
  const f = ident(m.field);
  return { sum: `SUM(${f})`, avg: `ROUND(AVG(${f}), 2)`, min: `MIN(${f})`, max: `MAX(${f})`, median: `MEDIAN(${f})`, distinct: `COUNT(DISTINCT ${f})` }[m.agg] || `SUM(${f})`;
}

function filterSql(f, tbl) {
  if (!f.field || !f.op) return null;
  const c = ident(f.field);
  if (f.op === "null") return `${c} IS NULL`;
  if (f.op === "notnull") return `${c} IS NOT NULL`;
  const raw = String(f.value ?? "").trim();
  if (!raw) return null;
  const num = colOf(tbl, f.field)?.type === "number";
  const val = (x) => (num && x !== "" && isFinite(Number(x.replace(",", "."))) ? String(Number(x.replace(",", "."))) : lit(x));
  switch (f.op) {
    case "contains": return `${c} LIKE ${lit("%" + raw + "%")}`;
    case "starts": return `${c} LIKE ${lit(raw + "%")}`;
    case "in": { const vs = raw.split(",").map((x) => x.trim()).filter(Boolean); return vs.length ? `${c} IN (${vs.map(val).join(", ")})` : null; }
    default: return `${c} ${{ eq: "=", ne: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" }[f.op] || "="} ${val(raw)}`;
  }
}

/** Columnas que produce la consulta (para «Ordenar por»). */
export function outputColumns(b, tbl) {
  const dims = b.dims || [], ms = b.metrics || [];
  if (!dims.length && !ms.length) return [];
  return [...dims.map((d) => ({ key: d, label: shown(tbl, d) })), ...ms.map((m) => ({ key: metricLabel(m, tbl), label: metricLabel(m, tbl) }))];
}

export function toSql(b, tbl) {
  if (!b?.table) return "";
  const dims = (b.dims || []).filter(Boolean), ms = (b.metrics || []).filter((m) => m.agg === "count" || m.field);
  const sel = [...dims.map(ident), ...ms.map((m) => `${metricSql(m)} AS ${ident(metricLabel(m, tbl))}`)];
  const lines = [`SELECT ${sel.length ? sel.join(",\n       ") : "*"}`, `FROM ${ident(b.table)}`];
  const where = (b.filters || []).map((f) => filterSql(f, tbl)).filter(Boolean);
  if (where.length) lines.push(`WHERE ${where.join("\n  AND ")}`);
  if (ms.length && dims.length) lines.push(`GROUP BY ${dims.map(ident).join(", ")}`);
  const outs = outputColumns({ dims, metrics: ms }, tbl);
  let by = b.order?.by && outs.some((o) => o.key === b.order.by) ? b.order.by : "";
  let dir = b.order?.dir === "asc" ? "ASC" : "DESC";
  if (!by && ms.length && dims.length) by = metricLabel(ms[0], tbl);
  if (by) lines.push(`ORDER BY ${ident(by)} ${dir}`);
  lines.push(`LIMIT ${Math.max(1, Math.min(10000, Number(b.limit) || 100))}`);
  return lines.join("\n");
}

/** La consulta contada en una frase, para que quede claro qué responde. */
export function describe(b, tbl) {
  if (!b?.table) return "Elige una tabla.";
  const dims = (b.dims || []).filter(Boolean), ms = (b.metrics || []).filter((m) => m.agg === "count" || m.field);
  const list = (xs) => (xs.length <= 1 ? xs.join("") : xs.slice(0, -1).join(", ") + " y " + xs.at(-1));
  let s;
  if (!dims.length && !ms.length) s = `Todas las columnas de ${b.table}`;
  else if (!ms.length) s = `${list(dims.map((d) => shown(tbl, d)))} de cada registro de ${b.table}`;
  else if (!dims.length) s = `${list(ms.map((m) => metricLabel(m, tbl)))} en ${b.table}`;
  else s = `${list(ms.map((m) => metricLabel(m, tbl)))} por ${list(dims.map((d) => shown(tbl, d)))}`;
  const fs = (b.filters || []).filter((f) => filterSql(f, tbl)).map((f) => `${shown(tbl, f.field)} ${OPS.find((o) => o.v === f.op)?.l || f.op}${NOVALUE.has(f.op) ? "" : ` «${f.value}»`}`);
  if (fs.length) s += `, solo donde ${list(fs)}`;
  if (ms.length && dims.length) {
    const by = b.order?.by || metricLabel(ms[0], tbl);
    s += `, ordenado por ${by} ${b.order?.dir === "asc" ? "de menor a mayor" : "de mayor a menor"}`;
  } else if (b.order?.by) s += `, ordenado por ${b.order.by}`;
  return `${s} · hasta ${Number(b.limit) || 100} filas.`;
}

const tIco = (t) => (t === "number" ? "#" : t === "date" ? "◷" : "Aa");
function fieldOptions(tbl, sel, filter) {
  return (tbl?.columns || []).filter((c) => !filter || filter(c)).map((c) =>
    `<option value="${esc(c.name)}" ${c.name === sel ? "selected" : ""}>${tIco(c.type)}  ${esc(c.display || c.name)}</option>`).join("");
}

/** HTML del constructor. */
export function builderHtml(b, schema, ro) {
  const tbl = schema.find((t) => t.table === b.table) || schema[0];
  const dis = ro ? "disabled" : "";
  const outs = outputColumns(b, tbl);
  const usedDims = new Set(b.dims || []);
  return `<div class="nb-bld" data-bld>
    <p class="nb-bld-say" data-say>${esc(describe(b, tbl))}</p>
    <div class="nb-bld-grid">
      <div class="nb-bld-k">Tabla</div>
      <div class="nb-bld-v"><select data-b="table" ${dis}>${schema.map((t) => `<option value="${esc(t.table)}" ${t.table === b.table ? "selected" : ""}>${esc(t.table)} · ${Number(t.rows).toLocaleString("es-CO")} filas</option>`).join("")}</select></div>

      <div class="nb-bld-k">Ver por<small>${(b.metrics || []).length ? "agrupa el cálculo" : "columnas a mostrar"}</small></div>
      <div class="nb-bld-v nb-bld-chips">
        ${(b.dims || []).map((d, i) => `<span class="nb-bchip">${tIco(colOf(tbl, d)?.type)} ${esc(shown(tbl, d))}${ro ? "" : `<button type="button" data-rmdim="${i}" title="Quitar">✕</button>`}</span>`).join("")}
        ${ro ? "" : `<select data-adddim class="nb-bld-add"><option value="">＋ Añadir campo</option>${fieldOptions(tbl, "", (c) => !usedDims.has(c.name))}</select>`}
        ${!(b.dims || []).length ? `<em class="nb-bld-hint">${(b.metrics || []).length ? "Sin campo: un solo total." : "Sin campos: se muestran todas las columnas."}</em>` : ""}
      </div>

      <div class="nb-bld-k">Calcular</div>
      <div class="nb-bld-v nb-bld-rows">
        ${(b.metrics || []).map((m, i) => {
          const a = AGGS.find((x) => x.v === m.agg) || AGGS[0];
          return `<div class="nb-bld-row">
            <select data-magg="${i}" ${dis}>${AGGS.map((x) => `<option value="${x.v}" ${x.v === m.agg ? "selected" : ""}>${x.l}</option>`).join("")}</select>
            ${a.needs ? `<select data-mfield="${i}" ${dis}><option value="">— campo —</option>${fieldOptions(tbl, m.field, a.needs === "number" ? (c) => c.type === "number" : null)}</select>` : ""}
            ${ro ? "" : `<button type="button" class="nb-ibtn" data-rmm="${i}" title="Quitar cálculo">✕</button>`}</div>`;
        }).join("")}
        ${ro ? "" : `<button type="button" class="nb-bld-link" data-addm>＋ Añadir cálculo</button>`}
      </div>

      <div class="nb-bld-k">Filtrar</div>
      <div class="nb-bld-v nb-bld-rows">
        ${(b.filters || []).map((f, i) => `<div class="nb-bld-row">
            <select data-ffield="${i}" ${dis}><option value="">— campo —</option>${fieldOptions(tbl, f.field)}</select>
            <select data-fop="${i}" ${dis}>${OPS.map((o) => `<option value="${o.v}" ${o.v === f.op ? "selected" : ""}>${o.l}</option>`).join("")}</select>
            ${NOVALUE.has(f.op) ? "" : `<input data-fval="${i}" value="${esc(f.value ?? "")}" placeholder="valor" list="nbdl-${esc(b._id || "")}-${i}" ${ro ? "readonly" : ""} /><datalist id="nbdl-${esc(b._id || "")}-${i}"></datalist>`}
            ${ro ? "" : `<button type="button" class="nb-ibtn" data-rmf="${i}" title="Quitar filtro">✕</button>`}</div>`).join("")}
        ${ro ? "" : `<button type="button" class="nb-bld-link" data-addf>＋ Añadir filtro</button>`}
      </div>

      <div class="nb-bld-k">Ordenar</div>
      <div class="nb-bld-v nb-bld-row">
        <select data-b="orderby" ${dis} ${outs.length ? "" : "disabled"}><option value="">${(b.metrics || []).length && (b.dims || []).length ? "Automático (primer cálculo)" : "Sin orden"}</option>${outs.map((o) => `<option value="${esc(o.key)}" ${o.key === b.order?.by ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select>
        <select data-b="dir" ${dis}><option value="desc" ${b.order?.dir !== "asc" ? "selected" : ""}>De mayor a menor</option><option value="asc" ${b.order?.dir === "asc" ? "selected" : ""}>De menor a mayor</option></select>
        <span class="nb-bld-k inline">Mostrar</span>
        <select data-b="limit" ${dis}>${[10, 20, 50, 100, 500, 1000, 10000].map((n) => `<option value="${n}" ${Number(b.limit || 100) === n ? "selected" : ""}>${n === 10000 ? "Hasta 10.000" : n} filas</option>`).join("")}</select>
      </div>
    </div>
    <details class="nb-bld-sql"><summary>Ver el SQL que se genera</summary><pre data-sqlprev>${esc(toSql(b, tbl))}</pre>
      ${ro ? "" : `<button type="button" class="nb-bld-link" data-tosql>Editar como SQL</button>`}</details>
  </div>`;
}

/** Plantilla por defecto sobre una tabla: cuántos registros hay por su primer campo de texto útil. */
export function starterBuilder(tbl) {
  if (!tbl) return null;
  const txt = pickText(tbl), num = pickNumber(tbl);
  if (txt) return { table: tbl.table, dims: [txt], metrics: [{ agg: "count" }, ...(num ? [{ agg: naturalAgg(num), field: num }] : [])], filters: [], order: {}, limit: 20 };
  return { table: tbl.table, dims: [], metrics: [], filters: [], order: {}, limit: 100 };
}

const BORING = /^(id|cod|codigo|código|cedula|cédula|documento|nit|telefono|celular|cliente|nombre)\b|(^|[\s_])id$|_id\b/i;
export function pickText(tbl) {
  const cols = tbl?.columns || [];
  return (cols.find((c) => c.type === "text" && !BORING.test(c.name) && !/^ML_|segmento ml|distancia/i.test(c.name)) || cols.find((c) => c.type === "text"))?.name;
}
const AMOUNT = /venta|valor|monto|importe|ingreso|gasto|costo|precio|total|cantidad|unidades|servicio|placas|movimiento|saldo|pago|revenue|sales|amount|qty/i;
const AVERAGE = /edad|age|antig|porcentaje|%|tasa|ratio|satisf|probab|score|puntaje|nota|calific|distancia|duraci|d[ií]as/i;
const NOTNUM = /a[nñ]io|year|^mes$|month|^d[ií]a$|semana|week|trimestre|id\b|^cod|cluster/i;
export function pickNumber(tbl) {
  const nums = (tbl?.columns || []).filter((c) => c.type === "number" && !BORING.test(c.name) && !NOTNUM.test(c.name));
  return (nums.find((c) => AMOUNT.test(c.name)) || nums.find((c) => !AVERAGE.test(c.name)) || nums[0] || (tbl?.columns || []).find((c) => c.type === "number"))?.name;
}
/** Suma para montos y cantidades; promedio para edades, porcentajes, tasas o puntajes. */
export const naturalAgg = (field) => (AVERAGE.test(String(field || "")) && !AMOUNT.test(String(field || "")) ? "avg" : "sum");
export function pickTime(tbl) {
  return (tbl?.columns || []).find((c) => c.type === "date" || /^(mes|month|periodo|período|fecha|a[nñ]io|year)\b/i.test(c.name))?.name;
}

/** Ideas rápidas para empezar, a partir de los campos reales de la tabla. */
export function ideas(tbl) {
  if (!tbl) return [];
  const txt = pickText(tbl), num = pickNumber(tbl), time = pickTime(tbl);
  const s = (n) => colOf(tbl, n)?.display || n;
  const out = [];
  if (txt) out.push({ label: `¿Cuántos registros hay por ${s(txt)}?`, cell: { kind: "sql", builder: { table: tbl.table, dims: [txt], metrics: [{ agg: "count" }], filters: [], order: {}, limit: 20 } } });
  const ag = naturalAgg(num), agL = ag === "avg" ? "promedio" : "total";
  if (txt && num) out.push({ label: `Top 10 de ${s(txt)} por ${agL} de ${s(num)}`, cell: { kind: "sql", builder: { table: tbl.table, dims: [txt], metrics: [{ agg: ag, field: num }], filters: [], order: {}, limit: 10 } } });
  if (time && num && time !== num) out.push({ label: `¿Cómo evoluciona ${s(num)} por ${s(time)}?`, cell: { kind: "sql", builder: { table: tbl.table, dims: [time], metrics: [{ agg: ag, field: num }], filters: [], order: { by: time, dir: "asc" }, limit: 1000 } } });
  if (num) out.push({ label: `Resumen de ${s(num)}`, cell: { kind: "sql", builder: { table: tbl.table, dims: [], metrics: [{ agg: "count" }, ...(ag === "sum" ? [{ agg: "sum", field: num }] : []), { agg: "avg", field: num }, { agg: "min", field: num }, { agg: "max", field: num }], filters: [], order: {}, limit: 1 } } });
  if (num) out.push({ label: `¿Cómo se distribuye ${s(num)}?`, cell: { kind: "profile", params: { table: tbl.table, field: num } } });
  if (txt && num && ag === "sum") out.push({ label: `¿Qué valores de ${s(txt)} concentran el 80 % de ${s(num)}?`, cell: { kind: "pareto", params: { table: tbl.table, dimension: txt, magg: "sum", mfield: num, measure: `SUM(${ident(num)})`, label: `Suma de ${num}` } } });
  else if (txt) out.push({ label: `¿Qué valores de ${s(txt)} concentran la mayoría de registros?`, cell: { kind: "pareto", params: { table: tbl.table, dimension: txt, magg: "count", mfield: "", measure: "COUNT(*)", label: "Registros" } } });
  return out;
}

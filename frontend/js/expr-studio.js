// expr-studio.js — «Estudio de expresiones»: ventana grande para crear/editar medidas y dimensiones
// (maestras o del fx de un gráfico), en SQL (estándar abierto). Tres zonas:
//   · Izquierda: identidad (nombre, descripción), tipo detectado en vivo y FORMATO (moneda, millones, kg, %, fecha…).
//   · Centro: ayuda de IA (≤ 500 caracteres) + editor con números de línea, resaltado SQL y resultado de la prueba.
//   · Derecha: catálogo con Campos (buscables, por tabla), Funciones SQL y Ejemplos con los campos reales.
// La validación siempre la hace el motor (/expressions/parse); aquí solo se ayuda a escribir.
// Una expresión antigua (Sum([x]), If(…)) se convierte a SQL al abrirla (/expressions/translate).

import * as api from "./api.js";
import { mountFormatPanel, formatValue } from "./num-format.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const AI_MAX = 500;

const RESERVED = new Set(["and", "or", "not", "is", "in", "between", "like", "ilike", "case", "when", "then", "else", "end", "as", "from", "filter", "where", "distinct", "null", "true", "false", "cast", "extract", "select", "table"]);
/** Nombre de campo en SQL: tal cual si es simple; entre comillas dobles si tiene espacios, tildes o símbolos. */
export const ident = (n) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(n) && !RESERVED.has(n.toLowerCase()) ? n : `"${String(n).replace(/"/g, '""')}"`);

const DIM_FUNCS = [
  { n: "CASE", sig: "CASE WHEN condición THEN valor ELSE otro END", d: "Devuelve un valor u otro según una o varias condiciones.", t: "CASE WHEN campo >= 0 THEN 'Sí' ELSE 'No' END", g: "Lógica" },
  { n: "IN", sig: "campo IN ('a', 'b')", d: "Verdadero si el valor está en la lista.", t: "campo IN ('A', 'B')", g: "Lógica" },
  { n: "BETWEEN", sig: "campo BETWEEN a AND b", d: "Verdadero si está entre dos valores (incluidos).", t: "campo BETWEEN 18 AND 30", g: "Lógica" },
  { n: "LIKE", sig: "campo LIKE 'AB%'", d: "Empieza por (AB%), termina en (%AB) o contiene (%AB%).", t: "campo LIKE 'AB%'", g: "Lógica" },
  { n: "IS NULL", sig: "campo IS NULL / IS NOT NULL", d: "Verdadero si el valor está vacío (o no).", t: "campo IS NULL", g: "Lógica" },
  { n: "COALESCE", sig: "COALESCE(valor, alternativa)", d: "Usa la alternativa cuando el valor está vacío.", t: "COALESCE(campo, 'Sin dato')", g: "Lógica" },
  { n: "ROUND", sig: "ROUND(número, decimales)", d: "Redondea.", t: "ROUND(campo, 0)", g: "Números" },
  { n: "FLOOR", sig: "FLOOR(número)", d: "Redondea hacia abajo.", t: "FLOOR(campo)", g: "Números" },
  { n: "CEIL", sig: "CEIL(número)", d: "Redondea hacia arriba.", t: "CEIL(campo)", g: "Números" },
  { n: "ABS", sig: "ABS(número)", d: "Valor absoluto.", t: "ABS(campo)", g: "Números" },
  { n: "CAST", sig: "CAST(valor AS INTEGER | DOUBLE | VARCHAR | DATE)", d: "Convierte el tipo de dato.", t: "CAST(campo AS INTEGER)", g: "Números" },
  { n: "CLASS", sig: "CLASS(número, ancho)", d: "Agrupa un número en rangos: «30 - 40» (función de DataSense).", t: "CLASS(campo, 10)", g: "Números" },
  { n: "YEAR", sig: "YEAR(fecha)", d: "Año de una fecha.", t: "YEAR(campo)", g: "Fechas" },
  { n: "MONTH", sig: "MONTH(fecha)", d: "Mes (1-12).", t: "MONTH(campo)", g: "Fechas" },
  { n: "DAY", sig: "DAY(fecha)", d: "Día del mes.", t: "DAY(campo)", g: "Fechas" },
  { n: "EXTRACT", sig: "EXTRACT(YEAR FROM fecha)", d: "Parte de una fecha (YEAR, MONTH, DAY).", t: "EXTRACT(YEAR FROM campo)", g: "Fechas" },
  { n: "||", sig: "texto || ' - ' || texto", d: "Une textos.", t: "campo || ' - ' || campo", g: "Texto" },
  { n: "UPPER", sig: "UPPER(texto)", d: "Mayúsculas.", t: "UPPER(campo)", g: "Texto" },
  { n: "LOWER", sig: "LOWER(texto)", d: "Minúsculas.", t: "LOWER(campo)", g: "Texto" },
  { n: "TRIM", sig: "TRIM(texto)", d: "Quita espacios al inicio y al final.", t: "TRIM(campo)", g: "Texto" },
  { n: "LEFT", sig: "LEFT(texto, n)", d: "Primeros n caracteres.", t: "LEFT(campo, 3)", g: "Texto" },
  { n: "RIGHT", sig: "RIGHT(texto, n)", d: "Últimos n caracteres.", t: "RIGHT(campo, 3)", g: "Texto" },
  { n: "SUBSTRING", sig: "SUBSTRING(texto, inicio, n)", d: "Parte del texto (empieza en 1).", t: "SUBSTRING(campo, 1, 3)", g: "Texto" },
  { n: "REPLACE", sig: "REPLACE(texto, 'buscar', 'por')", d: "Reemplaza un texto por otro.", t: "REPLACE(campo, 'a', 'b')", g: "Texto" },
  { n: "LENGTH", sig: "LENGTH(texto)", d: "Cantidad de caracteres.", t: "LENGTH(campo)", g: "Texto" },
];
const MEAS_FUNCS = [
  { n: "SUM", sig: "SUM(campo)", d: "Suma de un campo numérico.", t: "SUM(campo)", g: "Agregación" },
  { n: "COUNT", sig: "COUNT(campo)", d: "Cantidad de filas con valor.", t: "COUNT(campo)", g: "Agregación" },
  { n: "COUNT", sig: "COUNT(*)", d: "Cantidad de filas de la tabla.", t: "COUNT(*)", g: "Agregación" },
  { n: "COUNT", sig: "COUNT(DISTINCT campo)", d: "Valores distintos (p. ej. personas únicas).", t: "COUNT(DISTINCT campo)", g: "Agregación" },
  { n: "AVG", sig: "AVG(campo)", d: "Promedio.", t: "AVG(campo)", g: "Agregación" },
  { n: "MIN", sig: "MIN(campo)", d: "Valor mínimo.", t: "MIN(campo)", g: "Agregación" },
  { n: "MAX", sig: "MAX(campo)", d: "Valor máximo.", t: "MAX(campo)", g: "Agregación" },
  { n: "FILTER", sig: "agregación FILTER (WHERE condición)", d: "Agrega solo las filas que cumplen la condición.", t: "COUNT(*) FILTER (WHERE campo = 'valor')", g: "Condiciones" },
  { n: "CASE", sig: "SUM(CASE WHEN … THEN … ELSE 0 END)", d: "Agrega una expresión calculada en cada fila.", t: "SUM(CASE WHEN campo > 0 THEN campo ELSE 0 END)", g: "Condiciones" },
  { n: "/", sig: "agregación / agregación", d: "Combina agregaciones con + - * / (porcentajes, tasas, diferencias).", t: "100.0 * COUNT(campo) / COUNT(*)", g: "Medida compuesta" },
  { n: "ROUND", sig: "ROUND(medida, decimales)", d: "Redondea el resultado de la medida.", t: "ROUND(SUM(campo) / COUNT(campo), 2)", g: "Medida compuesta" },
  ...DIM_FUNCS.map((f) => ({ ...f, g: `Dentro de la agregación · ${f.g}` })),
];
const OPS = ["+", "-", "*", "/", "=", "<>", ">", ">=", "<", "<=", "AND", "OR", "NOT", "||", "( )", "' '"];
const FN_NAMES = new Set(["sum", "count", "avg", "min", "max", "round", "floor", "ceil", "ceiling", "abs", "cast", "class", "match", "year", "month", "day", "extract", "upper", "lower", "trim", "left", "right", "substring", "substr", "replace", "length", "coalesce", "nullif", "concat", "if", "iif", "greatest", "least", "date_part"]);
const KW = /^(AND|OR|NOT|DISTINCT|CASE|WHEN|THEN|ELSE|END|IN|IS|NULL|BETWEEN|LIKE|ILIKE|FILTER|WHERE|AS|TRUE|FALSE|INTEGER|DOUBLE|VARCHAR|DATE|FROM)$/i;

/** Resaltado SQL (HTML) para la capa bajo el textarea. */
function highlight(src) {
  let out = "", i = 0;
  const s = String(src);
  while (i < s.length) {
    const c = s[i];
    if (c === "-" && s[i + 1] === "-") { const j = s.indexOf("\n", i); const e = j < 0 ? s.length : j; out += `<span class="xs-c">${esc(s.slice(i, e))}</span>`; i = e; continue; }
    if (c === '"' || c === "[") { const close = c === "[" ? "]" : '"'; const j = s.indexOf(close, i + 1); const e = j < 0 ? s.length : j + 1; out += `<span class="xs-f">${esc(s.slice(i, e))}</span>`; i = e; continue; }
    if (c === "'") { let j = i + 1; while (j < s.length && s[j] !== "'") j++; const e = Math.min(s.length, j + 1); out += `<span class="xs-s">${esc(s.slice(i, e))}</span>`; i = e; continue; }
    if (/[0-9]/.test(c)) { let j = i; while (j < s.length && /[0-9.]/.test(s[j])) j++; out += `<span class="xs-n">${esc(s.slice(i, j))}</span>`; i = j; continue; }
    if (/[\p{L}_]/u.test(c)) {
      let j = i; while (j < s.length && /[\p{L}\p{N}_]/u.test(s[j])) j++;
      const w = s.slice(i, j);
      let k = j; while (s[k] === " ") k++;
      const cls = FN_NAMES.has(w.toLowerCase()) && s[k] === "(" ? "xs-fn" : KW.test(w) ? "xs-k" : "xs-f";
      out += `<span class="${cls}">${esc(w)}</span>`; i = j; continue;
    }
    if ("&+-*/=<>|%".includes(c)) { out += `<span class="xs-o">${esc(c)}</span>`; i++; continue; }
    if ("()".includes(c)) { out += `<span class="xs-p">${c}</span>`; i++; continue; }
    out += esc(c); i++;
  }
  return out + "\n";
}

/** Detección local del tipo (el motor confirma al probar). */
function detect(kind, text) {
  const t = String(text || "").trim().replace(/^=\s*/, "");
  if (!t) return { k: "empty", label: "Sin expresión" };
  if (kind === "measure") {
    const simple = /^[A-Za-z]+\s*\(\s*("[^"]+"|\[[^\]]+\]|[\p{L}\p{N}_%.]+|\*)\s*\)$/u.test(t);
    return simple ? { k: "measure", label: "Medida (agregación)" } : { k: "composite", label: "Medida compuesta" };
  }
  if (/^("[^"]+"|\[[^\]]+\]|[\p{L}_][\p{L}\p{N}_]*)$/u.test(t)) return { k: "field", label: "Campo del modelo" };
  return { k: "calc", label: "Dimensión calculada" };
}

/** Balance de paréntesis / comillas: aviso inmediato mientras se escribe. */
function balance(text) {
  let p = 0, q = false, dq = false, cw = 0, ce = 0;
  for (const c of text) {
    if (c === "'" && !dq) q = !q;
    else if (c === '"' && !q) dq = !dq;
    if (q || dq) continue;
    if (c === "(") p++; else if (c === ")") p--;
    if (p < 0) return "Sobra un paréntesis de cierre «)».";
  }
  const words = text.replace(/'[^']*'|"[^"]*"/g, " ").toUpperCase().match(/\b(CASE|END)\b/g) || [];
  for (const w of words) w === "CASE" ? cw++ : ce++;
  if (q) return "Falta cerrar una comilla «'».";
  if (dq) return "Falta cerrar una comilla doble «\"» del campo.";
  if (p > 0) return `Falta${p > 1 ? "n" : ""} ${p} paréntesis de cierre «)».`;
  if (cw > ce) return "Falta el END de un CASE.";
  return "";
}

/** Ordena la expresión en varias líneas (CASE, FILTER y argumentos largos). */
function pretty(text) {
  const t = String(text).replace(/\s+/g, " ").trim();
  if (t.length < 60) return t;
  return t
    .replace(/\s+(WHEN|ELSE)\s+/gi, "\n  $1 ")
    .replace(/\s+END\b/gi, "\nEND")
    .replace(/\)\s+FILTER\s+\(/gi, ")\n  FILTER (")
    .replace(/\s+(AND|OR)\s+/gi, "\n    $1 ");
}

/**
 * @param {object} o
 *  host: {open(html, cls) -> el, close()}; appId; kind "measure"|"dimension"; mode "master"|"expr"
 *  item (maestro a editar) | initial (texto); fields: [{field, display, type, tables}]
 *  onSave({name, expression, description, format}) (master) · onApply(expr, resolved, format) (expr) · onDelete()
 */
export function openExprStudio(o) {
  const isMeasure = o.kind === "measure";
  const isMaster = o.mode === "master";
  const item = o.item || null;
  const initial = item ? item.expression : (o.initial || "");
  const fields = o.fields || [];
  const funcs = isMeasure ? MEAS_FUNCS : DIM_FUNCS;
  const kindLabel = isMeasure ? "medida" : "dimensión";
  const title = isMaster ? `${item ? "Editar" : "Nueva"} ${kindLabel} maestra` : `Expresión de la ${kindLabel}`;
  let format = item?.format || o.format || null;

  // Ejemplos con los campos reales del modelo.
  const pick = (t, k = 0) => fields.filter((f) => f.type === t)[k]?.field;
  const num = ident(pick("number") || "valor");
  const txt = ident(pick("text") || "categoria");
  const txt2 = ident(pick("text", 1) || pick("text") || "categoria");
  const dat = ident(pick("date") || "fecha");
  const EXAMPLES = isMeasure ? [
    ["Total", `SUM(${num})`], ["Cantidad de registros", `COUNT(*)`], ["Promedio", `AVG(${num})`], ["Máximo", `MAX(${num})`],
    ["Valores únicos", `COUNT(DISTINCT ${txt})`],
    ["Contar los que cumplen una condición", `COUNT(*) FILTER (WHERE ${num} >= 40)`],
    ["Sumar solo algunos", `SUM(${num}) FILTER (WHERE ${txt} IN ('A', 'B'))`],
    ["% que cumple una condición", `ROUND(100.0 * COUNT(*) FILTER (WHERE ${num} >= 40) / COUNT(*), 2)`],
    ["% con dato (vs total)", `ROUND(100.0 * COUNT(${dat}) / COUNT(*), 2)`],
    ["Promedio por registro único", `SUM(${num}) / COUNT(DISTINCT ${txt})`],
    ["Rango (máximo − mínimo)", `MAX(${num}) - MIN(${num})`],
  ] : [
    ["Grupos según un umbral", `CASE WHEN ${num} >= 40 THEN 'Alto' ELSE 'Bajo' END`],
    ["Tres niveles", `CASE\n  WHEN ${num} >= 60 THEN 'Alto'\n  WHEN ${num} >= 30 THEN 'Medio'\n  ELSE 'Bajo'\nEND`],
    ["Rangos", `CLASS(${num}, 10)`],
    ["Año de una fecha", `YEAR(${dat})`],
    ["Año-Mes", `YEAR(${dat}) || '-' || MONTH(${dat})`],
    ["Unir dos campos", `${txt} || ' - ' || ${txt2}`],
    ["Agrupar categorías", `CASE WHEN ${txt} IN ('A', 'B') THEN 'Grupo 1' ELSE 'Otros' END`],
    ["Vacíos como «Sin dato»", `COALESCE(${txt}, 'Sin dato')`],
  ];

  const tables = {};
  for (const f of fields) for (const t of f.tables || ["(modelo)"]) (tables[t] ||= []).push(f);

  const el = o.host.open(`
    <div class="xs">
      <header class="xs-head">
        <span class="xs-badge ${isMeasure ? "m" : "d"}">${isMeasure ? "Σ" : "≡"}</span>
        <div class="xs-ttl"><h3>${esc(title)} <span class="xs-lang" title="Lenguaje de la expresión">SQL</span></h3><small>${isMeasure ? "Agrega valores (SUM, COUNT, AVG, MIN, MAX, COUNT DISTINCT) y combínalos: porcentajes, tasas, FILTER (WHERE …)." : "Un campo o una expresión por fila (CASE WHEN, ||, YEAR…)."}</small></div>
        <button class="ho-x" data-close aria-label="Cerrar">✕</button>
      </header>
      <div class="xs-body">
        <aside class="xs-left">
          ${isMaster ? `
          <label class="xs-lbl">Nombre<input id="xsName" value="${esc(item?.name || "")}" placeholder="${isMeasure ? "Ej.: Total conductores" : "Ej.: Rango de edad"}" maxlength="80" /></label>
          <label class="xs-lbl grow">Descripción<textarea id="xsDesc" placeholder="Qué representa y cómo se calcula. La IA también la lee.">${esc(item?.description || "")}</textarea></label>` : ""}
          <div class="xs-type" id="xsType"></div>
          <div class="xs-fmt"><span class="xs-tlbl">Formato</span><div id="xsFmt"></div></div>
          ${isMaster && item ? `<div class="xs-gov" id="xsGov"></div>` : ""}
          <div class="xs-tip">
            <b>Atajos</b>
            <span><kbd>Ctrl</kbd>+<kbd>Enter</kbd> probar</span>
            <span><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> ordenar</span>
            <span><kbd>Tab</kbd> sangría</span>
          </div>
        </aside>
        <section class="xs-center">
          <div class="xs-ai">
            <span class="xs-ai-ico" aria-hidden="true">✨</span>
            <textarea id="xsAiQ" rows="1" maxlength="${AI_MAX}" placeholder="${esc(isMeasure ? "Pídeselo a la IA: «el porcentaje de inactivos sobre el total de conductores»" : "Pídeselo a la IA: «agrupa la edad en jóvenes, adultos y mayores»")}"></textarea>
            <span class="xs-ai-n" id="xsAiN">0/${AI_MAX}</span>
            <button type="button" class="xs-tb ai" id="xsAiGo">Generar</button>
          </div>
          <div class="xs-ai-out" id="xsAiOut" hidden></div>
          <div class="xs-bar">
            <button type="button" class="xs-tb" id="xsTest" title="Probar en el motor (Ctrl+Enter)">▶ Probar</button>
            <button type="button" class="xs-tb" id="xsPretty" title="Ordenar en varias líneas (Ctrl+Shift+F)">⇶ Ordenar</button>
            <button type="button" class="xs-tb" id="xsClear" title="Borrar la expresión">✕ Limpiar</button>
            <span class="xs-ops">${OPS.map((x) => `<button type="button" class="xs-op" data-ins="${esc(x === "( )" ? "()" : x === "' '" ? "''" : ` ${x} `)}">${esc(x)}</button>`).join("")}</span>
            <span class="xs-count" id="xsCount"></span>
          </div>
          <div class="xs-conv" id="xsConv" hidden></div>
          <div class="xs-editor">
            <div class="xs-gutter" id="xsGut"></div>
            <div class="xs-code">
              <pre class="xs-hl" id="xsHl" aria-hidden="true"></pre>
              <textarea id="xsText" spellcheck="false" autocomplete="off" placeholder="${esc(isMeasure ? `SUM(${num})` : `CASE WHEN ${num} >= 40 THEN 'Mayor de 40' ELSE 'Menor de 40' END`)}">${esc(initial)}</textarea>
            </div>
          </div>
          <div class="xs-warn" id="xsWarn" hidden></div>
          <div class="xs-result" id="xsRes"><div class="xs-res-empty">Pulsa <b>Probar</b> para validar la expresión en el motor y ver un ejemplo del resultado.</div></div>
        </section>
        <aside class="xs-right">
          <div class="xs-tabs"><button type="button" class="on" data-xt="campos">Campos</button><button type="button" data-xt="funciones">Funciones</button><button type="button" data-xt="ejemplos">Ejemplos</button></div>
          <input class="xs-search" id="xsQ" type="search" placeholder="Buscar…" />
          <div class="xs-list" id="xsList"></div>
        </aside>
      </div>
      <footer class="xs-foot">
        ${isMaster && item ? `<button class="ho-btn danger" id="xsDel">Eliminar</button>` : ""}
        <span class="xs-msg" id="xsMsg">${isMaster && item ? "Si cambias la definición, se actualizan todos los gráficos que la usan." : ""}</span>
        <button class="ho-btn" data-close>Cancelar</button>
        <button class="ho-btn primary" id="xsOk">${isMaster ? (item ? "Guardar" : "Crear") : "Aplicar"}</button>
      </footer>
    </div>`, "studio");

  const $ = (s) => el.querySelector(s);
  const ta = $("#xsText"), hl = $("#xsHl"), gut = $("#xsGut");
  let tab = "campos";

  // Formato al lado del editor (la vista previa usa el último resultado probado).
  const fmtPanel = mountFormatPanel($("#xsFmt"), { kind: o.kind, value: format, onChange: (f) => { format = f; } });

  function paint() {
    const v = ta.value;
    hl.innerHTML = highlight(v);
    const n = v.split("\n").length;
    gut.innerHTML = Array.from({ length: n }, (_, i) => `<span>${i + 1}</span>`).join("");
    $("#xsCount").textContent = `${v.length} caracteres · ${n} línea${n === 1 ? "" : "s"}`;
    const d = detect(o.kind, v);
    $("#xsType").innerHTML = `<span class="xs-tlbl">Tipo</span><span class="xs-tval ${d.k}">${esc(d.label)}</span>
      ${d.k === "calc" ? `<small>Se evalúa en cada fila con campos de una misma tabla y se usa como cualquier dimensión.</small>` : d.k === "field" ? `<small>Usa el campo tal cual.</small>` : d.k === "composite" ? `<small>Combina agregaciones o agrega una expresión por fila. Todos los campos de una misma tabla.</small>` : isMeasure && d.k !== "empty" ? `<small>Una agregación sobre un campo.</small>` : ""}`;
    const w = balance(v);
    $("#xsWarn").hidden = !w; $("#xsWarn").textContent = w ? "⚠ " + w : "";
    syncScroll();
  }
  function syncScroll() { hl.scrollTop = ta.scrollTop; hl.scrollLeft = ta.scrollLeft; gut.scrollTop = ta.scrollTop; }
  function insert(txt) {
    const s = ta.selectionStart ?? ta.value.length, e = ta.selectionEnd ?? s;
    // Plantillas con «campo»: si hay texto seleccionado, se usa como argumento.
    const sel = ta.value.slice(s, e);
    const t = sel && /\bcampo\b/.test(txt) ? txt.replace(/\bcampo\b/, sel) : txt;
    ta.value = ta.value.slice(0, s) + t + ta.value.slice(e);
    const ph = t.search(/\bcampo\b/);
    ta.focus();
    if (ph >= 0) { ta.selectionStart = s + ph; ta.selectionEnd = s + ph + 5; } else ta.selectionStart = ta.selectionEnd = s + t.length;
    paint();
  }

  function renderList() {
    const q = norm($("#xsQ").value);
    const L = $("#xsList");
    if (tab === "campos") {
      L.innerHTML = Object.entries(tables).map(([t, fs]) => {
        const vis = fs.filter((f) => !q || norm(f.field + " " + f.display).includes(q));
        if (!vis.length) return "";
        return `<div class="xs-grp">${esc(t)} <em>${vis.length}</em></div>` + vis.map((f) => `
          <button type="button" class="xs-it" data-field="${esc(f.field)}" title="Insertar ${esc(ident(f.field))}">
            <span class="xs-ty ${esc(f.type)}">${f.type === "number" ? "#" : f.type === "date" ? "📅" : "Aa"}</span><b>${esc(f.display || f.field)}</b>
            ${isMeasure && f.type === "number" ? `<span class="xs-quick" data-agg="SUM" title="Insertar SUM(${esc(ident(f.field))})">Σ</span>` : ""}
            ${isMeasure ? `<span class="xs-quick" data-agg="COUNT" title="Insertar COUNT(${esc(ident(f.field))})">#</span>` : ""}
          </button>`).join("");
      }).join("") || `<div class="xs-none">Sin campos que coincidan.</div>`;
    } else if (tab === "funciones") {
      const groups = [...new Set(funcs.map((f) => f.g))];
      L.innerHTML = groups.map((g) => {
        const vis = funcs.filter((f) => f.g === g && (!q || norm(f.n + " " + f.sig + " " + f.d).includes(q)));
        if (!vis.length) return "";
        return `<div class="xs-grp">${esc(g)}</div>` + vis.map((f) => `
          <button type="button" class="xs-fn-it" data-tpl="${esc(f.t)}"><code>${esc(f.sig)}</code><small>${esc(f.d)}</small></button>`).join("");
      }).join("") + (isMeasure ? `<div class="xs-note">Para contar o sumar solo algunas filas usa <code>FILTER (WHERE …)</code>: <code>COUNT(*) FILTER (WHERE estado = 'Inactivo')</code>. Una división por cero da 0.</div>` : "");
    } else {
      L.innerHTML = EXAMPLES.filter(([l, x]) => !q || norm(l + " " + x).includes(q)).map(([l, x]) => `
        <button type="button" class="xs-ex" data-ex="${esc(x)}"><b>${esc(l)}</b><code>${esc(x)}</code></button>`).join("");
    }
  }

  el.querySelectorAll("[data-xt]").forEach((b) => b.addEventListener("click", () => {
    tab = b.dataset.xt;
    el.querySelectorAll("[data-xt]").forEach((x) => x.classList.toggle("on", x === b));
    renderList();
  }));
  $("#xsQ").addEventListener("input", renderList);
  $("#xsList").addEventListener("click", (e) => {
    const quick = e.target.closest("[data-agg]");
    const fieldBtn = e.target.closest("[data-field]");
    if (quick && fieldBtn) { insert(`${quick.dataset.agg}(${ident(fieldBtn.dataset.field)})`); return; }
    if (fieldBtn) {
      insert(ident(fieldBtn.dataset.field));
      if (isMaster && !isMeasure && !$("#xsName").value) $("#xsName").value = fieldBtn.dataset.field;
      return;
    }
    const fn = e.target.closest("[data-tpl]"); if (fn) { insert(fn.dataset.tpl); return; }
    const ex = e.target.closest("[data-ex]"); if (ex) { ta.value = ex.dataset.ex; ta.focus(); paint(); }
  });
  el.querySelectorAll("[data-ins]").forEach((b) => b.addEventListener("click", () => {
    insert(b.dataset.ins);
    if (b.dataset.ins === "()" || b.dataset.ins === "''") { ta.selectionStart = ta.selectionEnd = ta.selectionStart - 1; }
  }));
  ta.addEventListener("input", paint);
  ta.addEventListener("scroll", syncScroll);
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Tab") { e.preventDefault(); insert("  "); }
    else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); test(); }
    else if (e.key.toLowerCase() === "f" && e.ctrlKey && e.shiftKey) { e.preventDefault(); ta.value = pretty(ta.value); paint(); }
  });
  $("#xsPretty").addEventListener("click", () => { ta.value = pretty(ta.value); paint(); ta.focus(); });
  $("#xsClear").addEventListener("click", () => { ta.value = ""; paint(); ta.focus(); });
  $("#xsTest").addEventListener("click", () => test());

  /* ---------- Ayuda de IA (máx. 500 caracteres) ---------- */
  const aiQ = $("#xsAiQ"), aiOut = $("#xsAiOut");
  const aiCount = () => { $("#xsAiN").textContent = `${aiQ.value.length}/${AI_MAX}`; $("#xsAiN").classList.toggle("max", aiQ.value.length >= AI_MAX); aiQ.style.height = "auto"; aiQ.style.height = Math.min(96, aiQ.scrollHeight) + "px"; };
  aiQ.addEventListener("input", aiCount);
  aiQ.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); askAi(); } });
  $("#xsAiGo").addEventListener("click", () => askAi());
  async function askAi() {
    const prompt = aiQ.value.trim().slice(0, AI_MAX);
    if (!prompt) { aiQ.focus(); return; }
    const b = $("#xsAiGo");
    b.disabled = true; b.innerHTML = `<span class="xs-spin"></span>Pensando…`;
    aiOut.hidden = false; aiOut.className = "xs-ai-out"; aiOut.textContent = "La IA está escribiendo la expresión con tus campos…";
    try {
      const r = await api.assistExpression(o.appId, o.kind, prompt, exprOf());
      if (!r.ok) {
        aiOut.className = "xs-ai-out err"; aiOut.textContent = r.message || "No se pudo generar.";
        if (r.expression) aiOut.innerHTML += ` <button type="button" class="xs-op" id="xsAiUse">Ver su intento</button>`;
        $("#xsAiUse")?.addEventListener("click", () => { ta.value = r.expression; paint(); });
      } else {
        const prev = ta.value;
        ta.value = pretty(r.expression); paint();
        aiOut.className = "xs-ai-out ok";
        aiOut.innerHTML = `<b>✓ Lista y validada en el motor.</b> ${esc(r.explanation || "")}${r.value != null ? ` <span class="xs-ai-v">Resultado: ${Number(r.value).toLocaleString("es-CO", { maximumFractionDigits: 2 })}</span>` : ""}
          ${prev.trim() ? ` <button type="button" class="xs-op" id="xsAiUndo">Deshacer</button>` : ""}`;
        $("#xsAiUndo")?.addEventListener("click", () => { ta.value = prev; paint(); aiOut.hidden = true; });
        test();
      }
    } catch (e) {
      aiOut.className = "xs-ai-out err"; aiOut.textContent = e.message;
    }
    b.disabled = false; b.textContent = "Generar";
  }

  const exprOf = () => ta.value.replace(/--[^\n]*/g, "").replace(/\s*\n\s*/g, " ").trim();
  async function test() {
    const r = $("#xsRes");
    const expr = exprOf();
    if (!expr) { r.innerHTML = `<div class="xs-res-err">Escribe una expresión.</div>`; return null; }
    r.innerHTML = `<div class="xs-res-empty"><span class="xs-spin"></span>Probando en el motor…</div>`;
    try {
      const name = isMaster ? ($("#xsName").value.trim() || "Dimensión calculada") : undefined;
      const res = await api.parseExpression(o.appId, o.kind, expr, name);
      let extra = "";
      if (isMeasure) {
        if (res.value != null) {
          fmtPanel.setSample(res.value);
          extra = `<div class="xs-kpi"><span>Resultado con todos los datos</span><b>${Number(res.value).toLocaleString("es-CO", { maximumFractionDigits: 2 })}</b>${format ? `<em>con formato: <b>${esc(formatValue(res.value, format))}</b></em>` : ""}</div>`;
        }
        if (res.composite && res.parts?.length) {
          extra += `<div class="xs-vals"><span>${res.parts.length === 1 ? "1 agregación" : `${res.parts.length} agregaciones combinadas`}</span></div>`;
        }
      } else if (res.calculated) {
        extra = `<div class="xs-vals"><span>${res.distinct ?? "?"} valores distintos · ejemplos:</span>${(res.sample || []).map((v) => `<i>${esc(v)}</i>`).join("")}${(res.distinct || 0) > (res.sample || []).length ? "<i>…</i>" : ""}</div>`;
        if (res.sample?.length) fmtPanel.setSample(res.sample[0]);
      }
      const used = [...new Set(res.fields || (res.field ? [res.field] : []))];
      r.innerHTML = `<div class="xs-res-ok">✓ Expresión válida
          <span>Tabla <b>${esc(res.table)}</b>${res.composite ? " · <b>medida compuesta</b>" : res.agg ? ` · agregación <b>${esc(String(res.agg).toUpperCase())}</b>` : ""}${res.calculated ? " · <b>calculada</b>" : !isMeasure ? " · <b>campo</b>" : ""}</span></div>
        ${used.length ? `<div class="xs-used">${used.map((f) => `<span>${esc(ident(f))}</span>`).join("")}</div>` : ""}${extra}`;
      return res;
    } catch (e) {
      r.innerHTML = `<div class="xs-res-err">✕ ${esc(e.message)}</div>`;
      return null;
    }
  }

  $("#xsOk").addEventListener("click", async () => {
    const msg = $("#xsMsg");
    const expression = exprOf();
    if (!expression) { msg.textContent = "Escribe una expresión."; msg.classList.add("err"); return; }
    if (isMaster) {
      const name = $("#xsName").value.trim();
      if (!name) { msg.textContent = "Escribe un nombre."; msg.classList.add("err"); $("#xsName").focus(); return; }
      msg.classList.remove("err"); msg.textContent = "Validando en el motor…";
      try { await o.onSave({ name, expression, description: $("#xsDesc").value.trim() || null, format }); }
      catch (e) { msg.textContent = e.message; msg.classList.add("err"); }
    } else {
      const res = await test();
      if (res) await o.onApply(expression, res, format);
    }
  });
  $("#xsDel")?.addEventListener("click", async () => {
    if (!confirm(`¿Eliminar "${item.name}"? Los gráficos que lo usan mostrarán el elemento como eliminado.`)) return;
    try { await o.onDelete(); } catch (e) { $("#xsMsg").textContent = e.message; $("#xsMsg").classList.add("err"); }
  });

  /* ---------- Gobierno: certificación + historial de versiones (solo maestros existentes) ---------- */
  let cur = item ? { ...item } : null;
  const fmtDate = (s) => { const d = new Date(s); return isNaN(d) ? "" : d.toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" }); };
  function renderGov() {
    const g = $("#xsGov");
    if (!g || !cur) return;
    const certBtn = o.canCertify
      ? `<button type="button" class="xs-tb ${cur.certified ? "" : "cert"}" id="xsCert">${cur.certified ? "Quitar certificación" : "✓ Certificar"}</button>`
      : "";
    g.innerHTML = `
      <span class="xs-tlbl">Gobierno</span>
      ${cur.certified
        ? `<span class="xs-certok">✓ Métrica certificada</span>
           <small>Por <b>${esc(cur.certified_by || "—")}</b>${cur.certified_at ? ` · ${esc(fmtDate(cur.certified_at))}` : ""}${cur.certified_note ? `<br>«${esc(cur.certified_note)}»` : ""}</small>
           ${o.canCertify ? "" : `<small>Solo quien puede publicar la modifica.</small>`}`
        : `<small>Sin certificar. Una métrica certificada es la definición oficial: se distingue con ✓ y la IA la usa tal cual.</small>`}
      <div class="xs-gov-bar">${certBtn}<button type="button" class="xs-tb" id="xsHist">⟲ Historial · v${cur.version || 1}</button></div>`;
    $("#xsCert")?.addEventListener("click", async () => {
      const on = !cur.certified;
      let note;
      if (on) { note = prompt("Nota de certificación (opcional): qué valida esta definición.", "") ?? null; if (note === null) return; }
      try { cur = await o.onCertify(on, note || undefined); renderGov(); }
      catch (e) { $("#xsMsg").textContent = e.message; $("#xsMsg").classList.add("err"); }
    });
    $("#xsHist")?.addEventListener("click", showHistory);
  }
  async function showHistory() {
    const r = $("#xsRes");
    r.innerHTML = `<div class="xs-res-empty"><span class="xs-spin"></span>Cargando historial…</div>`;
    try {
      const vs = await o.onVersions();
      r.innerHTML = `<div class="xs-hist"><div class="xs-hist-h">Historial de la definición <em>${vs.length === 1 ? "1 versión" : `${vs.length} versiones`}</em></div>
        ${vs.map((v) => `
          <div class="xs-hist-it ${v.is_current ? "cur" : ""}">
            <span class="xs-hist-v">v${v.version}</span>
            <div class="xs-hist-b">
              <b>${esc(v.message || "Cambio")}</b>${v.is_current ? ` <span class="xs-hist-cur">actual</span>` : ""}
              <small>${esc(v.author_name || "—")} · ${esc(fmtDate(v.created_at))}${v.name !== cur.name ? ` · nombre «${esc(v.name)}»` : ""}</small>
              <code>${esc(v.expression)}</code>
            </div>
            ${v.is_current ? "" : `<div class="xs-hist-act"><button type="button" class="xs-op" data-hv-load="${v.version}" title="Cargar en el editor sin guardar">Ver</button><button type="button" class="xs-op" data-hv-restore="${v.version}" title="Restaurar (crea una versión nueva)">Restaurar</button></div>`}
          </div>`).join("")}</div>`;
      r.querySelectorAll("[data-hv-load]").forEach((b) => b.addEventListener("click", () => {
        const v = vs.find((x) => String(x.version) === b.dataset.hvLoad);
        ta.value = v.expression; paint(); ta.focus();
        $("#xsMsg").classList.remove("err"); $("#xsMsg").textContent = `Cargada la v${v.version} en el editor. Pulsa Guardar para dejarla como versión nueva.`;
      }));
      r.querySelectorAll("[data-hv-restore]").forEach((b) => b.addEventListener("click", async () => {
        if (!confirm(`¿Restaurar la v${b.dataset.hvRestore}? Se guarda como una versión nueva; el historial no se pierde.`)) return;
        try {
          cur = await o.onRestore(Number(b.dataset.hvRestore));
          ta.value = cur.expression; if ($("#xsName")) $("#xsName").value = cur.name; if ($("#xsDesc")) $("#xsDesc").value = cur.description || "";
          paint(); renderGov(); showHistory();
        } catch (e) { r.innerHTML = `<div class="xs-res-err">✕ ${esc(e.message)}</div>`; }
      }));
    } catch (e) {
      r.innerHTML = `<div class="xs-res-err">✕ ${esc(e.message)}</div>`;
    }
  }
  renderGov();

  /* ---------- Expresión antigua (Sum([x]), If(…)): se convierte a SQL al abrir ---------- */
  if (/\[[^\]]+\]/.test(initial.replace(/'[^']*'/g, ""))) {
    api.translateExpression(o.appId, initial, "sql").then((t) => {
      if (!el.isConnected || ta.value !== initial) return;
      ta.value = pretty(t.expression); paint();
      const c = $("#xsConv");
      c.hidden = false;
      c.innerHTML = `<b>Convertida a SQL</b> desde la sintaxis anterior: el resultado es el mismo. <button type="button" class="xs-op" id="xsConvOrig">Ver la original</button>`;
      $("#xsConvOrig").addEventListener("click", () => { c.innerHTML = `Original: <code>${esc(initial)}</code>`; });
    }).catch(() => { /* se deja la original: el motor también la entiende */ });
  }

  paint();
  renderList();
  setTimeout(() => { (isMaster && !item ? $("#xsName") : ta).focus(); }, 30);
  return el;
}

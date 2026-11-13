// expr-studio.js — «Estudio de expresiones»: ventana grande para crear/editar medidas y dimensiones
// (maestras o del fx de un gráfico). Tres zonas:
//   · Izquierda: identidad (nombre, descripción) y tipo detectado en vivo.
//   · Centro: editor amplio con números de línea, resaltado de sintaxis, contador y resultado de la prueba.
//   · Derecha: catálogo con Campos (buscables, por tabla), Funciones (firma + descripción) y Ejemplos
//     construidos con los campos reales del modelo. Un clic inserta en el cursor.
// La validación siempre la hace el motor (/expressions/parse); aquí solo se ayuda a escribir.

import * as api from "./api.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const DIM_FUNCS = [
  { n: "If", sig: "If(condición, si_verdadero, si_falso)", d: "Devuelve un valor u otro según una condición.", t: "If([campo] >= 0, 'Sí', 'No')", g: "Lógica" },
  { n: "Match", sig: "Match(valor, 'a', 'b', …)", d: "Posición del valor en la lista (0 si no está).", t: "Match([campo], 'A', 'B')", g: "Lógica" },
  { n: "Alt", sig: "Alt(valor, alternativa)", d: "Usa la alternativa cuando el valor está vacío.", t: "Alt([campo], 'Sin dato')", g: "Lógica" },
  { n: "IsNull", sig: "IsNull(valor)", d: "Verdadero si el valor está vacío.", t: "IsNull([campo])", g: "Lógica" },
  { n: "Class", sig: "Class(número, ancho)", d: "Agrupa un número en rangos: «30 - 40».", t: "Class([campo], 10)", g: "Números" },
  { n: "Round", sig: "Round(número, decimales)", d: "Redondea.", t: "Round([campo], 0)", g: "Números" },
  { n: "Floor", sig: "Floor(número)", d: "Redondea hacia abajo.", t: "Floor([campo])", g: "Números" },
  { n: "Ceil", sig: "Ceil(número)", d: "Redondea hacia arriba.", t: "Ceil([campo])", g: "Números" },
  { n: "Abs", sig: "Abs(número)", d: "Valor absoluto.", t: "Abs([campo])", g: "Números" },
  { n: "Num", sig: "Num(valor)", d: "Convierte a número.", t: "Num([campo])", g: "Números" },
  { n: "Year", sig: "Year(fecha)", d: "Año de una fecha.", t: "Year([campo])", g: "Fechas" },
  { n: "Month", sig: "Month(fecha)", d: "Mes (1-12).", t: "Month([campo])", g: "Fechas" },
  { n: "Day", sig: "Day(fecha)", d: "Día del mes.", t: "Day([campo])", g: "Fechas" },
  { n: "Date", sig: "Date(valor)", d: "Interpreta el valor como fecha (aaaa-mm-dd).", t: "Date([campo])", g: "Fechas" },
  { n: "Upper", sig: "Upper(texto)", d: "Mayúsculas.", t: "Upper([campo])", g: "Texto" },
  { n: "Lower", sig: "Lower(texto)", d: "Minúsculas.", t: "Lower([campo])", g: "Texto" },
  { n: "Trim", sig: "Trim(texto)", d: "Quita espacios al inicio y al final.", t: "Trim([campo])", g: "Texto" },
  { n: "Left", sig: "Left(texto, n)", d: "Primeros n caracteres.", t: "Left([campo], 3)", g: "Texto" },
  { n: "Right", sig: "Right(texto, n)", d: "Últimos n caracteres.", t: "Right([campo], 3)", g: "Texto" },
  { n: "Mid", sig: "Mid(texto, inicio, n)", d: "Parte del texto.", t: "Mid([campo], 1, 3)", g: "Texto" },
  { n: "Replace", sig: "Replace(texto, 'buscar', 'por')", d: "Reemplaza un texto por otro.", t: "Replace([campo], 'a', 'b')", g: "Texto" },
  { n: "Len", sig: "Len(texto)", d: "Cantidad de caracteres.", t: "Len([campo])", g: "Texto" },
  { n: "Text", sig: "Text(valor)", d: "Convierte a texto.", t: "Text([campo])", g: "Texto" },
];
const MEAS_FUNCS = [
  { n: "Sum", sig: "Sum([campo])", d: "Suma de un campo numérico.", t: "Sum([campo])", g: "Agregación" },
  { n: "Count", sig: "Count([campo])", d: "Cantidad de filas con valor.", t: "Count([campo])", g: "Agregación" },
  { n: "Avg", sig: "Avg([campo])", d: "Promedio.", t: "Avg([campo])", g: "Agregación" },
  { n: "Min", sig: "Min([campo])", d: "Valor mínimo.", t: "Min([campo])", g: "Agregación" },
  { n: "Max", sig: "Max([campo])", d: "Valor máximo.", t: "Max([campo])", g: "Agregación" },
  { n: "Count", sig: "Count(DISTINCT [campo])", d: "Cantidad de valores distintos (p. ej. personas únicas).", t: "Count(DISTINCT [campo])", g: "Agregación" },
  { n: "Sum", sig: "Sum(expresión por fila)", d: "Agrega el resultado de una expresión en cada fila.", t: "Sum(If([campo] = 'valor', 1, 0))", g: "Agregación" },
  { n: "/", sig: "Agregación / Agregación", d: "Combina agregaciones con + - * / (porcentajes, tasas, diferencias).", t: "Count([campo]) / Count([campo]) * 100", g: "Medida compuesta" },
  { n: "Round", sig: "Round(medida, decimales)", d: "Redondea el resultado de la medida.", t: "Round(Sum([campo]) / Count([campo]), 2)", g: "Medida compuesta" },
  { n: "If", sig: "If(condición, medida, otra)", d: "Elige entre dos resultados según una condición sobre agregaciones.", t: "If(Count([campo]) > 0, Sum([campo]) / Count([campo]), 0)", g: "Medida compuesta" },
  ...DIM_FUNCS.map((f) => ({ ...f, g: `Dentro de la agregación · ${f.g}` })),
];
const OPS = ["&", "+", "-", "*", "/", "=", "<>", ">", ">=", "<", "<=", "AND", "OR", "NOT", "( )", "' '"];
const FN_NAMES = new Set([...DIM_FUNCS, ...MEAS_FUNCS].map((f) => f.n.toLowerCase()));

/** Resaltado de sintaxis (HTML) para la capa bajo el textarea. */
function highlight(src) {
  let out = "", i = 0;
  const s = String(src);
  while (i < s.length) {
    const c = s[i];
    if (c === "[") { const j = s.indexOf("]", i); const e = j < 0 ? s.length : j + 1; out += `<span class="xs-f">${esc(s.slice(i, e))}</span>`; i = e; continue; }
    if (c === "'") { let j = i + 1; while (j < s.length && s[j] !== "'") j++; const e = Math.min(s.length, j + 1); out += `<span class="xs-s">${esc(s.slice(i, e))}</span>`; i = e; continue; }
    if (/[0-9]/.test(c)) { let j = i; while (j < s.length && /[0-9.]/.test(s[j])) j++; out += `<span class="xs-n">${esc(s.slice(i, j))}</span>`; i = j; continue; }
    if (/[A-Za-z_]/.test(c)) {
      let j = i; while (j < s.length && /[A-Za-z_0-9#]/.test(s[j])) j++;
      const w = s.slice(i, j);
      const cls = FN_NAMES.has(w.toLowerCase()) ? "xs-fn" : /^(AND|OR|NOT|DISTINCT)$/i.test(w) ? "xs-k" : "";
      out += cls ? `<span class="${cls}">${esc(w)}</span>` : esc(w); i = j; continue;
    }
    if ("&+-*/=<>".includes(c)) { out += `<span class="xs-o">${esc(c)}</span>`; i++; continue; }
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
    const simple = /^[A-Za-z]+\s*\(\s*(\[[^\]]+\]|[\w%.]+)\s*\)$/.test(t);
    return simple ? { k: "measure", label: "Medida (agregación)" } : { k: "composite", label: "Medida compuesta" };
  }
  if (/^\[[^\]]+\]$/.test(t)) return { k: "field", label: "Campo del modelo" };
  return { k: "calc", label: "Dimensión calculada" };
}

/** Balance de paréntesis / corchetes / comillas: aviso inmediato mientras se escribe. */
function balance(text) {
  let p = 0, b = 0, q = false;
  for (const c of text) {
    if (c === "'") q = !q;
    if (q) continue;
    if (c === "(") p++; else if (c === ")") p--; else if (c === "[") b++; else if (c === "]") b--;
    if (p < 0 || b < 0) return "Sobra un cierre «)» o «]».";
  }
  if (q) return "Falta cerrar una comilla «'».";
  if (p > 0) return `Falta${p > 1 ? "n" : ""} ${p} paréntesis de cierre «)».`;
  if (b > 0) return "Falta cerrar un corchete «]».";
  return "";
}

/** Ordena la expresión en varias líneas (If anidados y argumentos largos). */
function pretty(text) {
  const t = String(text).replace(/\s+/g, " ").trim();
  if (t.length < 60) return t;
  let out = "", depth = 0, q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === "'") q = !q;
    if (!q && c === "(") { depth++; out += "(\n" + "  ".repeat(depth); while (t[i + 1] === " ") i++; continue; }
    if (!q && c === ")") { depth = Math.max(0, depth - 1); out += "\n" + "  ".repeat(depth) + ")"; continue; }
    if (!q && c === ",") { out += ",\n" + "  ".repeat(depth); while (t[i + 1] === " ") i++; continue; }
    out += c;
  }
  return out;
}

/**
 * @param {object} o
 *  host: {open(html, cls) -> el, close()}; appId; kind "measure"|"dimension"; mode "master"|"expr"
 *  item (maestro a editar) | initial (texto); fields: [{field, display, type, tables}]
 *  onSave({name, expression, description}) (master) · onApply(expr, resolved) (expr) · onDelete()
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

  // Ejemplos con los campos reales del modelo.
  const num = fields.find((f) => f.type === "number")?.field || "Valor";
  const txt = fields.find((f) => f.type === "text")?.field || "Categoria";
  const txt2 = fields.filter((f) => f.type === "text")[1]?.field || txt;
  const dat = fields.find((f) => f.type === "date")?.field || "Fecha";
  const EXAMPLES = isMeasure ? [
    ["Total", `Sum([${num}])`], ["Cantidad de registros", `Count([${txt}])`], ["Promedio", `Avg([${num}])`], ["Máximo", `Max([${num}])`],
    ["Valores únicos", `Count(DISTINCT [${txt}])`],
    ["Porcentaje (% del total con dato)", `Count([${dat}]) / Count([${txt}]) * 100`],
    ["Contar los que cumplen una condición", `Sum(If([${num}] >= 40, 1, 0))`],
    ["% que cumple una condición", `Round(Sum(If([${num}] >= 40, 1, 0)) / Count([${txt}]) * 100, 2)`],
    ["Promedio por registro único", `Sum([${num}]) / Count(DISTINCT [${txt}])`],
    ["Rango (máximo − mínimo)", `Max([${num}]) - Min([${num}])`],
  ] : [
    ["Grupos según un umbral", `If([${num}] >= 40, 'Alto', 'Bajo')`],
    ["Rangos", `Class([${num}], 10)`],
    ["Tres niveles (If anidado)", `If([${num}] >= 60, 'Alto',\n  If([${num}] >= 30, 'Medio', 'Bajo'))`],
    ["Año de una fecha", `Year([${dat}])`],
    ["Año-Mes", `Year([${dat}]) & '-' & Month([${dat}])`],
    ["Unir dos campos", `[${txt}] & ' - ' & [${txt2}]`],
    ["Agrupar categorías", `If(Match([${txt}], 'A', 'B') > 0, 'Grupo 1', 'Otros')`],
    ["Vacíos como «Sin dato»", `Alt([${txt}], 'Sin dato')`],
  ];

  const tables = {};
  for (const f of fields) for (const t of f.tables || ["(modelo)"]) (tables[t] ||= []).push(f);

  const el = o.host.open(`
    <div class="xs">
      <header class="xs-head">
        <span class="xs-badge ${isMeasure ? "m" : "d"}">${isMeasure ? "Σ" : "≡"}</span>
        <div class="xs-ttl"><h3>${esc(title)}</h3><small>${isMeasure ? "Agrega valores (Sum, Count, Avg, Min, Max, Count DISTINCT) y combínalos: porcentajes, tasas, condiciones." : "Un campo o una expresión por fila (dimensión calculada)."}</small></div>
        <button class="ho-x" data-close aria-label="Cerrar">✕</button>
      </header>
      <div class="xs-body">
        <aside class="xs-left">
          ${isMaster ? `
          <label class="xs-lbl">Nombre<input id="xsName" value="${esc(item?.name || "")}" placeholder="${isMeasure ? "Ej.: Total conductores" : "Ej.: Rango de edad"}" maxlength="80" /></label>
          <label class="xs-lbl grow">Descripción<textarea id="xsDesc" placeholder="Qué representa y cómo se calcula. La IA también la lee.">${esc(item?.description || "")}</textarea></label>` : ""}
          <div class="xs-type" id="xsType"></div>
          ${isMaster && item ? `<div class="xs-gov" id="xsGov"></div>` : ""}
          <div class="xs-tip">
            <b>Atajos</b>
            <span><kbd>Ctrl</kbd>+<kbd>Enter</kbd> probar</span>
            <span><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> ordenar</span>
            <span><kbd>Tab</kbd> sangría</span>
          </div>
        </aside>
        <section class="xs-center">
          <div class="xs-bar">
            <button type="button" class="xs-tb" id="xsTest" title="Probar en el motor (Ctrl+Enter)">▶ Probar</button>
            <button type="button" class="xs-tb" id="xsPretty" title="Ordenar en varias líneas (Ctrl+Shift+F)">⇶ Ordenar</button>
            <button type="button" class="xs-tb" id="xsClear" title="Borrar la expresión">✕ Limpiar</button>
            <span class="xs-ops">${OPS.map((x) => `<button type="button" class="xs-op" data-ins="${esc(x === "( )" ? "()" : x === "' '" ? "''" : ` ${x} `)}">${esc(x)}</button>`).join("")}</span>
            <span class="xs-count" id="xsCount"></span>
          </div>
          <div class="xs-editor">
            <div class="xs-gutter" id="xsGut"></div>
            <div class="xs-code">
              <pre class="xs-hl" id="xsHl" aria-hidden="true"></pre>
              <textarea id="xsText" spellcheck="false" autocomplete="off" placeholder="${esc(isMeasure ? "Sum([Ventas])" : "If([EDAD EN AÑOS] >= 40, 'Mayor de 40', 'Menor de 40')")}">${esc(initial)}</textarea>
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

  function paint() {
    const v = ta.value;
    hl.innerHTML = highlight(v);
    const n = v.split("\n").length;
    gut.innerHTML = Array.from({ length: n }, (_, i) => `<span>${i + 1}</span>`).join("");
    $("#xsCount").textContent = `${v.length} caracteres · ${n} línea${n === 1 ? "" : "s"}`;
    const d = detect(o.kind, v);
    $("#xsType").innerHTML = `<span class="xs-tlbl">Tipo</span><span class="xs-tval ${d.k}">${esc(d.label)}</span>
      ${d.k === "calc" ? `<small>Se evalúa en cada fila con campos de una misma tabla y se usa como cualquier dimensión.</small>` : d.k === "field" ? `<small>Usa el campo tal cual.</small>` : d.k === "composite" ? `<small>Combina agregaciones o agrega una expresión por fila. Cada campo va dentro de una agregación y todos en una misma tabla.</small>` : isMeasure && d.k !== "empty" ? `<small>Una agregación sobre un campo.</small>` : ""}`;
    const w = balance(v);
    $("#xsWarn").hidden = !w; $("#xsWarn").textContent = w ? "⚠ " + w : "";
    syncScroll();
  }
  function syncScroll() { hl.scrollTop = ta.scrollTop; hl.scrollLeft = ta.scrollLeft; gut.scrollTop = ta.scrollTop; }
  function insert(txt) {
    const s = ta.selectionStart ?? ta.value.length, e = ta.selectionEnd ?? s;
    // Plantillas con [campo]: si hay texto seleccionado, se usa como argumento.
    const sel = ta.value.slice(s, e);
    const t = sel && txt.includes("[campo]") ? txt.replace("[campo]", sel) : txt;
    ta.value = ta.value.slice(0, s) + t + ta.value.slice(e);
    const ph = t.indexOf("[campo]");
    ta.focus();
    if (ph >= 0) { ta.selectionStart = s + ph; ta.selectionEnd = s + ph + 7; } else ta.selectionStart = ta.selectionEnd = s + t.length;
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
          <button type="button" class="xs-it" data-field="${esc(f.field)}" title="Insertar [${esc(f.field)}]">
            <span class="xs-ty ${esc(f.type)}">${f.type === "number" ? "#" : f.type === "date" ? "📅" : "Aa"}</span><b>${esc(f.display || f.field)}</b>
            ${isMeasure && f.type === "number" ? `<span class="xs-quick" data-agg="Sum" title="Insertar Sum([${esc(f.field)}])">Σ</span>` : ""}
            ${isMeasure ? `<span class="xs-quick" data-agg="Count" title="Insertar Count([${esc(f.field)}])">#</span>` : ""}
          </button>`).join("");
      }).join("") || `<div class="xs-none">Sin campos que coincidan.</div>`;
    } else if (tab === "funciones") {
      const groups = [...new Set(funcs.map((f) => f.g))];
      L.innerHTML = groups.map((g) => {
        const vis = funcs.filter((f) => f.g === g && (!q || norm(f.n + " " + f.d).includes(q)));
        if (!vis.length) return "";
        return `<div class="xs-grp">${esc(g)}</div>` + vis.map((f) => `
          <button type="button" class="xs-fn-it" data-tpl="${esc(f.t)}"><code>${esc(f.sig)}</code><small>${esc(f.d)}</small></button>`).join("");
      }).join("") + (isMeasure ? `<div class="xs-note">Dentro de una medida compuesta, <b>Count</b> cuenta valores no vacíos y una división por cero da 0. Las funciones por fila (If, Year, Upper…) se usan dentro de la agregación: <code>Sum(If([campo] = 'x', 1, 0))</code>.</div>` : "");
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
    if (quick && fieldBtn) { insert(`${quick.dataset.agg}([${fieldBtn.dataset.field}])`); return; }
    if (fieldBtn) {
      insert(`[${fieldBtn.dataset.field}]`);
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

  const exprOf = () => ta.value.replace(/\s*\n\s*/g, " ").trim();
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
        // El motor devuelve el valor total al validar (también para medidas compuestas).
        if (res.value != null) {
          extra = `<div class="xs-kpi"><span>Resultado con todos los datos</span><b>${Number(res.value).toLocaleString("es-CO", { maximumFractionDigits: 2 })}</b></div>`;
        }
        if (res.composite && res.parts?.length) {
          extra += `<div class="xs-vals"><span>${res.parts.length === 1 ? "1 agregación" : `${res.parts.length} agregaciones combinadas`}:</span>${res.parts.map((p) => `<i>${esc(p.agg)}${p.distinct ? " distinct" : ""}(${esc(p.field ? `[${p.field}]` : p.expr)})</i>`).join("")}</div>`;
        }
      } else if (res.calculated) {
        extra = `<div class="xs-vals"><span>${res.distinct ?? "?"} valores distintos · ejemplos:</span>${(res.sample || []).map((v) => `<i>${esc(v)}</i>`).join("")}${(res.distinct || 0) > (res.sample || []).length ? "<i>…</i>" : ""}</div>`;
      }
      const used = [...new Set(res.fields || (res.field ? [res.field] : []))];
      r.innerHTML = `<div class="xs-res-ok">✓ Expresión válida
          <span>Tabla <b>${esc(res.table)}</b>${res.composite ? " · <b>medida compuesta</b>" : res.agg ? ` · agregación <b>${esc(res.agg)}</b>` : ""}${res.calculated ? " · <b>calculada</b>" : !isMeasure ? " · <b>campo</b>" : ""}</span></div>
        ${used.length ? `<div class="xs-used">${used.map((f) => `<span>[${esc(f)}]</span>`).join("")}</div>` : ""}${extra}`;
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
      try { await o.onSave({ name, expression, description: $("#xsDesc").value.trim() || null }); }
      catch (e) { msg.textContent = e.message; msg.classList.add("err"); }
    } else {
      const res = await test();
      if (res) await o.onApply(expression, res);
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

  paint();
  renderList();
  setTimeout(() => { (isMaster && !item ? $("#xsName") : ta).focus(); }, 30);
  return el;
}

// app-cuaderno.js — Cuaderno de análisis (estilo Jupyter/Hex) dentro de una app.
//
// Un cuaderno es una lista de celdas que se ejecutan en el motor (POST /apps/{id}/notebooks/run):
//   · SQL: SELECT … FROM … WHERE … GROUP BY … HAVING … ORDER BY … LIMIT, con agregaciones y FILTER (WHERE …).
//     El resultado se ve como tabla o gráfico (sugerido según las columnas) y se descarga en CSV. Un resultado de
//     un solo valor se puede guardar como medida.
//   · Perfil de un campo: nulos, distintos, percentiles, asimetría, atípicos, histograma o valores más frecuentes.
//   · Pareto / ABC: qué parte de una dimensión explica el 80 % de una medida.
//   · Correlación: matriz de Pearson entre campos numéricos y las parejas más fuertes.
//   · Atípicos: método de Tukey (IQR) con z-score y los registros concretos.
//   · Nota: texto para documentar el análisis (**negrita**, `código`, # títulos, - listas).
// Se guarda solo (quien lo creó o un administrador, con charts:edit); el resto puede ejecutarlo y duplicarlo.
// Atajos: Ctrl+Enter ejecuta la celda, Mayús+Enter ejecuta y pasa a la siguiente, Ctrl+S guarda.

import * as api from "./api.js";
import { authService } from "./auth-service.js";
import { toast, confirmBox, modal } from "./ui-kit.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nf = (v, d = 2) => (v == null || v === "" || isNaN(v) ? (v ?? "") : Number(v).toLocaleString("es-CO", { maximumFractionDigits: d }));
const uid = () => "c" + Math.random().toString(36).slice(2, 10);
const ident = (n) => (/^[\p{L}_][\p{L}\p{N}_]*$/u.test(n) ? n : `"${String(n).replace(/"/g, '""')}"`);
const when = (s) => { if (!s) return ""; const d = new Date(s); return isNaN(d) ? "" : d.toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" }); };

const KINDS = {
  sql: { label: "SQL", icon: "⌗", desc: "Consulta" },
  profile: { label: "Perfil", icon: "◔", desc: "Perfil de un campo" },
  pareto: { label: "Pareto", icon: "▤", desc: "Pareto 80/20 y ABC" },
  correlation: { label: "Correlación", icon: "⊞", desc: "Matriz de correlación" },
  outliers: { label: "Atípicos", icon: "⇕", desc: "Valores atípicos (IQR)" },
  note: { label: "Nota", icon: "¶", desc: "Texto" },
};
const PAL = ["#6366f1", "#06b6d4", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6"];

export async function render(mount, ctx) {
  const me = authService.current() || {};
  const canEdit = ctx.can("charts:edit");
  const st = { list: [], nb: null, schema: [], results: new Map(), charts: new Map(), dirty: false, saving: false, q: "", activeCell: null };
  const params = new URLSearchParams(location.search);

  mount.innerHTML = `
    <div class="nb">
      <aside class="nb-side">
        <div class="nb-side-h"><span>Cuadernos</span>${canEdit ? `<button type="button" class="nb-ibtn" id="nbNew" title="Nuevo cuaderno">＋</button>` : ""}</div>
        <ul class="nb-list" id="nbList"><li class="nb-muted">Cargando…</li></ul>
        <div class="nb-side-h"><span>Datos</span></div>
        <input class="nb-search" id="nbQ" type="search" placeholder="Buscar tabla o campo" aria-label="Buscar tabla o campo" />
        <div class="nb-tree" id="nbTree"></div>
        <p class="nb-tip">Clic en un campo: lo inserta en la consulta. ◔ abre su perfil.</p>
      </aside>
      <section class="nb-main" id="nbMain"><div class="nb-empty"><span class="in-spin"></span> Cargando…</div></section>
    </div>`;
  const $ = (s) => mount.querySelector(s);

  function paintWelcome() {
    $("#nbMain").innerHTML = `<div class="nb-welcome">
      <h2>Cuaderno de análisis</h2>
      <p>Explora los datos de esta aplicación con <b>SQL</b> y análisis estadísticos, documenta lo que encuentras y guárdalo para volver o compartirlo.</p>
      <div class="nb-wl-grid">
        ${Object.entries(KINDS).filter(([k]) => k !== "note").map(([k, d]) => `<div class="nb-wl-it"><b><i>${d.icon}</i>${esc(d.label)}</b><span>${esc({ sql: "SELECT, GROUP BY, HAVING, FILTER (WHERE …), CASE, percentiles", profile: "Nulos, distintos, percentiles, asimetría e histograma", pareto: "Qué 20 % explica el 80 %, con clases A/B/C", correlation: "Qué variables se mueven juntas", outliers: "Registros fuera de lo normal (Tukey)" }[k])}</span></div>`).join("")}
      </div>
      ${canEdit ? `<button type="button" class="q-btn primary" id="nbFirst">＋ Crear mi primer cuaderno</button>` : `<p class="nb-muted">Aún no hay cuadernos en esta aplicación.</p>`}
    </div>`;
    $("#nbFirst")?.addEventListener("click", newNotebook);
  }

  function paintList() {
    const ul = $("#nbList");
    ul.innerHTML = st.list.length ? st.list.map((n) => `
      <li><button type="button" class="nb-li ${st.nb?.id === n.id ? "on" : ""}" data-nb="${esc(n.id)}" title="${esc(n.name)}">
        <b>${esc(n.name)}</b><small>${n.cell_count} ${n.cell_count === 1 ? "celda" : "celdas"} · ${esc(n.owner_name || "")}</small></button></li>`).join("")
      : `<li class="nb-muted">Sin cuadernos todavía.</li>`;
    ul.querySelectorAll("[data-nb]").forEach((b) => b.addEventListener("click", async () => { if (await leave()) open(b.dataset.nb); }));
  }

  function paintTree() {
    const q = st.q.trim().toLowerCase();
    const host = $("#nbTree");
    const tIco = (t) => (t === "number" ? "#" : t === "date" ? "◷" : "Aa");
    host.innerHTML = st.schema.map((t) => {
      const cols = t.columns.filter((c) => !q || `${t.table} ${c.name} ${c.display || ""}`.toLowerCase().includes(q));
      if (q && !cols.length && !t.table.toLowerCase().includes(q)) return "";
      return `<details class="nb-tbl" ${q || st.schema.length <= 2 ? "open" : ""}>
        <summary><span class="nb-tbl-n" title="${esc(t.table)}">${esc(t.table)}</span><em>${nf(t.rows, 0)}</em>
          <button type="button" class="nb-ibtn sm" data-tq="${esc(t.table)}" title="Nueva consulta sobre esta tabla">⌗</button></summary>
        ${cols.map((c) => `<div class="nb-col" data-ins="${esc(c.name)}" title="${esc(c.display ? c.display + " · " + c.name : c.name)} · clic para insertar">
          <span class="nb-ty ${esc(c.type)}">${tIco(c.type)}</span><span class="nb-col-n">${esc(c.display || c.name)}</span>
          <button type="button" class="nb-ibtn sm" data-prof="${esc(t.table)}|${esc(c.name)}" title="Perfil de ${esc(c.name)}">◔</button></div>`).join("")}
      </details>`;
    }).join("") || `<p class="nb-muted">Sin coincidencias.</p>`;
    host.querySelectorAll("[data-tq]").forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); addCell({ kind: "sql", title: b.dataset.tq, sql: `SELECT *\nFROM ${ident(b.dataset.tq)}\nLIMIT 100` }, true); }));
    host.querySelectorAll("[data-prof]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); const [t, f] = b.dataset.prof.split("|"); addCell({ kind: "profile", title: `Perfil · ${f}`, params: { table: t, field: f } }, true); }));
    host.querySelectorAll("[data-ins]").forEach((el) => el.addEventListener("click", () => insertField(el.dataset.ins)));
  }
  $("#nbQ").addEventListener("input", (e) => { st.q = e.target.value; paintTree(); });
  $("#nbNew")?.addEventListener("click", async () => { if (await leave()) newNotebook(); });

  /* =============================== cuaderno =============================== */
  const ownerOk = () => canEdit && st.nb && (me.role === "admin" || st.nb.owner_id === me.id);

  async function open(id) {
    destroyCharts();
    st.results.clear();
    try { st.nb = await api.getNotebook(ctx.appId, id); } catch (e) { toast(e.message, "err"); return; }
    st.dirty = false;
    const u = new URL(location.href); u.searchParams.set("nb", id); history.replaceState(null, "", u);
    paintList(); paintNotebook();
    runAll(true);
  }

  async function newNotebook() {
    try {
      const n = await api.createNotebook(ctx.appId, { name: `Análisis ${new Date().toLocaleDateString("es-CO", { day: "numeric", month: "short" })}` });
      st.list = await api.listNotebooks(ctx.appId);
      await open(n.id);
      mount.querySelector(".nb-title")?.select();
    } catch (e) { toast(e.message, "err"); }
  }

  function paintNotebook() {
    const nb = st.nb, ro = !ownerOk();
    $("#nbMain").innerHTML = `
      <header class="nb-head">
        <div class="nb-head-t">
          <input class="nb-title" value="${esc(nb.name)}" maxlength="120" ${ro ? "readonly" : ""} aria-label="Nombre del cuaderno" />
          <input class="nb-desc" value="${esc(nb.description || "")}" maxlength="300" placeholder="${ro ? "" : "Añade una descripción: qué preguntas responde este cuaderno"}" ${ro ? "readonly" : ""} aria-label="Descripción" />
          <small class="nb-meta">${esc(nb.owner_name || "")} · actualizado ${esc(when(nb.updated_at))}${ro ? ` · <b>solo lectura</b>${canEdit ? " (duplícalo para editar)" : ""}` : ""}</small>
        </div>
        <div class="nb-head-a">
          <span class="nb-save" id="nbSave">${ro ? "" : "Guardado"}</span>
          <button type="button" class="q-btn" id="nbRunAll" title="Ejecutar todas las celdas">▶ Ejecutar todo</button>
          ${canEdit ? `<button type="button" class="q-btn" id="nbDup" title="Duplicar como cuaderno tuyo">⧉ Duplicar</button>` : ""}
          <button type="button" class="q-btn" id="nbExport" title="Descargar las consultas como archivo .sql">⤓ .sql</button>
          ${ro ? "" : `<button type="button" class="q-btn danger" id="nbDel" title="Eliminar cuaderno">🗑</button>`}
        </div>
      </header>
      <div class="nb-cells" id="nbCells"></div>
      ${ro ? "" : addBar("end")}`;
    paintCells();
    const title = mount.querySelector(".nb-title"), desc = mount.querySelector(".nb-desc");
    title.addEventListener("input", () => { nb.name = title.value; markDirty(); });
    desc.addEventListener("input", () => { nb.description = desc.value; markDirty(); });
    $("#nbRunAll").addEventListener("click", () => runAll(false));
    $("#nbDup")?.addEventListener("click", duplicate);
    $("#nbExport").addEventListener("click", exportSql);
    $("#nbDel")?.addEventListener("click", remove);
    wireAddBar(mount.querySelector(".nb-add[data-at='end']"), null);
  }

  const addBar = (at) => `<div class="nb-add" data-at="${at}">${Object.entries(KINDS).map(([k, d]) => `<button type="button" data-add="${k}" title="${esc(d.desc)}"><i>${d.icon}</i>${esc(d.label)}</button>`).join("")}</div>`;
  function wireAddBar(el, afterId) {
    el?.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => addCell(defaults(b.dataset.add), true, afterId)));
  }

  function defaults(kind) {
    const t = mainTable();
    const num = t?.columns.find((c) => c.type === "number")?.name;
    const txt = t?.columns.find((c) => c.type === "text")?.name;
    switch (kind) {
      case "sql": return { kind, title: "Consulta", sql: t ? `SELECT ${txt ? ident(txt) + ",\n       " : ""}COUNT(*) AS registros${num ? `,\n       ROUND(AVG(${ident(num)}), 2) AS promedio_${num.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "_")}` : ""}\nFROM ${ident(t.table)}${txt ? `\nGROUP BY ${ident(txt)}\nORDER BY registros DESC` : ""}\nLIMIT 20` : "SELECT 1" };
      case "profile": return { kind, title: "Perfil", params: { table: t?.table, field: num || txt } };
      case "pareto": return { kind, title: "Pareto", params: { table: t?.table, dimension: txt, measure: num ? `SUM(${ident(num)})` : "COUNT(*)" } };
      case "correlation": return { kind, title: "Correlación", params: { table: t?.table } };
      case "outliers": return { kind, title: "Atípicos", params: { table: t?.table, field: num, k: 1.5 } };
      default: return { kind: "note", text: "## Hallazgo\nEscribe aquí lo que encontraste y por qué importa." };
    }
  }
  const mainTable = () => [...st.schema].sort((a, b) => b.rows - a.rows)[0];
  const tableOf = (name) => st.schema.find((t) => t.table === name) || mainTable();

  function addCell(cell, run = false, afterId = null) {
    if (!st.nb) return;
    if (!ownerOk()) { toast(canEdit ? "Este cuaderno es de otra persona: duplícalo para editarlo." : "No tienes permiso para editar cuadernos.", "err"); return; }
    const c = { id: uid(), ...cell };
    const cells = st.nb.cells;
    const i = afterId ? cells.findIndex((x) => x.id === afterId) : -1;
    if (i >= 0) cells.splice(i + 1, 0, c); else cells.push(c);
    markDirty(); paintCells();
    const el = mount.querySelector(`.nb-cell[data-id="${c.id}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    st.activeCell = c.id;
    if (run && c.kind !== "note") runCell(c.id);
    else el?.querySelector("textarea")?.focus();
  }

  /* =============================== celdas =============================== */
  function paintCells() {
    destroyCharts();
    const host = $("#nbCells");
    if (!host) return;
    const ro = !ownerOk();
    host.innerHTML = st.nb.cells.length ? st.nb.cells.map((c, i) => cellHtml(c, i, ro)).join("") : `<div class="nb-empty">Este cuaderno está vacío. ${ro ? "" : "Añade una celda abajo."}</div>`;
    st.nb.cells.forEach((c) => { wireCell(c); paintResult(c.id); });
  }

  function cellHtml(c, i, ro) {
    const k = KINDS[c.kind] || KINDS.sql;
    return `<section class="nb-cell k-${c.kind} ${st.activeCell === c.id ? "on" : ""}" data-id="${esc(c.id)}">
      <header class="nb-c-h">
        <span class="nb-c-n">[${i + 1}]</span><span class="nb-badge k-${c.kind}"><i>${k.icon}</i>${esc(k.label)}</span>
        <input class="nb-c-t" value="${esc(c.title || "")}" placeholder="${esc(k.desc)}" ${ro ? "readonly" : ""} aria-label="Título de la celda" />
        <span class="nb-c-st" data-st></span>
        ${c.kind !== "note" ? `<button type="button" class="nb-ibtn run" data-act="run" title="Ejecutar (Ctrl+Enter)">▶</button>` : ""}
        ${ro ? "" : `<button type="button" class="nb-ibtn" data-act="up" title="Subir">↑</button><button type="button" class="nb-ibtn" data-act="down" title="Bajar">↓</button>
          <button type="button" class="nb-ibtn" data-act="dup" title="Duplicar celda">⧉</button><button type="button" class="nb-ibtn" data-act="add" title="Añadir celda debajo">＋</button><button type="button" class="nb-ibtn danger" data-act="del" title="Eliminar celda">✕</button>`}
      </header>
      <div class="nb-c-b">${editorHtml(c, ro)}</div>
      <div class="nb-c-addhere" hidden>${addBar("cell")}</div>
      <div class="nb-c-r" data-res></div>
    </section>`;
  }

  function editorHtml(c, ro) {
    const p = c.params || {};
    const tSel = (name = "table") => `<label>Tabla<select data-p="${name}" ${ro ? "disabled" : ""}>${st.schema.map((t) => `<option value="${esc(t.table)}" ${t.table === p.table ? "selected" : ""}>${esc(t.table)} (${nf(t.rows, 0)})</option>`).join("")}</select></label>`;
    const fSel = (key, label, types) => {
      const t = tableOf(p.table);
      const cols = (t?.columns || []).filter((x) => !types || types.includes(x.type));
      return `<label>${label}<select data-p="${key}" ${ro ? "disabled" : ""}><option value="">— elige —</option>${cols.map((x) => `<option value="${esc(x.name)}" ${x.name === p[key] ? "selected" : ""}>${esc(x.display || x.name)}${x.type === "number" ? " #" : x.type === "date" ? " ◷" : ""}</option>`).join("")}</select></label>`;
    };
    switch (c.kind) {
      case "sql": return `<div class="nb-code"><textarea data-sql spellcheck="false" ${ro ? "readonly" : ""} aria-label="Consulta SQL">${esc(c.sql || "")}</textarea></div>`;
      case "profile": return `<div class="nb-form">${tSel()}${fSel("field", "Campo")}</div>`;
      case "pareto": return `<div class="nb-form">${tSel()}${fSel("dimension", "Dimensión", ["text", "date", "number"])}
        <label class="w">Medida (SQL)<input data-p="measure" value="${esc(p.measure || "COUNT(*)")}" placeholder="SUM(ventas)" ${ro ? "readonly" : ""} /></label>
        <label class="w">Solo donde (opcional)<input data-p="where" value="${esc(p.where || "")}" placeholder="estado = 'Activo'" ${ro ? "readonly" : ""} /></label></div>`;
      case "correlation": {
        const t = tableOf(p.table);
        const nums = (t?.columns || []).filter((x) => x.type === "number");
        const chosen = new Set(p.fields || []);
        return `<div class="nb-form">${tSel()}<div class="nb-chips w"><span>Campos (vacío = todos los numéricos)</span>${nums.map((x) => `<button type="button" class="nb-chip ${chosen.has(x.name) ? "on" : ""}" data-fld="${esc(x.name)}" ${ro ? "disabled" : ""}>${esc(x.display || x.name)}</button>`).join("") || `<em class="nb-muted">La tabla no tiene campos numéricos.</em>`}</div></div>`;
      }
      case "outliers": return `<div class="nb-form">${tSel()}${fSel("field", "Campo numérico", ["number"])}
        <label>Sensibilidad<select data-p="k" ${ro ? "disabled" : ""}>${[["1.5", "Estándar (k = 1,5)"], ["3", "Solo extremos (k = 3)"], ["1", "Sensible (k = 1)"]].map(([v, l]) => `<option value="${v}" ${String(p.k ?? "1.5") === v ? "selected" : ""}>${l}</option>`).join("")}</select></label></div>`;
      default: return `<div class="nb-note"><textarea data-text ${ro ? "readonly" : ""} aria-label="Nota" placeholder="Escribe tu nota…">${esc(c.text || "")}</textarea><div class="nb-md" data-md>${md(c.text || "")}</div></div>`;
    }
  }

  function wireCell(c) {
    const el = mount.querySelector(`.nb-cell[data-id="${c.id}"]`);
    if (!el) return;
    el.addEventListener("focusin", () => { st.activeCell = c.id; mount.querySelectorAll(".nb-cell.on").forEach((x) => x !== el && x.classList.remove("on")); el.classList.add("on"); });
    el.querySelector(".nb-c-t").addEventListener("input", (e) => { c.title = e.target.value; markDirty(); });
    el.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => cellAction(c, b.dataset.act, el)));
    const ta = el.querySelector("textarea[data-sql]");
    if (ta) {
      autosize(ta);
      ta.addEventListener("input", () => { c.sql = ta.value; autosize(ta); markDirty(); staleResult(c.id); });
      ta.addEventListener("keydown", (e) => {
        if (e.key === "Tab") { e.preventDefault(); const s = ta.selectionStart; ta.setRangeText("  ", s, ta.selectionEnd, "end"); c.sql = ta.value; markDirty(); }
        else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runCell(c.id); }
        else if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); runCell(c.id); focusNext(c.id); }
      });
    }
    el.querySelectorAll("[data-p]").forEach((inp) => inp.addEventListener(inp.tagName === "SELECT" ? "change" : "input", () => {
      c.params = { ...(c.params || {}), [inp.dataset.p]: inp.value };
      if (inp.dataset.p === "table") { delete c.params.field; delete c.params.dimension; c.params.fields = []; el.querySelector(".nb-c-b").innerHTML = editorHtml(c, !ownerOk()); wireCell(c); }
      markDirty();
      if (inp.tagName === "SELECT") runCell(c.id); else staleResult(c.id);
    }));
    el.querySelectorAll("input[data-p]").forEach((inp) => inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); runCell(c.id); } }));
    el.querySelectorAll("[data-fld]").forEach((b) => b.addEventListener("click", () => {
      const set = new Set(c.params?.fields || []);
      set.has(b.dataset.fld) ? set.delete(b.dataset.fld) : set.add(b.dataset.fld);
      c.params = { ...(c.params || {}), fields: [...set] };
      b.classList.toggle("on"); markDirty(); runCell(c.id);
    }));
    const nt = el.querySelector("textarea[data-text]");
    if (nt) {
      const mdEl = el.querySelector("[data-md]");
      const show = (edit) => { nt.hidden = !edit; mdEl.hidden = edit; if (edit) { autosize(nt); nt.focus(); } };
      show(!c.text && ownerOk());
      mdEl.addEventListener("click", () => { if (ownerOk()) show(true); });
      nt.addEventListener("input", () => { c.text = nt.value; autosize(nt); markDirty(); });
      nt.addEventListener("blur", () => { mdEl.innerHTML = md(c.text || ""); if (c.text) show(false); });
    }
  }

  function cellAction(c, act, el) {
    const cells = st.nb.cells, i = cells.indexOf(c);
    if (act === "run") return runCell(c.id);
    if (act === "add") { const h = el.querySelector(".nb-c-addhere"); h.hidden = !h.hidden; if (!h.dataset.w) { h.dataset.w = "1"; wireAddBar(h, c.id); } return; }
    if (act === "up" && i > 0) { [cells[i - 1], cells[i]] = [cells[i], cells[i - 1]]; }
    else if (act === "down" && i < cells.length - 1) { [cells[i + 1], cells[i]] = [cells[i], cells[i + 1]]; }
    else if (act === "dup") { const d = JSON.parse(JSON.stringify(c)); d.id = uid(); d.title = (c.title || KINDS[c.kind].label) + " (copia)"; cells.splice(i + 1, 0, d); if (st.results.has(c.id)) st.results.set(d.id, st.results.get(c.id)); }
    else if (act === "del") { cells.splice(i, 1); st.results.delete(c.id); }
    else return;
    markDirty(); paintCells();
  }

  function focusNext(id) {
    const i = st.nb.cells.findIndex((x) => x.id === id);
    const next = st.nb.cells[i + 1];
    if (next) mount.querySelector(`.nb-cell[data-id="${next.id}"] textarea, .nb-cell[data-id="${next.id}"] select`)?.focus();
    else if (ownerOk()) addCell(defaults("sql"));
  }

  function insertField(name) {
    const id = st.activeCell && st.nb?.cells.find((c) => c.id === st.activeCell && c.kind === "sql") ? st.activeCell : st.nb?.cells.find((c) => c.kind === "sql")?.id;
    const ta = id && mount.querySelector(`.nb-cell[data-id="${id}"] textarea[data-sql]`);
    if (!ta || ta.readOnly) { navigator.clipboard?.writeText(ident(name)); toast(`Copiado: ${ident(name)}`); return; }
    const s = ta.selectionStart ?? ta.value.length, e = ta.selectionEnd ?? s;
    const before = ta.value.slice(0, s), sep = /[\p{L}\p{N}_")]$/u.test(before) ? ", " : "";
    ta.setRangeText(sep + ident(name), s, e, "end");
    ta.focus(); ta.dispatchEvent(new Event("input"));
  }

  /* =============================== ejecutar =============================== */
  async function runCell(id) {
    const c = st.nb?.cells.find((x) => x.id === id);
    if (!c || c.kind === "note") return;
    const nbAt = st.nb.id;
    const el = mount.querySelector(`.nb-cell[data-id="${id}"]`);
    const stEl = el?.querySelector("[data-st]");
    if (stEl) stEl.innerHTML = `<span class="in-spin"></span>`;
    el?.querySelector("[data-res]")?.classList.add("busy");
    let r;
    try { r = await api.runNotebookCell(ctx.appId, { kind: c.kind, sql: c.sql, params: c.params }); }
    catch (e) { r = { error: e.message }; }
    if (st.nb?.id !== nbAt) return null;   // el usuario abrió o borró otro cuaderno mientras corría
    st.results.set(id, r);
    if (mount.isConnected) paintResult(id);
    return r;
  }
  async function runAll(quiet) {
    const nbAt = st.nb?.id;
    for (const c of [...(st.nb?.cells || [])]) {
      if (!mount.isConnected || st.nb?.id !== nbAt) return;
      if (c.kind !== "note") await runCell(c.id);
    }
    if (!quiet && st.nb?.id === nbAt) toast("Cuaderno ejecutado");
  }
  function staleResult(id) { mount.querySelector(`.nb-cell[data-id="${id}"] [data-res]`)?.classList.add("stale"); }

  function paintResult(id) {
    const el = mount.querySelector(`.nb-cell[data-id="${id}"]`);
    if (!el || !st.nb) return;
    const host = el.querySelector("[data-res]");
    const stEl = el.querySelector("[data-st]");
    host.classList.remove("busy", "stale");
    const r = st.results.get(id);
    const c = st.nb.cells.find((x) => x.id === id);
    destroyChart(id);
    if (!r) { host.innerHTML = ""; if (stEl) stEl.textContent = ""; return; }
    if (r.error) { host.innerHTML = `<div class="nb-err">✕ ${esc(r.error)}</div>`; if (stEl) stEl.innerHTML = `<span class="nb-st-err">error</span>`; return; }
    if (stEl) stEl.textContent = `${r.ms ?? 0} ms`;
    if (r.kind === "sql") host.innerHTML = sqlResult(c, r);
    else if (r.kind === "profile") host.innerHTML = profileResult(r);
    else if (r.kind === "pareto") host.innerHTML = paretoResult(r);
    else if (r.kind === "correlation") host.innerHTML = corrResult(r);
    else if (r.kind === "outliers") host.innerHTML = outResult(r);
    wireResult(c, r, host);
  }

  /* ---------- SQL ---------- */
  function sqlResult(c, r) {
    const view = c.view?.chart || "auto";
    const sug = r.chart?.type || "table";
    const mode = view === "auto" ? (sug === "kpi" ? "kpi" : "table") : view;
    const canChart = r.types.some((t) => t === "number") && r.rows.length > 0;
    const opts = [["table", "Tabla"], ...(canChart ? [["bar", "Barras"], ["line", "Líneas"], ["pie", "Torta"]] : []), ...(r.rows.length === 1 && canChart ? [["kpi", "Número"]] : []),
      ...(r.types.filter((t) => t === "number").length >= 2 ? [["scatter", "Dispersión"]] : [])];
    const single = r.rows.length === 1 && r.columns.length === 1 && r.types[0] === "number";
    return `<div class="nb-r-bar"><span class="nb-r-sum">${esc(r.summary)}</span>
        <span class="nb-seg">${opts.map(([v, l]) => `<button type="button" data-view="${v}" class="${mode === v ? "on" : ""}">${l}</button>`).join("")}</span>
        <button type="button" class="nb-ibtn" data-csv title="Descargar CSV">⤓ CSV</button>
        ${single && canEdit ? `<button type="button" class="nb-ibtn" data-measure title="Guardar esta expresión como medida de la app">Σ Guardar como medida</button>` : ""}</div>
      ${r.truncated ? `<p class="nb-warn">Se muestran ${nf(r.row_count, 0)} de ${nf(r.total_rows, 0)} filas: añade LIMIT o filtros (máx. 10.000).</p>` : ""}
      <div class="nb-r-view">${mode === "table" ? table(r.columns, r.rows, r.types) : mode === "kpi" ? kpi(r) : `<div class="nb-chart"><canvas></canvas></div>`}</div>`;
  }

  function kpi(r) {
    return `<div class="nb-kpis">${r.columns.map((col, i) => r.types[i] === "number" ? `<div class="nb-kpi"><b>${nf(r.rows[0][i])}</b><span>${esc(col)}</span></div>` : "").join("")}</div>`;
  }

  function table(columns, rows, types, { max = 200, cls = "" } = {}) {
    if (!rows.length) return `<p class="nb-muted">Sin filas.</p>`;
    const show = rows.slice(0, max);
    return `<div class="nb-tbl-w"><table class="nb-t ${cls}"><thead><tr>${columns.map((c, i) => `<th data-sort="${i}" class="${types?.[i] === "number" ? "num" : ""}" title="Ordenar">${esc(c)}</th>`).join("")}</tr></thead>
      <tbody>${show.map((r) => `<tr>${r.map((v, i) => `<td class="${types?.[i] === "number" || typeof v === "number" ? "num" : ""}${v == null ? " null" : ""}">${v == null ? "∅" : esc(typeof v === "number" ? nf(v, 4) : v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
      ${rows.length > max ? `<p class="nb-muted">Mostrando ${max} de ${nf(rows.length, 0)} filas en pantalla (el CSV las trae todas).</p>` : ""}`;
  }

  /* ---------- Perfil ---------- */
  function profileResult(r) {
    const k = (v, l, cls = "") => `<div class="nb-kpi ${cls}"><b>${v}</b><span>${l}</span></div>`;
    return `<p class="nb-summary">${(r.notes || []).map((n) => `<span>• ${esc(n)}</span>`).join("")}</p>
      <div class="nb-kpis">${k(nf(r.count, 0), "filas")}${k(`${nf(r.null_pct)} %`, "vacíos", r.null_pct > 10 ? "warn" : "")}${k(nf(r.distinct, 0), "distintos")}${k(esc({ number: "Número", date: "Fecha", text: "Texto" }[r.type]), "tipo")}
        ${r.stats ? k(nf(r.stats.median), "mediana") + k(nf(r.stats.mean), "media") + k(nf(r.stats.stddev), "desviación") + k(nf(r.stats.outliers, 0), "atípicos", r.stats.outliers ? "warn" : "") : ""}
        ${r.date_min ? k(esc(r.date_min), "desde") + k(esc(r.date_max), "hasta") : ""}</div>
      <div class="nb-split"><div class="nb-chart"><canvas></canvas></div><div>${table(r.columns, r.rows, null, { max: 25, cls: "compact" })}</div></div>`;
  }

  /* ---------- Pareto ---------- */
  function paretoResult(r) {
    const cls = r.classes || {};
    return `<p class="nb-summary"><span>${esc(r.summary)}</span></p>
      <div class="nb-kpis"><div class="nb-kpi"><b>${nf(r.top80, 0)} / ${nf(r.items, 0)}</b><span>explican el 80 %</span></div>
        <div class="nb-kpi a"><b>${nf(cls.A, 0)}</b><span>clase A</span></div><div class="nb-kpi b"><b>${nf(cls.B, 0)}</b><span>clase B</span></div><div class="nb-kpi c"><b>${nf(cls.C, 0)}</b><span>clase C</span></div>
        <div class="nb-kpi"><b>${nf(r.total)}</b><span>total</span></div></div>
      <div class="nb-chart tall"><canvas></canvas></div>
      <div class="nb-r-bar"><span class="nb-r-sum">Tabla ABC</span><button type="button" class="nb-ibtn" data-csv title="Descargar CSV">⤓ CSV</button><button type="button" class="nb-ibtn" data-tosql title="Abrir la consulta que usa este análisis">⌗ Ver SQL</button></div>
      ${table(r.columns, r.rows.map((x) => [x[0], x[1], `${nf(x[2])} %`, `${nf(x[3])} %`, x[4]]), [null, "number", "number", "number", null], { max: 100 })}`;
  }

  /* ---------- Correlación ---------- */
  function corrResult(r) {
    if (!r.fields || r.fields.length < 2) return `<p class="nb-summary"><span>${esc(r.summary)}</span></p>`;
    const color = (v) => {
      if (v == null) return "transparent";
      const a = Math.min(1, Math.abs(v));
      return v >= 0 ? `rgba(99,102,241,${(a * 0.85).toFixed(2)})` : `rgba(239,68,68,${(a * 0.85).toFixed(2)})`;
    };
    return `<p class="nb-summary"><span>${esc(r.summary)}</span></p>
      <div class="nb-heat-w"><table class="nb-heat"><thead><tr><th></th>${r.fields.map((f) => `<th title="${esc(f)}"><span>${esc(f)}</span></th>`).join("")}</tr></thead>
        <tbody>${r.matrix.map((row, i) => `<tr><th title="${esc(r.fields[i])}">${esc(r.fields[i])}</th>${row.map((v, j) => `<td style="background:${color(v)}" class="${Math.abs(v ?? 0) > 0.55 ? "hi" : ""}" title="${esc(r.fields[i])} × ${esc(r.fields[j])}: r = ${v == null ? "—" : nf(v, 3)}">${i === j ? "" : v == null ? "—" : nf(v, 2)}</td>`).join("")}</tr>`).join("")}</tbody></table>
        <div class="nb-heat-leg"><span>−1 inversa</span><i></i><span>+1 directa</span></div></div>
      <div class="nb-r-bar"><span class="nb-r-sum">Parejas ordenadas por fuerza</span><button type="button" class="nb-ibtn" data-csv>⤓ CSV</button></div>
      ${table(r.columns, r.rows, [null, null, "number", null, null, "number"], { max: 30 })}`;
  }

  /* ---------- Atípicos ---------- */
  function outResult(r) {
    const b = r.box, f = r.fences;
    let box = "";
    if (b && f) {
      const lo = Math.min(b.min, f.low), hi = Math.max(b.max, f.high), span = hi - lo || 1, x = (v) => (((v - lo) / span) * 100).toFixed(2);
      box = `<div class="nb-box" aria-label="Diagrama de caja">
        <div class="nb-box-fence" style="left:${x(f.low)}%;width:${(x(f.high) - x(f.low)).toFixed(2)}%"></div>
        <div class="nb-box-iqr" style="left:${x(b.q1)}%;width:${(x(b.q3) - x(b.q1)).toFixed(2)}%"></div>
        <div class="nb-box-med" style="left:${x(b.median)}%"></div>
        <span style="left:${x(b.min)}%">${nf(b.min)}</span><span style="left:${x(b.median)}%">${nf(b.median)}</span><span style="left:${x(b.max)}%">${nf(b.max)}</span></div>`;
    }
    return `<p class="nb-summary"><span>${esc(r.summary)}</span></p>
      ${r.counts ? `<div class="nb-kpis"><div class="nb-kpi ${r.counts.high ? "warn" : ""}"><b>${nf(r.counts.high, 0)}</b><span>altos</span></div><div class="nb-kpi ${r.counts.low ? "warn" : ""}"><b>${nf(r.counts.low, 0)}</b><span>bajos</span></div><div class="nb-kpi"><b>${nf(f.low)} ; ${nf(f.high)}</b><span>rango normal</span></div></div>` : ""}
      ${box}
      ${r.rows?.length ? `<div class="nb-r-bar"><span class="nb-r-sum">Registros atípicos (más lejanos primero)</span><button type="button" class="nb-ibtn" data-csv>⤓ CSV</button></div>${table(r.columns, r.rows, null, { max: 100 })}` : ""}`;
  }

  /* ---------- interacción y gráficos ---------- */
  function wireResult(c, r, host) {
    host.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => { c.view = { ...(c.view || {}), chart: b.dataset.view }; markDirty(); paintResult(c.id); }));
    host.querySelector("[data-csv]")?.addEventListener("click", () => csv(c, r));
    host.querySelector("[data-tosql]")?.addEventListener("click", () => addCell({ kind: "sql", title: `SQL de ${c.title || "Pareto"}`, sql: prettySql(r.sql) }, true, c.id));
    host.querySelector("[data-measure]")?.addEventListener("click", () => saveMeasure(c, r));
    host.querySelectorAll("th[data-sort]").forEach((th) => th.addEventListener("click", () => sortTable(th)));
    const cv = host.querySelector("canvas");
    if (cv && window.Chart) drawChart(c, r, cv);
  }

  function drawChart(c, r, canvas) {
    const C = window.Chart;
    const css = getComputedStyle(document.documentElement);
    const ink = css.getPropertyValue("--ds-muted").trim() || "#64748b";
    const grid = "rgba(148,163,184,.18)";
    const base = { responsive: true, maintainAspectRatio: false, animation: { duration: 250 }, plugins: { legend: { labels: { color: ink, boxWidth: 10 } } },
      scales: { x: { ticks: { color: ink, maxRotation: 45, autoSkip: true }, grid: { color: grid } }, y: { ticks: { color: ink }, grid: { color: grid } } } };
    let cfg;
    if (r.kind === "sql") {
      const mode = c.view?.chart && c.view.chart !== "auto" ? c.view.chart : r.chart?.type;
      const nums = r.types.map((t, i) => (t === "number" ? i : -1)).filter((i) => i >= 0);
      const xi = r.types.findIndex((t) => t !== "number");
      const labels = r.rows.slice(0, 500).map((row, i) => (xi >= 0 ? String(row[xi] ?? "∅") : String(i + 1)));
      const ys = (r.chart?.y?.length ? r.chart.y : nums).slice(0, mode === "pie" ? 1 : 3);
      if (mode === "scatter") {
        cfg = { type: "scatter", data: { datasets: [{ label: `${r.columns[nums[0]]} vs ${r.columns[nums[1]]}`, data: r.rows.slice(0, 2000).map((row) => ({ x: row[nums[0]], y: row[nums[1]] })), backgroundColor: PAL[0] + "aa" }] },
          options: { ...base, scales: { x: { ...base.scales.x, title: { display: true, text: r.columns[nums[0]], color: ink } }, y: { ...base.scales.y, title: { display: true, text: r.columns[nums[1]], color: ink } } } } };
      } else if (mode === "pie") {
        cfg = { type: "doughnut", data: { labels: labels.slice(0, 20), datasets: [{ data: r.rows.slice(0, 20).map((row) => row[ys[0]]), backgroundColor: PAL }] }, options: { ...base, scales: {} } };
      } else {
        cfg = { type: mode === "line" ? "line" : "bar", data: { labels, datasets: ys.map((yi, k) => ({ label: r.columns[yi], data: r.rows.slice(0, 500).map((row) => row[yi]), backgroundColor: PAL[k] + (mode === "line" ? "33" : "dd"), borderColor: PAL[k], borderWidth: mode === "line" ? 2 : 0, tension: .25, fill: mode === "line" && ys.length === 1, pointRadius: labels.length > 60 ? 0 : 2, borderRadius: 4 })) }, options: base };
      }
    } else if (r.kind === "profile") {
      if (r.histogram) cfg = { type: "bar", data: { labels: r.histogram.map((h) => h.label), datasets: [{ label: "Filas", data: r.histogram.map((h) => h.count), backgroundColor: PAL[0] + "cc", borderRadius: 3, barPercentage: 1, categoryPercentage: .95 }] }, options: { ...base, plugins: { legend: { display: false } } } };
      else if (r.series) cfg = { type: "line", data: { labels: r.series.map((s) => s.period), datasets: [{ label: "Registros", data: r.series.map((s) => s.count), borderColor: PAL[1], backgroundColor: PAL[1] + "22", fill: true, tension: .25, pointRadius: 2 }] }, options: { ...base, plugins: { legend: { display: false } } } };
      else cfg = { type: "bar", data: { labels: r.rows.slice(0, 15).map((x) => String(x[0])), datasets: [{ label: "Filas", data: r.rows.slice(0, 15).map((x) => x[1]), backgroundColor: PAL[0] + "cc", borderRadius: 4 }] }, options: { ...base, indexAxis: "y", plugins: { legend: { display: false } } } };
    } else if (r.kind === "pareto") {
      const rows = r.rows.slice(0, 60);
      const clsColor = { A: "#6366f1", B: "#06b6d4", C: "#94a3b8" };
      cfg = { type: "bar", data: { labels: rows.map((x) => String(x[0])), datasets: [
        { type: "bar", label: r.measure, data: rows.map((x) => x[1]), backgroundColor: rows.map((x) => clsColor[x[4]] + "dd"), borderRadius: 3, yAxisID: "y", order: 2 },
        { type: "line", label: "% acumulado", data: rows.map((x) => x[3]), borderColor: "#f59e0b", backgroundColor: "#f59e0b", pointRadius: 0, tension: .2, yAxisID: "y2", order: 1 },
      ] }, options: { ...base, scales: { x: { ...base.scales.x, ticks: { ...base.scales.x.ticks, autoSkip: true, maxTicksLimit: 30 } }, y: base.scales.y,
        y2: { position: "right", min: 0, max: 100, ticks: { color: ink, callback: (v) => v + " %" }, grid: { display: false } } } } };
    }
    if (!cfg) return;
    try { st.charts.set(c.id, new C(canvas, cfg)); } catch (e) { console.warn(e); }
  }
  function destroyChart(id) { const ch = st.charts.get(id); if (ch) { try { ch.destroy(); } catch {} st.charts.delete(id); } }
  function destroyCharts() { [...st.charts.keys()].forEach(destroyChart); }

  function sortTable(th) {
    const tbl = th.closest("table"), i = Number(th.dataset.sort), body = tbl.tBodies[0];
    const dir = th.dataset.dir === "asc" ? "desc" : "asc";
    tbl.querySelectorAll("th").forEach((x) => { delete x.dataset.dir; x.classList.remove("asc", "desc"); });
    th.dataset.dir = dir; th.classList.add(dir);
    const val = (tr) => { const t = tr.children[i]?.textContent ?? ""; const n = Number(t.replace(/\./g, "").replace(",", ".").replace(/[%\s]/g, "")); return t === "∅" ? null : isNaN(n) ? t : n; };
    [...body.rows].sort((a, b) => {
      const x = val(a), y = val(b);
      if (x == null || y == null) return x == null ? 1 : -1;
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "es");
      return dir === "asc" ? c : -c;
    }).forEach((tr) => body.appendChild(tr));
  }

  function csv(c, r) {
    const q = (v) => { const s = v == null ? "" : String(v); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [r.columns.map(q).join(","), ...r.rows.map((row) => row.map(q).join(","))];
    const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(st.nb.name + "_" + (c.title || c.kind)).replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 80)}.csv`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function saveMeasure(c, r) {
    const m = String(c.sql || "").replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").trim().match(/^SELECT\s+(.+?)(?:\s+AS\s+("[^"]+"|[\p{L}_][\p{L}\p{N}_]*))?\s+FROM\s+("[^"]+"|[\p{L}_][\p{L}\p{N}_]*)\s*(WHERE\s+(.+?))?\s*;?$/iu);
    if (!m) { toast("Para guardarla como medida, la consulta debe ser SELECT <expresión> FROM tabla [WHERE …].", "err"); return; }
    let expr = m[1].trim();
    if (m[5]) {
      // WHERE de la consulta → FILTER (WHERE …) en cada agregación, para que la medida dé lo mismo.
      expr = expr.replace(/\b(SUM|AVG|COUNT|MIN|MAX)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)(?!\s*FILTER)/gi, (all) => `${all} FILTER (WHERE ${m[5]})`);
    }
    const suggested = (m[2] ? m[2].replace(/"/g, "") : c.title || "Medida").slice(0, 80);
    const dlg = modal({
      title: "Guardar como medida",
      body: `<p class="cfg-confirm" style="margin:0 0 10px">Queda como medida maestra de la app y la puedes usar en hojas, informes y alertas.</p>
        <label class="nb-form" style="display:block"><span style="display:block;font-size:11px;font-weight:700;color:var(--ds-muted);margin-bottom:4px">Nombre</span>
          <input id="nbMName" value="${esc(suggested)}" maxlength="80" style="width:100%;box-sizing:border-box;height:36px;padding:0 10px;border-radius:9px;border:1px solid var(--ds-border-2);background:var(--ds-surface);color:var(--ds-text);font:inherit" /></label>
        <p style="margin:10px 0 0;font:12px ui-monospace,Consolas,monospace;color:var(--ds-muted);word-break:break-word">${esc(expr)}</p>
        <p class="nb-err" id="nbMErr" hidden style="margin-top:10px"></p>`,
      actions: `<button type="button" class="q-btn" data-x>Cancelar</button><button type="button" class="q-btn primary" id="nbMOk">Guardar medida</button>`,
    });
    const inp = dlg.el.querySelector("#nbMName"), okB = dlg.el.querySelector("#nbMOk"), errEl = dlg.el.querySelector("#nbMErr");
    inp.focus(); inp.select();
    const go = async () => {
      const name = inp.value.trim();
      if (!name) { inp.focus(); return; }
      okB.disabled = true;
      try {
        // Una medida maestra no lleva tabla: el motor la resuelve en la tabla donde están sus campos. Si esos
        // campos existen en varias tablas puede elegir otra y dar otro número: en ese caso no se guarda.
        const chk = await api.parseExpression(ctx.appId, "measure", expr);
        const want = Number(r.rows[0][0]), got = Number(chk?.value);
        if (!(Math.abs(got - want) <= Math.max(1e-9, Math.abs(want) * 1e-9))) {
          errEl.textContent = `Como medida de la app, esta expresión se calcularía sobre «${chk?.table || "otra tabla"}» y daría ${nf(chk?.value)} en vez de ${nf(want)}: sus campos existen en varias tablas. Usa nombres de campo que solo estén en «${r.table}».`;
          errEl.hidden = false; okB.disabled = false; return;
        }
        await api.createMasterItem(ctx.appId, { kind: "measure", name, expression: expr, description: `Creada desde el cuaderno «${st.nb.name}».` });
        dlg.close();
        toast(`Medida «${name}» guardada: ya la puedes usar en las hojas.`);
      } catch (e) { errEl.textContent = e.message; errEl.hidden = false; okB.disabled = false; }
    };
    okB.addEventListener("click", go);
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
  }

  /* =============================== guardar =============================== */
  let saveT = 0;
  function markDirty() {
    if (!ownerOk()) return;
    st.dirty = true;
    const s = $("#nbSave"); if (s) { s.textContent = "Sin guardar…"; s.className = "nb-save dirty"; }
    clearTimeout(saveT); saveT = setTimeout(save, 1200);
  }
  async function save() {
    if (!st.dirty || !st.nb || !ownerOk() || st.saving) return;
    st.saving = true;
    const s = $("#nbSave"); if (s) { s.textContent = "Guardando…"; s.className = "nb-save"; }
    try {
      const out = await api.updateNotebook(ctx.appId, st.nb.id, { name: st.nb.name || "Cuaderno sin título", description: st.nb.description || null, cells: st.nb.cells });
      st.dirty = false; st.nb.updated_at = out.updated_at;
      const li = st.list.find((n) => n.id === st.nb.id); if (li) { li.name = out.name; li.cell_count = out.cell_count; }
      paintList();
      if (s) { s.textContent = "Guardado"; s.className = "nb-save ok"; }
    } catch (e) { if (s) { s.textContent = "No se guardó"; s.className = "nb-save err"; s.title = e.message; } toast(e.message, "err"); }
    st.saving = false;
    if (st.dirty) { clearTimeout(saveT); saveT = setTimeout(save, 1200); }
  }
  async function leave() { if (st.dirty) { clearTimeout(saveT); await save(); } return true; }

  async function duplicate() {
    try {
      const n = await api.createNotebook(ctx.appId, { name: `${st.nb.name} (copia)`.slice(0, 120), description: st.nb.description, cells: st.nb.cells });
      st.list = await api.listNotebooks(ctx.appId);
      toast("Cuaderno duplicado"); await open(n.id);
    } catch (e) { toast(e.message, "err"); }
  }
  async function remove() {
    if (!(await confirmBox({ title: "Eliminar cuaderno", message: `¿Eliminar <strong>${esc(st.nb.name)}</strong> y sus ${st.nb.cells.length} celdas? No se puede deshacer.`, okLabel: "Eliminar", danger: true }))) return;
    try {
      await api.deleteNotebook(ctx.appId, st.nb.id);
      st.dirty = false; st.nb = null;
      st.list = await api.listNotebooks(ctx.appId);
      const u = new URL(location.href); u.searchParams.delete("nb"); history.replaceState(null, "", u);
      paintList();
      if (st.list.length) open(st.list[0].id); else paintWelcome();
      toast("Cuaderno eliminado");
    } catch (e) { toast(e.message, "err"); }
  }
  function exportSql() {
    const parts = [`-- ${st.nb.name}`, st.nb.description ? `-- ${st.nb.description}` : "", `-- Exportado de DataSense · ${new Date().toLocaleString("es-CO")}`, ""];
    st.nb.cells.forEach((c, i) => {
      if (c.kind === "sql") parts.push(`-- [${i + 1}] ${c.title || "Consulta"}`, (c.sql || "").trim().replace(/;?\s*$/, ";"), "");
      else if (c.kind === "note") parts.push(...(c.text || "").split("\n").map((l) => `-- ${l}`), "");
      else { const r = st.results.get(c.id); if (r?.sql) parts.push(`-- [${i + 1}] ${c.title || KINDS[c.kind].label}`, r.sql + ";", ""); }
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([parts.join("\n")], { type: "text/plain;charset=utf-8" }));
    a.download = `${st.nb.name.replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 80)}.sql`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* =============================== carga =============================== */
  // Al final de render: así todas las funciones y constantes de arriba ya están inicializadas.
  try { [st.list, st.schema] = await Promise.all([api.listNotebooks(ctx.appId), api.notebookSchema(ctx.appId)]); }
  catch (e) { $("#nbMain").innerHTML = `<div class="nb-empty err">${esc(e.message)}</div>`; return; }
  paintList(); paintTree();
  const want = params.get("nb");
  if (want && st.list.some((n) => n.id === want)) await open(want);
  else if (st.list.length) await open(st.list[0].id);
  else paintWelcome();

  /* =============================== atajos y limpieza =============================== */
  const onKey = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && mount.isConnected) { e.preventDefault(); clearTimeout(saveT); save(); }
  };
  document.addEventListener("keydown", onKey);
  const onUnload = (e) => { if (st.dirty) { save(); e.preventDefault(); e.returnValue = ""; } };
  window.addEventListener("beforeunload", onUnload);
  return () => {
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("beforeunload", onUnload);
    if (st.dirty) save();
    destroyCharts();
  };
}

/* =============================== utilidades =============================== */
function autosize(ta) { ta.style.height = "auto"; ta.style.height = Math.max(64, Math.min(560, ta.scrollHeight + 2)) + "px"; }

function prettySql(s) {
  return String(s || "").replace(/\s+(FROM|WHERE|GROUP BY|HAVING|ORDER BY|LIMIT)\s+/gi, "\n$1 ").trim();
}

/** Markdown mínimo y seguro para las notas: # títulos, **negrita**, *cursiva*, `código`, - listas. */
function md(text) {
  const inline = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/\*([^*]+)\*/g, "<i>$1</i>");
  const out = [];
  let list = false;
  for (const line of String(text).split("\n")) {
    const h = line.match(/^(#{1,3})\s+(.*)$/), li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li) { if (!list) { out.push("<ul>"); list = true; } out.push(`<li>${inline(li[1])}</li>`); continue; }
    if (list) { out.push("</ul>"); list = false; }
    if (h) out.push(`<h${h[1].length + 2}>${inline(h[2])}</h${h[1].length + 2}>`);
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push("</ul>");
  return out.join("") || `<p class="nb-muted">Nota vacía: haz clic para escribir.</p>`;
}

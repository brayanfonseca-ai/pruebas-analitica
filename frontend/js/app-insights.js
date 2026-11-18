// app-insights.js — vista «Qué cambió · simular · actuar» de una app:
//   · Qué cambió y por qué: compara una medida entre dos periodos y la descompone por dimensión (relato + aportes).
//   · ¿Qué pasaría si…?: escenario hipotético (fijar / multiplicar / sumar en un % de filas filtradas) y su efecto.
//   · Del dato a la acción: los registros detrás de una cifra → tabla, CSV, listas guardadas que se envían a un webhook.
//   · Agente de guardia: vigila las métricas tras cada carga y avisa en la campana.
// Todo lo calcula el backend (/insights/*, /actions, /watchdog).

import * as api from "./api.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nf = (v) => (v == null || isNaN(v) ? "—" : Number(v).toLocaleString("es-CO", { maximumFractionDigits: 2 }));
const when = (s) => { if (!s) return "—"; const d = new Date(s); return isNaN(d) ? esc(s) : d.toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" }); };
const TABS = [["cambio", "Qué cambió y por qué"], ["simular", "¿Qué pasaría si…?"], ["accion", "Del dato a la acción"], ["guardia", "Agente de guardia"]];

export async function render(mount, ctx) {
  const canEdit = ctx.can("charts:edit");
  const st = { tab: sessionStorage.getItem(`ds.ins.tab.${ctx.appId}`) || "cambio", masters: [], fields: [], actions: [], explain: null, rowsQ: null };
  mount.innerHTML = `
    <div class="in">
      <header class="in-head"><div><h1>Qué cambió · simular · actuar</h1>
        <p>Entiende por qué se movió una cifra, prueba escenarios antes de decidir y llega a los registros concretos para actuar.</p></div></header>
      <nav class="in-tabs" role="tablist">${TABS.map(([k, l]) => `<button type="button" role="tab" data-tab="${k}">${l}</button>`).join("")}</nav>
      <section class="in-body" id="inBody"></section>
    </div>`;
  const $ = (s) => mount.querySelector(s);
  const body = $("#inBody");

  try {
    const [m, f] = await Promise.all([api.listMasterItems(ctx.appId), api.getFields(ctx.appId)]);
    st.masters = m.filter((x) => x.kind === "measure");
    st.fields = [...(f.dimensions || []), ...(f.measures || [])];
  } catch { /* sin catálogo */ }

  const measureSelect = (name = "measure", sel = "") => `
    <select name="${name}">
      ${st.masters.length ? `<optgroup label="Medidas maestras">${st.masters.map((m) => `<option value="m:${esc(m.id)}" ${sel === "m:" + m.id ? "selected" : ""}>${m.certified ? "✓ " : ""}${esc(m.name)}</option>`).join("")}</optgroup>` : ""}
      <option value="fx" ${sel === "fx" || !st.masters.length ? "selected" : ""}>Escribir una expresión fx…</option>
    </select>`;
  const measureBody = (form) => {
    const v = form.measure.value;
    return v.startsWith("m:") ? { master_id: v.slice(2) } : { expression: form.expr.value.trim() };
  };
  const fieldOpts = (types, sel = "", blank = "") => `${blank ? `<option value="">${blank}</option>` : ""}${[...new Map(st.fields.filter((f) => !types || types.includes(f.type)).map((f) => [f.field, f])).values()]
    .map((f) => `<option value="${esc(f.field)}" ${sel === f.field ? "selected" : ""}>${esc(f.display || f.field)}</option>`).join("")}`;
  const selFrom = (field, values) => (field && values.trim() ? { [field]: values.split(",").map((x) => x.trim()).filter(Boolean) } : {});

  function paintTabs() {
    mount.querySelectorAll("[data-tab]").forEach((b) => { b.classList.toggle("on", b.dataset.tab === st.tab); b.setAttribute("aria-selected", b.dataset.tab === st.tab); });
    sessionStorage.setItem(`ds.ins.tab.${ctx.appId}`, st.tab);
    ({ cambio: tabCambio, simular: tabSimular, accion: tabAccion, guardia: tabGuardia })[st.tab]();
  }
  mount.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { st.tab = b.dataset.tab; paintTabs(); }));

  /* ----------------------------- Qué cambió ----------------------------- */
  function tabCambio() {
    body.innerHTML = `
      <form class="in-form" id="exForm">
        <label class="wide">Medida${measureSelect()}</label>
        <label class="wide" data-fx>Expresión<input name="expr" placeholder="Round(Sum(If([ESTADO CONTRATO] = 'Inactivo', 1, 0)) / Count([CEDULA]) * 100, 2)"/></label>
        <label data-fx>Nombre (opcional)<input name="lbl" maxlength="80" placeholder="% Inactivos"/></label>
        <label>Comparar por<select name="time"><option value="">Automático</option>${fieldOpts(null)}</select></label>
        <label>Periodo actual<select name="cur"><option value="">El último</option></select></label>
        <label>Contra<select name="prev"><option value="">El anterior</option></select></label>
        <label>Filtro (opcional)<select name="sf">${fieldOpts(["text", "date"], "", "Sin filtro")}</select></label>
        <label>Valores<input name="sv" placeholder="CALI, NEIVA"/></label>
        <div class="in-actions"><button class="in-btn" type="submit">Explicar el cambio</button><span class="in-err" id="exErr" role="alert"></span></div>
      </form>
      <div id="exOut"></div>`;
    const f = $("#exForm");
    const sync = () => { f.querySelectorAll("[data-fx]").forEach((l) => { l.hidden = f.measure.value !== "fx"; }); };
    f.measure.addEventListener("change", sync); sync();
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const q = { ...measureBody(f), selections: selFrom(f.sf.value, f.sv.value) };
      if (q.expression && f.lbl.value.trim()) q.label = f.lbl.value.trim();
      if (f.time.value) q.time_field = f.time.value;
      if (f.cur.value) q.current = f.cur.value;
      if (f.prev.value) q.previous = f.prev.value;
      $("#exErr").textContent = ""; $("#exOut").innerHTML = `<div class="in-loading">Analizando…</div>`;
      try {
        const r = await api.explainChange(ctx.appId, q);
        st.explain = { q, r };
        // periodos disponibles en los selectores
        const fill = (sel, chosen, def) => { sel.innerHTML = `<option value="">${def}</option>` + [...r.periods].reverse().map((p) => `<option ${p === chosen ? "selected" : ""}>${esc(p)}</option>`).join(""); };
        fill(f.cur, q.current, "El último"); fill(f.prev, q.previous, "El anterior");
        if (!q.time_field) f.time.value = r.time_field;
        paintExplain(r);
      } catch (x) { $("#exOut").innerHTML = ""; $("#exErr").textContent = x.message; }
    });
    if (st.explain) paintExplain(st.explain.r);
  }

  function paintExplain(r) {
    const pct = r.measure.percent, u = pct ? " %" : "";
    const up = r.delta > 0, dn = r.delta < 0;
    $("#exOut").innerHTML = `
      <div class="in-card">
        <div class="in-kpis">
          <div><span>${esc(r.previous)}</span><b>${nf(r.previous_value)}${u}</b></div>
          <div class="in-arrow ${up ? "up" : dn ? "dn" : ""}">${up ? "▲" : dn ? "▼" : "＝"}<small>${r.delta > 0 ? "+" : ""}${nf(r.delta)}${pct ? " pts" : ""}${!pct && r.delta_pct != null ? ` · ${r.delta_pct > 0 ? "+" : ""}${nf(r.delta_pct)} %` : ""}</small></div>
          <div><span>${esc(r.current)}</span><b>${nf(r.current_value)}${u}</b></div>
        </div>
        <ul class="in-story">${r.story.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
      </div>
      ${r.drivers.map((d) => {
        const max = Math.max(...d.items.map((i) => Math.abs(i.delta)), 0) || 1;
        return `<div class="in-card"><h3>Por ${esc(d.display)} <small>${d.values} valores</small></h3>
          <table class="in-tbl"><thead><tr><th>${esc(d.display)}</th><th>${esc(r.previous)}</th><th>${esc(r.current)}</th><th>Cambio</th>${r.measure.additive ? "<th>% del cambio</th>" : ""}<th></th></tr></thead><tbody>
          ${d.items.map((i) => `<tr><td>${esc(i.value)}</td><td>${nf(i.previous)}${u}</td><td>${nf(i.current)}${u}</td>
            <td><span class="in-bar ${i.delta >= 0 ? "up" : "dn"}"><i style="width:${(Math.abs(i.delta) / max * 100).toFixed(1)}%"></i></span>${i.delta > 0 ? "+" : ""}${nf(i.delta)}${pct ? " pts" : ""}</td>
            ${r.measure.additive ? `<td>${i.share == null ? "—" : nf(i.share) + " %"}</td>` : ""}
            <td><button type="button" class="in-link" data-rows="${esc(d.dimension)}" data-val="${esc(i.value)}">Ver registros</button></td></tr>`).join("")}
          </tbody></table></div>`;
      }).join("") || `<div class="in-card"><p class="in-muted">No hay dimensiones para descomponer el cambio.</p></div>`}`;
    $("#exOut").querySelectorAll("[data-rows]").forEach((b) => b.addEventListener("click", () => {
      st.rowsQ = { table: r.measure.table, selections: { ...r.selections, [r.time_field]: [r.current], [b.dataset.rows]: [b.dataset.val] } };
      st.tab = "accion"; paintTabs();
    }));
  }

  /* ----------------------------- ¿Qué pasaría si…? ----------------------------- */
  function tabSimular() {
    body.innerHTML = `
      <form class="in-form" id="wiForm">
        <label class="wide">Medida a observar${measureSelect()}</label>
        <label class="wide" data-fx>Expresión<input name="expr" placeholder="Count([FECHA RETIRO]) / Count([CEDULA]) * 100"/></label>
        <label data-fx>Nombre (opcional)<input name="lbl" maxlength="80" placeholder="% Rotación"/></label>
        <label>Ver también por<select name="dim">${fieldOpts(["text", "date"], "", "Solo el total")}</select></label>
        <div class="in-changes full" id="wiChanges"></div>
        <div class="in-actions"><button type="button" class="in-btn ghost" id="wiAdd">＋ Otro cambio</button><button class="in-btn" type="submit">Simular</button><span class="in-err" id="wiErr" role="alert"></span></div>
      </form>
      <div id="wiOut"></div>`;
    const f = $("#wiForm");
    const sync = () => { f.querySelectorAll("[data-fx]").forEach((l) => { l.hidden = f.measure.value !== "fx"; }); };
    f.measure.addEventListener("change", sync); sync();
    const addChange = () => {
      const d = document.createElement("div");
      d.className = "in-change";
      d.innerHTML = `
        <span class="in-ch-h">Cambio</span>
        <label>Campo a cambiar<select data-k="field">${fieldOpts(null)}</select></label>
        <label>Operación<select data-k="op"><option value="set">Fijar el valor</option><option value="multiply">Multiplicar por</option><option value="add">Sumar</option></select></label>
        <label>Valor<input data-k="value" placeholder="Activo · 1.1 · -5"/></label>
        <label>En el % de filas<input data-k="share" type="number" min="1" max="100" value="100"/></label>
        <label>Solo donde (campo)<select data-k="sf">${fieldOpts(["text", "date"], "", "Todas las filas")}</select></label>
        <label>es<input data-k="sv" placeholder="Inactivo"/></label>
        <label class="wide">y la condición (opcional)<input data-k="where" placeholder="[EDAD EN AÑOS] < 30"/></label>
        <button type="button" class="in-x" title="Quitar este cambio" aria-label="Quitar este cambio">✕</button>`;
      d.querySelector(".in-x").addEventListener("click", () => { if ($("#wiChanges").children.length > 1) d.remove(); });
      $("#wiChanges").appendChild(d);
    };
    addChange();
    $("#wiAdd").addEventListener("click", addChange);
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const changes = [...mount.querySelectorAll(".in-change")].map((d) => {
        const g = (k) => d.querySelector(`[data-k="${k}"]`).value.trim();
        const c = { field: g("field"), op: g("op"), value: g("value"), share: Number(g("share") || 100), selections: selFrom(g("sf"), g("sv")) };
        if (g("where")) c.where = g("where");
        return c;
      });
      const m = measureBody(f);
      const q = { measures: [m.master_id ? { master_id: m.master_id } : { expression: m.expression, label: f.lbl.value.trim() || m.expression }], changes };
      if (f.dim.value) q.dimension = f.dim.value;
      $("#wiErr").textContent = ""; $("#wiOut").innerHTML = `<div class="in-loading">Simulando…</div>`;
      try { paintWhatIf(await api.whatIf(ctx.appId, q)); } catch (x) { $("#wiOut").innerHTML = ""; $("#wiErr").textContent = x.message; }
    });
  }

  function paintWhatIf(r) {
    $("#wiOut").innerHTML = `
      <div class="in-card">
        <h3>Escenario</h3>
        <ul class="in-story">${r.changes.map((c) => `<li>${esc(c.text)}</li>`).join("")}</ul>
        ${r.results.map((x) => {
          const u = x.percent ? " %" : "";
          return `<div class="in-kpis"><div><span>Hoy</span><b>${nf(x.before)}${u}</b></div>
            <div class="in-arrow ${x.delta > 0 ? "up" : x.delta < 0 ? "dn" : ""}">${x.delta > 0 ? "▲" : x.delta < 0 ? "▼" : "＝"}<small>${x.delta > 0 ? "+" : ""}${nf(x.delta)}${x.percent ? " pts" : ""}</small></div>
            <div><span>Con el escenario</span><b>${nf(x.after)}${u}</b></div></div>
            ${x.by ? `<table class="in-tbl"><thead><tr><th></th><th>Hoy</th><th>Escenario</th><th>Cambio</th></tr></thead><tbody>
              ${x.by.slice(0, 12).map((b) => `<tr><td>${esc(b.value)}</td><td>${nf(b.before)}${u}</td><td>${nf(b.after)}${u}</td><td class="${b.delta > 0 ? "up" : b.delta < 0 ? "dn" : ""}">${b.delta > 0 ? "+" : ""}${nf(b.delta)}</td></tr>`).join("")}
            </tbody></table>` : ""}`;
        }).join("")}
        <ul class="in-story strong">${r.story.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
        <p class="in-muted">${esc(r.note)}</p>
      </div>`;
  }

  /* ----------------------------- Del dato a la acción ----------------------------- */
  async function tabAccion() {
    const q = st.rowsQ || {};
    const s0 = Object.entries(q.selections || {});
    body.innerHTML = `
      <form class="in-form" id="rwForm">
        <label>Tabla<select name="table"><option value="">Automática</option></select></label>
        <div class="in-sels full" id="rwSels"></div>
        <label class="wide">Condición por fila (opcional)<input name="where" value="${esc(q.where || "")}" placeholder="[probabilidad_retiro] > 0.6"/></label>
        <label>Ordenar por<select name="sort">${fieldOpts(null, "", "Sin orden")}</select></label>
        <label>Columnas (coma, vacío = todas)<input name="fields" placeholder="cedula, periodo, probabilidad_retiro"/></label>
        <div class="in-actions"><button type="button" class="in-btn ghost" id="rwAddSel">＋ Filtro</button><button class="in-btn" type="submit">Ver registros</button>
          <button type="button" class="in-btn ghost" id="rwCsv">⬇ Exportar CSV</button>
          ${canEdit ? `<button type="button" class="in-btn ghost" id="rwSave">Guardar como lista</button>` : ""}
          <span class="in-err" id="rwErr" role="alert"></span></div>
      </form>
      <div id="rwOut"></div>
      <div class="in-card"><h3>Listas guardadas</h3><div id="rwLists"><div class="in-loading">Cargando…</div></div></div>`;
    try {
      const tables = await api.listTables(ctx.appId);
      $("#rwForm").table.innerHTML += tables.map((t) => `<option ${q.table === t.name ? "selected" : ""}>${esc(t.name)}</option>`).join("");
    } catch {}
    const addSel = (field = "", values = "") => {
      const d = document.createElement("div");
      d.className = "in-sel";
      d.innerHTML = `<select data-k="f">${fieldOpts(null, field, "Campo…")}</select><input data-k="v" value="${esc(values)}" placeholder="valor1, valor2"/><button type="button" class="in-x" aria-label="Quitar filtro">✕</button>`;
      d.querySelector(".in-x").addEventListener("click", () => d.remove());
      $("#rwSels").appendChild(d);
    };
    s0.length ? s0.forEach(([k, v]) => addSel(k, v.join(", "))) : addSel();
    $("#rwAddSel").addEventListener("click", () => addSel());
    const form = $("#rwForm");
    const read = () => {
      const selections = {};
      mount.querySelectorAll(".in-sel").forEach((d) => Object.assign(selections, selFrom(d.querySelector("[data-k=f]").value, d.querySelector("[data-k=v]").value)));
      const b = { selections, limit: 200 };
      if (form.table.value) b.table = form.table.value;
      if (form.where.value.trim()) b.where = form.where.value.trim();
      if (form.sort.value) { b.sort = form.sort.value; b.desc = true; }
      const fl = form.fields.value.split(",").map((x) => x.trim()).filter(Boolean);
      if (fl.length) b.fields = fl;
      return b;
    };
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      $("#rwErr").textContent = ""; $("#rwOut").innerHTML = `<div class="in-loading">Buscando…</div>`;
      try { const r = await api.insightRows(ctx.appId, read()); st.rowsQ = { ...read(), table: r.table }; paintRows(r); }
      catch (x) { $("#rwOut").innerHTML = ""; $("#rwErr").textContent = x.message; }
    });
    $("#rwCsv").addEventListener("click", async () => {
      try { $("#rwErr").textContent = ""; await api.downloadRowsCsv(ctx.appId, { ...read(), limit: 10000 }, "registros"); } catch (x) { $("#rwErr").textContent = x.message; }
    });
    $("#rwSave")?.addEventListener("click", async () => {
      const name = prompt("Nombre de la lista (p. ej. «Conductores con riesgo alto de retiro»):");
      if (!name) return;
      const webhook = prompt("URL de webhook para enviarla (Teams, Power Automate, Zapier, n8n…). Déjalo vacío si solo la quieres exportar:", "") || "";
      const b = read();
      try {
        await api.createAction(ctx.appId, { name, table: b.table, selections: b.selections, where: b.where, fields: b.fields, sort: b.sort, ...(webhook.trim() ? { webhook_url: webhook.trim() } : {}) });
        loadLists();
      } catch (x) { $("#rwErr").textContent = x.message; }
    });
    if (st.rowsQ) form.requestSubmit();
    loadLists();
  }

  function paintRows(r) {
    $("#rwOut").innerHTML = `<div class="in-card">
      <h3>${nf(r.total)} registro(s) <small>de ${nf(r.table_rows)} en ${esc(r.table)}${r.truncated ? ` · se muestran ${r.rows.length}` : ""}</small></h3>
      ${r.rows.length ? `<div class="in-scroll"><table class="in-tbl rows"><thead><tr>${r.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
        <tbody>${r.rows.map((row) => `<tr>${row.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : `<p class="in-muted">Ningún registro cumple los filtros.</p>`}
    </div>`;
  }

  async function loadLists() {
    const host = $("#rwLists");
    if (!host) return;
    try { st.actions = await api.listActions(ctx.appId); } catch (x) { host.innerHTML = `<p class="in-err">${esc(x.message)}</p>`; return; }
    host.innerHTML = st.actions.length ? `<ul class="in-lists">${st.actions.map((a) => `
      <li data-id="${esc(a.id)}"><div><b>${esc(a.name)}</b>
        <small>${esc(a.table_name)}${Object.keys(a.selections || {}).length ? " · " + esc(Object.entries(a.selections).map(([k, v]) => `${k} = ${v.join(", ")}`).join("; ")) : ""}${a.where_expr ? " · " + esc(a.where_expr) : ""}</small>
        <small>${nf(a.last_count)} registro(s)${a.has_webhook ? ` · webhook ${esc(a.webhook_url)}` : ""}${a.last_run_at ? ` · última ejecución ${when(a.last_run_at)}: ${esc(a.last_message || "")}` : ""}</small></div>
        <div class="in-l-act">
          <button type="button" class="in-btn ghost sm" data-open>Ver</button>
          <button type="button" class="in-btn ghost sm" data-csv>CSV</button>
          ${canEdit && a.has_webhook ? `<button type="button" class="in-btn ghost sm" data-send>Enviar</button>` : ""}
          ${canEdit ? `<button type="button" class="in-btn ghost sm danger" data-del>Borrar</button>` : ""}
        </div></li>`).join("")}</ul>` : `<p class="in-muted">Aún no hay listas. Arma una búsqueda arriba y pulsa «Guardar como lista». Una alerta puede ejecutar una lista al dispararse.</p>`;
    host.querySelectorAll("li").forEach((li) => {
      const a = st.actions.find((x) => x.id === li.dataset.id);
      li.querySelector("[data-open]").addEventListener("click", () => {
        st.rowsQ = { table: a.table_name, selections: a.selections, where: a.where_expr || undefined, fields: a.fields?.length ? a.fields : undefined };
        tabAccion();
      });
      li.querySelector("[data-csv]").addEventListener("click", () => api.downloadActionCsv(ctx.appId, a.id, a.name).catch((x) => alert(x.message)));
      li.querySelector("[data-send]")?.addEventListener("click", async (e) => {
        e.currentTarget.disabled = true;
        try { const r = await api.runAction(ctx.appId, a.id, true); alert(r.message); } catch (x) { alert(x.message); }
        loadLists();
      });
      li.querySelector("[data-del]")?.addEventListener("click", async () => {
        if (!confirm(`¿Borrar la lista «${a.name}»?`)) return;
        try { await api.deleteAction(ctx.appId, a.id); loadLists(); } catch (x) { alert(x.message); }
      });
    });
  }

  /* ----------------------------- Agente de guardia ----------------------------- */
  async function tabGuardia() {
    body.innerHTML = `<div class="in-loading">Cargando…</div>`;
    let w = null;
    try { w = (await api.getWatchdog(ctx.appId)).watchdog; } catch {}
    const chosen = new Set(w?.measures || []);
    body.innerHTML = `
      <div class="in-card">
        <h3>Agente de guardia ${w ? (w.enabled ? `<span class="in-pill ok">Activo</span>` : `<span class="in-pill">Pausado</span>`) : `<span class="in-pill">Apagado</span>`}</h3>
        <p class="in-muted">Después de cada carga de datos (y al menos una vez al día) compara el último periodo con el anterior en tus métricas. Si alguna cambia más que el umbral, o la salud de datos tiene problemas críticos, te avisa en la campana con el porqué.</p>
        <form class="in-form" id="wdForm">
          <label>Avisar si cambia más de (%)<input name="th" type="number" min="1" step="any" value="${esc(w?.threshold_pct ?? 15)}" ${canEdit ? "" : "disabled"}/></label>
          <label class="wide">Métricas a vigilar <small>(vacío = las certificadas; si no hay, las maestras)</small>
            <select name="ms" multiple size="${Math.min(6, Math.max(2, st.masters.length))}" ${canEdit ? "" : "disabled"}>${st.masters.map((m) => `<option value="${esc(m.id)}" ${chosen.has(m.id) ? "selected" : ""}>${m.certified ? "✓ " : ""}${esc(m.name)}</option>`).join("")}</select></label>
          <label class="in-chk"><input type="checkbox" name="en" ${w?.enabled === false ? "" : "checked"} ${canEdit ? "" : "disabled"}/> Activo</label>
          <div class="in-actions">${canEdit ? `<button class="in-btn" type="submit">${w ? "Guardar" : "Activar el agente"}</button>` : ""}
            <button type="button" class="in-btn ghost" id="wdRun">▶ Revisar ahora</button>
            ${canEdit && w ? `<button type="button" class="in-btn ghost danger" id="wdOff">Apagar</button>` : ""}
            <span class="in-err" id="wdErr" role="alert"></span></div>
        </form>
      </div>
      <div id="wdOut"></div>`;
    const paint = (s) => {
      if (!s) { $("#wdOut").innerHTML = ""; return; }
      $("#wdOut").innerHTML = `<div class="in-card"><h3>Última revisión <small>${when(s.checked_at)} · umbral ${nf(s.threshold_pct)} %</small></h3>
        ${s.headline?.length ? `<ul class="in-story strong">${s.headline.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>` : `<p class="in-okmsg">✓ Sin cambios fuertes ni problemas críticos.</p>`}
        <table class="in-tbl"><thead><tr><th>Métrica</th><th>Antes</th><th>Ahora</th><th>Cambio</th><th></th></tr></thead><tbody>
          ${(s.measures || []).map((m) => m.error ? `<tr><td>${esc(m.label)}</td><td colspan="4" class="in-muted">${esc(m.error)}</td></tr>`
            : `<tr class="${m.flag ? "flag" : ""}"><td>${esc(m.label)}</td><td>${nf(m.previous_value)} <small>${esc(m.previous)}</small></td><td>${nf(m.current_value)} <small>${esc(m.current)}</small></td><td>${nf(m.change)} ${esc(m.unit)}</td><td>${m.flag ? "⚠ Aviso" : "En calma"}</td></tr>`).join("")}
        </tbody></table>
        <p class="in-muted">Salud de datos: ${s.health_score ?? "—"}/100${s.health_critical?.length ? " · " + s.health_critical.map(esc).join(" · ") : ""}</p></div>`;
    };
    paint(w?.last_summary);
    $("#wdForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.currentTarget;
      try {
        await api.saveWatchdog(ctx.appId, { threshold_pct: Number(f.th.value), enabled: f.en.checked, measures: [...f.ms.selectedOptions].map((o) => o.value) });
        tabGuardia();
      } catch (x) { $("#wdErr").textContent = x.message; }
    });
    $("#wdRun").addEventListener("click", async (e) => {
      const b = e.currentTarget; b.disabled = true; b.textContent = "Revisando…";
      try { paint(await api.runWatchdog(ctx.appId)); } catch (x) { $("#wdErr").textContent = x.message; }
      b.disabled = false; b.textContent = "▶ Revisar ahora";
    });
    $("#wdOff")?.addEventListener("click", async () => { if (!confirm("¿Apagar el agente de guardia?")) return; await api.deleteWatchdog(ctx.appId); tabGuardia(); });
  }

  paintTabs();
}

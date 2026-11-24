// app-automatizar.js — vista «Automatizar» de una app: Salud de datos, Carga programada (con historial) y Alertas.
// Todo lo calcula el backend (GET /health, /schedule, /alerts); aquí solo se pinta y se envían los formularios.

import * as api from "./api.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nf = (v) => (v == null || isNaN(v) ? "—" : Number(v).toLocaleString("es-CO", { maximumFractionDigits: 2 }));
const plural = (n, one, many) => `${n} ${Number(n) === 1 ? one : many}`;
const when = (s) => { if (!s) return "—"; const d = new Date(s); return isNaN(d) ? esc(s) : d.toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" }); };
const rel = (s) => {
  if (!s) return "";
  const ms = new Date(s) - Date.now(); const a = Math.abs(ms) / 60000;
  const t = a < 1 ? "menos de un minuto" : a < 60 ? `${Math.round(a)} min` : a < 1440 ? `${Math.round(a / 60)} h` : `${Math.round(a / 1440)} días`;
  return ms >= 0 ? `en ${t}` : `hace ${t}`;
};
const OPS = [[">", "es mayor que"], [">=", "es mayor o igual a"], ["<", "es menor que"], ["<=", "es menor o igual a"], ["=", "es igual a"], ["!=", "es distinto de"], ["change", "cambia más de (%)"]];
const DAYS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const STATUS = { ok: ["Correcta", "ok"], warn: ["Con advertencias", "warn"], fail: ["Falló", "fail"] };
const TRIG = { manual: "Manual (editor)", schedule: "Programada", now: "Ejecutar ahora" };
const ALERT_STATE = { triggered: ["Disparada", "fail"], ok: ["En calma", "ok"], error: ["Error", "warn"], unknown: ["Sin revisar", "muted"] };

export async function render(mount, ctx) {
  const canData = ctx.can("data:import");
  const me = ctx.me?.() || {};
  const canModerate = ctx.can("apps:publish");
  const st = { health: null, schedule: null, runs: [], alerts: [], masters: [], actions: [] };

  mount.innerHTML = `
    <div class="au">
      <header class="au-head">
        <div><h1>Automatizar</h1><p>Mantén los datos al día sin tocar nada: programa la carga, crea alertas que te avisan en la campana y revisa la salud de los datos.</p></div>
      </header>
      <section class="au-card" id="auHealth" aria-label="Salud de datos"></section>
      <div class="au-grid">
        <section class="au-card" id="auSched" aria-label="Carga programada"></section>
        <section class="au-card" id="auAlerts" aria-label="Alertas"></section>
      </div>
    </div>`;
  const $ = (s) => mount.querySelector(s);

  async function load() {
    const [h, s, a, m, ac] = await Promise.allSettled([api.getHealth(ctx.appId), api.getSchedule(ctx.appId), api.listAlerts(ctx.appId), api.listMasterItems(ctx.appId), api.listActions(ctx.appId)]);
    st.actions = ac.status === "fulfilled" ? ac.value : [];
    st.health = h.status === "fulfilled" ? h.value : { error: h.reason?.message };
    if (s.status === "fulfilled") { st.schedule = s.value.schedule; st.runs = s.value.runs || []; }
    st.alerts = a.status === "fulfilled" ? a.value : [];
    st.masters = m.status === "fulfilled" ? m.value.filter((x) => x.kind === "measure") : [];
    paintHealth(); paintSchedule(); paintAlerts();
  }

  /* ------------------------------- Salud ------------------------------- */
  let showAll = false;
  function paintHealth() {
    const h = st.health;
    const el = $("#auHealth");
    if (!h || h.error) { el.innerHTML = `<h2>Salud de datos</h2><p class="au-err">No se pudo revisar: ${esc(h?.error)}</p>`; return; }
    if (h.score == null) { el.innerHTML = `<h2>Salud de datos</h2><p class="au-muted">La app aún no tiene datos cargados.</p>`; return; }
    const cls = h.status === "buena" ? "ok" : h.status === "regular" ? "warn" : "fail";
    const issues = h.issues || [];
    const shown = showAll ? issues : issues.slice(0, 6);
    el.innerHTML = `
      <div class="au-h-top">
        <div class="au-score ${cls}" role="img" aria-label="Puntaje de salud ${h.score} de 100" style="--p:${h.score}"><b>${h.score}</b><span>de 100</span></div>
        <div class="au-h-txt">
          <h2>Salud de datos · <span class="au-pill ${cls}">${esc({ buena: "Buena", regular: "Regular", mala: "Mala" }[h.status])}</span></h2>
          <p class="au-muted">${plural(h.counts.critical, "crítico", "críticos")} · ${plural(h.counts.warning, "advertencia", "advertencias")} · ${plural(h.counts.info, "aviso", "avisos")} · revisado ${when(h.checked_at)}</p>
          <div class="au-tables">${(h.tables || []).map((t) => `
            <div class="au-tbl"><b title="${esc(t.table)}">${esc(t.table)}</b>
              <span>${nf(t.rows)} filas · ${t.columns} col.${t.rows_change_pct != null ? ` · <em class="${t.rows_change_pct < 0 ? "dn" : "up"}">${t.rows_change_pct > 0 ? "+" : ""}${nf(t.rows_change_pct)} % vs. carga anterior</em>` : ""}</span>
              <small>Cargada ${when(t.last_load)}${t.newest_date ? ` · dato más reciente ${esc(t.newest_date)}` : ""}</small></div>`).join("")}</div>
        </div>
        <button type="button" class="au-btn ghost" id="auHRe">↻ Revisar</button>
      </div>
      ${issues.length ? `<ul class="au-issues">${shown.map((i) => `
        <li class="au-issue ${esc(i.severity)}">
          <span class="au-sev">${{ critical: "Crítico", warning: "Advertencia", info: "Aviso" }[i.severity]}</span>
          <div><b>${i.table ? esc(i.table) + (i.column ? " · " + esc(i.column) : "") : "App"}</b> — ${esc(i.message)}${i.fix ? `<small>💡 ${esc(i.fix)}</small>` : ""}</div>
        </li>`).join("")}</ul>
        ${issues.length > 6 ? `<button type="button" class="au-link" id="auHMore">${showAll ? "Ver menos" : `Ver los ${issues.length} problemas`}</button>` : ""}`
        : `<p class="au-okmsg">✓ No se encontraron problemas.</p>`}`;
    $("#auHRe").addEventListener("click", async (e) => { e.currentTarget.disabled = true; try { st.health = await api.getHealth(ctx.appId); } catch (x) { st.health = { error: x.message }; } paintHealth(); });
    $("#auHMore")?.addEventListener("click", () => { showAll = !showAll; paintHealth(); });
  }

  /* ------------------------------- Carga programada ------------------------------- */
  function paintSchedule() {
    const s = st.schedule;
    const f = s || { frequency: "daily", time_of_day: "06:00", weekday: 1, interval_minutes: 60, notify: "fail", enabled: true };
    const dis = canData ? "" : "disabled";
    $("#auSched").innerHTML = `
      <h2>Carga programada</h2>
      ${s ? `<div class="au-sum ${s.enabled ? "" : "off"}">
          <b>${esc(s.description)}</b>${s.enabled ? "" : " <span class='au-pill muted'>Pausada</span>"}
          <span>Próxima: ${s.enabled && s.next_run_at ? `${when(s.next_run_at)} (${rel(s.next_run_at)})` : "—"}</span>
          <span>Última: ${s.last_run_at ? `${when(s.last_run_at)} · <span class="au-pill ${STATUS[s.last_status]?.[1] || "muted"}">${STATUS[s.last_status]?.[0] || s.last_status}</span>${s.last_duration_ms != null ? ` · ${(s.last_duration_ms / 1000).toFixed(1)} s` : ""}` : "aún no ha corrido"}</span>
          <small>Corre con los permisos de ${esc(s.owner_name || "—")}.</small>
        </div>` : `<p class="au-muted">Sin programación: los datos se actualizan solo al pulsar «Ejecutar script» en Script de datos.</p>`}
      ${canData ? "" : `<p class="au-muted">Programar la carga requiere el permiso «Importar datos».</p>`}
      <form class="au-form" id="auSchedForm">
        <label>Frecuencia<select name="frequency" ${dis}>
          ${[["interval", "Cada N minutos"], ["hourly", "Cada hora"], ["daily", "Diaria"], ["weekly", "Semanal"]].map(([v, l]) => `<option value="${v}" ${f.frequency === v ? "selected" : ""}>${l}</option>`).join("")}
        </select></label>
        <label data-for="interval">Cada (minutos)<input name="interval_minutes" type="number" min="5" max="10080" value="${esc(f.interval_minutes || 60)}" ${dis}/></label>
        <label data-for="weekly">Día<select name="weekday" ${dis}>${DAYS.map((d, i) => `<option value="${i + 1}" ${Number(f.weekday) === i + 1 ? "selected" : ""}>${d}</option>`).join("")}</select></label>
        <label data-for="daily weekly">Hora<input name="time_of_day" type="time" value="${esc(f.time_of_day || "06:00")}" ${dis}/></label>
        <label>Avisarme en la campana<select name="notify" ${dis}>
          ${[["fail", "Solo si falla"], ["always", "Siempre"], ["never", "Nunca"]].map(([v, l]) => `<option value="${v}" ${f.notify === v ? "selected" : ""}>${l}</option>`).join("")}
        </select></label>
        <label class="au-chk"><input type="checkbox" name="enabled" ${f.enabled !== false ? "checked" : ""} ${dis}/> Activa</label>
        <div class="au-err" id="auSchedErr" role="alert"></div>
        ${canData ? `<div class="au-actions">
          <button type="submit" class="au-btn">${s ? "Guardar cambios" : "Programar carga"}</button>
          <button type="button" class="au-btn ghost" id="auRunNow">▶ Ejecutar ahora</button>
          ${s ? `<button type="button" class="au-btn ghost danger" id="auSchedDel">Quitar programación</button>` : ""}
        </div>` : ""}
      </form>
      <h3>Historial de cargas</h3>
      ${st.runs.length ? `<table class="au-runs"><thead><tr><th>Fecha</th><th>Origen</th><th>Estado</th><th>Duración</th><th>Detalle</th></tr></thead><tbody>
        ${st.runs.map((r) => `<tr><td>${when(r.started_at)}</td><td>${esc(TRIG[r.trigger] || r.trigger)}${r.user_name ? `<small>${esc(r.user_name)}</small>` : ""}</td>
          <td><span class="au-pill ${STATUS[r.status]?.[1] || "muted"}">${STATUS[r.status]?.[0] || esc(r.status)}</span></td>
          <td>${r.duration_ms != null ? (r.duration_ms / 1000).toFixed(1) + " s" : "—"}</td><td class="au-msg" title="${esc(r.message)}">${esc(r.message)}</td></tr>`).join("")}
      </tbody></table>` : `<p class="au-muted">Aún no hay cargas registradas.</p>`}`;
    const form = $("#auSchedForm");
    const sync = () => {
      const fq = form.frequency.value;
      form.querySelectorAll("[data-for]").forEach((l) => { l.hidden = !l.dataset.for.split(" ").includes(fq); });
    };
    form.frequency.addEventListener("change", sync); sync();
    if (!canData) return;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = {
        frequency: form.frequency.value, interval_minutes: Number(form.interval_minutes.value), weekday: Number(form.weekday.value),
        time_of_day: form.time_of_day.value, notify: form.notify.value, enabled: form.enabled.checked,
      };
      try { $("#auSchedErr").textContent = ""; st.schedule = await api.saveSchedule(ctx.appId, body); paintSchedule(); refreshHealth(); }
      catch (x) { $("#auSchedErr").textContent = x.message; }
    });
    $("#auRunNow").addEventListener("click", async (e) => {
      const b = e.currentTarget; b.disabled = true; b.textContent = "Cargando…";
      try {
        const r = await api.runScheduleNow(ctx.appId);
        const s2 = await api.getSchedule(ctx.appId);
        st.schedule = s2.schedule; st.runs = s2.runs;
        st.alerts = await api.listAlerts(ctx.appId);
        paintSchedule(); paintAlerts(); refreshHealth();
        $("#auSchedErr").textContent = r.status === "ok" ? "" : r.message;
      } catch (x) { b.disabled = false; b.textContent = "▶ Ejecutar ahora"; $("#auSchedErr").textContent = x.message; }
    });
    $("#auSchedDel")?.addEventListener("click", async () => {
      if (!confirm("¿Quitar la carga programada? Los datos solo se actualizarán a mano.")) return;
      try { await api.deleteSchedule(ctx.appId); st.schedule = null; paintSchedule(); refreshHealth(); } catch (x) { $("#auSchedErr").textContent = x.message; }
    });
  }
  async function refreshHealth() { try { st.health = await api.getHealth(ctx.appId); paintHealth(); } catch {} }

  /* ------------------------------- Alertas ------------------------------- */
  let editing = null;   // null | "new" | alert
  function paintAlerts() {
    const el = $("#auAlerts");
    el.innerHTML = `
      <div class="au-a-head"><h2>Alertas</h2>${editing ? "" : `<button type="button" class="au-btn" id="auANew">＋ Nueva alerta</button>`}</div>
      <p class="au-muted">Te avisan en la campana cuando una medida cruza un umbral o cambia más de un %. Son tuyas: cada persona crea las suyas.</p>
      ${editing ? alertForm(editing === "new" ? null : editing) : ""}
      ${st.alerts.length ? `<ul class="au-alerts">${st.alerts.map((a) => {
        const [lbl, cls] = ALERT_STATE[a.state] || [a.state, "muted"];
        const mine = a.owner_id === me.userId || canModerate;
        const master = a.master_id ? st.masters.find((m) => m.id === a.master_id) : null;
        return `<li class="au-alert ${a.enabled ? "" : "off"}" data-id="${esc(a.id)}">
          <div class="au-a-main">
            <div class="au-a-t"><b>${esc(a.name)}</b><span class="au-pill ${cls}">${lbl}</span>${a.enabled ? "" : `<span class="au-pill muted">Pausada</span>`}</div>
            <div class="au-a-c"><code>${esc(master ? `${master.name} (maestra)` : a.expression)}</code> ${esc(a.condition)}${a.selections && Object.keys(a.selections).length ? ` · con ${esc(Object.entries(a.selections).map(([k, v]) => `${k} = ${v.join(", ")}`).join("; "))}` : ""}</div>
            ${a.action_id ? `<small>⚡ Ejecuta la lista «${esc((st.actions.find((x) => x.id === a.action_id) || {}).name || "—")}» al dispararse</small>` : ""}
            <small>Valor: <b>${nf(a.last_value)}</b> · ${esc(a.last_message || "")} · ${a.check_mode === "interval" ? `revisa cada ${a.interval_minutes} min` : "revisa al recargar"} · revisada ${when(a.last_checked_at)} · de ${esc(a.owner_name || "—")}</small>
          </div>
          <div class="au-a-act">
            <button type="button" class="au-btn ghost sm" data-check>Revisar</button>
            ${mine ? `<button type="button" class="au-btn ghost sm" data-edit>Editar</button><button type="button" class="au-btn ghost sm danger" data-del>Borrar</button>` : ""}
          </div>
        </li>`;
      }).join("")}</ul>` : editing ? "" : `<p class="au-muted">No hay alertas todavía.</p>`}`;
    $("#auANew")?.addEventListener("click", () => { editing = "new"; paintAlerts(); });
    el.querySelectorAll(".au-alert").forEach((li) => {
      const a = st.alerts.find((x) => x.id === li.dataset.id);
      li.querySelector("[data-check]").addEventListener("click", async () => { try { Object.assign(a, await api.checkAlert(ctx.appId, a.id)); paintAlerts(); } catch (x) { alert(x.message); } });
      li.querySelector("[data-edit]")?.addEventListener("click", () => { editing = a; paintAlerts(); });
      li.querySelector("[data-del]")?.addEventListener("click", async () => {
        if (!confirm(`¿Borrar la alerta «${a.name}»?`)) return;
        try { await api.deleteAlert(ctx.appId, a.id); st.alerts = st.alerts.filter((x) => x !== a); paintAlerts(); } catch (x) { alert(x.message); }
      });
    });
    const form = $("#auAForm");
    if (!form) return;
    const syncA = () => {
      form.querySelector("[data-for='expr']").hidden = form.source.value !== "expr";
      form.querySelector("[data-for='master']").hidden = form.source.value !== "master";
      form.querySelector("[data-for='every']").hidden = form.check_mode.value !== "interval";
      form.querySelector("[data-unit]").textContent = form.op.value === "change" ? "%" : "";
    };
    ["change", "input"].forEach((t) => form.addEventListener(t, syncA)); syncA();
    form.querySelector("[data-cancel]").addEventListener("click", () => { editing = null; paintAlerts(); });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const sel = {};
      const sf = form.sel_field.value.trim(), sv = form.sel_values.value.trim();
      if (sf && sv) sel[sf] = sv.split(",").map((x) => x.trim()).filter(Boolean);
      const body = {
        name: form.name.value.trim(), op: form.op.value, threshold: Number(form.threshold.value),
        expression: form.source.value === "expr" ? form.expression.value.trim() : "",
        master_id: form.source.value === "master" ? form.master_id.value : "",
        selections: sel, check_mode: form.check_mode.value, interval_minutes: Number(form.interval_minutes.value), enabled: form.enabled.checked,
        action_id: form.action_id.value,
      };
      const btn = form.querySelector("[type=submit]"); btn.disabled = true;
      try {
        const saved = editing === "new" ? await api.createAlert(ctx.appId, body) : await api.updateAlert(ctx.appId, editing.id, body);
        editing = null;
        st.alerts = await api.listAlerts(ctx.appId);
        paintAlerts();
        const li = $(`.au-alert[data-id="${CSS.escape(saved.id)}"]`);
        li?.classList.add("flash");
      } catch (x) { $("#auAErr").textContent = x.message; btn.disabled = false; }
    });
  }

  function alertForm(a) {
    const selEntry = a && a.selections ? Object.entries(a.selections)[0] : null;
    const src = a?.master_id ? "master" : "expr";
    return `<form class="au-form au-aform" id="auAForm">
      <label class="full">Nombre<input name="name" maxlength="120" required value="${esc(a?.name || "")}" placeholder="Ej.: Rotación sobre 10 %"/></label>
      <label>Medida<select name="source"><option value="expr" ${src === "expr" ? "selected" : ""}>Expresión fx</option>${st.masters.length ? `<option value="master" ${src === "master" ? "selected" : ""}>Medida maestra</option>` : ""}</select></label>
      <label class="wide" data-for="expr">Expresión<input name="expression" value="${esc(a?.expression || "")}" placeholder="Count([FECHA RETIRO]) / Count([CEDULA]) * 100"/></label>
      <label class="wide" data-for="master">Medida maestra<select name="master_id">${st.masters.map((m) => `<option value="${esc(m.id)}" ${a?.master_id === m.id ? "selected" : ""}>${m.certified ? "✓ " : ""}${esc(m.name)}</option>`).join("")}</select></label>
      <label>Avisar cuando<select name="op">${OPS.map(([v, l]) => `<option value="${v}" ${(a?.op || ">") === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label>Umbral <span data-unit></span><input name="threshold" type="number" step="any" required value="${esc(a?.threshold ?? "")}"/></label>
      <label>Filtro: campo (opcional)<input name="sel_field" value="${esc(selEntry?.[0] || "")}" placeholder="SUCURSAL"/></label>
      <label>Valores (separados por coma)<input name="sel_values" value="${esc(selEntry?.[1]?.join(", ") || "")}" placeholder="CALI, NEIVA"/></label>
      <label>Revisar<select name="check_mode"><option value="reload" ${(a?.check_mode || "reload") === "reload" ? "selected" : ""}>Cada vez que se recarguen los datos</option><option value="interval" ${a?.check_mode === "interval" ? "selected" : ""}>Cada N minutos</option></select></label>
      <label data-for="every">Cada (minutos)<input name="interval_minutes" type="number" min="5" value="${esc(a?.interval_minutes || 60)}"/></label>
      <label class="wide">Al dispararse, ejecutar la lista<select name="action_id"><option value="">Ninguna (solo avisar)</option>${(st.actions || []).map((x) => `<option value="${esc(x.id)}" ${a?.action_id === x.id ? "selected" : ""}>${esc(x.name)}${x.has_webhook ? " · envía al webhook" : ""}</option>`).join("")}</select></label>
      <label class="au-chk"><input type="checkbox" name="enabled" ${a?.enabled === false ? "" : "checked"}/> Activa</label>
      <div class="au-err full" id="auAErr" role="alert"></div>
      <div class="au-actions full"><button type="submit" class="au-btn">${a ? "Guardar" : "Crear alerta"}</button><button type="button" class="au-btn ghost" data-cancel>Cancelar</button>
        <small class="au-muted">Se valida en el motor y se revisa al guardar.</small></div>
    </form>`;
  }

  await load();
  const timer = setInterval(() => { if (!document.hidden && !editing) load().catch(() => {}); }, 60000);
  return () => clearInterval(timer);
}

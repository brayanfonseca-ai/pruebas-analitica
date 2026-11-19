// app-insights.js — vista «Qué cambió · simular · actuar» de una app, en 4 pasos encadenados:
//   1 · Qué cambió: tablero vivo con una tarjeta por métrica (valor, cambio y tendencia). Clic → por qué cambió
//       (relato + segmentos que lo empujan en barras), con atajos a «ver registros» y «simular».
//   2 · ¿Qué pasaría si…?: escenario armado como una frase; se recalcula solo al cambiar algo.
//   3 · Actuar: los registros detrás de la cifra → tabla, CSV y listas guardadas que se envían a un webhook.
//   4 · Vigilar: el agente de guardia revisa las métricas tras cada carga y avisa en la campana.
// Todo lo calcula el backend (/insights/*, /actions, /watchdog).

import * as api from "./api.js";
import { toast, modal, confirmBox } from "./ui-kit.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nf = (v, d = 2) => (v == null || isNaN(v) ? "—" : Number(v).toLocaleString("es-CO", { maximumFractionDigits: d }));
const when = (s) => { if (!s) return "—"; const d = new Date(s); return isNaN(d) ? esc(s) : d.toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" }); };
const sign = (v) => (v > 0 ? "+" : v < 0 ? "−" : "");
const dirCls = (v) => (v > 0 ? "up" : v < 0 ? "dn" : "eq");

const STEPS = [
  ["cambio", "1", "Qué cambió", "Por qué se movió cada cifra"],
  ["simular", "2", "¿Qué pasaría si…?", "Prueba un escenario antes de decidir"],
  ["accion", "3", "Actuar", "Los registros concretos, para exportar o enviar"],
  ["guardia", "4", "Vigilar", "Un agente que avisa cuando algo se mueve"],
];

/** Minigráfica SVG de una serie; resalta los dos últimos puntos (anterior y actual). */
function spark(series, { w = 220, h = 54, cls = "" } = {}) {
  if (!series || series.length < 2) return `<svg class="in-spark ${cls}" viewBox="0 0 ${w} ${h}"></svg>`;
  const vs = series.map((p) => Number(p.value) || 0);
  const min = Math.min(...vs), max = Math.max(...vs), span = max - min || 1, pad = 5;
  const X = (i) => pad + (i / (vs.length - 1)) * (w - pad * 2);
  const Y = (v) => h - pad - ((v - min) / span) * (h - pad * 2);
  const pts = vs.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`);
  const n = vs.length;
  return `<svg class="in-spark ${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <path class="a" d="M${pts[0]} L${pts.join(" L")} L${X(n - 1).toFixed(1)},${h} L${X(0).toFixed(1)},${h} Z"/>
    <path class="l" d="M${pts.join(" L")}"/>
    <circle class="p" cx="${X(n - 2).toFixed(1)}" cy="${Y(vs[n - 2]).toFixed(1)}" r="3"/>
    <circle class="c" cx="${X(n - 1).toFixed(1)}" cy="${Y(vs[n - 1]).toFixed(1)}" r="4"/>
  </svg>`;
}

/** Barras por periodo (detalle): los dos comparados en color. */
function periodBars(series, prev, cur, pct) {
  if (!series?.length) return "";
  const vs = series.map((p) => Number(p.value) || 0);
  const max = Math.max(...vs), min = Math.min(...vs);
  // base cerca del mínimo: si todos rondan 500, la variación entre 470 y 530 se ve
  const base = min > 0 && (max - min) / max < 0.5 ? min - (max - min) * 0.35 : Math.min(0, min);
  const span = max - base || 1;
  return `<div class="in-pbars">${series.map((p) => {
    const k = p.period === cur ? "cur" : p.period === prev ? "prev" : "";
    return `<div class="in-pbar ${k}" title="${esc(p.period)}: ${nf(p.value)}${pct ? " %" : ""}">
      <em>${k ? nf(p.value, 1) : ""}</em><i style="height:${Math.max(4, ((Number(p.value) || 0) - base) / span * 100).toFixed(1)}%"></i><span>${esc(String(p.period).slice(-7))}</span></div>`;
  }).join("")}</div>`;
}

/** Cuenta animada de un número dentro de un elemento. */
function countUp(el, to, suffix = "") {
  if (!el || to == null || isNaN(to)) return;
  const t0 = performance.now(), dur = 650;
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    el.textContent = nf(to * e) + suffix;
    if (k < 1) requestAnimationFrame(step); else el.textContent = nf(to) + suffix;
  };
  requestAnimationFrame(step);
}

/** Ejecuta promesas de a `n` a la vez. */
async function pool(tasks, n = 3) {
  let i = 0;
  const run = async () => { while (i < tasks.length) { const t = tasks[i++]; await t(); } };
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, run));
}

export async function render(mount, ctx) {
  const canEdit = ctx.can("charts:edit");
  const K = (k) => `ds.ins.${k}.${ctx.appId}`;
  const st = {
    tab: sessionStorage.getItem(K("tab")) || "cambio",
    masters: [], fields: [], tables: [],
    pulse: { cur: "", prev: "", time: "", sf: "", sv: "", periods: [], time_display: "", open: null, dim: null },
    custom: JSON.parse(sessionStorage.getItem(K("custom")) || "[]"),
    cards: new Map(),
    rowsQ: null, rowsFrom: null, sim: null,
  };
  if (st.tab === "pulso") st.tab = "cambio";

  mount.innerHTML = `
    <div class="in">
      <header class="in-hero">
        <div><h1>Entiende tus cifras y actúa</h1>
          <p>Mira qué métricas se movieron, descubre por qué, prueba qué pasaría si cambias algo y llega a las personas o registros concretos para actuar.</p></div>
      </header>
      <nav class="in-steps" role="tablist" aria-label="Pasos">${STEPS.map(([k, n, l, d], i) => `${i ? '<span class="in-step-arrow" aria-hidden="true">›</span>' : ""}
        <button type="button" role="tab" data-tab="${k}"><span class="in-step-n">${n}</span><span><b>${l}</b><small>${d}</small></span></button>`).join("")}</nav>
      <section class="in-body" id="inBody"></section>
    </div>`;
  const $ = (s) => mount.querySelector(s);
  const body = $("#inBody");

  try {
    const [m, f, t] = await Promise.all([api.listMasterItems(ctx.appId), api.getFields(ctx.appId), api.listTables(ctx.appId).catch(() => [])]);
    st.masters = m.filter((x) => x.kind === "measure").sort((a, b) => (b.certified ? 1 : 0) - (a.certified ? 1 : 0));
    st.allFields = [...(f.dimensions || []), ...(f.measures || [])];
    st.fields = [...new Map(st.allFields.map((x) => [x.field, x])).values()];
    st.tables = t.map((x) => x.name);
    st.tableRows = Object.fromEntries(t.map((x) => [x.name, Number(x.rows ?? x.row_count ?? 0)]));
  } catch { /* sin catálogo */ }

  const fieldOpts = (types, sel = "", blank = "") => `${blank ? `<option value="">${esc(blank)}</option>` : ""}${st.fields.filter((f) => !types || types.includes(f.type))
    .map((f) => `<option value="${esc(f.field)}" ${sel === f.field ? "selected" : ""}>${esc(f.display || f.field)}</option>`).join("")}`;
  const selFrom = (field, values) => (field && String(values || "").trim() ? { [field]: String(values).split(",").map((x) => x.trim()).filter(Boolean) } : {});
  const display = (field) => st.fields.find((f) => f.field === field)?.display || field;

  /** Métricas del tablero: maestras (certificadas primero) + las fx que agregó la persona; si no hay, sugeridas. */
  function metrics() {
    const out = st.masters.slice(0, 8).map((m) => ({ key: "m:" + m.id, label: m.name, certified: !!m.certified, q: { master_id: m.id } }));
    st.custom.forEach((c, i) => out.push({ key: "fx:" + i, label: c.label || c.expression, custom: i, q: { expression: c.expression, ...(c.label ? { label: c.label } : {}) } }));
    if (!st.masters.length) out.unshift(...suggested());
    return out;
  }
  /** Sin medidas maestras: registros de la tabla principal y los números que tienen sentido sumar o promediar. */
  function suggested() {
    const all = st.allFields || st.fields;
    const skip = /^(a[nñ]io|year|mes|month|d[ií]a|day|semana|week|id|cod|codigo|c[oó]digo|cedula|c[eé]dula|documento|nit|telefono|celular|horizonte)\b|(^|[\s_])id$|_id\b|^id[\s_]/i;
    const out = [];
    const big = Object.entries(st.tableRows || {}).sort((a, b) => b[1] - a[1])[0]?.[0];
    const inBig = all.filter((f) => f.table === big);
    const idf = inBig.find((f) => /cedula|c[eé]dula|documento|^id$|codigo/i.test(f.field)) || inBig[0] || all[0];
    if (idf) out.push({ key: "auto:rows", label: `Registros${big ? ` · ${big}` : ""}`, suggested: true, q: { expression: `Count([${idf.field}])`, label: "Registros" } });
    const seen = new Set();
    for (const f of all) {
      if (out.length >= 6) break;
      if (f.type !== "number" || skip.test(f.field.trim()) || seen.has(f.field)) continue;
      seen.add(f.field);
      const avg = /%|porcentaje|tasa|probabilidad|promedio|edad|antig/i.test(f.field);
      const label = avg ? (f.field.trim().startsWith("%") ? f.display || f.field : `Promedio ${f.display || f.field}`) : `Total ${f.display || f.field}`;
      out.push({ key: "auto:" + f.table + "." + f.field, label, suggested: true, q: { expression: `${avg ? "Avg" : "Sum"}([${f.field}])`, label } });
    }
    return out;
  }
  const pulseQ = () => {
    const p = st.pulse, q = { selections: selFrom(p.sf, p.sv) };
    if (p.time) q.time_field = p.time;
    if (p.cur) q.current = p.cur;
    if (p.prev) q.previous = p.prev;
    return q;
  };

  function paintTabs() {
    mount.querySelectorAll("[data-tab]").forEach((b) => { const on = b.dataset.tab === st.tab; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); });
    sessionStorage.setItem(K("tab"), st.tab);
    ({ cambio: tabCambio, simular: tabSimular, accion: tabAccion, guardia: tabGuardia })[st.tab]();
  }
  const go = (tab) => { st.tab = tab; paintTabs(); mount.querySelector(".in-steps")?.scrollIntoView({ behavior: "smooth", block: "nearest" }); };
  mount.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => go(b.dataset.tab)));

  /* =============================== 1 · Qué cambió =============================== */
  function tabCambio() {
    const p = st.pulse;
    body.innerHTML = `
      <div class="in-bar-ctx">
        <span class="in-ctx-txt" id="puCtx">Comparando el último periodo con el anterior…</span>
        <span class="in-spacer"></span>
        <button type="button" class="in-btn ghost sm" id="puAdj" aria-expanded="false">⚙ Ajustar</button>
        <button type="button" class="in-btn ghost sm" id="puAdd">＋ Métrica</button>
        <button type="button" class="in-btn ghost sm" id="puRe" title="Volver a calcular">↻</button>
      </div>
      <form class="in-adjust" id="puForm" hidden>
        <label>Comparar por<select name="time"><option value="">Automático</option>${fieldOpts(null, p.time)}</select></label>
        <label>Periodo actual<select name="cur"><option value="">El último</option></select></label>
        <label>Contra<select name="prev"><option value="">El anterior</option></select></label>
        <label>Solo donde<select name="sf">${fieldOpts(["text", "date"], p.sf, "Todos los datos")}</select></label>
        <label>es<input name="sv" value="${esc(p.sv)}" placeholder="CALI, NEIVA"/></label>
        <div class="in-adj-act"><button type="submit" class="in-btn sm">Aplicar</button><button type="button" class="in-btn ghost sm" id="puReset">Restablecer</button></div>
      </form>
      <div class="in-grid" id="puGrid"></div>
      <div id="puDetail"></div>`;
    fillPeriods();
    $("#puAdj").addEventListener("click", (e) => { const f = $("#puForm"); f.hidden = !f.hidden; e.currentTarget.setAttribute("aria-expanded", String(!f.hidden)); });
    $("#puForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const f = e.currentTarget;
      const timeChanged = f.time.value !== p.time;
      Object.assign(p, { time: f.time.value, cur: timeChanged ? "" : f.cur.value, prev: timeChanged ? "" : f.prev.value, sf: f.sf.value, sv: f.sv.value.trim() });
      st.cards.clear(); loadPulse();
    });
    $("#puReset").addEventListener("click", () => { Object.assign(p, { time: "", cur: "", prev: "", sf: "", sv: "" }); st.cards.clear(); tabCambio(); });
    $("#puRe").addEventListener("click", () => { st.cards.clear(); loadPulse(); });
    $("#puAdd").addEventListener("click", addMetricModal);
    loadPulse();
  }

  function fillPeriods() {
    const f = $("#puForm"); if (!f) return;
    const p = st.pulse;
    const opts = (chosen, def) => `<option value="">${def}</option>` + [...p.periods].reverse().map((x) => `<option ${x === chosen ? "selected" : ""}>${esc(x)}</option>`).join("");
    f.cur.innerHTML = opts(p.cur, "El último"); f.prev.innerHTML = opts(p.prev, "El anterior");
  }

  function addMetricModal() {
    const m = modal({
      title: "Agregar una métrica al tablero",
      body: `<form class="in-mform" id="amForm">
        <label>Expresión fx<input name="expr" required placeholder="Round(Sum(If([ESTADO CONTRATO] = 'Inactivo', 1, 0)) / Count([CEDULA]) * 100, 2)"/></label>
        <label>Nombre<input name="lbl" maxlength="80" placeholder="% Inactivos"/></label>
        <p class="in-muted">Puedes usar medidas compuestas: <code>Count([A]) / Count([B]) * 100</code>. Si la usarás seguido, guárdala como medida maestra para que todos la vean.</p>
        <div class="in-chips">${st.fields.filter((f) => f.type === "number").slice(0, 6).map((f) => `<button type="button" class="in-chip" data-ex="Sum([${esc(f.field)}])" data-lb="Total ${esc(f.display || f.field)}">Σ ${esc(f.display || f.field)}</button>`).join("")}</div>
        <div class="in-err" id="amErr" role="alert"></div></form>`,
      actions: `<button type="button" class="q-btn" data-x>Cancelar</button><button type="button" class="q-btn primary" id="amOk">Agregar</button>`,
    });
    const f = m.el.querySelector("#amForm");
    m.el.querySelectorAll("[data-ex]").forEach((b) => b.addEventListener("click", () => { f.expr.value = b.dataset.ex; f.lbl.value = b.dataset.lb; }));
    const ok = async () => {
      const expression = f.expr.value.trim(); if (!expression) { m.el.querySelector("#amErr").textContent = "Escribe una expresión."; return; }
      try { await api.explainChange(ctx.appId, { expression, label: f.lbl.value.trim() || undefined, drivers: false, ...pulseQ() }); }
      catch (x) { m.el.querySelector("#amErr").textContent = x.message; return; }
      st.custom.push({ expression, label: f.lbl.value.trim() });
      sessionStorage.setItem(K("custom"), JSON.stringify(st.custom));
      m.close(); loadPulse();
    };
    m.el.querySelector("#amOk").addEventListener("click", ok);
    f.addEventListener("submit", (e) => { e.preventDefault(); ok(); });
    f.expr.focus();
  }

  async function loadPulse() {
    const grid = $("#puGrid"); if (!grid) return;
    const ms = metrics();
    if (!ms.length) { grid.innerHTML = `<div class="in-empty"><b>No hay datos para comparar todavía.</b><span>Carga datos en la app y vuelve aquí.</span></div>`; return; }
    grid.innerHTML = ms.map((m) => `<button type="button" class="in-mcard loading" data-key="${esc(m.key)}">
        <span class="in-mc-h"><b>${m.certified ? '<i class="in-cert" title="Métrica certificada">✓</i>' : ""}${esc(m.label)}</b>${m.custom != null ? `<span class="in-mc-x" data-rm="${m.custom}" title="Quitar del tablero" role="button" aria-label="Quitar">✕</span>` : ""}</span>
        <span class="in-sk w60"></span><span class="in-sk w40"></span><span class="in-sk h40"></span></button>`).join("")
      + (st.masters.length ? "" : `<div class="in-hint">${ms.some((x) => x.suggested) ? "Son métricas sugeridas a partir de tus campos. " : ""}Crea medidas maestras en la hoja (o «＋ Métrica») para ver aquí lo que te importa.</div>`);
    grid.querySelectorAll("[data-rm]").forEach((x) => x.addEventListener("click", (e) => {
      e.stopPropagation(); st.custom.splice(Number(x.dataset.rm), 1); sessionStorage.setItem(K("custom"), JSON.stringify(st.custom)); st.cards.clear(); loadPulse();
    }));
    grid.querySelectorAll(".in-mcard").forEach((c) => c.addEventListener("click", () => openDetail(ms.find((m) => m.key === c.dataset.key))));
    const q0 = pulseQ();
    let ctxSet = false;
    const seenPeriods = new Set();
    await pool(ms.map((m) => async () => {
      let r = st.cards.get(m.key), err = null;
      if (!r) { try { r = await api.explainChange(ctx.appId, { ...m.q, ...q0, drivers: false, trend: true }); st.cards.set(m.key, r); } catch (x) { err = x.message; } }
      if (!grid.isConnected) return;
      const el = grid.querySelector(`[data-key="${CSS.escape(m.key)}"]`); if (!el) return;
      el.classList.remove("loading");
      if (err) { el.classList.add("bad"); el.innerHTML = el.querySelector(".in-mc-h").outerHTML + `<span class="in-mc-err">${esc(err)}</span>`; return; }
      seenPeriods.add(`${r.current}|${r.previous}`);
      if (ctxSet && seenPeriods.size > 1) {
        const cx = $("#puCtx");
        if (cx) cx.innerHTML = `Cada métrica compara su <b>último periodo</b> con el anterior (sus tablas llegan a fechas distintas) · por ${esc(r.time_display)}`;
      }
      if (!ctxSet) {
        ctxSet = true;
        Object.assign(st.pulse, { periods: r.periods, time_display: r.time_display });
        fillPeriods();
        const f = Object.entries(r.selections || {});
        const cx = $("#puCtx");
        if (cx) cx.innerHTML = `Comparando <b>${esc(r.current)}</b> con <b>${esc(r.previous)}</b> · por ${esc(r.time_display)}${f.length ? ` · solo ${esc(f.map(([k, v]) => `${display(k)} = ${v.join(", ")}`).join("; "))}` : ""}`;
      }
      const u = r.measure.percent ? " %" : "", d = r.delta;
      const chg = r.measure.percent ? `${sign(d)}${nf(Math.abs(d))} pts` : r.delta_pct != null ? `${sign(d)}${nf(Math.abs(r.delta_pct), 1)} %` : `${sign(d)}${nf(Math.abs(d))}`;
      el.classList.add(dirCls(d));
      el.innerHTML = `${el.querySelector(".in-mc-h").outerHTML}
        <span class="in-mc-v"><b data-v>${nf(r.current_value)}${u}</b><em class="in-delta ${dirCls(d)}">${d > 0 ? "▲" : d < 0 ? "▼" : "＝"} ${chg}</em></span>
        <span class="in-mc-s"><b>${esc(r.current)}</b> vs ${esc(r.previous)} (${nf(r.previous_value)}${u})</span>
        ${spark(r.trend, { cls: dirCls(d) })}
        <span class="in-mc-go">Ver por qué →</span>`;
      el.querySelector(".in-mc-x")?.addEventListener("click", (e) => { e.stopPropagation(); st.custom.splice(Number(e.currentTarget.dataset.rm), 1); sessionStorage.setItem(K("custom"), JSON.stringify(st.custom)); st.cards.clear(); loadPulse(); });
      countUp(el.querySelector("[data-v]"), r.current_value, u);
    }), 3);
    // reabre el detalle que estaba abierto
    if (!grid.isConnected) return;
    const open = st.pulse.open && ms.find((m) => m.key === st.pulse.open);
    if (open) openDetail(open, false);
  }

  async function openDetail(m, scroll = true) {
    if (!m) return;
    st.pulse.open = m.key;
    $("#puGrid")?.querySelectorAll(".in-mcard").forEach((c) => c.classList.toggle("sel", c.dataset.key === m.key));
    const host = $("#puDetail"); if (!host) return;
    host.innerHTML = `<div class="in-card in-detail"><div class="in-loading"><span class="in-spin"></span> Buscando por qué cambió ${esc(m.label)}…</div></div>`;
    if (scroll) host.scrollIntoView({ behavior: "smooth", block: "start" });
    let r;
    try { r = await api.explainChange(ctx.appId, { ...m.q, ...pulseQ(), trend: true }); }
    catch (x) { if (host.isConnected) host.innerHTML = `<div class="in-card in-detail"><p class="in-err">${esc(x.message)}</p></div>`; return; }
    if (!host.isConnected || st.pulse.open !== m.key) return;
    const pct = r.measure.percent, u = pct ? " %" : "", d = r.delta;
    const kind = (s) => /^Lo que más|^También pesa/.test(s) ? ["why", "🔎"] : /^En sentido contrario/.test(s) ? ["counter", "↔"] : /^Como /.test(s) ? ["note", "ℹ"] : ["sum", d > 0 ? "▲" : d < 0 ? "▼" : "＝"];
    const dims = r.drivers || [];
    if (!dims.some((x) => x.dimension === st.pulse.dim)) st.pulse.dim = dims[0]?.dimension || null;
    host.innerHTML = `
      <div class="in-card in-detail ${dirCls(d)}">
        <div class="in-dt-top">
          <div class="in-dt-h"><span class="in-eyebrow">Por qué cambió</span><h2>${m.certified ? '<i class="in-cert">✓</i>' : ""}${esc(r.measure.label)}</h2></div>
          <button type="button" class="in-x2" id="dtX" aria-label="Cerrar">✕</button>
        </div>
        <div class="in-dt-hero">
          <div class="in-dt-num"><span>${esc(r.previous)}</span><b>${nf(r.previous_value)}${u}</b></div>
          <div class="in-dt-mid ${dirCls(d)}"><span class="in-dt-arrow">${d > 0 ? "▲" : d < 0 ? "▼" : "＝"}</span><b>${sign(d)}${nf(Math.abs(d))}${pct ? " pts" : ""}</b>${!pct && r.delta_pct != null ? `<small>${sign(d)}${nf(Math.abs(r.delta_pct), 1)} %</small>` : ""}</div>
          <div class="in-dt-num cur"><span>${esc(r.current)}</span><b data-v>${nf(r.current_value)}${u}</b></div>
          <div class="in-dt-chart">${periodBars(r.trend, r.previous, r.current, pct)}</div>
        </div>
        <ul class="in-why">${r.story.map((s) => { const [k, i] = kind(s); return `<li class="${k}"><span>${i}</span><p>${esc(s)}</p></li>`; }).join("")}</ul>
        ${dims.length ? `
          <div class="in-dims"><span class="in-dims-l">Ver el cambio por</span>${dims.map((x) => `<button type="button" class="in-chip ${x.dimension === st.pulse.dim ? "on" : ""}" data-dim="${esc(x.dimension)}">${esc(x.display)}</button>`).join("")}</div>
          <div id="dtDrv"></div>` : `<p class="in-muted">No hay dimensiones de texto para descomponer este cambio.</p>`}
        <div class="in-dt-foot">
          <button type="button" class="in-btn ghost" id="dtRows">Ver los registros de ${esc(r.current)} →</button>
          <button type="button" class="in-btn ghost" id="dtSim">Simular un escenario →</button>
        </div>
      </div>`;
    countUp(host.querySelector("[data-v]"), r.current_value, u);
    $("#dtX").addEventListener("click", () => { st.pulse.open = null; host.innerHTML = ""; $("#puGrid")?.querySelectorAll(".in-mcard").forEach((c) => c.classList.remove("sel")); });
    const toRows = (extra = {}, label = "") => {
      st.rowsQ = { table: r.measure.table, selections: { ...r.selections, [r.time_field]: [r.current], ...extra } };
      st.rowsFrom = `${r.measure.label} · ${display(r.time_field)} = ${r.current}${label ? ` · ${label}` : ""}`;
      go("accion");
    };
    const toSim = (dim, val) => { st.sim = { metric: m, where: dim ? { field: dim, value: val } : null }; go("simular"); };
    $("#dtRows").addEventListener("click", () => toRows());
    $("#dtSim").addEventListener("click", () => toSim());
    const paintDrv = () => {
      const dr = dims.find((x) => x.dimension === st.pulse.dim); if (!dr) return;
      const max = Math.max(...dr.items.map((i) => Math.abs(i.delta)), 0) || 1;
      $("#dtDrv").innerHTML = `<ul class="in-drv">${dr.items.map((i) => `
        <li class="${dirCls(i.delta)}">
          <span class="in-drv-l" title="${esc(i.value)}">${esc(i.value)}</span>
          <span class="in-drv-v">${nf(i.previous)}${u} → <b>${nf(i.current)}${u}</b></span>
          <span class="in-drv-bar"><span class="neg">${i.delta < 0 ? `<i style="width:${(Math.abs(i.delta) / max * 100).toFixed(1)}%"></i>` : ""}</span><span class="pos">${i.delta > 0 ? `<i style="width:${(Math.abs(i.delta) / max * 100).toFixed(1)}%"></i>` : ""}</span></span>
          <span class="in-drv-d">${sign(i.delta)}${nf(Math.abs(i.delta))}${pct ? " pts" : ""}${i.share != null ? `<small>${nf(i.share, 1)} % del cambio</small>` : i.weight != null ? `<small>${nf(i.weight, 1)} % de las filas</small>` : ""}</span>
          <span class="in-drv-a"><button type="button" class="in-link" data-r="${esc(i.value)}">Registros</button><button type="button" class="in-link" data-s="${esc(i.value)}">Simular</button></span>
        </li>`).join("")}</ul>
        <p class="in-muted">${dr.values > dr.items.length ? `Se muestran los ${dr.items.length} que más empujan de ${dr.values} valores. ` : ""}Verde = sube, rojo = baja.</p>`;
      $("#dtDrv").querySelectorAll("[data-r]").forEach((b) => b.addEventListener("click", () => toRows({ [dr.dimension]: [b.dataset.r] }, `${dr.display} = ${b.dataset.r}`)));
      $("#dtDrv").querySelectorAll("[data-s]").forEach((b) => b.addEventListener("click", () => toSim(dr.dimension, b.dataset.s)));
      requestAnimationFrame(() => $("#dtDrv")?.querySelector(".in-drv")?.classList.add("go"));
    };
    host.querySelectorAll("[data-dim]").forEach((b) => b.addEventListener("click", () => {
      st.pulse.dim = b.dataset.dim; host.querySelectorAll("[data-dim]").forEach((x) => x.classList.toggle("on", x === b)); paintDrv();
    }));
    paintDrv();
  }

  /* =============================== 2 · ¿Qué pasaría si…? =============================== */
  function tabSimular() {
    const ms = metrics();
    const pre = st.sim || {};
    const metricOpts = ms.map((m) => `<option value="${esc(m.key)}" ${pre.metric?.key === m.key ? "selected" : ""}>${m.certified ? "✓ " : ""}${esc(m.label)}</option>`).join("") + `<option value="fx">otra expresión fx…</option>`;
    body.innerHTML = `
      <div class="in-card in-sim">
        <p class="in-sent">¿Qué le pasaría a <select id="siM" class="in-inl">${metricOpts}</select><input id="siFx" class="in-inl wide" placeholder="Count([FECHA RETIRO]) / Count([CEDULA]) * 100" hidden/> si…</p>
        <div id="siCh"></div>
        <div class="in-sim-act">
          <button type="button" class="in-btn ghost sm" id="siAdd">＋ Otro cambio a la vez</button>
          <label class="in-inl-l">Ver el efecto por <select id="siDim" class="in-inl">${fieldOpts(["text"], pre.where?.field || "", "solo el total")}</select></label>
          <span class="in-spacer"></span>
          <span class="in-sim-st" id="siSt"></span>
          <button type="button" class="in-btn" id="siGo">Simular</button>
        </div>
      </div>
      <div id="siOut"><div class="in-empty soft"><b>Arma la frase de arriba</b><span>El resultado se calcula solo en cuanto completes el campo y el valor. No se modifica ningún dato: se simula sobre una copia.</span></div></div>`;
    const fx = $("#siFx"), mSel = $("#siM");
    const syncFx = () => { fx.hidden = mSel.value !== "fx"; };
    mSel.addEventListener("change", () => { syncFx(); schedule(); }); syncFx();
    const addChange = (preset = {}) => {
      const d = document.createElement("div");
      d.className = "in-ch";
      d.innerHTML = `
        <p class="in-sent sub"><span class="in-ch-n"></span>en <select data-k="scope" class="in-inl"><option value="all">todas las filas</option><option value="where" ${preset.field ? "selected" : ""}>las filas donde</option></select>
          <span data-w ${preset.field ? "" : "hidden"}><select data-k="sf" class="in-inl">${fieldOpts(["text", "date"], preset.field || "")}</select> es <input data-k="sv" class="in-inl" value="${esc(preset.value || "")}" placeholder="CALI"/></span>,
          el campo <select data-k="field" class="in-inl">${fieldOpts(null, "", "elige…")}</select>
          <select data-k="op" class="in-inl"><option value="set">pasa a ser</option><option value="multiply">se multiplica por</option><option value="add">aumenta en</option></select>
          <input data-k="value" class="in-inl" placeholder="Activo · 1.1 · 5"/>
          en el <input data-k="share" class="in-inl num" type="number" min="1" max="100" value="100"/> % de ellas.
          <button type="button" class="in-link" data-adv>condición avanzada</button>
        </p>
        <label class="in-adv" hidden>Además, solo filas que cumplan <input data-k="where" class="in-inl wide" placeholder="[EDAD EN AÑOS] < 30"/></label>
        <button type="button" class="in-x" aria-label="Quitar este cambio">✕</button>`;
      d.querySelector("[data-k=scope]").addEventListener("change", (e) => { d.querySelector("[data-w]").hidden = e.target.value !== "where"; });
      d.querySelector("[data-adv]").addEventListener("click", () => { const a = d.querySelector(".in-adv"); a.hidden = !a.hidden; });
      d.querySelector(".in-x").addEventListener("click", () => { if ($("#siCh").children.length > 1) { d.remove(); number(); schedule(); } });
      $("#siCh").appendChild(d); number();
    };
    const number = () => { const all = [...mount.querySelectorAll(".in-ch")]; all.forEach((d, i) => { d.querySelector(".in-ch-n").textContent = all.length > 1 ? `${i + 1}. ` : ""; d.querySelector(".in-x").hidden = all.length < 2; }); };
    addChange(pre.where || {});
    $("#siAdd").addEventListener("click", () => addChange());
    let tm = null;
    const read = () => {
      const changes = [...mount.querySelectorAll(".in-ch")].map((d) => {
        const g = (k) => d.querySelector(`[data-k="${k}"]`).value.trim();
        const c = { field: g("field"), op: g("op"), value: g("value"), share: Math.min(100, Math.max(1, Number(g("share") || 100))) };
        c.selections = g("scope") === "where" ? selFrom(g("sf"), g("sv")) : {};
        if (g("where")) c.where = g("where");
        return c;
      });
      const m = mSel.value === "fx" ? { expression: fx.value.trim(), label: fx.value.trim() } : ms.find((x) => x.key === mSel.value)?.q;
      return { changes, m };
    };
    const ready = ({ changes, m }) => m && (m.master_id || m.expression) && changes.every((c) => c.field && c.value !== "");
    const run = async () => {
      if (!mSel.isConnected) return;
      const r0 = read();
      if (!ready(r0)) { $("#siSt").textContent = "Completa el campo y el valor"; return; }
      const q = { measures: [r0.m.master_id ? { master_id: r0.m.master_id } : { expression: r0.m.expression, label: r0.m.label || r0.m.expression }], changes: r0.changes };
      if ($("#siDim").value) q.dimension = $("#siDim").value;
      $("#siSt").innerHTML = `<span class="in-spin"></span> Simulando…`;
      try { const r = await api.whatIf(ctx.appId, q); if (!mSel.isConnected) return; paintWhatIf(r); $("#siSt").textContent = ""; }
      catch (x) { if (!mSel.isConnected) return; $("#siSt").textContent = ""; $("#siOut").innerHTML = `<div class="in-card"><p class="in-err">${esc(x.message)}</p></div>`; }
    };
    const schedule = () => { clearTimeout(tm); if (mSel.isConnected && ready(read())) { $("#siSt").textContent = "…"; tm = setTimeout(run, 650); } };
    body.querySelector(".in-sim").addEventListener("input", schedule);
    body.querySelector(".in-sim").addEventListener("change", schedule);
    $("#siGo").addEventListener("click", run);
  }

  function paintWhatIf(r) {
    if (!$("#siOut")) return;
    $("#siOut").innerHTML = `
      <div class="in-card in-wi">
        <span class="in-eyebrow">Resultado del escenario</span>
        <ul class="in-why">${r.changes.map((c) => `<li class="sum"><span>✎</span><p>${esc(c.text)}</p></li>`).join("")}</ul>
        ${r.results.map((x) => {
          const u = x.percent ? " %" : "", mx = Math.max(Math.abs(x.before), Math.abs(x.after)) || 1;
          return `<div class="in-wi-m"><h3>${esc(x.label)}</h3>
            <div class="in-wi-bars">
              <div class="row"><span>Hoy</span><span class="bar"><i class="before" style="--w:${(Math.abs(x.before) / mx * 100).toFixed(1)}%"></i></span><b>${nf(x.before)}${u}</b></div>
              <div class="row"><span>Con el escenario</span><span class="bar"><i class="after ${dirCls(x.delta)}" style="--w:${(Math.abs(x.after) / mx * 100).toFixed(1)}%"></i></span><b>${nf(x.after)}${u}</b></div>
            </div>
            <div class="in-wi-d ${dirCls(x.delta)}">${x.delta > 0 ? "▲" : x.delta < 0 ? "▼" : "＝"} ${sign(x.delta)}${nf(Math.abs(x.delta))}${x.percent ? " puntos" : ""}${!x.percent && x.before ? ` (${sign(x.delta)}${nf(Math.abs(x.delta / x.before * 100), 1)} %)` : ""}</div>
            ${x.by ? (() => { const bm = Math.max(...x.by.map((b) => Math.max(Math.abs(b.before), Math.abs(b.after))), 0) || 1;
              return `<ul class="in-wi-by">${x.by.slice(0, 12).map((b) => `<li><span class="l" title="${esc(b.value)}">${esc(b.value)}</span>
                <span class="bars"><i class="before" style="--w:${(Math.abs(b.before) / bm * 100).toFixed(1)}%"></i><i class="after ${dirCls(b.delta)}" style="--w:${(Math.abs(b.after) / bm * 100).toFixed(1)}%"></i></span>
                <span class="d ${dirCls(b.delta)}">${nf(b.before)} → <b>${nf(b.after)}</b></span></li>`).join("")}</ul>`; })() : ""}
          </div>`;
        }).join("")}
        <ul class="in-why">${r.story.map((s) => `<li class="why"><span>💡</span><p>${esc(s)}</p></li>`).join("")}</ul>
        <p class="in-muted">${esc(r.note)}</p>
      </div>`;
    requestAnimationFrame(() => $("#siOut .in-wi")?.classList.add("go"));
  }

  /* =============================== 3 · Actuar =============================== */
  async function tabAccion() {
    const q = st.rowsQ || {};
    const s0 = Object.entries(q.selections || {});
    body.innerHTML = `
      ${st.rowsFrom ? `<div class="in-from"><span>Viene de <b>Qué cambió</b>: ${esc(st.rowsFrom)}</span><button type="button" class="in-link" id="rwBack">← volver</button></div>` : ""}
      <form class="in-card in-rw" id="rwForm">
        <div class="in-rw-top">
          <label>Tabla<select name="table"><option value="">Automática</option>${st.tables.map((t) => `<option ${q.table === t ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
          <label class="grow">Condición por fila (opcional)<input name="where" value="${esc(q.where || "")}" placeholder="[probabilidad_retiro] > 0.6"/></label>
          <label>Ordenar por (mayor primero)<select name="sort">${fieldOpts(null, q.sort || "", "Sin orden")}</select></label>
        </div>
        <div class="in-rw-f"><span class="in-dims-l">Filtros</span><div class="in-sels" id="rwSels"></div><button type="button" class="in-link" id="rwAddSel">＋ filtro</button></div>
        <details class="in-rw-cols"><summary>Columnas a mostrar</summary><input name="fields" value="${esc((q.fields || []).join(", "))}" placeholder="cedula, periodo, probabilidad_retiro (vacío = todas)"/></details>
        <div class="in-rw-act">
          <button class="in-btn" type="submit">Buscar registros</button>
          <button type="button" class="in-btn ghost" id="rwCsv">⬇ Exportar CSV</button>
          ${canEdit ? `<button type="button" class="in-btn ghost" id="rwSave">Guardar como lista</button>` : ""}
          <span class="in-err" id="rwErr" role="alert"></span>
        </div>
      </form>
      <div id="rwOut"></div>
      <div class="in-card"><h3>Listas guardadas <small>búsquedas que puedes reabrir, exportar o enviar a un webhook</small></h3><div id="rwLists"><div class="in-loading">Cargando…</div></div></div>`;
    $("#rwBack")?.addEventListener("click", () => go("cambio"));
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
    const search = async () => {
      $("#rwErr").textContent = ""; $("#rwOut").innerHTML = `<div class="in-card"><div class="in-loading"><span class="in-spin"></span> Buscando…</div></div>`;
      try { const b = read(); const r = await api.insightRows(ctx.appId, b); if (!form.isConnected) return; st.rowsQ = { ...b, table: r.table }; paintRows(r); }
      catch (x) { if (!form.isConnected) return; $("#rwOut").innerHTML = ""; $("#rwErr").textContent = x.message; }
    };
    form.addEventListener("submit", (e) => { e.preventDefault(); search(); });
    $("#rwCsv").addEventListener("click", async () => {
      try { $("#rwErr").textContent = ""; await api.downloadRowsCsv(ctx.appId, { ...read(), limit: 10000 }, "registros"); toast("CSV descargado"); } catch (x) { $("#rwErr").textContent = x.message; }
    });
    $("#rwSave")?.addEventListener("click", () => saveListModal(read()));
    search();
    loadLists();
  }

  function saveListModal(b) {
    const m = modal({
      title: "Guardar como lista",
      body: `<form class="in-mform" id="slForm">
        <label>Nombre<input name="name" required maxlength="120" placeholder="Conductores con riesgo alto de retiro"/></label>
        <label>Enviar a un webhook (opcional)<input name="hook" type="url" placeholder="https://… (Teams, Power Automate, Zapier, n8n)"/></label>
        <p class="in-muted">Una lista guardada se reabre con un clic, se exporta a CSV o se envía al webhook. Una alerta puede ejecutarla al dispararse. Para correos, WhatsApp o agentes de IA usa <a href="/pages/automatizaciones.html">Automatizaciones</a>.</p>
        <div class="in-err" id="slErr" role="alert"></div></form>`,
      actions: `<button type="button" class="q-btn" data-x>Cancelar</button><button type="button" class="q-btn primary" id="slOk">Guardar</button>`,
    });
    const f = m.el.querySelector("#slForm");
    const ok = async () => {
      const name = f.name.value.trim(); if (!name) { m.el.querySelector("#slErr").textContent = "Ponle un nombre."; return; }
      try {
        await api.createAction(ctx.appId, { name, table: b.table, selections: b.selections, where: b.where, fields: b.fields, sort: b.sort, ...(f.hook.value.trim() ? { webhook_url: f.hook.value.trim() } : {}) });
        m.close(); toast("Lista guardada"); loadLists();
      } catch (x) { m.el.querySelector("#slErr").textContent = x.message; }
    };
    m.el.querySelector("#slOk").addEventListener("click", ok);
    f.addEventListener("submit", (e) => { e.preventDefault(); ok(); });
    f.name.focus();
  }

  function paintRows(r) {
    $("#rwOut").innerHTML = `<div class="in-card">
      <div class="in-rw-h"><b class="in-big">${nf(r.total, 0)}</b><span>registro(s) de ${nf(r.table_rows, 0)} en <b>${esc(r.table)}</b>${r.truncated ? ` · se muestran los primeros ${r.rows.length}` : ""}</span></div>
      ${r.rows.length ? `<div class="in-scroll"><table class="in-tbl rows"><thead><tr>${r.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
        <tbody>${r.rows.map((row) => `<tr>${row.map((v) => `<td title="${esc(v)}">${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : `<div class="in-empty soft"><b>Ningún registro cumple los filtros.</b><span>Quita algún filtro o cambia la condición.</span></div>`}
    </div>`;
  }

  async function loadLists() {
    const host = $("#rwLists");
    if (!host) return;
    let lists = [];
    try { lists = await api.listActions(ctx.appId); } catch (x) { host.innerHTML = `<p class="in-err">${esc(x.message)}</p>`; return; }
    host.innerHTML = lists.length ? `<ul class="in-lists">${lists.map((a) => `
      <li data-id="${esc(a.id)}"><div><b>${esc(a.name)}</b>
        <small>${esc(a.table_name)}${Object.keys(a.selections || {}).length ? " · " + esc(Object.entries(a.selections).map(([k, v]) => `${display(k)} = ${v.join(", ")}`).join("; ")) : ""}${a.where_expr ? " · " + esc(a.where_expr) : ""}</small>
        <small>${nf(a.last_count, 0)} registro(s)${a.has_webhook ? ` · envía a ${esc(a.webhook_url)}` : ""}${a.last_run_at ? ` · ${when(a.last_run_at)}: ${esc(a.last_message || "")}` : ""}</small></div>
        <div class="in-l-act">
          <button type="button" class="in-btn ghost sm" data-open>Abrir</button>
          <button type="button" class="in-btn ghost sm" data-csv>CSV</button>
          ${canEdit && a.has_webhook ? `<button type="button" class="in-btn ghost sm" data-send>Enviar</button>` : ""}
          ${canEdit ? `<button type="button" class="in-btn ghost sm danger" data-del>Borrar</button>` : ""}
        </div></li>`).join("")}</ul>` : `<p class="in-muted">Aún no hay listas. Arma una búsqueda arriba y pulsa «Guardar como lista».</p>`;
    host.querySelectorAll("li").forEach((li) => {
      const a = lists.find((x) => x.id === li.dataset.id);
      li.querySelector("[data-open]").addEventListener("click", () => {
        st.rowsQ = { table: a.table_name, selections: a.selections, where: a.where_expr || undefined, fields: a.fields?.length ? a.fields : undefined, sort: a.sort_field || undefined };
        st.rowsFrom = null; tabAccion();
      });
      li.querySelector("[data-csv]").addEventListener("click", () => api.downloadActionCsv(ctx.appId, a.id, a.name).then(() => toast("CSV descargado")).catch((x) => toast(x.message, "err")));
      li.querySelector("[data-send]")?.addEventListener("click", async (e) => {
        const b = e.currentTarget; b.disabled = true;
        try { const r = await api.runAction(ctx.appId, a.id, true); toast(r.message, r.ok === false ? "err" : "ok"); } catch (x) { toast(x.message, "err"); }
        loadLists();
      });
      li.querySelector("[data-del]")?.addEventListener("click", async () => {
        if (!(await confirmBox({ title: "Borrar lista", message: `¿Borrar la lista «${esc(a.name)}»?`, okLabel: "Borrar", danger: true }))) return;
        try { await api.deleteAction(ctx.appId, a.id); toast("Lista borrada"); loadLists(); } catch (x) { toast(x.message, "err"); }
      });
    });
  }

  /* =============================== 4 · Vigilar =============================== */
  async function tabGuardia() {
    body.innerHTML = `<div class="in-card"><div class="in-loading"><span class="in-spin"></span> Cargando…</div></div>`;
    let w = null;
    try { w = (await api.getWatchdog(ctx.appId)).watchdog; } catch {}
    const chosen = new Set(w?.measures || []);
    const on = !!w?.enabled;
    const th = Number(w?.threshold_pct ?? 15);
    body.innerHTML = `
      <div class="in-card in-wd ${on ? "on" : ""}">
        <div class="in-wd-top">
          <span class="in-wd-ico" aria-hidden="true">${on ? "🛡" : "💤"}</span>
          <div><h2>${on ? "El agente está vigilando" : w ? "El agente está en pausa" : "Activa un agente que vigile tus cifras"}</h2>
            <p class="in-muted">Después de cada carga de datos (y al menos una vez al día) compara el último periodo con el anterior. Si una métrica cambia más que el umbral, o los datos tienen problemas graves, te avisa en la campana 🔔 con el porqué.</p></div>
          ${canEdit ? `<label class="in-sw" title="Activar o pausar"><input type="checkbox" id="wdOn" ${on || !w ? "checked" : ""}/><i></i></label>` : ""}
        </div>
        <div class="in-wd-cfg">
          <label class="in-wd-th">Avisar si una métrica cambia más de <b id="wdThV">${nf(th, 1)} %</b>
            <input type="range" id="wdTh" min="1" max="60" step="1" value="${Math.min(60, Math.max(1, th))}" ${canEdit ? "" : "disabled"}/>
            <span class="in-wd-scale"><span>sensible</span><span>solo lo grande</span></span></label>
          <div class="in-wd-ms"><span class="in-dims-l">Métricas a vigilar ${chosen.size ? "" : "<small>(ninguna elegida = las certificadas; si no hay, todas las maestras)</small>"}</span>
            <div class="in-chips">${st.masters.length ? st.masters.map((m) => `<button type="button" class="in-chip ${chosen.has(m.id) ? "on" : ""}" data-ms="${esc(m.id)}" ${canEdit ? "" : "disabled"}>${m.certified ? "✓ " : ""}${esc(m.name)}</button>`).join("") : `<span class="in-muted">No hay medidas maestras: vigilará los registros y los totales.</span>`}</div></div>
        </div>
        <div class="in-wd-act">
          ${canEdit ? `<button type="button" class="in-btn" id="wdSave">${w ? "Guardar" : "Activar el agente"}</button>` : ""}
          <button type="button" class="in-btn ghost" id="wdRun">▶ Revisar ahora</button>
          ${canEdit && w ? `<button type="button" class="in-btn ghost danger" id="wdOff">Apagar</button>` : ""}
          <span class="in-err" id="wdErr" role="alert"></span>
        </div>
        <a class="in-wd-more" href="/pages/automatizaciones.html">¿Quieres el aviso por correo, WhatsApp o Teams, o que un agente de IA escriba el informe? Crea una automatización →</a>
      </div>
      <div id="wdOut"></div>`;
    $("#wdTh").addEventListener("input", (e) => { $("#wdThV").textContent = `${e.target.value} %`; });
    body.querySelectorAll("[data-ms]").forEach((b) => b.addEventListener("click", () => b.classList.toggle("on")));
    const paint = (s) => {
      if (!s) { $("#wdOut").innerHTML = ""; return; }
      $("#wdOut").innerHTML = `<div class="in-card"><h3>Última revisión <small>${when(s.checked_at)} · umbral ${nf(s.threshold_pct)} %</small></h3>
        ${s.headline?.length ? `<ul class="in-why">${s.headline.map((h) => `<li class="counter"><span>⚠</span><p>${esc(h)}</p></li>`).join("")}</ul>` : `<p class="in-okmsg">✓ Todo en calma: sin cambios fuertes ni problemas graves.</p>`}
        <div class="in-wd-grid">${(s.measures || []).map((m) => m.error ? `<div class="in-wd-m bad"><b>${esc(m.label)}</b><small>${esc(m.error)}</small></div>`
          : `<div class="in-wd-m ${m.flag ? "flag" : ""}"><b>${esc(m.label)}</b><span class="v">${nf(m.current_value)}</span><small>antes ${nf(m.previous_value)} · ${esc(m.previous)} → ${esc(m.current)}</small>
            <em class="in-delta ${dirCls(m.change)}">${m.change > 0 ? "▲" : m.change < 0 ? "▼" : "＝"} ${nf(m.change)} ${esc(m.unit)}</em>${m.flag ? `<span class="in-pill warn">Aviso</span>` : `<span class="in-pill ok">En calma</span>`}</div>`).join("")}</div>
        <p class="in-muted">Salud de datos: <b>${s.health_score ?? "—"}/100</b>${s.health_critical?.length ? " · " + s.health_critical.map(esc).join(" · ") : ""}</p></div>`;
    };
    paint(w?.last_summary);
    $("#wdSave")?.addEventListener("click", async () => {
      try {
        await api.saveWatchdog(ctx.appId, { threshold_pct: Number($("#wdTh").value), enabled: $("#wdOn").checked, measures: [...body.querySelectorAll("[data-ms].on")].map((b) => b.dataset.ms) });
        toast($("#wdOn").checked ? "Agente de guardia activo" : "Agente en pausa"); tabGuardia();
      } catch (x) { $("#wdErr").textContent = x.message; }
    });
    $("#wdRun").addEventListener("click", async (e) => {
      const b = e.currentTarget; b.disabled = true; b.innerHTML = `<span class="in-spin"></span> Revisando…`;
      try { paint(await api.runWatchdog(ctx.appId)); } catch (x) { $("#wdErr").textContent = x.message; }
      b.disabled = false; b.textContent = "▶ Revisar ahora";
    });
    $("#wdOff")?.addEventListener("click", async () => {
      if (!(await confirmBox({ title: "Apagar el agente", message: "¿Apagar el agente de guardia? Dejará de revisar tus métricas.", okLabel: "Apagar", danger: true }))) return;
      await api.deleteWatchdog(ctx.appId); toast("Agente apagado"); tabGuardia();
    });
  }

  paintTabs();
}

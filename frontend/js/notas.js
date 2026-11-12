// notas.js — «Notas para agente»: el diccionario de datos de cada aplicación.
//
// Al cargar datos en una app, aquí aparecen sus tablas y columnas. Para cada una se escribe qué significa, de qué
// tipo es (identificador, dimensión, medida, fecha…), cómo se le llama en el negocio y con qué otras columnas se
// puede cruzar. El asistente de IA y los agentes MCP reciben ese texto como contexto: así saben qué es cada campo
// y cómo modelar/fusionar los datos sin adivinar.
//
//  · Lista de aplicaciones con su cobertura de documentación.
//  · Editor por app: contexto del negocio, descripción de tablas, columnas y cruces (con sugerencias por nombre).
//  · «Autocompletar con IA»: propone borradores que se revisan antes de aplicar (nunca guarda solo).

import { renderNav, wireAppsButton, renderProfileMenu, svg } from "./hub-nav.js";
import { authService } from "./auth-service.js";
import * as api from "./api.js";
import { esc, norm, toast, modal, confirmBox, fmtDate } from "./ui-kit.js";

if (!authService.isAuthenticated()) location.replace("index.html");
if (!authService.can("charts:edit")) location.replace("inicio.html");

const main = document.getElementById("main");

const SEM = {
  id: ["Identificador", "Clave que identifica cada fila o registro (p. ej. id_cliente)."],
  dimension: ["Dimensión", "Atributo por el que se agrupa o filtra (p. ej. ciudad, producto)."],
  measure: ["Medida", "Número que se suma, promedia o cuenta (p. ej. ventas, cantidad)."],
  date: ["Fecha", "Momento en el tiempo (p. ej. fecha de pedido)."],
  category: ["Categoría", "Valor de una lista cerrada (p. ej. estado, tipo)."],
  text: ["Texto libre", "Comentarios o descripciones sin lista cerrada."],
  flag: ["Indicador", "Sí/No, verdadero/falso o 0/1."],
};
const semLabel = (s) => (SEM[s] ? SEM[s][0] : "Sin clasificar");

const st = {
  view: "apps",          // apps | edit
  apps: [], cover: {},   // appId -> {pct, documented, columns}
  app: null, data: null, // app abierta y su diccionario
  dirty: new Set(),      // "tabla\u0001columna" | "tabla\u0001" | "\u0001app"
  q: "", open: new Set(), loading: true, saving: false, ai: false,
};
const K = (t, c = "") => `${t}\u0001${c}`;
const isDirty = () => st.dirty.size > 0;

/* ----------------------- Datos ----------------------- */
async function loadApps() {
  try {
    st.apps = (await api.listApps()).filter((a) => a.stage !== undefined || true);
    st.loading = false; render();
    await Promise.all(st.apps.map(async (a) => {
      try { const n = await api.getNotes(a.id); st.cover[a.id] = { ...n.coverage, tables: n.tables.length }; } catch { st.cover[a.id] = null; }
    }));
  } catch (e) { st.loading = false; st.error = e.message; }
  render();
}

async function openApp(app) {
  st.app = app; st.view = "edit"; st.loading = true; st.dirty.clear(); st.q = ""; st.open = new Set();
  history.replaceState(null, "", `?app=${encodeURIComponent(app.id)}`);
  render();
  try {
    st.data = await api.getNotes(app.id);
    if (st.data.tables.length === 1) st.open.add(st.data.tables[0].name);
  } catch (e) { toast(e.message, "err"); st.data = null; }
  await loadVersions();
  st.loading = false; render();
  if (location.hash === "#versiones") setTimeout(() => main.querySelector("#ntVersions")?.scrollIntoView({ behavior: "smooth" }), 80);
}

async function backToApps() {
  if (isDirty() && !(await confirmBox({ title: "Cambios sin guardar", message: "Tienes notas sin guardar. Si sales, se pierden.", okLabel: "Salir sin guardar", danger: true }))) return;
  st.view = "apps"; st.app = null; st.data = null; st.dirty.clear();
  history.replaceState(null, "", location.pathname);
  loadApps();
}

async function save() {
  if (!isDirty() || st.saving) return;
  st.saving = true; render();
  const payload = { tables: [] };
  const byTable = new Map();
  for (const key of st.dirty) {
    const [t, c] = key.split("\u0001");
    if (!t && key === K("", "")) continue;
    if (!t) { payload.app_text = st.data.app_text; continue; }
    const tb = st.data.tables.find((x) => x.name === t);
    if (!tb) continue;
    if (!byTable.has(t)) byTable.set(t, { name: t, columns: [] });
    const out = byTable.get(t);
    if (!c) { out.description = tb.description; out.grain = tb.grain; continue; }
    const col = tb.columns.find((x) => x.name === c);
    if (col) out.columns.push({ name: c, description: col.description, semantic: col.semantic, synonyms: col.synonyms, joins: col.joins });
  }
  if (st.dirty.has(K("", "app"))) payload.app_text = st.data.app_text;
  payload.tables = [...byTable.values()];
  try {
    st.data = await api.saveNotes(st.app.id, payload);
    st.dirty.clear();
    toast("Notas guardadas. El agente ya las usa.");
  } catch (e) { toast(e.message, "err"); }
  st.saving = false; render();
}

/* ----------------------- Render ----------------------- */
function render() {
  const keep = { x: window.scrollX, y: window.scrollY };
  main.innerHTML = st.view === "apps" ? appsView() : editView();
  wire();
  window.scrollTo(keep.x, keep.y);
}

const ring = (pct, size = 54) => {
  const r = 22, c = 2 * Math.PI * r, off = c * (1 - (pct || 0) / 100);
  return `<svg class="nt-ring" style="width:${size}px;height:${size}px;max-width:${size}px;flex:none" width="${size}" height="${size}" viewBox="0 0 56 56" aria-label="${pct || 0}% documentado"><circle cx="28" cy="28" r="${r}" class="bg"/>
    <circle cx="28" cy="28" r="${r}" class="fg" stroke-dasharray="${c}" stroke-dashoffset="${off}" transform="rotate(-90 28 28)"/><text x="28" y="32" text-anchor="middle">${pct || 0}%</text></svg>`;
};

/* =======================  LISTA DE APPS  ======================= */
function appsView() {
  const head = `<div class="q-greeting"><h1>Notas para agente</h1></div>
    <p class="cfg-sub">Explica a la IA qué significa cada columna y con qué se puede cruzar. El asistente y los agentes MCP leen estas notas para entender tus datos antes de analizarlos o modelarlos.</p>`;
  if (st.loading) return head + `<p class="cfg-muted">Cargando aplicaciones…</p>`;
  if (st.error) return head + `<div class="cfg-card cfg-pad"><p class="cn-status err">${esc(st.error)}</p></div>`;
  if (!st.apps.length) return head + `<div class="cfg-card cn-empty"><div class="cn-empty-ic">${svg("notes")}</div><h3>No hay aplicaciones todavía</h3><p>Crea una aplicación y carga datos; luego vuelve aquí para documentarlos.</p><a class="q-btn primary" href="crear.html">+ Crear aplicación</a></div>`;
  const q = norm(st.q);
  const list = st.apps.filter((a) => !q || norm(a.name).includes(q));
  return head + `
    <div class="cfg-bar">
      <div class="cfg-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input id="ntQ" type="search" placeholder="Buscar aplicación" value="${esc(st.q)}" aria-label="Buscar aplicación" /></div>
      <span class="cfg-count">${list.length} de ${st.apps.length}</span>
    </div>
    <div class="nt-apps">${list.map((a) => {
      const c = st.cover[a.id];
      const noData = c && c.columns === 0;
      return `<button type="button" class="nt-app" data-app="${esc(a.id)}">
        ${c ? ring(c.pct) : `<span class="nt-ring-ph"></span>`}
        <div class="nt-app-t"><h3>${esc(a.name)}</h3>
          <small>${c ? (noData ? "Sin datos cargados todavía" : `${c.tables} ${c.tables === 1 ? "tabla" : "tablas"} · ${c.documented} de ${c.columns} columnas documentadas`) : "Calculando…"}</small>
          <span class="ds-stage ${esc(a.stage || "personal")}"><span class="ds-stage-dot"></span>${{ personal: "Personal", desarrollo: "Desarrollo", produccion: "Producción" }[a.stage] || "Personal"}</span></div>
        <span class="nt-go">${svg("notes")}<em>${noData ? "Ver" : "Documentar"}</em></span></button>`;
    }).join("") || `<p class="cfg-muted">Ninguna aplicación coincide.</p>`}</div>`;
}

/* =======================  EDITOR  ======================= */
function colRow(t, c) {
  const joins = c.joins || [];
  const have = new Set(joins.map((j) => `${j.table}\u0001${j.column}`));
  const sugg = (c.auto_joins || []).filter((j) => !/^ML_/.test(j.table) && !have.has(`${j.table}\u0001${j.column}`));
  const key = K(t.name, c.name);
  return `<tr class="${c.documented ? "doc" : ""}" data-t="${esc(t.name)}" data-c="${esc(c.name)}">
    <td class="nt-col-n"><b>${esc(c.name)}</b>
      <small><span class="nt-type">${esc(c.type || "—")}</span>${c.distinct != null ? ` · ${c.distinct} distintos` : ""}</small>
      ${c.samples && c.samples.length ? `<small class="nt-samples" title="Valores de ejemplo">${c.samples.map(esc).join(" · ")}</small>` : ""}</td>
    <td><textarea class="nt-in" rows="2" data-f="description" placeholder="¿Qué representa esta columna? Unidad, regla de negocio…">${esc(c.description)}</textarea></td>
    <td><select data-f="semantic" aria-label="Tipo de ${esc(c.name)}"><option value="">Sin clasificar</option>
      ${Object.entries(SEM).map(([v, [l, d]]) => `<option value="${v}" title="${esc(d)}" ${c.semantic === v ? "selected" : ""}>${l}</option>`).join("")}</select></td>
    <td><input class="nt-in" data-f="synonyms" value="${esc(c.synonyms)}" placeholder="Otros nombres, separados por coma" /></td>
    <td><div class="nt-joins">
      ${joins.map((j, i) => `<span class="nt-chip" title="${esc(j.note || "")}">${svg("link")}${esc(j.table)}.${esc(j.column)}<button type="button" data-rm="${i}" aria-label="Quitar cruce">✕</button></span>`).join("")}
      ${sugg.map((j) => `<button type="button" class="nt-chip sug" data-sug="${esc(JSON.stringify([j.table, j.column]))}" title="Sugerido: mismo nombre de columna. Clic para agregarlo.">＋ ${esc(j.table)}.${esc(j.column)}</button>`).join("")}
      <button type="button" class="nt-add" data-addjoin title="Agregar un cruce manual">＋ Cruce</button>
    </div></td>
    <td class="nt-dirty">${st.dirty.has(key) ? `<i title="Sin guardar"></i>` : ""}</td>
  </tr>`;
}

function tableSection(t) {
  const q = norm(st.q);
  const cols = t.columns.filter((c) => !q || norm(c.name + " " + c.description + " " + c.synonyms).includes(q));
  if (q && !cols.length && !norm(t.name).includes(q)) return "";
  const doc = t.columns.filter((c) => c.documented).length;
  const open = st.open.has(t.name) || !!q;
  return `<details class="nt-table" data-tname="${esc(t.name)}" ${open ? "open" : ""}>
    <summary><span class="nt-tn">${svg("database")}<b>${esc(t.name)}</b></span>
      <span class="nt-meta">${t.rows != null ? `${t.rows.toLocaleString("es")} filas · ` : ""}${t.columns.length} columnas</span>
      <span class="nt-prog" title="${doc} de ${t.columns.length} documentadas"><i style="width:${t.columns.length ? Math.round(doc * 100 / t.columns.length) : 0}%"></i></span>
      <span class="nt-prog-t">${doc}/${t.columns.length}</span></summary>
    <div class="nt-tbody">
      <div class="nt-tgrid">
        <label>¿Qué contiene esta tabla?<textarea class="nt-in" rows="2" data-tf="description" placeholder="Ej.: Una fila por pedido realizado en la tienda online.">${esc(t.description)}</textarea></label>
        <label>Granularidad (una fila representa…)<input class="nt-in" data-tf="grain" value="${esc(t.grain)}" placeholder="Ej.: un pedido" /></label>
      </div>
      <div class="cfg-card nt-wrap"><table class="cfg-table nt-cols">
        <thead><tr><th>Columna</th><th>Qué significa</th><th>Tipo</th><th>También se llama</th><th>Se cruza con</th><th></th></tr></thead>
        <tbody>${cols.map((c) => colRow(t, c)).join("") || `<tr><td colspan="6" class="cfg-empty">Ninguna columna coincide.</td></tr>`}</tbody>
      </table></div>
    </div></details>`;
}

function editView() {
  const back = `<button type="button" class="cn-back" id="ntBack">‹ Todas las aplicaciones</button>`;
  if (st.loading || !st.data) return back + `<p class="cfg-muted">${st.loading ? "Cargando diccionario…" : "No se pudo cargar."}</p>`;
  const d = st.data, cov = d.coverage;
  const pct = (() => { const tot = d.tables.reduce((a, t) => a + t.columns.length, 0); const dc = d.tables.reduce((a, t) => a + t.columns.filter((c) => c.documented).length, 0); return tot ? Math.round(dc * 100 / tot) : 0; })();
  const empty = !d.tables.length;
  return `${back}
    <div class="nt-head">
      <div class="nt-head-l">${ring(pct, 62)}<div><h1>${esc(st.app.name)}</h1>
        <p>${empty ? "Esta aplicación aún no tiene datos." : `${d.tables.length} ${d.tables.length === 1 ? "tabla" : "tablas"} · ${cov.columns} columnas · ${pct}% documentado`}</p></div></div>
      <div class="nt-head-r">
        <button type="button" class="q-btn" id="ntCtx" ${empty ? "disabled" : ""}>${svg("eye")} Lo que recibe el agente</button>
        <button type="button" class="q-btn" id="ntAi" ${empty || st.ai ? "disabled" : ""}>${svg("predict")} ${st.ai ? "Pensando…" : "Autocompletar con IA"}</button>
        <button type="button" class="q-btn primary" id="ntSave" ${isDirty() && !st.saving ? "" : "disabled"}>${st.saving ? "Guardando…" : isDirty() ? `Guardar (${st.dirty.size})` : "Guardado"}</button>
      </div>
    </div>
    ${empty ? `<div class="cfg-card cn-empty"><div class="cn-empty-ic">${svg("database")}</div><h3>Primero carga datos</h3><p>Las columnas aparecen aquí cuando la aplicación tiene tablas cargadas (archivo, conexión o script).</p>
      <a class="q-btn primary" href="app.html?app=${encodeURIComponent(st.app.id)}#datos">Ir al Gestor de datos</a></div>` : `
    <div class="cfg-card cfg-pad nt-ctx">
      <label class="nt-lbl">Contexto del negocio <small>(opcional, para toda la app)</small>
        <textarea class="nt-in" id="ntApp" rows="3" placeholder="Ej.: Somos una cadena de tiendas en Colombia. Las ventas están en COP e incluyen IVA. El año fiscal empieza en febrero.">${esc(d.app_text)}</textarea></label>
    </div>
    <div class="cfg-bar" style="margin-top:16px">
      <div class="cfg-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input id="ntQ" type="search" placeholder="Buscar tabla o columna" value="${esc(st.q)}" aria-label="Buscar" /></div>
      <button type="button" class="q-btn" id="ntToggle">${st.open.size ? "Contraer todo" : "Expandir todo"}</button>
    </div>
    ${d.tables.map(tableSection).join("")}
    <p class="cfg-hint">Los <strong>cruces sugeridos</strong> salen de columnas con el mismo nombre en otras tablas. Las notas se guardan por aplicación y las leen el asistente de IA y los agentes MCP (<code>get_agent_context</code>).</p>`}
    ${versionsView()}`;
}

/* =======================  VERSIONES DEL SCRIPT (control de versiones)  ======================= */
async function loadVersions() {
  st.versions = null; st.verDetail = null;
  if (!authService.can("data:import")) return;
  try { st.versions = await api.listScriptVersions(st.app.id); } catch { st.versions = null; }
}

function versionsView() {
  if (!st.versions) return "";
  const v = st.versions;
  const head = v[0];
  return `<section class="vc" id="ntVersions">
    <div class="vc-head"><div><h2>${svg("script")} Versiones del script de carga</h2>
      <p>Cada vez que guardas el script con cambios se crea una versión nueva: queda como <b>principal</b> y la anterior baja al historial. Nada se borra; restaurar crea otra versión.</p></div>
      <a class="q-btn" href="app.html?app=${encodeURIComponent(st.app.id)}#editor">Abrir el editor de carga</a></div>
    ${v.length ? `<ol class="vc-line">${v.map((x) => `
      <li class="vc-item ${x.is_head ? "head" : ""} ${st.verDetail?.version === x.version ? "open" : ""}" data-v="${x.version}">
        <span class="vc-dot"></span>
        <div class="vc-card">
          <div class="vc-top"><span class="vc-tag">v${x.version}</span>${x.is_head ? `<span class="vc-head-tag">PRINCIPAL</span>` : ""}
            <b class="vc-msg">${esc(x.message)}</b>
            <span class="vc-diffc"><em class="add">+${x.added}</em><em class="del">−${x.removed}</em></span></div>
          <small>${esc(x.author_name || "—")} · ${esc(fmtDate(x.created_at))} · ${x.lines} líneas</small>
          <div class="vc-acts">
            <button type="button" class="q-btn sm2" data-vact="view">${st.verDetail?.version === x.version ? "Ocultar cambios" : "Ver cambios"}</button>
            ${x.is_head ? "" : `<button type="button" class="q-btn sm2" data-vact="restore" ${authService.can("data:import") ? "" : "disabled"}>Restaurar esta versión</button>`}
          </div>
          ${st.verDetail?.version === x.version ? diffView(st.verDetail) : ""}
        </div></li>`).join("")}</ol>`
      : `<div class="cfg-card cn-empty"><p>Aún no hay versiones. Se crea la primera al pulsar <b>Guardar script</b> en el editor de carga.</p></div>`}
    ${head ? `<p class="cfg-hint">Versión principal: <b>v${head.version}</b> · ${v.length} ${v.length === 1 ? "versión" : "versiones"} en total.</p>` : ""}
  </section>`;
}

function diffView(d) {
  const ops = d.diff || [];
  const changed = ops.some((o) => o.op !== " ");
  // Contexto compacto: muestra cambios con 2 líneas alrededor; el resto se pliega.
  const keep = new Array(ops.length).fill(false);
  ops.forEach((o, i) => { if (o.op !== " ") for (let k = Math.max(0, i - 2); k <= Math.min(ops.length - 1, i + 2); k++) keep[k] = true; });
  let html = "", skipped = 0, ln = 0;
  ops.forEach((o, i) => {
    if (o.op !== "-") ln++;
    if (changed && !keep[i]) { skipped++; return; }
    if (skipped) { html += `<div class="vc-skip">··· ${skipped} línea${skipped === 1 ? "" : "s"} sin cambios</div>`; skipped = 0; }
    html += `<div class="vc-l ${o.op === "+" ? "add" : o.op === "-" ? "del" : ""}"><span class="vc-n">${o.op === "-" ? "" : ln}</span><span class="vc-op">${o.op === " " ? "" : o.op}</span><code>${esc(o.text) || "&nbsp;"}</code></div>`;
  });
  if (skipped) html += `<div class="vc-skip">··· ${skipped} línea${skipped === 1 ? "" : "s"} sin cambios</div>`;
  return `<div class="vc-diff">${d.version === 1 && !changed ? "" : ""}${html || `<div class="vc-skip">Sin cambios respecto a la versión anterior.</div>`}</div>`;
}

async function versionAction(version, act) {
  if (act === "view") {
    if (st.verDetail?.version === version) { st.verDetail = null; render(); return; }
    try { st.verDetail = await api.getScriptVersion(st.app.id, version); render(); } catch (e) { toast(e.message, "err"); }
    return;
  }
  if (act === "restore") {
    const ok = await confirmBox({ title: `Restaurar v${version}`, message: `Se creará una versión nueva con el contenido de <b>v${version}</b> y quedará como principal. La versión actual se conserva en el historial. Después pulsa <b>Cargar datos</b> en el editor para aplicarla.`, okLabel: "Restaurar" });
    if (!ok) return;
    try {
      const r = await api.restoreScriptVersion(st.app.id, version);
      toast(r.version_created ? `Restaurada: ahora la principal es v${r.version}.` : "Esa versión ya era igual a la principal.");
      await loadVersions(); render();
    } catch (e) { toast(e.message, "err"); }
  }
}

/* ----------------------- Eventos ----------------------- */
function findCol(tn, cn) {
  const t = st.data.tables.find((x) => x.name === tn);
  return { t, c: t ? t.columns.find((x) => x.name === cn) : null };
}
function markDirty(key) {
  st.dirty.add(key);
  const b = main.querySelector("#ntSave");
  if (b) { b.disabled = false; b.textContent = `Guardar (${st.dirty.size})`; }
}

function wire() {
  const q = main.querySelector("#ntQ");
  if (q) q.addEventListener("input", () => {
    st.q = q.value; const pos = q.selectionStart; render();
    const nq = main.querySelector("#ntQ"); nq.focus(); nq.setSelectionRange(pos, pos);
  });
  main.querySelectorAll("[data-app]").forEach((b) => b.addEventListener("click", () => openApp(st.apps.find((a) => a.id === b.dataset.app))));
  const back = main.querySelector("#ntBack");
  if (back) back.addEventListener("click", backToApps);
  main.querySelectorAll(".vc-item [data-vact]").forEach((b) => b.addEventListener("click", () =>
    versionAction(Number(b.closest(".vc-item").dataset.v), b.dataset.vact)));
  if (st.view !== "edit" || !st.data) return;

  const save_ = main.querySelector("#ntSave");
  if (save_) save_.addEventListener("click", save);
  const app = main.querySelector("#ntApp");
  if (app) app.addEventListener("input", () => { st.data.app_text = app.value; markDirty(K("", "app")); });
  main.querySelector("#ntCtx")?.addEventListener("click", showContext);
  main.querySelector("#ntAi")?.addEventListener("click", suggest);
  main.querySelector("#ntToggle")?.addEventListener("click", () => {
    st.open = st.open.size ? new Set() : new Set(st.data.tables.map((t) => t.name)); render();
  });
  main.querySelectorAll("details.nt-table").forEach((d) => d.addEventListener("toggle", () => {
    const n = d.dataset.tname; if (d.open) st.open.add(n); else st.open.delete(n);
    const tg = main.querySelector("#ntToggle"); if (tg) tg.textContent = st.open.size ? "Contraer todo" : "Expandir todo";
  }));
  // Campos de tabla
  main.querySelectorAll("[data-tf]").forEach((el) => el.addEventListener("input", () => {
    const t = st.data.tables.find((x) => x.name === el.closest("details").dataset.tname);
    t[el.dataset.tf] = el.value; markDirty(K(t.name));
  }));
  // Campos de columna
  main.querySelectorAll("tr[data-c] [data-f]").forEach((el) => el.addEventListener("input", () => {
    const tr = el.closest("tr"); const { c } = findCol(tr.dataset.t, tr.dataset.c);
    c[el.dataset.f] = el.value;
    if (el.dataset.f === "description") { c.documented = el.value.trim() !== ""; tr.classList.toggle("doc", c.documented); }
    markDirty(K(tr.dataset.t, tr.dataset.c));
    const d = tr.dataset.t; markDot(tr);
  }));
  main.querySelectorAll("tr[data-c] [data-rm]").forEach((b) => b.addEventListener("click", () => {
    const tr = b.closest("tr"); const { c } = findCol(tr.dataset.t, tr.dataset.c);
    c.joins.splice(+b.dataset.rm, 1); markDirty(K(tr.dataset.t, tr.dataset.c)); render();
  }));
  main.querySelectorAll("tr[data-c] [data-sug]").forEach((b) => b.addEventListener("click", () => {
    const tr = b.closest("tr"); const { c } = findCol(tr.dataset.t, tr.dataset.c);
    const [table, column] = JSON.parse(b.dataset.sug);
    c.joins.push({ table, column, note: "mismo nombre de columna" }); markDirty(K(tr.dataset.t, tr.dataset.c)); render();
  }));
  main.querySelectorAll("tr[data-c] [data-addjoin]").forEach((b) => b.addEventListener("click", () => {
    const tr = b.closest("tr"); addJoin(tr.dataset.t, tr.dataset.c);
  }));
}
function markDot(tr) {
  const cell = tr.querySelector(".nt-dirty");
  if (cell && !cell.firstChild) cell.innerHTML = `<i title="Sin guardar"></i>`;
}

function addJoin(tn, cn) {
  const { c } = findCol(tn, cn);
  const tables = st.data.tables;
  const m = modal({
    title: `Cruce de ${tn}.${cn}`,
    body: `<div class="cfg-form">
      <label>Tabla<select id="jT">${tables.map((t) => `<option value="${esc(t.name)}">${esc(t.name)}</option>`).join("")}</select></label>
      <label>Columna<select id="jC"></select></label>
      <label>Nota (opcional)<input id="jN" placeholder="Ej.: relación 1 a muchos; usar LEFT JOIN" /></label></div>`,
    actions: `<button type="button" class="q-btn" data-x>Cancelar</button><button type="button" class="q-btn primary" id="jOk">Agregar</button>`,
  });
  const jT = m.el.querySelector("#jT"), jC = m.el.querySelector("#jC");
  const fill = () => { const t = tables.find((x) => x.name === jT.value); jC.innerHTML = t.columns.map((x) => `<option>${esc(x.name)}</option>`).join(""); };
  jT.addEventListener("change", fill); fill();
  m.el.querySelector("#jOk").addEventListener("click", () => {
    if (jT.value === tn && jC.value === cn) { toast("Elige otra columna distinta.", "err"); return; }
    c.joins.push({ table: jT.value, column: jC.value, note: m.el.querySelector("#jN").value.trim() });
    markDirty(K(tn, cn)); m.close(); render();
  });
}

async function showContext() {
  try {
    if (isDirty()) toast("Guarda primero para ver exactamente lo que recibe el agente.", "err");
    const r = await api.getNotesContext(st.app.id);
    modal({
      title: "Lo que recibe el agente", wide: true,
      body: `<p class="cfg-hint" style="margin-top:0">Este texto se añade al contexto del asistente de IA (y lo devuelve la herramienta MCP <code>get_agent_context</code>).</p>
        ${r.empty ? `<p class="cfg-muted">Todavía no hay notas guardadas.</p>` : `<pre class="nt-pre">${esc(r.text)}</pre>`}`,
      actions: `<button type="button" class="q-btn" data-x>Cerrar</button>`,
    });
  } catch (e) { toast(e.message, "err"); }
}

async function suggest() {
  st.ai = true; render();
  try {
    const r = await api.suggestNotes(st.app.id, {});
    st.ai = false; render();
    if (!r.ok) { toast(r.message || "La IA no pudo proponer notas.", "err"); return; }
    const items = [];
    for (const pt of r.tables || []) {
      const t = st.data.tables.find((x) => x.name === pt.name); if (!t) continue;
      if (pt.description && !String(t.description).trim()) items.push({ kind: "t", t, text: pt.description });
      for (const pc of pt.columns || []) {
        const c = t.columns.find((x) => x.name === pc.name);
        if (c && !c.documented && (pc.description || pc.semantic)) items.push({ kind: "c", t, c, text: pc.description, semantic: pc.semantic });
      }
    }
    if (!items.length) { toast(r.message || "Todo está documentado.", "ok"); return; }
    const m = modal({
      title: "Borradores de la IA", wide: true,
      body: `<p class="cfg-hint" style="margin-top:0">Revisa y desmarca lo que no sirva. Solo se rellenan campos vacíos; nada se guarda hasta que pulses <strong>Guardar</strong>.</p>
        <ul class="nt-sug">${items.map((it, i) => `<li><label><input type="checkbox" data-i="${i}" checked />
          <span><b>${esc(it.t.name)}${it.kind === "c" ? "." + esc(it.c.name) : ""}</b>${it.semantic ? ` <em>${esc(semLabel(it.semantic))}</em>` : ""}<br>${esc(it.text)}</span></label></li>`).join("")}</ul>`,
      actions: `<button type="button" class="q-btn" data-x>Cancelar</button><button type="button" class="q-btn primary" id="aiOk">Aplicar seleccionados</button>`,
    });
    m.el.querySelector("#aiOk").addEventListener("click", () => {
      let n = 0;
      m.el.querySelectorAll("input[data-i]:checked").forEach((cb) => {
        const it = items[+cb.dataset.i];
        if (it.kind === "t") { it.t.description = it.text; st.dirty.add(K(it.t.name)); }
        else { it.c.description = it.text || it.c.description; if (it.semantic) it.c.semantic = it.semantic; it.c.documented = !!String(it.c.description).trim(); st.dirty.add(K(it.t.name, it.c.name)); st.open.add(it.t.name); }
        n++;
      });
      m.close(); render(); toast(`${n} borradores aplicados. Revisa y guarda.`);
    });
  } catch (e) { st.ai = false; render(); toast(e.message, "err"); }
}

window.addEventListener("beforeunload", (e) => { if (isDirty()) { e.preventDefault(); e.returnValue = ""; } });

/* ----------------------- Arranque ----------------------- */
renderNav("nav", { active: "notas" });
wireAppsButton();
renderProfileMenu(authService);
(async () => {
  render();
  const id = new URLSearchParams(location.search).get("app");
  await loadApps();
  if (id) { const a = st.apps.find((x) => x.id === id); if (a) openApp(a); }
})();

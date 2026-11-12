// conexiones.js — módulo Conexiones. Las conexiones son del USUARIO: se crean una vez y sirven en todos
// sus proyectos. Solo las ve quien las creó y con quien las comparta (ni siquiera el administrador ve las
// privadas de otros: contienen credenciales). Pueden crearlas quienes tienen el permiso `connections:manage`
// (administrador y desarrollador por defecto).
//
//  · Mis conexiones: propias y compartidas conmigo; probar, editar, compartir y eliminar.
//  · Catálogo: conectores agrupados por proveedor (AWS, Microsoft, Google, bases de datos, APIs, IA y MCP).
//  · Conectar un agente: configuración para que un agente de IA use DataSense por MCP.

import { renderNav, wireAppsButton, renderProfileMenu, svg } from "./hub-nav.js";
import { authService } from "./auth-service.js";
import * as api from "./api.js";
import { makeModalHost } from "./conn-hub.js";
import { openConnectionWizard, PROVIDERS, connectorById, connectorTile, providerOf, isReady } from "./connections.js";
import { esc, norm, initials, fmtDate, toast, modal, confirmBox, copyText } from "./ui-kit.js";

if (!authService.isAuthenticated()) location.replace("index.html");
if (!authService.can("connections:manage")) location.replace("inicio.html");

const main = document.getElementById("main");
const st = { tab: "mias", conns: [], q: "", prov: "", loading: true, error: "" };

async function load() {
  try { st.conns = await api.listAllConnections(); st.error = ""; } catch (e) { st.error = e.message; }
  st.loading = false;
}

/* ----------------------- Estructura ----------------------- */
function tabs() {
  const list = [["mias", "Mis conexiones", "plug"], ["catalogo", "Catálogo de conectores", "catalog"], ["agente", "Conectar un agente", "assist"]];
  return `<div class="cfg-tabs" role="tablist">${list.map(([id, label, ic]) =>
    `<button type="button" class="cfg-tab ${st.tab === id ? "on" : ""}" role="tab" aria-selected="${st.tab === id}" data-tab="${id}">${svg(ic)}<span>${label}</span></button>`).join("")}</div>`;
}

function render() {
  const body = { mias: miasView, catalogo: catalogView, agente: agenteView }[st.tab]();
  main.innerHTML = `
    <div class="q-greeting"><h1>Conexiones</h1></div>
    <p class="cfg-sub">Conéctate una vez y úsalo en todos tus proyectos. Cada conexión es tuya: solo la ves tú y las personas con las que decidas compartirla.</p>
    ${tabs()}
    <div class="cfg-pane">${body}</div>`;
  wire();
}

/* =======================  MIS CONEXIONES  ======================= */
function visibleConns() {
  const q = norm(st.q);
  return st.conns.filter((c) => (!st.prov || providerOf(c.connector)?.id === st.prov)
    && (!q || norm(`${c.name} ${c.connector} ${c.space} ${c.owner_name}`).includes(q)));
}

function connCard(c) {
  const meta = connectorById(c.connector);
  const shared = c.shared_with || [];
  const mine = c.mine !== false;
  const ready = isReady(c.connector);
  return `<article class="cn-card ${mine ? "" : "foreign"}" data-id="${esc(c.id)}">
    <div class="cn-card-top">
      ${connectorTile(c.connector, "lg")}
      <div class="cn-card-t"><h3 title="${esc(c.name)}">${esc(c.name)}</h3>
        <small>${esc(meta?.name || c.connector)} · ${esc(providerOf(c.connector)?.label || "")}</small></div>
      <i class="cn-badge ${ready ? "ready" : "soon"}" title="${ready ? "Conecta de verdad" : "Guarda la configuración; aún no se conecta"}">${ready ? "Disponible" : "Vista previa"}</i>
    </div>
    <div class="cn-card-meta">
      <span class="cn-owner ${mine ? "mine" : ""}">${mine ? svg("lock") + "Tuya" : svg("share") + "Compartida por " + esc(c.owner_name || "otro usuario")}</span>
      ${c.space ? `<span class="cn-space" title="Espacio">${esc(c.space)}</span>` : ""}
    </div>
    ${mine ? `<div class="cn-shared">${shared.length
      ? `<div class="cn-avs">${shared.slice(0, 4).map((u) => `<span class="cfg-avatar sm" title="${esc(u.name)}">${esc(initials(u.name))}</span>`).join("")}</div>
         <span>Compartida con ${shared.length === 1 ? esc(shared[0].name) : shared.length + " personas"}</span>`
      : `<span class="cn-priv">${svg("lock")} Privada: solo tú la ves</span>`}</div>` : ""}
    <div class="cn-card-foot">
      <small>${esc(fmtDate(c.created_at, false))}</small>
      <div class="cfg-actions">
        <button type="button" class="cfg-icon" data-act="test" title="Probar conexión" aria-label="Probar ${esc(c.name)}">${svg("refresh")}</button>
        ${mine ? `<button type="button" class="cfg-icon" data-act="share" title="Compartir" aria-label="Compartir ${esc(c.name)}">${svg("share")}</button>
        <button type="button" class="cfg-icon" data-act="edit" title="Editar" aria-label="Editar ${esc(c.name)}">${svg("settings")}</button>
        <button type="button" class="cfg-icon danger" data-act="del" title="Eliminar" aria-label="Eliminar ${esc(c.name)}">${svg("trash")}</button>` : ""}
      </div>
    </div>
  </article>`;
}

function miasView() {
  if (st.loading) return `<p class="cfg-muted">Cargando conexiones…</p>`;
  if (st.error) return `<div class="cfg-card cfg-pad"><p class="cn-status err">${esc(st.error)}</p></div>`;
  const list = visibleConns();
  const mine = st.conns.filter((c) => c.mine !== false).length;
  const bar = `
    <div class="cfg-bar">
      <div class="cfg-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input id="cnQ" type="search" placeholder="Buscar por nombre, conector o espacio" value="${esc(st.q)}" aria-label="Buscar conexiones" /></div>
      <select id="cnProv" aria-label="Filtrar por proveedor"><option value="">Todos los proveedores</option>
        ${PROVIDERS.map((p) => `<option value="${p.id}" ${st.prov === p.id ? "selected" : ""}>${esc(p.label)}</option>`).join("")}</select>
      <span class="cfg-count">${list.length} de ${st.conns.length} · ${mine} tuyas</span>
      <button type="button" class="q-btn primary" id="cnNew">+ Nueva conexión</button>
    </div>`;
  if (!st.conns.length) {
    return bar + `<div class="cfg-card cn-empty">
      <div class="cn-empty-ic">${svg("plug")}</div>
      <h3>Aún no tienes conexiones</h3>
      <p>Crea una conexión a Amazon S3, Athena, una base de datos o una API y úsala en cualquiera de tus aplicaciones.</p>
      <button type="button" class="q-btn primary" id="cnNew2">+ Crear mi primera conexión</button></div>`;
  }
  if (!list.length) return bar + `<div class="cfg-card cn-empty"><p>Ninguna conexión coincide con el filtro.</p></div>`;
  // Agrupadas por proveedor para que sea fácil de recorrer.
  const groups = PROVIDERS.map((p) => ({ p, items: list.filter((c) => providerOf(c.connector)?.id === p.id) }))
    .concat([{ p: { id: "otros", label: "Otros", color: "#64748b" }, items: list.filter((c) => !providerOf(c.connector)) }])
    .filter((g) => g.items.length);
  return bar + groups.map((g) => `
    <section class="cn-group" style="--cn-c:${g.p.color}">
      <h2 class="cn-group-h"><span class="cn-prov-dot"></span>${esc(g.p.label)}<em>${g.items.length}</em></h2>
      <div class="cn-cards">${g.items.map(connCard).join("")}</div>
    </section>`).join("");
}

/* =======================  CATÁLOGO  ======================= */
function catalogView() {
  return `<p class="cfg-hint cn-cat-hint">Elige un conector para crear una conexión. Los marcados <i class="cn-badge ready">Disponible</i> se conectan de verdad;
    los de <i class="cn-badge soon">Vista previa</i> guardan la configuración pero aún no abren la conexión (verás un aviso claro, nunca un resultado falso).</p>`
    + PROVIDERS.map((p) => `
    <section class="cn-prov cn-prov-big" style="--cn-c:${p.color}">
      <header class="cn-prov-h"><span class="cn-prov-dot"></span><strong>${esc(p.label)}</strong><small>${esc(p.hint)}</small></header>
      <div class="cn-tiles">${p.items.map(connectorById).filter(Boolean).map((c) => `
        <button type="button" class="cn-pick" data-new="${c.id}">
          ${connectorTile(c.id)}
          <span class="cn-pick-t"><b>${esc(c.name)}</b><i class="cn-badge ${isReady(c.id) ? "ready" : "soon"}">${isReady(c.id) ? "Disponible" : "Vista previa"}</i></span>
        </button>`).join("")}</div>
    </section>`).join("");
}

/* =======================  CONECTAR UN AGENTE  ======================= */
function agenteView() {
  const base = location.origin;
  const cfg = JSON.stringify({
    mcpServers: {
      datasense: {
        command: "node",
        args: ["<ruta-al-proyecto>/mcp-server/dist/src/index.js"],
        env: { DATASENSE_BASE_URL: base, DATASENSE_USER: "tu-correo@empresa.com", DATASENSE_PASSWORD: "tu-contraseña" },
      },
    },
  }, null, 2);
  return `
    <div class="cfg-card cfg-pad cn-agent">
      <h3>${svg("assist")} Usa DataSense desde un agente de IA</h3>
      <p>DataSense incluye un servidor <strong>MCP</strong> (Model Context Protocol) con todas las acciones de la plataforma: crear aplicaciones, cargar datos,
        consultar, crear hojas, compartir conexiones, escribir notas para el agente y más. Cualquier agente compatible (Kiro, Claude, etc.) puede usarlo.</p>
      <ol class="cn-steps">
        <li>Compila el servidor una vez: <code>npm install &amp;&amp; npm run build</code> dentro de <code>mcp-server/</code>.</li>
        <li>Agrega este bloque a la configuración MCP de tu agente (en Kiro: <code>~/.kiro/settings/mcp.json</code>).</li>
        <li>Reconecta el servidor <code>datasense</code> desde el panel MCP del agente.</li>
      </ol>
      <div class="cn-code"><button type="button" class="cn-code-copy" id="cnCopyCfg">${svg("copy")} Copiar</button><pre><code>${esc(cfg)}</code></pre></div>
      <p class="cfg-hint">El agente entra con la cuenta que pongas en <code>DATASENSE_USER</code> y <strong>solo ve las conexiones de esa cuenta</strong> (propias y compartidas con ella).
        Para que un agente entienda tus datos, documenta las columnas en <a href="notas.html">Notas para agente</a>.</p>
    </div>
    <div class="cfg-card cfg-pad cn-agent">
      <h3>${svg("plug")} Que DataSense use un servidor MCP externo</h3>
      <p>También puedes registrar servidores MCP de otros (stdio o HTTP/SSE) como conexión para tenerlos guardados junto a tus demás conectores.</p>
      <div class="cn-tiles">${["mcp-stdio", "mcp-http"].map(connectorById).map((c) => `
        <button type="button" class="cn-pick" data-new="${c.id}">${connectorTile(c.id)}<span class="cn-pick-t"><b>${esc(c.name)}</b><i class="cn-badge soon">Vista previa</i></span></button>`).join("")}</div>
    </div>`;
}

/* ----------------------- Acciones ----------------------- */
let host = null;
function newConn(connector) {
  host = makeModalHost();
  openConnectionWizard(null, host, async (created) => {
    await load(); st.tab = "mias"; render();
    if (created?.id) flash(created.id);
  }, connector ? { connector } : {});
}
function flash(id) {
  const el = main.querySelector(`[data-id="${CSS.escape(id)}"]`);
  if (el) { el.scrollIntoView({ block: "center", behavior: "smooth" }); el.classList.add("cn-flash"); setTimeout(() => el.classList.remove("cn-flash"), 2200); }
}

async function testConn(c, btn) {
  btn.disabled = true;
  try {
    const r = await api.browseConnection(c.id, {});
    if (r.ok) toast(`«${c.name}»: conexión correcta${r.items ? ` (${r.items.length} ${r.level === "database" ? "bases de datos" : "objetos"} visibles)` : ""}.`);
    else toast(`«${c.name}»: ${r.message || "no se pudo conectar."}`, "err");
  } catch (e) { toast(`«${c.name}»: ${e.message}`, "err"); }
  btn.disabled = false;
}

async function shareConn(c) {
  let targets = [];
  try { targets = await api.connectionShareTargets(); } catch (e) { toast(e.message, "err"); return; }
  const cur = new Set((c.shared_with || []).map((u) => u.user_id));
  const m = modal({
    title: `Compartir «${c.name}»`,
    body: `<p class="cfg-hint" style="margin-top:0">Quien reciba la conexión podrá <strong>usarla</strong> (explorar y cargar datos) en sus proyectos, pero no editarla, eliminarla ni compartirla. Tus credenciales no se muestran.</p>
      ${targets.length ? `<ul class="cn-targets">${targets.map((u) => `
        <li><label><input type="checkbox" value="${esc(u.id)}" ${cur.has(u.id) ? "checked" : ""}/>
          <span class="cfg-avatar sm">${esc(initials(u.name))}</span>
          <span class="cn-t-n"><b>${esc(u.name)}</b><small>${esc(u.email)}</small></span>
          <span class="cfg-role ${esc(u.role)}">${esc(u.role === "admin" ? "Administrador" : u.role === "editor" ? "Desarrollador" : u.role)}</span></label></li>`).join("")}</ul>`
        : `<p class="cfg-muted">No hay otras personas con permiso para usar conexiones. Un administrador puede dárselo en Configuración.</p>`}`,
    actions: `<button type="button" class="q-btn" data-x>Cancelar</button><button type="button" class="q-btn primary" id="cnShareOk" ${targets.length ? "" : "disabled"}>Guardar</button>`,
  });
  m.el.querySelector("#cnShareOk").addEventListener("click", async () => {
    const ids = [...m.el.querySelectorAll('input[type="checkbox"]:checked')].map((i) => i.value);
    try {
      await api.shareConnection(c.id, ids);
      m.close();
      toast(ids.length ? `Conexión compartida con ${ids.length} ${ids.length === 1 ? "persona" : "personas"}.` : "Conexión privada de nuevo.");
      await load(); render();
    } catch (e) { toast(e.message, "err"); }
  });
}

async function editConn(c) {
  host = makeModalHost();
  openConnectionWizard(null, host, async () => { await load(); render(); }, { connection: c });
}

async function delConn(c) {
  const n = (c.shared_with || []).length;
  const ok = await confirmBox({
    title: "Eliminar conexión",
    message: `¿Eliminar <strong>${esc(c.name)}</strong>?${n ? ` Dejará de estar disponible para las ${n} ${n === 1 ? "persona" : "personas"} con quien la compartiste.` : ""} Las tablas ya cargadas en tus aplicaciones no se borran.`,
    okLabel: "Eliminar", danger: true,
  });
  if (!ok) return;
  try { await api.deleteConnectionGlobal(c.id); toast("Conexión eliminada."); await load(); render(); } catch (e) { toast(e.message, "err"); }
}

function wire() {
  main.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { st.tab = b.dataset.tab; render(); }));
  main.querySelectorAll("[data-new]").forEach((b) => b.addEventListener("click", () => newConn(b.dataset.new)));
  const q = main.querySelector("#cnQ");
  if (q) q.addEventListener("input", () => {
    st.q = q.value; const pos = q.selectionStart; render();
    const nq = main.querySelector("#cnQ"); nq.focus(); nq.setSelectionRange(pos, pos);
  });
  const pv = main.querySelector("#cnProv");
  if (pv) pv.addEventListener("change", () => { st.prov = pv.value; render(); });
  main.querySelectorAll("#cnNew, #cnNew2").forEach((b) => b.addEventListener("click", () => newConn()));
  main.querySelectorAll(".cn-card [data-act]").forEach((b) => b.addEventListener("click", () => {
    const c = st.conns.find((x) => x.id === b.closest(".cn-card").dataset.id);
    if (!c) return;
    ({ test: () => testConn(c, b), share: () => shareConn(c), edit: () => editConn(c), del: () => delConn(c) })[b.dataset.act]();
  }));
  const cp = main.querySelector("#cnCopyCfg");
  if (cp) cp.addEventListener("click", () => copyText(main.querySelector(".cn-code code").textContent, "Configuración copiada."));
}

/* ----------------------- Arranque ----------------------- */
renderNav("nav", { active: "conexiones" });
wireAppsButton();
renderProfileMenu(authService);
render();
load().then(render);

// flows.js — Automatizaciones por nodos (estilo n8n).
//   · Lista: tus flujos, galería de plantillas y credenciales (correo SMTP, WhatsApp, webhooks de canal, APIs).
//   · Editor: lienzo con nodos que se arrastran desde la paleta y se conectan tirando de los puntos de salida;
//     panel de propiedades con plantillas {{ … }} y un selector de variables tomado de la última ejecución;
//     «Ejecutar» corre el flujo y pinta en cada nodo cuántos registros produjo o el error.
// El catálogo de nodos, la validación y la ejecución viven en el backend (/api/v1/flows/*).

import { renderNav, wireAppsButton, renderProfileMenu } from "./hub-nav.js";
import { authService } from "./auth-service.js";
import * as api from "./api.js";
import { esc, fmtDate, toast, modal, confirmBox, copyText } from "./ui-kit.js";

if (!authService.isAuthenticated()) location.replace("index.html");
if (!authService.can("charts:edit")) location.replace("inicio.html");

renderNav("nav", { active: "automatizaciones" });
wireAppsButton();
renderProfileMenu(authService);

const main = document.getElementById("main");
const qs = new URLSearchParams(location.search);
const NODE_W = 232, NODE_H = 72;

const S = { catalog: null, byType: {}, cats: {}, apps: [], creds: [], masters: {}, fields: {}, tables: {} };

/* ------------------------------ iconos ------------------------------ */
const P = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
const ICONS = {
  play: '<path d="M8 5.5v13l10-6.5z"/>', clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v4.5h-4.5"/>', bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z"/><path d="M10 20.6a2 2 0 0 0 4 0"/>',
  sigma: '<path d="M17 5H7l6 7-6 7h10"/>', table: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10"/>',
  chat: '<path d="M4.5 5.5h15v10h-9l-4.5 3.5v-3.5h-1.5z"/>', trend: '<path d="M3.5 17 9 11.5l4 4 7.5-8"/><path d="M15 7.5h5.5V13"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>', flask: '<path d="M9.5 3.5h5M10.5 3.5v6L5 19a1 1 0 0 0 .9 1.5h12.2A1 1 0 0 0 19 19l-5.5-9.5v-6"/><path d="M7.5 14.5h9"/>',
  sparkles: '<path d="M12 3.5 13.8 9 19.5 11l-5.7 2-1.8 5.5-1.8-5.5L4.5 11l5.7-2z"/><path d="M19 3.5v3M17.5 5h3"/>',
  split: '<path d="M4 12h6l4-5.5h6M14 17.5h6M10 12l4 5.5"/>', filter: '<path d="M4 5.5h16l-6 7.5v5l-4 2v-7z"/>',
  edit: '<path d="M4.5 19.5h4l10-10-4-4-10 10z"/><path d="m13 7 4 4"/>', layers: '<path d="m12 4 8.5 4.5L12 13 3.5 8.5z"/><path d="m3.5 12.5 8.5 4.5 8.5-4.5"/>',
  hourglass: '<path d="M7 3.5h10M7 20.5h10M8 3.5c0 5 8 5 8 8.5s-8 3.5-8 8.5M16 3.5c0 5-8 5-8 8.5"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4 7 8 6 8-6"/>',
  whatsapp: '<path d="M4.5 19.5 5.6 16A8 8 0 1 1 8.4 18.6z"/><path d="M9.3 8.8c.2 2.6 2.6 5.3 5.6 5.9l1.2-1.3-1.8-1.1-.9.7c-1.1-.4-2-1.3-2.4-2.4l.7-.9-1-1.8z"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.6 2.6 14.4 0 17M12 3.5c-2.6 2.6-2.6 14.4 0 17"/>',
};
const ico = (k, s = 18) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" ${P} aria-hidden="true">${ICONS[k] || ICONS.sparkles}</svg>`;
const TRIG_LABEL = { "trigger.manual": "Manual", "trigger.schedule": "Programado", "trigger.webhook": "Webhook", "trigger.reload": "Al recargar datos", "trigger.alert": "Al dispararse una alerta" };
const STATUS = { ok: ["Correcta", "ok"], error: ["Con error", "err"] };

async function loadBase() {
  if (S.catalog) return;
  const [cat, apps, creds] = await Promise.all([api.flowCatalog(), api.listApps().catch(() => []), api.listFlowCredentials().catch(() => [])]);
  S.catalog = cat; S.apps = apps; S.creds = creds;
  cat.nodes.forEach((n) => { S.byType[n.type] = n; });
  cat.categories.forEach((c) => { S.cats[c.id] = c; });
}
const color = (type) => S.cats[S.byType[type]?.category]?.color || "#64748b";

/* =========================================================================
   LISTA
   ========================================================================= */
async function renderList() {
  main.classList.remove("fl-editing");
  main.innerHTML = `<div class="fl-loading">Cargando…</div>`;
  let flows = [], templates = [];
  try { await loadBase(); [flows, templates] = await Promise.all([api.listFlows(), api.flowTemplates()]); }
  catch (e) { main.innerHTML = `<p class="fl-err">${esc(e.message)}</p>`; return; }
  main.innerHTML = `
    <div class="fl-list">
      <header class="fl-hero">
        <div>
          <h1>Automatizaciones</h1>
          <p>Arrastra nodos y conéctalos: recarga tus datos, consulta tus apps, deja que un agente de IA analice y redacte, y envía el resultado por correo, WhatsApp, Teams o a cualquier API.</p>
        </div>
        <div class="fl-hero-act">
          <button type="button" class="fl-btn ghost" id="flCreds">🔑 Credenciales (${S.creds.length})</button>
          <button type="button" class="fl-btn" id="flNew">＋ Nueva automatización</button>
        </div>
      </header>
      <section>
        <h2 class="fl-h2">Empieza con una plantilla</h2>
        <div class="fl-tpls">${templates.map((t) => `
          <button type="button" class="fl-tpl" data-tpl="${esc(t.id)}">
            <span class="fl-tpl-flow">${t.node_types.map((ty, i) => `${i ? '<i class="fl-tpl-arrow">›</i>' : ""}<span class="fl-tpl-ico" style="--c:${color(ty)}">${ico(S.byType[ty]?.icon, 15)}</span>`).join("")}</span>
            <b>${esc(t.name)}</b><small>${esc(t.description)}</small>
          </button>`).join("")}</div>
      </section>
      <section>
        <h2 class="fl-h2">Tus automatizaciones <em>${flows.length}</em></h2>
        ${flows.length ? `<div class="fl-cards">${flows.map((f) => `
          <article class="fl-card" data-id="${esc(f.id)}">
            <div class="fl-card-top">
              <span class="fl-card-flow">${(f.node_types || []).slice(0, 6).map((ty) => `<span class="fl-tpl-ico" style="--c:${color(ty)}">${ico(S.byType[ty]?.icon, 14)}</span>`).join("")}</span>
              <label class="fl-switch" title="${f.enabled ? "Activa: corre sola" : "Pausada"}"><input type="checkbox" data-toggle ${f.enabled ? "checked" : ""}/><i></i></label>
            </div>
            <h3>${esc(f.name)}</h3>
            <p>${esc(f.description || TRIG_LABEL[f.trigger] || "Sin disparador")}</p>
            <div class="fl-card-meta">
              <span>${esc(TRIG_LABEL[f.trigger] || "—")} · ${f.nodes_count} nodos</span>
              <span>${f.last_run_at ? `Última: ${fmtDate(f.last_run_at)} <b class="fl-st ${STATUS[f.last_status]?.[1] || ""}">${STATUS[f.last_status]?.[0] || ""}</b>` : "Aún no se ejecuta"}</span>
              ${f.enabled && f.next_run_at ? `<span>Próxima: ${fmtDate(f.next_run_at)}</span>` : ""}
            </div>
          </article>`).join("")}</div>`
          : `<div class="fl-empty"><div class="fl-empty-ico">${ico("sparkles", 34)}</div><b>Todavía no tienes automatizaciones</b><span>Elige una plantilla o crea una desde cero.</span></div>`}
      </section>
    </div>`;
  main.querySelector("#flNew").addEventListener("click", () => newFlow(null));
  main.querySelector("#flCreds").addEventListener("click", () => credentialsModal(() => renderList()));
  main.querySelectorAll("[data-tpl]").forEach((b) => b.addEventListener("click", () => newFlow(templates.find((t) => t.id === b.dataset.tpl))));
  main.querySelectorAll(".fl-card").forEach((c) => {
    c.addEventListener("click", (e) => { if (!e.target.closest(".fl-switch")) location.href = `automatizaciones.html?flow=${encodeURIComponent(c.dataset.id)}`; });
    c.querySelector("[data-toggle]").addEventListener("change", async (e) => {
      try { await api.setFlowEnabled(c.dataset.id, e.target.checked); toast(e.target.checked ? "Automatización activa" : "Automatización pausada"); }
      catch (x) { e.target.checked = !e.target.checked; toast(x.message, "err"); }
    });
  });
  if (qs.get("new") === "1") { history.replaceState(null, "", "automatizaciones.html"); newFlow(null); }
  if (qs.get("credentials") === "1") { history.replaceState(null, "", "automatizaciones.html"); credentialsModal(() => renderList()); }
}

/** Nueva automatización (en blanco o desde una plantilla, pidiendo lo que la plantilla necesita). */
function newFlow(tpl) {
  const g = tpl ? JSON.stringify(tpl.graph) : "";
  const need = (k) => g.includes(`{{${k}}}`);
  const credSel = (kind) => `<select name="${kind}"><option value="">— Elegir después —</option>${S.creds.filter((c) => kind === "whatsapp" ? c.kind.startsWith("whatsapp") : c.kind === kind).map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}</select>`;
  const m = modal({
    title: tpl ? tpl.name : "Nueva automatización",
    body: `<form class="fl-form" id="nfForm">
      <label>Nombre<input name="name" required maxlength="120" value="${esc(tpl?.name || "")}" placeholder="Ej.: Recarga diaria de rotación"/></label>
      ${tpl ? `<p class="fl-muted">${esc(tpl.description)}</p>` : `<p class="fl-muted">Empieza con un disparador manual; agrega nodos desde la paleta.</p>`}
      ${need("app") ? `<label>Aplicación<select name="app" required>${S.apps.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join("")}</select></label>` : ""}
      ${need("measure") ? `<label>Métrica a vigilar (fx)<input name="measure" value="Round(Sum(If([ESTADO CONTRATO] = 'Inactivo', 1, 0)) / Count([CEDULA]) * 100, 2)"/></label><label>Nombre de la métrica<input name="measure_label" value="% Inactivos"/></label>` : ""}
      ${need("email") ? `<label>Correo de destino<input name="email" type="email" placeholder="gerente@empresa.com" value="${esc(authService.current()?.email || "")}"/></label>` : ""}
      ${need("phone") ? `<label>WhatsApp de destino<input name="phone" placeholder="+573001234567"/></label>` : ""}
      ${need("smtp") ? `<label>Cuenta de correo (SMTP)${credSel("smtp")}</label>` : ""}
      ${need("whatsapp") ? `<label>Cuenta de WhatsApp${credSel("whatsapp")}</label>` : ""}
      ${need("webhook") ? `<label>Webhook del canal (Teams/Slack)${credSel("webhook")}</label>` : ""}
      ${tpl && (need("smtp") || need("whatsapp") || need("webhook")) ? `<p class="fl-muted">Si aún no tienes la cuenta, créala luego en «Credenciales»: el nodo queda marcado para completarlo.</p>` : ""}
      <div class="fl-err" id="nfErr"></div>
    </form>`,
    actions: `<button type="button" class="fl-btn ghost" data-x>Cancelar</button><button type="button" class="fl-btn" id="nfOk">Crear y abrir</button>`,
  });
  m.el.querySelector("#nfOk").addEventListener("click", async () => {
    const f = m.el.querySelector("#nfForm");
    const v = Object.fromEntries(new FormData(f).entries());
    if (!v.name?.trim()) { m.el.querySelector("#nfErr").textContent = "Escribe un nombre."; return; }
    let graph = { nodes: [{ id: "t", type: "trigger.manual", name: "Ejecutar manualmente", x: 80, y: 180, params: {} }], edges: [] };
    if (tpl) {
      let s = JSON.stringify(tpl.graph);
      for (const k of ["app", "measure", "measure_label", "email", "phone", "smtp", "whatsapp", "webhook"]) s = s.split(`{{${k}}}`).join(JSON.stringify(String(v[k] || "")).slice(1, -1));
      graph = JSON.parse(s);
    }
    try {
      const flow = await api.createFlow({ name: v.name.trim(), description: tpl?.description, graph });
      location.href = `automatizaciones.html?flow=${encodeURIComponent(flow.id)}`;
    } catch (x) { m.el.querySelector("#nfErr").textContent = x.message; }
  });
}

/** Llama a fn cuando el modal se cierra (por la X, Esc, clic fuera o un botón «Cerrar»). */
function whenClosed(m, fn) {
  if (!fn) return;
  const obs = new MutationObserver(() => { if (!document.body.contains(m.el)) { obs.disconnect(); fn(); } });
  obs.observe(document.body, { childList: true });
}

/* =========================================================================
   CREDENCIALES
   ========================================================================= */
function credentialsModal(onClose) {
  const m = modal({ title: "Credenciales de automatización", wide: true, body: `<div id="crBody"></div>`, actions: `<button type="button" class="fl-btn ghost" data-x>Cerrar</button>` });
  const paint = async () => {
    try { S.creds = await api.listFlowCredentials(); } catch {}
    const body = m.el.querySelector("#crBody");
    body.innerHTML = `
      <p class="fl-muted">Son privadas: solo tus automatizaciones las usan y las contraseñas o tokens nunca vuelven a mostrarse.</p>
      <div class="fl-cr-add">${S.catalog.credentials.map((c) => `<button type="button" class="fl-btn ghost sm" data-add="${esc(c.kind)}">＋ ${esc(c.label)}</button>`).join("")}</div>
      ${S.creds.length ? `<ul class="fl-cr-list">${S.creds.map((c) => `
        <li data-id="${esc(c.id)}"><div><b>${esc(c.name)}</b><small>${esc(S.catalog.credentials.find((k) => k.kind === c.kind)?.label || c.kind)} · ${esc(Object.entries(c.config).filter(([, v]) => v && v !== "••••••").map(([k, v]) => `${k}: ${v}`).slice(0, 3).join(" · "))}</small></div>
          <div class="fl-cr-act"><button type="button" class="fl-btn ghost sm" data-test>Probar</button><button type="button" class="fl-btn ghost sm" data-edit>Editar</button><button type="button" class="fl-btn ghost sm danger" data-del>Borrar</button></div></li>`).join("")}</ul>`
        : `<p class="fl-muted">Aún no tienes credenciales.</p>`}
      <div id="crForm"></div>`;
    body.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => form(null, b.dataset.add)));
    body.querySelectorAll("li").forEach((li) => {
      const c = S.creds.find((x) => x.id === li.dataset.id);
      li.querySelector("[data-edit]").addEventListener("click", () => form(c, c.kind));
      li.querySelector("[data-test]").addEventListener("click", async (e) => {
        e.currentTarget.disabled = true;
        try { const r = await api.testFlowCredential(c.id); toast(r.message, r.ok ? "ok" : "err"); } catch (x) { toast(x.message, "err"); }
        e.currentTarget.disabled = false;
      });
      li.querySelector("[data-del]").addEventListener("click", async () => {
        if (!(await confirmBox({ title: "Borrar credencial", message: `¿Borrar «${c.name}»? Los nodos que la usan dejarán de enviar.`, okLabel: "Borrar", danger: true }))) return;
        await api.deleteFlowCredential(c.id); paint();
      });
    });
  };
  const form = (c, kind) => {
    const def = S.catalog.credentials.find((k) => k.kind === kind);
    const host = m.el.querySelector("#crForm");
    host.innerHTML = `<form class="fl-form fl-cr-form"><h4>${c ? "Editar" : "Nueva"}: ${esc(def.label)}</h4><p class="fl-muted">${esc(def.help)}</p>
      <label>Nombre<input name="__name" required value="${esc(c?.name || def.label)}"/></label>
      ${def.fields.map((f) => `<label>${esc(f.label)}<input name="${esc(f.key)}" ${f.secret ? 'type="password" autocomplete="new-password"' : ""} placeholder="${esc(f.secret && c ? "(sin cambios)" : f.placeholder)}" value="${esc(c && !f.secret ? c.config[f.key] ?? "" : "")}"/></label>`).join("")}
      <div class="fl-err" data-err></div>
      <div class="fl-row"><button type="submit" class="fl-btn">Guardar</button><button type="button" class="fl-btn ghost" data-cancel>Cancelar</button></div></form>`;
    const f = host.querySelector("form");
    f.querySelector("[data-cancel]").addEventListener("click", () => { host.innerHTML = ""; });
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(f).entries());
      const name = v.__name; delete v.__name;
      try {
        if (c) await api.updateFlowCredential(c.id, { name, config: v }); else await api.createFlowCredential({ kind, name, config: v });
        toast("Credencial guardada"); paint();
      } catch (x) { f.querySelector("[data-err]").textContent = x.message; }
    });
  };
  whenClosed(m, onClose);
  paint();
}

/* =========================================================================
   EDITOR
   ========================================================================= */
async function renderEditor(id) {
  main.classList.add("fl-editing");
  main.innerHTML = `<div class="fl-loading">Abriendo el editor…</div>`;
  let flow;
  try { await loadBase(); flow = await api.getFlow(id); }
  catch (e) { main.innerHTML = `<p class="fl-err">${esc(e.message)} <a href="automatizaciones.html">Volver</a></p>`; return; }
  const E = {
    flow, graph: flow.graph, sel: null, selEdge: null, view: { x: 0, y: 0, k: 1 },
    run: null, dirty: false, saveT: null, lastFocus: null,
  };
  main.innerHTML = `
    <div class="fe">
      <header class="fe-bar">
        <a class="fe-back" href="automatizaciones.html" title="Volver a la lista" aria-label="Volver">‹</a>
        <input class="fe-name" id="feName" value="${esc(flow.name)}" maxlength="120" aria-label="Nombre de la automatización"/>
        <span class="fe-save" id="feSave">Guardado</span>
        <span class="fe-spacer"></span>
        <span class="fe-problems" id="feProblems"></span>
        <label class="fl-switch big" title="Activar: el flujo corre solo según su disparador"><input type="checkbox" id="feOn" ${flow.enabled ? "checked" : ""}/><i></i><span id="feOnLbl">${flow.enabled ? "Activa" : "Pausada"}</span></label>
        <button type="button" class="fl-btn ghost" id="feRuns">Ejecuciones</button>
        <button type="button" class="fl-btn ghost" id="feCreds">🔑</button>
        <button type="button" class="fl-btn run" id="feRun">▶ Ejecutar</button>
      </header>
      <div class="fe-body">
        <aside class="fe-pal">
          <input class="fe-pal-q" id="feQ" type="search" placeholder="Buscar nodo…" aria-label="Buscar nodo"/>
          <div id="fePal"></div>
        </aside>
        <section class="fe-canvas" id="feCanvas" tabindex="0" aria-label="Lienzo del flujo">
          <div class="fe-world" id="feWorld"><svg class="fe-edges" id="feEdges"></svg><div id="feNodes"></div></div>
          <div class="fe-zoom"><button type="button" data-z="in" title="Acercar">＋</button><button type="button" data-z="out" title="Alejar">－</button><button type="button" data-z="fit" title="Ver todo">⤢</button></div>
          <div class="fe-hint" id="feHint">Arrastra nodos desde la izquierda · tira del punto derecho de un nodo hasta otro para conectarlos · Supr borra</div>
        </section>
        <aside class="fe-insp" id="feInsp"></aside>
      </div>
      <section class="fe-log" id="feLog" hidden></section>
    </div>`;
  const $ = (s) => main.querySelector(s);
  const canvas = $("#feCanvas"), world = $("#feWorld"), nodesEl = $("#feNodes"), edgesEl = $("#feEdges");

  /* ---------- paleta ---------- */
  const paintPalette = () => {
    const q = $("#feQ").value.trim().toLowerCase();
    $("#fePal").innerHTML = S.catalog.categories.map((c) => {
      const ns = S.catalog.nodes.filter((n) => n.category === c.id && (!q || (n.label + " " + n.description).toLowerCase().includes(q)));
      if (!ns.length) return "";
      return `<div class="fe-pal-cat"><span style="--c:${c.color}">${esc(c.label)}</span></div>` + ns.map((n) => `
        <div class="fe-pal-it" draggable="true" data-type="${esc(n.type)}" title="${esc(n.description)}" style="--c:${c.color}">
          <span class="fe-pal-ico">${ico(n.icon, 16)}</span><span><b>${esc(n.label)}</b><small>${esc(n.description)}</small></span>
        </div>`).join("");
    }).join("");
    $("#fePal").querySelectorAll("[data-type]").forEach((it) => {
      it.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/ds-node", it.dataset.type); e.dataTransfer.effectAllowed = "copy"; });
      it.addEventListener("dblclick", () => { const r = canvas.getBoundingClientRect(); addNode(it.dataset.type, toWorld(r.left + r.width / 2, r.top + r.height / 2)); });
    });
  };
  $("#feQ").addEventListener("input", paintPalette);
  paintPalette();

  /* ---------- coordenadas ---------- */
  const toWorld = (cx, cy) => { const r = canvas.getBoundingClientRect(); return { x: (cx - r.left - E.view.x) / E.view.k, y: (cy - r.top - E.view.y) / E.view.k }; };
  const applyView = () => {
    world.style.transform = `translate(${E.view.x}px, ${E.view.y}px) scale(${E.view.k})`;
    // los puertos nunca se ven más pequeños que ~13 px en pantalla, aunque el flujo esté alejado
    world.style.setProperty("--pk", String(Math.max(1, 0.95 / E.view.k)));
  };
  /** Puerto de entrada más cercano al puntero (imán de 48 px en pantalla). */
  const nearestIn = (cx, cy, except) => {
    let best = null, bd = 48;
    nodesEl.querySelectorAll(".fe-port.in").forEach((p) => {
      if (p.dataset.in === except) return;
      const r = p.getBoundingClientRect(), d = Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy);
      if (d < bd) { bd = d; best = p; }
    });
    return best;
  };
  /** Conecta from:port → to si es válido. Devuelve un texto de error o null. */
  const connect = (from, port, to) => {
    const toNode = nodeById(to);
    if (!toNode || to === from) return "Elige otro nodo.";
    if (!S.byType[toNode.type]?.input) return `«${toNode.name}» es un disparador: no recibe conexiones.`;
    if (E.graph.edges.some((x) => x.from === from && x.port === port && x.to === to)) return "Ya están conectados.";
    E.graph.edges.push({ from, port, to });
    changed();
    if (E.sel) paintInspector();
    return null;
  };
  const nodeById = (id) => E.graph.nodes.find((n) => n.id === id);
  const outPorts = (n) => S.byType[n.type]?.outputs || ["out"];
  const portPos = (n, port) => {
    const outs = outPorts(n);
    if (port === "__in") return { x: n.x, y: n.y + NODE_H / 2 };
    const i = Math.max(0, outs.indexOf(port));
    return { x: n.x + NODE_W, y: n.y + NODE_H * (i + 1) / (outs.length + 1) };
  };
  const curve = (a, b) => { const dx = Math.max(50, Math.abs(b.x - a.x) / 2); return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`; };

  /* ---------- pintar ---------- */
  const stepOf = (n) => E.run?.steps?.filter((s) => s.node_id === n.id).slice(-1)[0];
  const subtitle = (n) => {
    const p = n.params || {};
    const def = S.byType[n.type];
    switch (n.type) {
      case "trigger.schedule": return p.mode === "interval" ? `Cada ${p.minutes || 60} min` : p.mode === "hourly" ? "Cada hora" : p.mode === "weekly" ? `${["", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"][Number(p.weekday || 1)]} ${p.time || "07:00"}` : `Diario ${p.time || "07:00"}`;
      case "action.email": return p.to ? `→ ${p.to}` : def.label;
      case "action.whatsapp": return p.to ? `→ ${p.to}` : def.label;
      case "logic.if": case "logic.filter": return p.left ? `${String(p.left).replace(/[{}]/g, "").replace("$json.", "").trim()} ${p.op || ""} ${p.right ?? ""}` : def.label;
      case "ai.agent": return ({ analyst: "Analista de datos", writer: "Redactor", classifier: "Clasificador", hr: "Experto en rotación", custom: "Personalizado" })[p.role || "analyst"];
      default: {
        if (p.app) { const a = S.apps.find((x) => x.id === p.app); if (a) return a.name; }
        return def?.label || n.type;
      }
    }
  };
  const paintNodes = () => {
    nodesEl.innerHTML = E.graph.nodes.map((n) => {
      const def = S.byType[n.type] || { outputs: ["out"], input: true, icon: "sparkles", label: n.type };
      const st = stepOf(n);
      const outs = def.outputs;
      const badge = st ? (st.status === "error" ? `<span class="fe-badge err" title="${esc(st.error)}">✕ error</span>`
        : st.status === "warning" ? `<span class="fe-badge warn" title="${esc(st.error || "Falló pero siguió")}">⚠ siguió</span>`
        : `<span class="fe-badge ok">✓ ${Object.entries(st.output_count || {}).map(([p, c]) => outs.length > 1 ? `${p === "true" ? "sí" : p === "false" ? "no" : p} ${c}` : c).join(" · ")}</span>`) : "";
      return `<div class="fe-node ${E.sel === n.id ? "sel" : ""} ${n.disabled ? "off" : ""} ${st?.status === "error" ? "bad" : st ? "good" : ""}" data-id="${esc(n.id)}" style="left:${n.x}px;top:${n.y}px;--c:${color(n.type)}">
        ${def.input ? `<span class="fe-port in" data-in="${esc(n.id)}" title="Entrada"></span>` : `<span class="fe-trig" title="Disparador">⚡</span>`}
        <span class="fe-node-ico">${ico(def.icon, 20)}</span>
        <span class="fe-node-txt"><b>${esc(n.name)}</b><small>${esc(subtitle(n))}</small></span>
        ${badge}
        ${outs.map((p, i) => `<span class="fe-port out ${p}" data-out="${esc(n.id)}" data-port="${esc(p)}" style="top:${NODE_H * (i + 1) / (outs.length + 1)}px" title="Salida ${p}">${outs.length > 1 ? `<em>${p === "true" ? "sí" : p === "false" ? "no" : p}</em>` : ""}</span>`).join("")}
      </div>`;
    }).join("");
    paintEdges();
    paintProblems();
  };
  const paintEdges = (temp) => {
    const maxX = Math.max(1200, ...E.graph.nodes.map((n) => n.x + NODE_W + 200)), maxY = Math.max(800, ...E.graph.nodes.map((n) => n.y + NODE_H + 200));
    // tamaño explícito en style: hub.css tiene «svg { width: 100%; height: 100% }» y dentro de .fe-world (sin tamaño)
    // dejaba el SVG en 0×0, y Chrome no pinta un SVG de tamaño cero (las líneas existían pero no se veían)
    edgesEl.setAttribute("width", maxX); edgesEl.setAttribute("height", maxY);
    edgesEl.style.width = maxX + "px"; edgesEl.style.height = maxY + "px";
    edgesEl.innerHTML = E.graph.edges.map((e, i) => {
      const a = nodeById(e.from), b = nodeById(e.to);
      if (!a || !b) return "";
      const d = curve(portPos(a, e.port), portPos(b, "__in"));
      const live = E.run && stepOf(a)?.status === "ok" && (stepOf(a).output_count?.[e.port] || 0) > 0;
      const mid = { x: (portPos(a, e.port).x + portPos(b, "__in").x) / 2, y: (portPos(a, e.port).y + portPos(b, "__in").y) / 2 };
      return `<g class="fe-edge ${E.selEdge === i ? "sel" : ""} ${live ? "live" : ""} p-${esc(e.port)}" data-edge="${i}">
        <path class="hit" d="${d}"/><path class="line" d="${d}"/>
        ${E.selEdge === i ? `<g class="fe-edge-x" data-edel="${i}" transform="translate(${mid.x},${mid.y})"><circle r="10"/><path d="M-4,-4 4,4 M4,-4 -4,4"/></g>` : ""}
      </g>`;
    }).join("") + (temp ? `<path class="fe-temp" d="${temp}"/>` : "");
  };
  const paintProblems = () => {
    const pr = E.problems || [];
    const el = $("#feProblems");
    el.innerHTML = pr.length ? `⚠ ${pr.length} pendiente${pr.length > 1 ? "s" : ""}` : "";
    el.title = pr.join("\n");
    el.onclick = () => pr.length && toast(pr.join(" · "), "err");
  };

  /* ---------- guardar ---------- */
  const save = async () => {
    clearTimeout(E.saveT);
    $("#feSave").textContent = "Guardando…";
    try {
      const f = await api.updateFlow(E.flow.id, { name: $("#feName").value.trim() || E.flow.name, graph: E.graph });
      E.flow = f; E.problems = f.problems; E.dirty = false;
      // el servidor normaliza (ids/nombres únicos): conserva posiciones y selección
      E.graph = f.graph;
      $("#feSave").textContent = "Guardado";
      $("#feOn").checked = f.enabled; $("#feOnLbl").textContent = f.enabled ? "Activa" : "Pausada";
      paintProblems();
    } catch (x) { $("#feSave").textContent = "Sin guardar"; toast(x.message, "err"); }
  };
  const changed = (repaint = true) => {
    E.dirty = true; $("#feSave").textContent = "Cambios sin guardar…";
    clearTimeout(E.saveT); E.saveT = setTimeout(save, 900);
    if (repaint) paintNodes();
  };
  $("#feName").addEventListener("input", () => changed(false));

  /* ---------- nodos ---------- */
  const uniqueName = (base) => { let n = base, k = 2; const used = new Set(E.graph.nodes.map((x) => x.name.toLowerCase())); while (used.has(n.toLowerCase())) n = `${base} ${k++}`; return n; };
  function addNode(type, at) {
    const def = S.byType[type];
    if (!def) return;
    const params = {};
    def.params.forEach((p) => { if (p.default !== undefined) params[p.key] = p.default; });
    if (def.params.some((p) => p.key === "app")) {
      const other = E.graph.nodes.find((n) => n.params?.app);
      if (other) params.app = other.params.app; else if (S.apps.length === 1) params.app = S.apps[0].id;
    }
    const from = E.sel && nodeById(E.sel);
    // con un nodo seleccionado (doble clic en la paleta), el nuevo va a su derecha
    let x = Math.round(at.x - NODE_W / 2), y = Math.round(at.y - NODE_H / 2);
    if (from && !at.exact) { x = from.x + NODE_W + 72; y = from.y; }
    // nunca encima de otro nodo
    const hits = (px, py) => E.graph.nodes.some((o) => Math.abs(o.x - px) < NODE_W + 16 && Math.abs(o.y - py) < NODE_H + 16);
    for (let i = 0; i < 40 && hits(x, y); i++) y += NODE_H + 32;
    const n = { id: "n" + Math.random().toString(36).slice(2, 9), type, name: uniqueName(def.label), x, y, params };
    // si hay un nodo seleccionado sin salida conectada, se conecta solo
    if (from && def.input && !E.graph.edges.some((e) => e.from === from.id)) E.graph.edges.push({ from: from.id, port: outPorts(from)[0], to: n.id });
    E.graph.nodes.push(n);
    ensureVisible(n);
    select(n.id);
    changed();
  }
  /** Desplaza la vista lo justo para que el nodo quede dentro del lienzo. */
  function ensureVisible(n) {
    const r = canvas.getBoundingClientRect(), pad = 40, k = E.view.k;
    const sx = n.x * k + E.view.x, sy = n.y * k + E.view.y, ex = sx + NODE_W * k, ey = sy + NODE_H * k;
    if (ex > r.width - pad) E.view.x -= ex - (r.width - pad); else if (sx < pad) E.view.x += pad - sx;
    if (ey > r.height - pad) E.view.y -= ey - (r.height - pad); else if (sy < pad) E.view.y += pad - sy;
    applyView();
  }
  canvas.addEventListener("dragover", (e) => { if ([...e.dataTransfer.types].includes("text/ds-node")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } });
  canvas.addEventListener("drop", (e) => {
    const type = e.dataTransfer.getData("text/ds-node");
    if (!type) return;
    e.preventDefault();
    addNode(type, { ...toWorld(e.clientX, e.clientY), exact: true });
  });

  function select(id, edge = null) {
    E.sel = id; E.selEdge = edge;
    paintNodes();
    paintInspector();
  }

  /* ---------- puntero: mover nodo, conectar, desplazar ---------- */
  let drag = null;
  canvas.addEventListener("pointerdown", (e) => {
    const out = e.target.closest("[data-out]");
    const node = e.target.closest(".fe-node");
    const edge = e.target.closest("[data-edge]");
    const edel = e.target.closest("[data-edel]");
    if (edel) { E.graph.edges.splice(Number(edel.dataset.edel), 1); E.selEdge = null; changed(); return; }
    if (out) {
      e.preventDefault(); e.stopPropagation();
      drag = { kind: "link", from: out.dataset.out, port: out.dataset.port, sx: e.clientX, sy: e.clientY };
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (node) {
      const n = nodeById(node.dataset.id);
      const w = toWorld(e.clientX, e.clientY);
      drag = { kind: "node", id: n.id, dx: w.x - n.x, dy: w.y - n.y, moved: false };
      if (E.sel !== n.id) select(n.id);
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (edge) { select(null, Number(edge.dataset.edge)); return; }
    drag = { kind: "pan", sx: e.clientX, sy: e.clientY, vx: E.view.x, vy: E.view.y, moved: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (drag.kind === "pan") {
      drag.moved = drag.moved || Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 3;
      E.view.x = drag.vx + e.clientX - drag.sx; E.view.y = drag.vy + e.clientY - drag.sy; applyView();
    } else if (drag.kind === "node") {
      const n = nodeById(drag.id), w = toWorld(e.clientX, e.clientY);
      n.x = Math.round((w.x - drag.dx) / 8) * 8; n.y = Math.round((w.y - drag.dy) / 8) * 8;
      drag.moved = true;
      const el = nodesEl.querySelector(`[data-id="${CSS.escape(n.id)}"]`);
      if (el) { el.style.left = n.x + "px"; el.style.top = n.y + "px"; }
      paintEdges();
    } else if (drag.kind === "link") {
      const a = portPos(nodeById(drag.from), drag.port), b = toWorld(e.clientX, e.clientY);
      paintEdges(curve(a, b));
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const overNode = under?.closest(".fe-node");
      const hot = (overNode && overNode.dataset.id !== drag.from ? overNode.querySelector(".fe-port.in") : null) || nearestIn(e.clientX, e.clientY, drag.from);
      nodesEl.querySelectorAll(".fe-port.in").forEach((p) => p.classList.toggle("hot", p === hot));
      nodesEl.querySelectorAll(".fe-node").forEach((n) => n.classList.toggle("drop", !!hot && n.dataset.id === hot.dataset.in));
    }
  });
  canvas.addEventListener("pointerup", (e) => {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.kind === "pan" && !d.moved) { select(null); return; }
    if (d.kind === "node" && d.moved) changed();
    if (d.kind === "link") {
      nodesEl.querySelectorAll(".fe-port.in.hot, .fe-node.drop").forEach((x) => x.classList.remove("hot", "drop"));
      const tgt = document.elementFromPoint(e.clientX, e.clientY);
      let hit = tgt?.closest(".fe-node");
      if (!hit || hit.dataset.id === d.from) hit = nearestIn(e.clientX, e.clientY, d.from);
      const to = hit?.dataset.in || hit?.dataset.id;
      const moved = Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 6;
      if (to && to !== d.from) {
        const err = connect(d.from, d.port, to);
        if (err) { paintEdges(); if (!/Ya están/.test(err)) toast(err, "err"); }
      } else {
        paintEdges();
        if (moved) toast("Suelta la línea sobre otro nodo para conectarlos (o usa «Conectar a» en el panel derecho).", "err");
        else select(d.from);
      }
    }
  });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const k = Math.min(1.6, Math.max(0.35, E.view.k * (e.deltaY < 0 ? 1.1 : 0.9)));
    const cx = e.clientX - r.left, cy = e.clientY - r.top;
    E.view.x = cx - (cx - E.view.x) * k / E.view.k; E.view.y = cy - (cy - E.view.y) * k / E.view.k; E.view.k = k;
    applyView();
  }, { passive: false });
  const fit = () => {
    const ns = E.graph.nodes;
    if (!ns.length) { E.view = { x: 40, y: 40, k: 1 }; applyView(); return; }
    const r = canvas.getBoundingClientRect();
    const minX = Math.min(...ns.map((n) => n.x)), minY = Math.min(...ns.map((n) => n.y));
    const maxX = Math.max(...ns.map((n) => n.x + NODE_W)), maxY = Math.max(...ns.map((n) => n.y + NODE_H));
    // no se aleja de más (por debajo del 60 % los nodos ya no se pueden usar); si no cabe, se ve desde el inicio
    const k = Math.min(1.1, Math.max(0.6, Math.min((r.width - 100) / (maxX - minX || 1), (r.height - 120) / (maxY - minY || 1))));
    const wpx = (maxX - minX) * k, hpx = (maxY - minY) * k;
    E.view = { k, x: wpx <= r.width - 60 ? (r.width - wpx) / 2 - minX * k : 40 - minX * k, y: hpx <= r.height - 60 ? (r.height - hpx) / 2 - minY * k : 40 - minY * k };
    applyView();
  };
  main.querySelectorAll("[data-z]").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.z === "fit") return fit();
    const r = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: b.dataset.z === "in" ? -1 : 1, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
  }));
  document.addEventListener("keydown", (e) => {
    if (!main.contains(document.activeElement) && document.activeElement !== document.body) return;
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); return; }
    if (typing) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      if (E.selEdge != null) { E.graph.edges.splice(E.selEdge, 1); E.selEdge = null; changed(); }
      else if (E.sel) removeNode(E.sel);
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d" && E.sel) { e.preventDefault(); duplicate(E.sel); }
  });
  function removeNode(id) {
    E.graph.nodes = E.graph.nodes.filter((n) => n.id !== id);
    E.graph.edges = E.graph.edges.filter((x) => x.from !== id && x.to !== id);
    E.sel = null; changed(); paintInspector();
  }
  function duplicate(id) {
    const n = nodeById(id);
    const c = JSON.parse(JSON.stringify(n));
    c.id = "n" + Math.random().toString(36).slice(2, 9); c.name = uniqueName(n.name); c.x += 32; c.y += 96;
    E.graph.nodes.push(c); select(c.id); changed();
  }

  /* ---------- inspector ---------- */
  const upstream = (id) => {
    const seen = new Set(), out = [];
    const walk = (x) => E.graph.edges.filter((e) => e.to === x).forEach((e) => { if (!seen.has(e.from)) { seen.add(e.from); out.push(nodeById(e.from)); walk(e.from); } });
    walk(id);
    return out.filter(Boolean);
  };
  const sampleOf = (n) => { const st = stepOf(n); if (!st) return null; const o = st.output || {}; return (o.out || o.true || o.false || [])[0] || null; };
  async function loadAppMeta(app) {
    if (!app || S.fields[app]) return;
    try {
      const [f, m, t] = await Promise.all([api.getFields(app), api.listMasterItems(app), api.listTables(app)]);
      S.fields[app] = [...new Map([...(f.dimensions || []), ...(f.measures || [])].map((x) => [x.field, x])).values()];
      S.masters[app] = m.filter((x) => x.kind === "measure");
      S.tables[app] = t.map((x) => x.name);
    } catch { S.fields[app] = []; S.masters[app] = []; S.tables[app] = []; }
  }

  async function paintInspector() {
    const box = $("#feInsp");
    const n = E.sel && nodeById(E.sel);
    if (!n) {
      const wh = E.graph.nodes.some((x) => x.type === "trigger.webhook");
      box.innerHTML = `<div class="fe-insp-empty">
        <h3>${esc(E.flow.name)}</h3>
        <p>Selecciona un nodo para configurarlo. Doble clic en la paleta lo agrega en el centro; con un nodo seleccionado, el nuevo se conecta solo.</p>
        ${wh ? `<div class="fe-wh"><b>URL del webhook</b><code id="feWh">${esc(location.origin + E.flow.webhook_path)}</code>
          <div class="fl-row"><button type="button" class="fl-btn ghost sm" id="feWhCopy">Copiar</button><button type="button" class="fl-btn ghost sm" id="feWhRot">Regenerar</button></div>
          <small>POST con JSON (o GET con parámetros). Responde con la salida del último nodo. Requiere la automatización activa.</small></div>` : ""}
        <div class="fe-tips"><b>Variables en cualquier campo</b>${S.catalog.template_help.map((t) => `<div><code>${esc(t.expr)}</code><span>${esc(t.desc)}</span></div>`).join("")}</div>
        <button type="button" class="fl-btn ghost danger sm" id="feDelFlow">Eliminar automatización</button>
      </div>`;
      box.querySelector("#feWhCopy")?.addEventListener("click", () => copyText(location.origin + E.flow.webhook_path).then(() => toast("URL copiada")));
      box.querySelector("#feWhRot")?.addEventListener("click", async () => { E.flow = await api.rotateFlowWebhook(E.flow.id); paintInspector(); toast("URL regenerada: la anterior dejó de funcionar"); });
      box.querySelector("#feDelFlow").addEventListener("click", async () => {
        if (!(await confirmBox({ title: "Eliminar automatización", message: `¿Eliminar «${E.flow.name}» y su historial?`, okLabel: "Eliminar", danger: true }))) return;
        await api.deleteFlow(E.flow.id); location.href = "automatizaciones.html";
      });
      return;
    }
    const def = S.byType[n.type];
    await loadAppMeta(n.params?.app);
    if (E.sel !== n.id) return;
    const st = stepOf(n);
    const ups = upstream(n.id);
    box.innerHTML = `
      <div class="fe-insp-head" style="--c:${color(n.type)}">
        <span class="fe-node-ico">${ico(def.icon, 20)}</span>
        <div><input class="fe-insp-name" id="fiName" value="${esc(n.name)}" maxlength="60" aria-label="Nombre del nodo"/><small>${esc(def.label)} · ${esc(S.cats[def.category]?.label || "")}</small></div>
      </div>
      <p class="fe-insp-desc">${esc(def.description)}</p>
      <form class="fe-params" id="fiForm" autocomplete="off">${def.params.map((p) => field(n, p)).join("") || `<p class="fl-muted">Este nodo no necesita configuración.</p>`}</form>
      ${ups.length ? `<details class="fe-vars" open><summary>Variables disponibles</summary>
        ${ups.map((u) => { const s = sampleOf(u); const keys = s ? Object.keys(s).slice(0, 14) : [];
          return `<div class="fe-var-node"><b>${esc(u.name)}</b>${keys.length ? keys.map((k) => `<button type="button" class="fe-chip" data-var="${esc(upstreamExpr(n, u, k))}" title="${esc(Templates(s[k]))}">${esc(k)}</button>`).join("") : `<small>Ejecuta el flujo para ver sus campos.</small>`}
            <button type="button" class="fe-chip all" data-var="${esc(`{{ $node["${u.name}"].items | table }}`)}">tabla</button></div>`; }).join("")}
        <small class="fl-muted">Haz clic para insertar en el último campo que tocaste.</small></details>` : ""}
      ${connBox(n, def)}
      <label class="fe-chk"><input type="checkbox" id="fiOff" ${n.disabled ? "checked" : ""}/> Desactivar (deja pasar los datos sin ejecutarlo)</label>
      ${def.input ? `<label class="fe-chk"><input type="checkbox" id="fiCont" ${n.params?.on_error === "continue" ? "checked" : ""}/> Si falla, seguir con el resto del flujo</label>` : ""}
      ${st ? `<div class="fe-out ${st.status}"><div class="fe-out-h"><b>Última ejecución</b><span>${st.status === "error" ? "✕ Error" : st.status === "skipped" ? "Omitido" : st.status === "warning" ? "⚠ Falló, pero siguió" : `✓ ${st.ms} ms`}</span></div>
        ${st.error ? `<p class="fl-err">${esc(st.error)}</p>` : ""}${st.note ? `<p class="fl-muted">${esc(st.note)}</p>` : ""}
        ${outputView(st)}</div>` : ""}
      <div class="fl-row fe-insp-foot"><button type="button" class="fl-btn ghost sm" id="fiDup">Duplicar</button><button type="button" class="fl-btn ghost sm danger" id="fiDel">Eliminar nodo</button></div>`;
    const form = box.querySelector("#fiForm");
    const sync = () => {
      form.querySelectorAll("[data-show]").forEach((el) => {
        const [k, vals] = el.dataset.show.split("=");
        el.hidden = !vals.split("|").includes(String(n.params?.[k] ?? ""));
      });
    };
    sync();
    form.addEventListener("focusin", (e) => { if (e.target.matches("input[type=text], input:not([type]), textarea")) E.lastFocus = e.target; });
    form.addEventListener("input", (e) => readField(n, e.target, sync));
    form.addEventListener("change", async (e) => {
      readField(n, e.target, sync);
      if (e.target.dataset.key === "app") { await loadAppMeta(n.params.app); paintInspector(); }
      if (e.target.dataset.newcred) credentialsModal(async () => { S.creds = await api.listFlowCredentials(); paintInspector(); });
    });
    form.querySelectorAll("[data-kvadd]").forEach((b) => b.addEventListener("click", () => {
      const k = b.dataset.kvadd; const cur = kvList(n.params[k]); cur.push({ key: "", value: "" }); n.params[k] = cur; changed(false); paintInspector();
    }));
    form.querySelectorAll("[data-kvdel]").forEach((b) => b.addEventListener("click", () => {
      const [k, i] = b.dataset.kvdel.split(":"); const cur = kvList(n.params[k]); cur.splice(Number(i), 1); n.params[k] = cur; changed(); paintInspector();
    }));
    form.querySelectorAll("[data-newcredbtn]").forEach((b) => b.addEventListener("click", () => credentialsModal(async () => { S.creds = await api.listFlowCredentials(); paintInspector(); })));
    box.querySelector("#fiName").addEventListener("change", (e) => { n.name = e.target.value.trim() || def.label; changed(); });
    box.querySelector("#fiOff").addEventListener("change", (e) => { n.disabled = e.target.checked; changed(); });
    box.querySelector("#fiCont")?.addEventListener("change", (e) => { n.params.on_error = e.target.checked ? "continue" : undefined; changed(false); });
    box.querySelectorAll("[data-conn]").forEach((s) => s.addEventListener("change", () => {
      if (!s.value) return;
      const err = connect(n.id, s.dataset.conn, s.value);
      if (err) toast(err, "err"); else toast(`Conectado con «${nodeById(s.value).name}»`);
      paintInspector();
    }));
    box.querySelectorAll("[data-unconn]").forEach((b) => b.addEventListener("click", () => {
      const [port, to] = b.dataset.unconn.split("|");
      E.graph.edges = E.graph.edges.filter((x) => !(x.from === n.id && (x.port || "out") === port && x.to === to));
      changed(); paintInspector();
    }));
    box.querySelector("#fiDup").addEventListener("click", () => duplicate(n.id));
    box.querySelector("#fiDel").addEventListener("click", () => removeNode(n.id));
    box.querySelectorAll("[data-var]").forEach((b) => b.addEventListener("click", () => {
      const t = E.lastFocus && box.contains(E.lastFocus) ? E.lastFocus : form.querySelector("textarea, input[type=text]");
      if (!t) return;
      const s = t.selectionStart ?? t.value.length;
      t.value = t.value.slice(0, s) + b.dataset.var + t.value.slice(t.selectionEnd ?? s);
      t.focus(); readField(n, t, sync);
    }));
    box.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
      box.querySelectorAll("[data-tab]").forEach((x) => x.classList.toggle("on", x === b));
      box.querySelectorAll("[data-pane]").forEach((x) => { x.hidden = x.dataset.pane !== b.dataset.tab; });
    }));
  }
  /** «Conectar a»: une nodos eligiendo de una lista (sin arrastrar) y muestra de dónde recibe. */
  function connBox(n, def) {
    const pl = (p) => (p === "true" ? "Si se cumple (sí)" : p === "false" ? "Si no se cumple (no)" : "Siguiente paso");
    const ins = E.graph.edges.filter((x) => x.to === n.id).map((x) => nodeById(x.from)).filter(Boolean);
    const cands = E.graph.nodes.filter((o) => o.id !== n.id && S.byType[o.type]?.input);
    const rows = (def.outputs || ["out"]).map((p) => {
      const cur = E.graph.edges.filter((x) => x.from === n.id && (x.port || "out") === p).map((x) => nodeById(x.to)).filter(Boolean);
      const free = cands.filter((o) => !cur.includes(o));
      return `<div class="fe-conn-row"><span class="fe-conn-p ${p}">${pl(p)}</span>
        <div class="fe-conn-list">${cur.map((o) => `<span class="fe-conn-chip" style="--c:${color(o.type)}">→ ${esc(o.name)}<button type="button" data-unconn="${esc(p)}|${esc(o.id)}" title="Quitar conexión" aria-label="Quitar conexión con ${esc(o.name)}">✕</button></span>`).join("")}
        ${free.length ? `<select data-conn="${esc(p)}" aria-label="Conectar ${esc(pl(p))}"><option value="">＋ Conectar a…</option>${free.map((o) => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join("")}</select>` : cur.length ? "" : `<small class="fl-muted">Agrega otro nodo para conectarlo.</small>`}</div></div>`;
    }).join("");
    return `<div class="fe-conn"><b>Conexiones</b>
      ${def.input ? `<div class="fe-conn-row"><span class="fe-conn-p">Recibe de</span><div class="fe-conn-list">${ins.length ? ins.map((o) => `<span class="fe-conn-chip in" style="--c:${color(o.type)}">${esc(o.name)} →</span>`).join("") : `<small class="fe-warn">Nada todavía: este nodo no se ejecutará.</small>`}</div></div>` : ""}
      ${rows}</div>`;
  }
  const Templates = (v) => (v == null ? "" : typeof v === "object" ? JSON.stringify(v).slice(0, 80) : String(v).slice(0, 80));
  const upstreamExpr = (n, u, k) => {
    const direct = E.graph.edges.some((e) => e.from === u.id && e.to === n.id);
    const key = /^[A-Za-z_][\w]*$/.test(k) ? `.${k}` : `["${k}"]`;
    return direct ? `{{ $json${key} }}` : `{{ $node["${u.name}"].json${key} }}`;
  };
  const kvList = (v) => Array.isArray(v) ? v : v && typeof v === "object" ? Object.entries(v).map(([key, value]) => ({ key, value })) : [];

  function outputView(st) {
    const ports = Object.keys(st.output || {});
    const items = ports.flatMap((p) => st.output[p]);
    if (!items.length) return `<p class="fl-muted">Sin registros de salida.</p>`;
    const cols = [...new Set(items.flatMap((i) => Object.keys(i)))].slice(0, 8);
    const cell = (v) => esc(v == null ? "" : typeof v === "object" ? JSON.stringify(v).slice(0, 60) : String(v).slice(0, 120));
    return `<div class="fe-out-tabs"><button type="button" class="on" data-tab="t">Tabla</button><button type="button" data-tab="j">JSON</button></div>
      <div data-pane="t" class="fe-out-scroll"><table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${items.slice(0, 15).map((i) => `<tr>${cols.map((c) => `<td>${cell(i[c])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
      <pre data-pane="j" hidden class="fe-out-json">${esc(JSON.stringify(items.slice(0, 5), null, 2))}</pre>`;
  }

  function field(n, p) {
    const v = n.params?.[p.key] ?? "";
    const show = p.show_if ? ` data-show="${esc(p.show_if.key)}=${esc(p.show_if.values.join("|"))}"` : "";
    const lbl = `<span>${esc(p.label)}${p.required ? ' <i class="req">*</i>' : ""}</span>`;
    const help = p.help ? `<small>${esc(p.help)}</small>` : "";
    const app = n.params?.app;
    const k = `data-key="${esc(p.key)}"`;
    let ctl;
    if (p.type === "textarea") ctl = `<textarea ${k} rows="${p.key === "body" || p.key === "prompt" ? 6 : 3}" placeholder="${esc(p.placeholder || "")}">${esc(v)}</textarea>`;
    else if (p.type === "number") ctl = `<input ${k} type="text" inputmode="decimal" value="${esc(v)}" placeholder="${esc(p.placeholder || "")}"/>`;
    else if (p.type === "bool") return `<label class="fe-chk"${show}><input ${k} type="checkbox" ${v === true ? "checked" : ""}/> ${esc(p.label)}</label>`;
    else if (p.type === "select") ctl = `<select ${k}>${p.options.map((o) => `<option value="${esc(o.value)}" ${String(v || p.default) === o.value ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select>`;
    else if (p.type === "app") ctl = `<select ${k}><option value="">${p.required ? "Elegir…" : "Ninguna"}</option>${S.apps.map((a) => `<option value="${esc(a.id)}" ${v === a.id ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select>`;
    else if (p.type === "table") ctl = `<select ${k}><option value="">Automática</option>${(S.tables[app] || []).map((t) => `<option ${v === t ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
    else if (p.type === "field") ctl = `<select ${k}><option value="">${p.required ? "Elegir…" : "Ninguno"}</option>${(S.fields[app] || []).map((f) => `<option value="${esc(f.field)}" ${v === f.field ? "selected" : ""}>${esc(f.display || f.field)}</option>`).join("")}</select>`;
    else if (p.type === "measure") {
      const ms = S.masters[app] || [];
      const isM = String(v).startsWith("m:");
      ctl = `<select data-measure-pick="${esc(p.key)}"><option value="">Escribir una expresión fx…</option>${ms.map((m) => `<option value="m:${esc(m.id)}" ${v === "m:" + m.id ? "selected" : ""}>${m.certified ? "✓ " : ""}${esc(m.name)}</option>`).join("")}</select>
        <input ${k} type="text" value="${isM ? "" : esc(v)}" placeholder="${esc(p.placeholder || "Sum([campo])")}" ${isM ? "hidden" : ""}/>`;
    } else if (p.type.startsWith("credential:")) {
      const want = p.type.split(":")[1];
      const cs = S.creds.filter((c) => want === "whatsapp" ? c.kind.startsWith("whatsapp") : c.kind === want);
      ctl = `<div class="fe-cred"><select ${k}><option value="">${cs.length ? "Elegir…" : "No tienes ninguna"}</option>${cs.map((c) => `<option value="${esc(c.id)}" ${v === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>
        <button type="button" class="fl-btn ghost sm" data-newcredbtn title="Crear credencial">＋</button></div>`;
    } else if (p.type === "json") ctl = `<textarea ${k} rows="3" class="mono" placeholder="${esc(p.placeholder || "{}")}">${esc(typeof v === "object" ? JSON.stringify(v) : v)}</textarea>`;
    else if (p.type === "kv") {
      const rows = kvList(v);
      ctl = `<div class="fe-kv">${rows.map((r, i) => `<div class="fe-kv-row"><input data-kv="${esc(p.key)}:${i}:key" value="${esc(r.key)}" placeholder="campo"/><input data-kv="${esc(p.key)}:${i}:value" value="${esc(typeof r.value === "object" ? JSON.stringify(r.value) : r.value)}" placeholder="valor o {{ plantilla }}"/><button type="button" data-kvdel="${esc(p.key)}:${i}" aria-label="Quitar">✕</button></div>`).join("")}
        <button type="button" class="fl-btn ghost sm" data-kvadd="${esc(p.key)}">＋ Agregar</button></div>`;
    } else ctl = `<input ${k} type="text" value="${esc(v)}" placeholder="${esc(p.placeholder || "")}"/>`;
    return `<label class="fe-field"${show}>${lbl}${ctl}${help}</label>`;
  }

  function readField(n, el, sync) {
    n.params = n.params || {};
    if (el.dataset.measurePick) {
      const key = el.dataset.measurePick;
      const inp = el.parentElement.querySelector(`[data-key="${CSS.escape(key)}"]`);
      if (el.value) { n.params[key] = el.value; inp.hidden = true; } else { inp.hidden = false; n.params[key] = inp.value; }
      changed(); return;
    }
    if (el.dataset.kv) {
      const [key, i, part] = el.dataset.kv.split(":");
      const cur = kvList(n.params[key]); cur[Number(i)][part] = el.value; n.params[key] = cur;
      changed(false); return;
    }
    const key = el.dataset.key;
    if (!key) return;
    const def = S.byType[n.type].params.find((p) => p.key === key);
    if (def?.type === "bool") n.params[key] = el.checked;
    else if (def?.type === "number") n.params[key] = el.value === "" ? undefined : (isNaN(Number(el.value)) ? el.value : Number(el.value));
    else n.params[key] = el.value;
    sync?.();
    const box = nodesEl.querySelector(`[data-id="${CSS.escape(n.id)}"] small`);
    if (box) box.textContent = subtitle(n);
    changed(false);
  }

  /* ---------- ejecutar / historial ---------- */
  $("#feRun").addEventListener("click", async () => {
    const b = $("#feRun");
    if (E.dirty) await save();
    b.disabled = true; b.textContent = "Ejecutando…";
    E.run = null; paintNodes();
    try {
      E.run = await api.runFlow(E.flow.id);
      paintNodes(); paintInspector(); showLog(E.run);
      toast(E.run.status === "ok" ? `Ejecución correcta (${(E.run.duration_ms / 1000).toFixed(1)} s)` : `Falló: ${E.run.error}`, E.run.status === "ok" ? "ok" : "err");
    } catch (x) { toast(x.message, "err"); }
    b.disabled = false; b.textContent = "▶ Ejecutar";
  });
  function showLog(run) {
    const log = $("#feLog");
    log.hidden = false;
    log.innerHTML = `<div class="fe-log-h"><b>Ejecución ${run.status === "ok" ? "correcta" : "con error"}</b><span>${(run.duration_ms / 1000).toFixed(2)} s · ${run.steps.length} paso(s)</span>${run.error ? `<span class="fl-err">${esc(run.error)}</span>` : ""}<button type="button" class="fe-x" id="feLogX" aria-label="Cerrar">✕</button></div>
      <ol class="fe-steps">${run.steps.map((s) => `<li class="${s.status}" data-node="${esc(s.node_id)}"><span class="fe-dot"></span><b>${esc(s.name)}</b><small>${s.status === "error" ? esc(s.error) : s.status === "skipped" ? "omitido" : `${s.input_count} → ${Object.values(s.output_count || {}).reduce((a, c) => a + c, 0)} registro(s)${s.note ? " · " + esc(s.note) : ""}`}</small><em>${s.ms ?? 0} ms</em></li>`).join("")}</ol>`;
    log.querySelector("#feLogX").addEventListener("click", () => { log.hidden = true; });
    log.querySelectorAll("[data-node]").forEach((li) => li.addEventListener("click", () => select(li.dataset.node)));
  }
  $("#feRuns").addEventListener("click", async () => {
    const runs = await api.listFlowRuns(E.flow.id);
    const m = modal({
      title: "Ejecuciones", wide: true,
      body: runs.length ? `<table class="fe-runs"><thead><tr><th>Fecha</th><th>Disparador</th><th>Estado</th><th>Duración</th><th>Detalle</th><th></th></tr></thead><tbody>${runs.map((r) => `<tr>
          <td>${fmtDate(r.started_at)}</td><td>${esc({ manual: "Manual", schedule: "Programado", webhook: "Webhook", reload: "Recarga de datos", alert: "Alerta" }[r.trigger] || r.trigger)}</td>
          <td><b class="fl-st ${STATUS[r.status]?.[1] || ""}">${STATUS[r.status]?.[0] || esc(r.status)}</b></td><td>${((r.duration_ms || 0) / 1000).toFixed(1)} s</td>
          <td class="fe-runs-err">${esc(r.error || "")}</td><td><button type="button" class="fl-btn ghost sm" data-run="${esc(r.id)}">Ver en el lienzo</button></td></tr>`).join("")}</tbody></table>`
        : `<p class="fl-muted">Aún no hay ejecuciones.</p>`,
      actions: `<button type="button" class="fl-btn ghost" data-x>Cerrar</button>`,
    });
    m.el.querySelectorAll("[data-run]").forEach((b) => b.addEventListener("click", async () => {
      const r = await api.getFlowRun(E.flow.id, b.dataset.run);
      E.run = { ...r, run_id: r.id }; m.close(); paintNodes(); paintInspector(); showLog(E.run);
    }));
  });
  $("#feOn").addEventListener("change", async (e) => {
    if (E.dirty) await save();
    try {
      E.flow = await api.setFlowEnabled(E.flow.id, e.target.checked);
      $("#feOnLbl").textContent = E.flow.enabled ? "Activa" : "Pausada";
      toast(E.flow.enabled ? (E.flow.next_run_at ? `Activa · próxima ejecución ${fmtDate(E.flow.next_run_at)}` : "Activa: corre cuando ocurra su disparador") : "Pausada");
    } catch (x) { e.target.checked = !e.target.checked; toast(x.message, "err"); }
  });
  $("#feCreds").addEventListener("click", () => credentialsModal(async () => { S.creds = await api.listFlowCredentials(); paintInspector(); }));
  addEventListener("beforeunload", (e) => { if (E.dirty) { save(); e.preventDefault(); } });

  E.problems = flow.problems;
  paintNodes();
  paintInspector();
  requestAnimationFrame(fit);
}

/* ------------------------------ arranque ------------------------------ */
if (qs.get("flow")) renderEditor(qs.get("flow"));
else renderList();

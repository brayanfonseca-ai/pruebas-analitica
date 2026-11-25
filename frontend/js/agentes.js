// agentes.js — Estudio de agentes de PROTHEO.
//
//  · Galería: qué es un agente y para qué sirve, plantillas y «Tus agentes».
//  · Estudio por nodos (como n8n): el agente al centro, conectado a sus canales de entrada, a lo que produce y a sus
//    piezas (cerebro, memoria, conocimiento, herramientas, límites). Paleta a la izquierda, inspector a la derecha.
//  · Probador: conversación con traza en vivo de cada herramienta (entrada, resultado y tiempo) y las fuentes de la
//    base de conocimiento que usó.
// Todo corre en el servidor (/api/v1/agents) con los permisos de quien conversa. Sin conexiones externas.

import { renderNav, wireAppsButton, renderProfileMenu, svg } from "./hub-nav.js";
import { authService } from "./auth-service.js";
import * as api from "./api.js";

if (!authService.isAuthenticated()) location.replace("index.html");

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const main = document.getElementById("main");
const canBuild = () => authService.can("agents:build");
const st = { catalog: null, agents: [], apps: [], kb: null, view: "gallery", agent: null, sel: "agent", conv: null, msgs: [], busy: false, dirty: false, saveT: null, pan: { x: 0, y: 0 }, zoom: 1 };

/* ----------------------------- utilidades ----------------------------- */
function toast(msg, kind = "ok") {
  let host = document.getElementById("agToasts");
  if (!host) { host = document.createElement("div"); host.id = "agToasts"; host.className = "cfg-toasts"; host.setAttribute("aria-live", "polite"); document.body.appendChild(host); }
  const t = document.createElement("div"); t.className = `cfg-toast ${kind}`; t.textContent = msg; host.appendChild(t);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 300); }, kind === "err" ? 6000 : 3000);
}
const fmtAgo = (iso) => {
  if (!iso) return "nunca";
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return "ahora"; if (m < 60) return `hace ${m} min`; const h = Math.round(m / 60); if (h < 24) return `hace ${h} h`; return `hace ${Math.round(h / 24)} d`;
};
/** Markdown mínimo y seguro (negrita, listas, código y citas [K1]). */
function md(text) {
  const lines = esc(text).split(/\n/);
  let html = "", list = false;
  for (const raw of lines) {
    const l = raw.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\[K(\d+)\]/g, '<sup class="ag-cite">K$1</sup>');
    if (/^\s*[-*•]\s+/.test(l)) { if (!list) { html += "<ul>"; list = true; } html += `<li>${l.replace(/^\s*[-*•]\s+/, "")}</li>`; continue; }
    if (list) { html += "</ul>"; list = false; }
    html += l.trim() ? `<p>${l}</p>` : "";
  }
  return html + (list ? "</ul>" : "");
}
const TOOL_ICON = { preguntar: "?", que_cambio: "Δ", registros: "≡", simular: "◎", salud: "♥", medidas: "▤", conocimiento: "✺" };

/* ----------------------------- carga ----------------------------- */
async function load() {
  const [cat, agents, apps] = await Promise.all([api.agentCatalog(), api.listAgents(), api.listApps().catch(() => [])]);
  st.catalog = cat; st.agents = agents; st.apps = apps;
  try { st.kb = authService.can("knowledge:use") ? await api.kbSettings() : null; } catch { st.kb = null; }
  localStorage.setItem("ds.kb", st.kb?.enabled ? "1" : "0");
}

/* =============================== GALERÍA =============================== */
function galleryView() {
  const T = st.catalog.templates.filter((t) => t.id !== "custom");
  const mine = st.agents;
  const kbOn = !!st.kb?.enabled;
  main.innerHTML = `
    <section class="ag-hero">
      <div class="ag-hero-txt">
        <span class="ag-kicker">Agentes de IA · motor PROTHEO</span>
        <h1>Agentes que <em>trabajan con tus datos</em></h1>
        <p>Un agente es un <b>especialista</b> al que le das un rol, una aplicación y unas herramientas. Cuando le preguntas, <b>decide qué consultar</b>,
          usa las cifras reales de PROTHEO y te responde citando de dónde sale cada número. No inventa: si no lo puede comprobar, te lo dice.</p>
        <div class="ag-hero-cta">${canBuild() ? `<button type="button" class="q-btn primary" id="agNew">＋ Crear agente</button>` : ""}
          <a class="q-btn" href="#porque" id="agWhy">¿Para qué sirve?</a></div>
      </div>
      <div class="ag-hero-viz" aria-hidden="true">${heroViz()}</div>
    </section>

    <section class="ag-why" id="porque">
      ${[["◆", "Responde con cifras exactas", "«¿Por qué subió Andina?» → usa «Qué cambió y por qué», encuentra que fue E-commerce en Bogotá y te da el porcentaje del aumento."],
        ["▲", "Vigila lo que importa", "Un agente vigía revisa devoluciones, caídas y calidad de los datos, y te dice dónde mirar primero."],
        ["✎", "Escribe por ti", "Convierte los números en el resumen ejecutivo, los hallazgos para la junta o el mensaje para el gerente."],
        ["✺", "Aprende de lo que haces", "Si activas la base de conocimiento, recuerda lo que ya preguntaste, analizaste e informaste y lo usa como contexto."]]
        .map(([i, t, d]) => `<article><span>${i}</span><b>${t}</b><p>${d}</p></article>`).join("")}
    </section>

    <section class="ag-kb ${kbOn ? "on" : ""}">
      <div class="ag-kb-orb" aria-hidden="true">${neuralMini()}</div>
      <div class="ag-kb-txt">
        <b>Base de conocimiento ${kbOn ? "activa" : "apagada"}</b>
        <p>${kbOn
          ? `Tiene <b>${st.kb.stats.docs}</b> documentos y <b>${st.kb.stats.entities}</b> entidades conectadas. Se alimenta con tus preguntas, informes, agentes y hojas.`
          : "Es opcional y es tuya. Al activarla, PROTHEO guarda lo que preguntas, analizas e informas, lo conecta como una red neuronal y tus agentes lo usan como memoria. Nadie más la ve."}</p>
      </div>
      ${st.kb ? (kbOn ? `<a class="q-btn primary" href="conocimiento.html">Abrir conocimiento →</a>` : `<button type="button" class="q-btn primary" id="kbOn">Activar base de conocimiento</button>`) : ""}
    </section>

    <h2 class="ag-h2">Tus agentes <small>${mine.length}</small></h2>
    <div class="ag-grid">${mine.map(agentCard).join("") || `<p class="cfg-muted">Aún no tienes agentes. Empieza con una plantilla.</p>`}</div>

    ${canBuild() ? `<h2 class="ag-h2">Plantillas</h2>
    <div class="ag-grid tpl">${T.map((t) => `<button type="button" class="ag-tpl" data-tpl="${esc(t.id)}" style="--c:${esc(t.color)}">
      <span class="ag-ico">${esc(t.icon)}</span><b>${esc(t.label)}</b><p>${esc(t.description)}</p>
      <span class="ag-tools">${t.tools.map((x) => `<i title="${esc(st.catalog.tools.find((y) => y.id === x)?.label || x)}">${TOOL_ICON[x] || "•"}</i>`).join("")}</span></button>`).join("")}
      <button type="button" class="ag-tpl blank" data-tpl="custom"><span class="ag-ico">✦</span><b>En blanco</b><p>Tus propias instrucciones y herramientas.</p></button></div>` : ""}`;
  main.querySelector("#agNew")?.addEventListener("click", () => newAgent("analyst"));
  main.querySelectorAll("[data-tpl]").forEach((b) => b.addEventListener("click", () => newAgent(b.dataset.tpl)));
  main.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => openAgent(b.dataset.open)));
  main.querySelector("#agWhy")?.addEventListener("click", (e) => { e.preventDefault(); main.querySelector("#porque").scrollIntoView({ behavior: "smooth" }); });
  main.querySelector("#kbOn")?.addEventListener("click", enableKb);
}

function agentCard(a) {
  return `<button type="button" class="ag-card" data-open="${esc(a.id)}" style="--c:${esc(a.color || "#6366f1")}">
    <header><span class="ag-ico">${esc(a.icon || "◆")}</span><span class="ag-status ${a.status === "published" ? "on" : ""}">${a.status === "published" ? "Publicado" : "Borrador"}</span></header>
    <b>${esc(a.name)}</b><p>${esc(a.description || "")}</p>
    <footer><span>${esc(a.app_name || "Sin aplicación")}</span><span>${a.tools.length} herramienta(s) · ${a.uses || 0} uso(s) · ${esc(fmtAgo(a.last_used_at))}</span></footer>
  </button>`;
}

function heroViz() {
  // Agente al centro con herramientas en órbita (animado con CSS).
  const tools = ["?", "Δ", "≡", "◎", "♥", "▤", "✺"];
  return `<div class="ag-orbit">${tools.map((t, i) => `<span style="--i:${i};--n:${tools.length}">${t}</span>`).join("")}<div class="ag-core">✦</div></div>`;
}
function neuralMini() {
  const pts = Array.from({ length: 9 }, (_, i) => [50 + 36 * Math.cos((i / 9) * Math.PI * 2), 50 + 36 * Math.sin((i / 9) * Math.PI * 2)]);
  return `<svg viewBox="0 0 100 100">${pts.map((p, i) => pts.slice(i + 1).filter((_, j) => (i + j) % 3 === 0).map((q) => `<line x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}"/>`).join("")).join("")}
    ${pts.map((p) => `<line x1="50" y1="50" x2="${p[0]}" y2="${p[1]}"/>`).join("")}${pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="${3 + (i % 3)}" style="--d:${i * 0.2}s"/>`).join("")}<circle cx="50" cy="50" r="7" class="c"/></svg>`;
}

async function enableKb() {
  try {
    st.kb = await api.kbUpdateSettings({ enabled: true });
    localStorage.setItem("ds.kb", "1");
    renderNav("nav", { active: "agentes" });
    toast("Base de conocimiento activada. Aparece en el menú como «Conocimiento».");
    if (st.view === "gallery") galleryView(); else studioView();
  } catch (e) { toast(e.message, "err"); }
}

async function newAgent(template) {
  try {
    const firstApp = st.apps.find((a) => a.stage === "produccion") || st.apps[0];
    const a = await api.createAgent({ template, app_id: firstApp?.id || "" });
    st.agents.unshift(a);
    openAgent(a.id, a);
  } catch (e) { toast(e.message, "err"); }
}

async function openAgent(id, preloaded) {
  try {
    st.agent = preloaded || await api.getAgent(id);
    st.sel = "agent"; st.conv = null; st.msgs = []; st.view = "studio";
    history.replaceState(null, "", `?agent=${encodeURIComponent(id)}`);
    studioView();
  } catch (e) { toast(e.message, "err"); }
}

/* =============================== ESTUDIO =============================== */
const W = 1180, H = 720;
/** Posiciones de los nodos (guardadas en layout; si no, una disposición radial clara). */
function nodes() {
  const a = st.agent, L = a.layout || {};
  const pos = (id, x, y) => ({ x: L[id]?.x ?? x, y: L[id]?.y ?? y });
  const toolList = a.tools.map((t) => st.catalog.tools.find((x) => x.id === t)).filter(Boolean);
  const out = [
    { id: "in:chat", kind: "in", icon: "💬", title: "Chat en PROTHEO", sub: "Pruébalo aquí al lado", ...pos("in:chat", 40, 210) },
    { id: "in:flow", kind: "in", icon: "⚡", title: "Automatizaciones", sub: "Nodo «Agente de IA»", ...pos("in:flow", 40, 330) },
    { id: "in:mcp", kind: "in", icon: "⧉", title: "MCP", sub: "Tools agent_chat", ...pos("in:mcp", 40, 450) },
    { id: "agent", kind: "agent", ...pos("agent", 420, 300) },
    { id: "out:answer", kind: "out", icon: "✓", title: "Respuesta con fuentes", sub: "Cifra + de dónde sale", ...pos("out:answer", 900, 210) },
    { id: "out:trace", kind: "out", icon: "⌁", title: "Traza de herramientas", sub: "Qué consultó y cuánto tardó", ...pos("out:trace", 900, 330) },
    { id: "out:kb", kind: "out", icon: "✺", title: "Conocimiento", sub: st.kb?.enabled ? "Se guarda la conversación" : "Apagado", ...pos("out:kb", 900, 450), off: !st.kb?.enabled },
    { id: "p:brain", kind: "part", icon: "⬡", title: "Cerebro", sub: "Motor PROTHEO", ...pos("p:brain", 170, 590) },
    { id: "p:app", kind: "part", icon: "▦", title: "Datos", sub: a.app_name || "Sin aplicación", ...pos("p:app", 360, 600), off: !a.app_id },
    { id: "p:memory", kind: "part", icon: "↺", title: "Memoria", sub: a.memory ? `Últimos ${a.memory} turnos` : "Sin memoria", ...pos("p:memory", 550, 610), off: !a.memory },
    { id: "p:kb", kind: "part", icon: "✺", title: "Conocimiento", sub: a.knowledge ? (st.kb?.enabled ? "Usa tu base" : "Tu base está apagada") : "No lo usa", ...pos("p:kb", 740, 600), off: !a.knowledge || !st.kb?.enabled },
    { id: "p:guard", kind: "part", icon: "⛨", title: "Límites", sub: `${a.max_steps} pasos · ${a.guard_pii ? "oculta datos personales" : "sin filtro"}`, ...pos("p:guard", 930, 590) },
  ];
  // Herramientas en una banda superior (hasta 4 por fila) entre entradas y salidas: nunca se pisan.
  toolList.forEach((t, i) => {
    const row = Math.floor(i / 4), col = i % 4, inRow = Math.min(4, toolList.length - row * 4);
    const x0 = 255 + (640 - ((inRow - 1) * 190 + NODE_W.tool)) / 2;
    out.push({ id: `t:${t.id}`, kind: "tool", icon: TOOL_ICON[t.id] || "•", title: t.label, sub: t.id, tool: t.id, ...pos(`t:${t.id}`, Math.round(x0 + col * 190), 40 + row * 82) });
  });
  return out;
}
const NODE_W = { agent: 300, in: 190, out: 210, part: 170, tool: 170 }, NODE_H = { agent: 150, in: 62, out: 62, part: 66, tool: 56 };

function studioView() {
  const a = st.agent;
  main.innerHTML = `
    <div class="ag-studio">
      <header class="ag-bar">
        <button type="button" class="q-btn" id="agBack">‹ Agentes</button>
        <span class="ag-ico sm" style="--c:${esc(a.color)}">${esc(a.icon)}</span>
        <input class="ag-name" id="agName" value="${esc(a.name)}" maxlength="60" ${a.editable ? "" : "readonly"} aria-label="Nombre del agente" />
        <span class="ag-status ${a.status === "published" ? "on" : ""}" id="agStatus">${a.status === "published" ? "● Publicado" : "○ Borrador"}</span>
        <span class="ag-save" id="agSave"></span>
        <span class="ag-sp"></span>
        ${a.editable ? `<button type="button" class="q-btn" id="agFit" title="Reordenar nodos">⤢ Ordenar</button>
          <button type="button" class="q-btn ${a.status === "published" ? "" : "primary"}" id="agPub">${a.status === "published" ? "Pasar a borrador" : "Publicar ↗"}</button>` : ""}
      </header>
      <div class="ag-body">
        ${a.editable ? `<aside class="ag-pal" aria-label="Piezas">
          <h4>Herramientas</h4><p class="ag-hint">Solo lectura. Doble clic o arrastra para conectar.</p>
          ${st.catalog.tools.map((t) => `<div class="ag-pal-it ${a.tools.includes(t.id) ? "on" : ""}" draggable="true" data-pal="${esc(t.id)}" title="${esc(t.description)}">
            <i>${TOOL_ICON[t.id] || "•"}</i><span><b>${esc(t.label)}</b><small>${esc(t.description)}</small></span><em>${a.tools.includes(t.id) ? "✓" : "＋"}</em></div>`).join("")}
          <h4>Estilo de respuesta</h4>
          <div class="pm-chipset ag-style">${st.catalog.styles.map((s) => `<button type="button" data-style="${s.id}" class="${a.style === s.id ? "on" : ""}">${s.label}</button>`).join("")}</div>
        </aside>` : ""}
        <section class="ag-canvas" id="agCanvas" tabindex="0" aria-label="Lienzo del agente">
          <div class="ag-zoom"><button type="button" data-z="+">＋</button><button type="button" data-z="-">－</button><button type="button" data-z="0">⤢</button></div>
          <div class="ag-world" id="agWorld"></div>
        </section>
        <aside class="ag-side">
          <div class="ag-tabs"><button type="button" data-st="test" class="on">Probar</button><button type="button" data-st="cfg">Configurar</button></div>
          <div class="ag-side-b" id="agSide"></div>
        </aside>
      </div>
    </div>`;
  drawCanvas();
  sideTest();
  wireStudio();
}

function drawCanvas() {
  const a = st.agent, list = nodes(), world = main.querySelector("#agWorld");
  const byId = Object.fromEntries(list.map((n) => [n.id, n]));
  const center = (n) => ({ x: n.x + NODE_W[n.kind] / 2, y: n.y + NODE_H[n.kind] / 2 });
  const ag = byId.agent;
  const curve = (p, q, cls, label = "") => {
    const dx = Math.max(60, Math.abs(q.x - p.x) * 0.5);
    const d = Math.abs(q.y - p.y) > Math.abs(q.x - p.x) * 1.2
      ? `M${p.x},${p.y} C${p.x},${(p.y + q.y) / 2} ${q.x},${(p.y + q.y) / 2} ${q.x},${q.y}`
      : `M${p.x},${p.y} C${p.x + dx},${p.y} ${q.x - dx},${q.y} ${q.x},${q.y}`;
    return `<path class="ag-edge ${cls}" d="${d}"/>${label ? `<text class="ag-elabel" x="${(p.x + q.x) / 2}" y="${(p.y + q.y) / 2 - 6}">${esc(label)}</text>` : ""}`;
  };
  const agL = { x: ag.x, y: ag.y + NODE_H.agent / 2 }, agR = { x: ag.x + NODE_W.agent, y: ag.y + NODE_H.agent / 2 };
  const agB = { x: ag.x + NODE_W.agent / 2, y: ag.y + NODE_H.agent }, agT = { x: ag.x + NODE_W.agent / 2, y: ag.y };
  let edges = "";
  for (const n of list) {
    if (n.kind === "in") edges += curve({ x: n.x + NODE_W.in, y: n.y + NODE_H.in / 2 }, agL, "in");
    if (n.kind === "out") edges += curve(agR, { x: n.x, y: n.y + NODE_H.out / 2 }, `out ${n.off ? "off" : ""}`);
    if (n.kind === "part") edges += curve(agB, { x: n.x + NODE_W.part / 2, y: n.y }, `part ${n.off ? "off" : ""}`);
    if (n.kind === "tool") edges += curve(agT, { x: n.x + NODE_W.tool / 2, y: n.y + NODE_H.tool }, `tool ${st.lastTools?.includes(n.tool) ? "hot" : ""}`);
  }
  const node = (n) => {
    if (n.kind === "agent") {
      return `<div class="ag-node agent ${st.sel === "agent" ? "sel" : ""} ${st.busy ? "busy" : ""}" data-node="agent" style="left:${n.x}px;top:${n.y}px;--c:${esc(a.color)}">
        <div class="ag-pulse" aria-hidden="true"></div>
        <header><span class="ag-ico" style="--c:${esc(a.color)}">${esc(a.icon)}</span><div><b>${esc(a.name)}</b><small>Agente · razona y usa herramientas</small></div></header>
        <div class="ag-chips"><span>solo lectura</span><span>≤ ${a.max_steps} pasos</span>${a.guard_pii ? "<span>sin datos personales</span>" : ""}<span>${esc(st.catalog.styles.find((s) => s.id === a.style)?.label || "Breve")}</span></div>
        <i class="ag-port l"></i><i class="ag-port r"></i><i class="ag-port t"></i><i class="ag-port b"></i></div>`;
    }
    return `<div class="ag-node ${n.kind} ${n.off ? "off" : ""} ${st.sel === n.id ? "sel" : ""} ${n.kind === "tool" && st.lastTools?.includes(n.tool) ? "hot" : ""}" data-node="${esc(n.id)}" style="left:${n.x}px;top:${n.y}px">
      <span class="ag-nico">${esc(n.icon)}</span><div><b>${esc(n.title)}</b><small>${esc(n.sub)}</small></div>
      ${n.kind === "tool" && a.editable ? `<button type="button" class="ag-x" data-rm="${esc(n.tool)}" title="Quitar herramienta" aria-label="Quitar ${esc(n.title)}">✕</button>` : ""}</div>`;
  };
  world.style.width = W + "px"; world.style.height = H + "px";
  world.style.transform = `translate(${st.pan.x}px, ${st.pan.y}px) scale(${st.zoom})`;
  world.innerHTML = `<svg class="ag-edges" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${edges}</svg>
    <span class="ag-glabel" style="left:40px;top:170px">Entradas</span><span class="ag-glabel" style="left:900px;top:170px">Salidas</span>
    <span class="ag-glabel" style="left:170px;top:560px">Piezas del agente</span>${list.length > 12 ? `<span class="ag-glabel" style="left:440px;top:18px">Herramientas</span>` : ""}
    ${list.map(node).join("")}`;
}

/* ----------------------------- panel lateral ----------------------------- */
function sideTest() {
  const a = st.agent, side = main.querySelector("#agSide");
  const starters = a.starters?.length ? a.starters : [];
  side.innerHTML = `
    <div class="ag-chat">
      <div class="ag-convbar"><select id="agConv" aria-label="Conversación"><option value="">Conversación nueva</option></select>
        <button type="button" class="cfg-icon" id="agConvDel" title="Borrar conversación" aria-label="Borrar conversación">${svg("trash")}</button></div>
      <div class="ag-msgs" id="agMsgs">${st.msgs.length ? st.msgs.map(msgHtml).join("") : `
        <div class="ag-empty"><span class="ag-ico" style="--c:${esc(a.color)}">${esc(a.icon)}</span><b>${esc(a.name)}</b>
          <p>${a.app_id ? `Pregúntale sobre <b>${esc(a.app_name || "la aplicación")}</b>. Verás cada herramienta que usa y su resultado.` : "Elige una aplicación en Configurar para que pueda consultar datos."}</p>
          ${starters.map((s) => `<button type="button" class="ag-starter" data-q="${esc(s)}">${esc(s)}</button>`).join("")}</div>`}</div>
      <form class="ag-input" id="agForm"><textarea id="agQ" rows="2" maxlength="2000" placeholder="Escribe una pregunta… (Enter para enviar)" ${st.busy ? "disabled" : ""}></textarea>
        <button type="submit" class="q-btn primary" ${st.busy ? "disabled" : ""}>${st.busy ? "…" : "Enviar"}</button></form>
    </div>`;
  const msgs = side.querySelector("#agMsgs"); msgs.scrollTop = msgs.scrollHeight;
  api.agentConversations(a.id).then((list) => {
    const sel = side.querySelector("#agConv"); if (!sel) return;
    sel.innerHTML = `<option value="">Conversación nueva</option>` + list.map((c) => `<option value="${esc(c.id)}" ${st.conv === c.id ? "selected" : ""}>${esc(c.title || "Sin título")} · ${c.messages / 2 | 0}</option>`).join("");
  }).catch(() => {});
  side.querySelector("#agConv").addEventListener("change", async (e) => {
    st.conv = e.target.value || null;
    st.msgs = st.conv ? (await api.agentConversation(a.id, st.conv)).messages : [];
    sideTest();
  });
  side.querySelector("#agConvDel").addEventListener("click", async () => {
    if (!st.conv) { st.msgs = []; sideTest(); return; }
    await api.deleteAgentConversation(a.id, st.conv).catch((e) => toast(e.message, "err"));
    st.conv = null; st.msgs = []; sideTest();
  });
  side.querySelectorAll("[data-q]").forEach((b) => b.addEventListener("click", () => send(b.dataset.q)));
  const q = side.querySelector("#agQ");
  q.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(q.value); } });
  side.querySelector("#agForm").addEventListener("submit", (e) => { e.preventDefault(); send(q.value); });
  side.querySelectorAll(".ag-step > summary").forEach(() => {});
  if (!st.busy) q.focus();
}

function msgHtml(m) {
  if (m.role === "user") return `<div class="ag-m u"><div>${esc(m.content)}</div></div>`;
  if (m.pending) return `<div class="ag-m a pending"><div class="ag-think"><i></i><i></i><i></i><span>Pensando y consultando los datos…</span></div></div>`;
  const steps = m.steps || [];
  return `<div class="ag-m a ${m.error ? "err" : ""}">
    ${steps.length ? `<div class="ag-trace">${steps.map((s, i) => `<details class="ag-step ${s.ok ? "" : "bad"}"><summary><i>${TOOL_ICON[s.tool] || "•"}</i><b>${esc(s.label || s.tool)}</b>
      <span>${s.ok ? "✓" : "✕"} ${s.ms != null ? `${(s.ms / 1000).toLocaleString("es-CO", { maximumFractionDigits: 1 })} s` : ""}</span></summary>
      <div><small>Entrada</small><code>${esc(JSON.stringify(s.input || {}))}</code><small>Resultado</small><pre>${esc(s.result || "")}</pre></div></details>`).join("")}</div>` : ""}
    <div class="ag-ans">${m.error ? esc(m.error) : md(m.content)}</div>
    ${m.knowledge?.length ? `<div class="ag-srcs">${m.knowledge.map((k, i) => `<span title="${esc(k.kind)}"><sup>K${i + 1}</sup>${esc(k.title)}</span>`).join("")}</div>` : ""}
    ${m.ms ? `<small class="ag-meta">${(m.ms / 1000).toLocaleString("es-CO", { maximumFractionDigits: 1 })} s · ${steps.length} herramienta(s)</small>` : ""}
  </div>`;
}

async function send(text) {
  text = String(text || "").trim();
  if (!text || st.busy) return;
  const a = st.agent;
  st.busy = true;
  st.msgs.push({ role: "user", content: text }, { role: "assistant", pending: true });
  drawCanvas(); sideTest();
  try {
    const r = await api.agentChat(a.id, text, st.conv);
    st.msgs.pop();
    if (!r.ok) st.msgs.push({ role: "assistant", error: r.error || "No se pudo responder.", steps: r.steps || [] });
    else {
      st.conv = r.conversation_id;
      st.msgs.push({ role: "assistant", content: r.answer, steps: r.steps, knowledge: r.knowledge, ms: r.duration_ms });
      st.lastTools = (r.steps || []).map((s) => s.tool);
    }
  } catch (e) {
    st.msgs.pop(); st.msgs.push({ role: "assistant", error: e.message });
  }
  st.busy = false;
  drawCanvas(); sideTest();
  setTimeout(() => { st.lastTools = []; if (st.view === "studio") drawCanvas(); }, 6000);
}

/* ----------------------------- configurar ----------------------------- */
function sideConfig() {
  const a = st.agent, side = main.querySelector("#agSide"), ro = a.editable ? "" : "disabled";
  const sel = st.sel;
  const T = st.catalog.templates.find((t) => t.id === a.template);
  const toolInfo = sel.startsWith("t:") ? st.catalog.tools.find((t) => t.id === sel.slice(2)) : null;
  side.innerHTML = `<div class="ag-cfg">
    ${toolInfo ? `<div class="ag-cfg-focus"><span class="ag-nico">${TOOL_ICON[toolInfo.id]}</span><div><b>${esc(toolInfo.label)}</b><p>${esc(toolInfo.description)}</p>
      <code>${esc(toolInfo.usage)}</code>${a.editable ? `<button type="button" class="q-btn sm danger" data-rm="${esc(toolInfo.id)}">Quitar del agente</button>` : ""}</div></div>` : ""}
    <label>Descripción<input id="cDesc" value="${esc(a.description || "")}" maxlength="240" ${ro}/></label>
    <div class="ag-row"><label>Ícono<input id="cIcon" value="${esc(a.icon || "")}" maxlength="2" ${ro}/></label>
      <label>Color<input id="cColor" type="color" value="${esc(a.color || "#6366f1")}" ${ro}/></label></div>
    <label>Aplicación (datos)<select id="cApp" ${ro}><option value="">Sin aplicación</option>${st.apps.map((x) => `<option value="${esc(x.id)}" ${x.id === a.app_id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>
      <small>El agente consulta esta app con los permisos de quien conversa.</small></label>
    <label>Rol base<input value="${esc(T?.label || a.template)}" disabled/><small>${esc(T?.role || "")}</small></label>
    <label>Instrucciones<textarea id="cIns" rows="6" maxlength="4000" placeholder="p. ej. «Cuando hables de margen usa siempre el % Margen certificado. Prioriza las regiones con más devoluciones.»" ${ro}>${esc(a.instructions || "")}</textarea></label>
    <div class="ag-row"><label>Memoria (turnos)<input id="cMem" type="number" min="0" max="20" value="${a.memory}" ${ro}/></label>
      <label>Pasos máximos<input id="cSteps" type="number" min="1" max="8" value="${a.max_steps}" ${ro}/></label></div>
    <label class="ag-sw"><span>Usar la base de conocimiento<small>${st.kb?.enabled ? "Busca en lo que ya preguntaste e informaste." : "Tu base está apagada."}</small></span>
      <input type="checkbox" id="cKb" ${a.knowledge ? "checked" : ""} ${ro}/></label>
    <label class="ag-sw"><span>Ocultar datos personales<small>Correos, teléfonos y documentos salen como •••.</small></span><input type="checkbox" id="cPii" ${a.guard_pii ? "checked" : ""} ${ro}/></label>
    <label>Preguntas sugeridas (una por línea)<textarea id="cStart" rows="3" ${ro}>${esc((a.starters || []).join("\n"))}</textarea></label>
    ${st.kb && !st.kb.enabled ? `<button type="button" class="q-btn" id="cKbOn">Activar mi base de conocimiento</button>` : ""}
    ${a.editable ? `<button type="button" class="q-btn danger" id="cDel">${svg("trash")} Eliminar agente</button>` : ""}
    <p class="ag-hint">Motor: ${esc(st.catalog.brain.label)} · ${esc(st.catalog.brain.model)}. Las herramientas son de solo lectura: el agente no modifica datos.</p>
  </div>`;
  if (!a.editable) return;
  const bind = (id, key, conv = (v) => v, ev = "input") => side.querySelector(id)?.addEventListener(ev, (e) => patch({ [key]: conv(e.target.type === "checkbox" ? e.target.checked : e.target.value) }));
  bind("#cDesc", "description"); bind("#cIcon", "icon"); bind("#cColor", "color"); bind("#cIns", "instructions");
  bind("#cApp", "app_id", (v) => v, "change"); bind("#cMem", "memory", Number, "change"); bind("#cSteps", "max_steps", Number, "change");
  bind("#cKb", "knowledge", Boolean, "change"); bind("#cPii", "guard_pii", Boolean, "change");
  bind("#cStart", "starters", (v) => v.split("\n").map((x) => x.trim()).filter(Boolean));
  side.querySelector("#cKbOn")?.addEventListener("click", enableKb);
  side.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => toggleTool(b.dataset.rm, false)));
  side.querySelector("#cDel")?.addEventListener("click", async () => {
    if (!confirm(`¿Eliminar el agente «${a.name}» y sus conversaciones?`)) return;
    try { await api.deleteAgent(a.id); st.agents = st.agents.filter((x) => x.id !== a.id); toast("Agente eliminado."); back(); } catch (e) { toast(e.message, "err"); }
  });
}

/** Guarda con un pequeño retraso (como el editor de automatizaciones). */
function patch(p, redraw = true) {
  Object.assign(st.agent, p);
  if (p.app_id !== undefined) st.agent.app_name = st.apps.find((x) => x.id === p.app_id)?.name || null;
  const s = main.querySelector("#agSave"); if (s) s.textContent = "Guardando…";
  clearTimeout(st.saveT);
  st.saveT = setTimeout(async () => {
    try {
      const saved = await api.updateAgent(st.agent.id, p.layout ? { layout: st.agent.layout } : p);
      Object.assign(st.agent, { ...saved, layout: st.agent.layout });
      const i = st.agents.findIndex((x) => x.id === saved.id); if (i >= 0) st.agents[i] = saved;
      const el = main.querySelector("#agSave"); if (el) el.textContent = "✓ Guardado";
    } catch (e) { toast(e.message, "err"); const el = main.querySelector("#agSave"); if (el) el.textContent = "No se guardó"; }
  }, p.layout ? 500 : 450);
  if (redraw && !p.layout && !("instructions" in p) && !("description" in p) && !("starters" in p)) drawCanvas();
}

function toggleTool(id, on) {
  const a = st.agent;
  const set = new Set(a.tools);
  if (on ?? !set.has(id)) set.add(id); else set.delete(id);
  const tools = st.catalog.tools.map((t) => t.id).filter((t) => set.has(t));
  if (st.sel === `t:${id}` && !set.has(id)) st.sel = "agent";
  patch({ tools });
  main.querySelectorAll(`[data-pal="${id}"]`).forEach((el) => { el.classList.toggle("on", set.has(id)); el.querySelector("em").textContent = set.has(id) ? "✓" : "＋"; });
  if (main.querySelector(".ag-tabs .on")?.dataset.st === "cfg") sideConfig();
}

/* ----------------------------- interacción ----------------------------- */
function wireStudio() {
  const a = st.agent;
  main.querySelector("#agBack").addEventListener("click", back);
  main.querySelector("#agName")?.addEventListener("input", (e) => { patch({ name: e.target.value }, false); main.querySelector(".ag-node.agent b").textContent = e.target.value; });
  main.querySelector("#agPub")?.addEventListener("click", async () => {
    const to = a.status === "published" ? "draft" : "published";
    try { Object.assign(st.agent, await api.updateAgent(a.id, { status: to })); toast(to === "published" ? "Agente publicado: lo pueden usar quienes vean su aplicación." : "Agente devuelto a borrador."); studioView(); }
    catch (e) { toast(e.message, "err"); }
  });
  main.querySelector("#agFit")?.addEventListener("click", () => { st.agent.layout = {}; st.pan = { x: 0, y: 0 }; st.zoom = fitZoom(); patch({ layout: {} }); drawCanvas(); });
  main.querySelectorAll(".ag-tabs [data-st]").forEach((b) => b.addEventListener("click", () => {
    main.querySelectorAll(".ag-tabs button").forEach((x) => x.classList.toggle("on", x === b));
    if (b.dataset.st === "test") sideTest(); else sideConfig();
  }));
  main.querySelectorAll("[data-style]").forEach((b) => b.addEventListener("click", () => {
    main.querySelectorAll("[data-style]").forEach((x) => x.classList.toggle("on", x === b)); patch({ style: b.dataset.style });
  }));
  // Paleta: doble clic o arrastrar al lienzo
  main.querySelectorAll("[data-pal]").forEach((el) => {
    el.addEventListener("dblclick", () => toggleTool(el.dataset.pal));
    el.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/tool", el.dataset.pal));
  });
  const canvas = main.querySelector("#agCanvas");
  canvas.addEventListener("dragover", (e) => { if (a.editable) { e.preventDefault(); canvas.classList.add("drop"); } });
  canvas.addEventListener("dragleave", () => canvas.classList.remove("drop"));
  canvas.addEventListener("drop", (e) => { e.preventDefault(); canvas.classList.remove("drop"); const t = e.dataTransfer.getData("text/tool"); if (t) toggleTool(t, true); });
  // Zoom
  main.querySelectorAll("[data-z]").forEach((b) => b.addEventListener("click", () => {
    st.zoom = b.dataset.z === "0" ? fitZoom() : Math.max(0.4, Math.min(1.6, st.zoom + (b.dataset.z === "+" ? 0.1 : -0.1)));
    if (b.dataset.z === "0") st.pan = { x: 0, y: 0 };
    drawCanvas();
  }));
  canvas.addEventListener("wheel", (e) => { e.preventDefault(); st.zoom = Math.max(0.4, Math.min(1.6, st.zoom * (e.deltaY < 0 ? 1.08 : 0.93))); drawCanvas(); }, { passive: false });
  // Arrastrar nodos y desplazar el lienzo
  let drag = null;
  canvas.addEventListener("pointerdown", (e) => {
    if (e.target.closest("[data-rm]") || e.target.closest(".ag-zoom")) return;
    const n = e.target.closest("[data-node]");
    if (n) {
      st.sel = n.dataset.node;
      main.querySelectorAll(".ag-node").forEach((x) => x.classList.toggle("sel", x === n));
      const list = nodes(), node = list.find((x) => x.id === n.dataset.node);
      drag = { kind: "node", id: node.id, sx: e.clientX, sy: e.clientY, ox: node.x, oy: node.y, moved: false };
      if (main.querySelector(".ag-tabs .on")?.dataset.st === "cfg" || n.dataset.node !== "in:chat") {
        main.querySelectorAll(".ag-tabs button").forEach((x) => x.classList.toggle("on", x.dataset.st === (n.dataset.node === "in:chat" ? "test" : "cfg")));
        if (n.dataset.node === "in:chat") sideTest(); else sideConfig();
      }
    } else drag = { kind: "pan", sx: e.clientX, sy: e.clientY, ox: st.pan.x, oy: st.pan.y };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = (e.clientX - drag.sx), dy = (e.clientY - drag.sy);
    if (drag.kind === "pan") { st.pan = { x: drag.ox + dx, y: drag.oy + dy }; main.querySelector("#agWorld").style.transform = `translate(${st.pan.x}px, ${st.pan.y}px) scale(${st.zoom})`; return; }
    if (!a.editable) return;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    st.agent.layout = { ...(st.agent.layout || {}), [drag.id]: { x: Math.round(drag.ox + dx / st.zoom), y: Math.round(drag.oy + dy / st.zoom) } };
    drawCanvas();
  });
  canvas.addEventListener("pointerup", () => { if (drag?.kind === "node" && drag.moved) patch({ layout: st.agent.layout }); drag = null; });
  canvas.addEventListener("click", (e) => { const b = e.target.closest("[data-rm]"); if (b) toggleTool(b.dataset.rm, false); });
  canvas.addEventListener("keydown", (e) => {
    if ((e.key === "Delete" || e.key === "Backspace") && st.sel.startsWith("t:") && a.editable) toggleTool(st.sel.slice(2), false);
  });
  st.zoom = fitZoom();
  drawCanvas();
}

function fitZoom() {
  const c = main.querySelector("#agCanvas");
  if (!c) return 1;
  return Math.max(0.45, Math.min(1, (c.clientWidth - 30) / W, (c.clientHeight - 30) / H));
}

function back() {
  st.view = "gallery"; st.agent = null;
  history.replaceState(null, "", "agentes.html");
  api.listAgents().then((l) => { st.agents = l; galleryView(); }).catch(() => galleryView());
}

/* ----------------------------- arranque ----------------------------- */
renderNav("nav", { active: "agentes" });
wireAppsButton();
renderProfileMenu(authService);

(async () => {
  main.innerHTML = `<p class="cfg-muted" style="padding:24px">Cargando agentes…</p>`;
  try { await authService.refresh(); await load(); }
  catch (e) { main.innerHTML = `<p class="cfg-err" style="padding:24px">No se pudieron cargar los agentes: ${esc(e.message)}</p>`; return; }
  renderNav("nav", { active: "agentes" });
  const want = new URLSearchParams(location.search).get("agent");
  if (want && st.agents.some((x) => x.id === want)) openAgent(want); else galleryView();
  window.addEventListener("resize", () => { if (st.view === "studio") { st.zoom = fitZoom(); drawCanvas(); } });
})();

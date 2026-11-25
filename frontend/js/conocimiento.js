// conocimiento.js — Base de conocimiento personal de PROTHEO.
//
// Apagada por defecto: la persona la activa. Al activarla se alimenta sola con lo que hace en la plataforma
// (preguntas, IA, qué cambió, informes, agentes, hojas, medidas, cuadernos) y se ve como una red neuronal:
// cada nodo es una entidad (app, medida, dimensión, valor como «Andina») y cada línea, que aparecieron juntas.
//  · Vista de grafo: simulación de fuerzas en canvas, zoom y arrastre, búsqueda que ilumina, clic para ver documentos.
//  · Vista de lista: documentos con su fuente, entidades y fecha; búsqueda por relevancia.
//  · Fuentes: qué alimenta la base (cada una se puede apagar).
//  · Ajustes: activar/apagar, retención, exportar y vaciar.

import { renderNav, wireAppsButton, renderProfileMenu } from "./hub-nav.js";
import { authService } from "./auth-service.js";
import * as api from "./api.js";

if (!authService.isAuthenticated()) location.replace("index.html");

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const main = document.getElementById("main");
const TYPE = {
  app: { label: "Aplicación", color: "#f59e0b" }, measure: { label: "Medida", color: "#6366f1" }, dimension: { label: "Dimensión", color: "#22d3ee" },
  field: { label: "Campo", color: "#0ea5e9" }, value: { label: "Valor", color: "#10b981" }, agent: { label: "Agente", color: "#f472b6" },
  concept: { label: "Concepto", color: "#a855f7" }, report: { label: "Informe", color: "#8b5cf6" }, doc: { label: "Documento", color: "#94a3b8" },
};
const KIND = { ask: "Pregunta", ai: "Asistente", insight: "Qué cambió", report: "Informe", agent: "Agente", sheet: "Hoja", master: "Capa de negocio", notebook: "Cuaderno", note: "Nota" };
const tcolor = (t) => (TYPE[String(t).startsWith("doc:") ? "doc" : t] || TYPE.concept).color;
const st = { settings: null, tab: "grafo", graph: null, sim: null, sel: null, q: "", hits: null, docs: [], kind: "", app: "", paused: false, withDocs: false, apps: [] };

function toast(msg, kind = "ok") {
  let host = document.getElementById("kbToasts");
  if (!host) { host = document.createElement("div"); host.id = "kbToasts"; host.className = "cfg-toasts"; document.body.appendChild(host); }
  const t = document.createElement("div"); t.className = `cfg-toast ${kind}`; t.textContent = msg; host.appendChild(t);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 300); }, 3200);
}
const fmt = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleString("es-CO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); };

/* =============================== APAGADA =============================== */
function offView() {
  stopSim();
  main.innerHTML = `
    <section class="kb-off">
      <div class="kb-off-orb" aria-hidden="true"><canvas id="kbOrb" width="360" height="360"></canvas></div>
      <div>
        <span class="ag-kicker">Opcional · solo para ti</span>
        <h1>Tu base de conocimiento</h1>
        <p>Cuando la actives, PROTHEO guardará lo que <b>preguntas</b>, lo que te responde la <b>IA</b>, los <b>«qué cambió»</b>, tus <b>informes</b>,
          tus conversaciones con <b>agentes</b> y las <b>hojas y medidas</b> que creas. Conecta todo como una red: «Andina», «Ventas netas» y «E-commerce»
          quedan unidos si aparecieron juntos. Luego puedes <b>buscar</b> en todo y tus <b>agentes lo usan como memoria</b>.</p>
        <ul class="kb-off-list"><li>Nadie más la ve, ni el administrador.</li><li>Eliges qué fuentes la alimentan y cuánto tiempo se guarda.</li>
          <li>Puedes exportarla o vaciarla cuando quieras.</li><li>Si la apagas, deja de guardar al instante.</li></ul>
        <button type="button" class="q-btn primary big" id="kbOn">Activar mi base de conocimiento</button>
      </div>
    </section>`;
  main.querySelector("#kbOn").addEventListener("click", async () => {
    try { st.settings = await api.kbUpdateSettings({ enabled: true }); localStorage.setItem("ds.kb", "1"); renderNav("nav", { active: "conocimiento" }); toast("Activada: desde ahora se alimenta con lo que haces."); render(); }
    catch (e) { toast(e.message, "err"); }
  });
  orbAnim(main.querySelector("#kbOrb"));
}

function orbAnim(cv) {
  if (!cv) return;
  const ctx = cv.getContext("2d"), N = 46, pts = Array.from({ length: N }, () => ({ a: Math.random() * 6.28, b: Math.random() * 3.14, r: 120 + Math.random() * 30, s: Math.random() }));
  const step = (t) => {
    if (!document.body.contains(cv)) return;
    ctx.clearRect(0, 0, 360, 360);
    const P = pts.map((p) => { const a = p.a + t / 4000; const x = Math.cos(a) * Math.sin(p.b) * p.r, z = Math.sin(a) * Math.sin(p.b) * p.r, y = Math.cos(p.b) * p.r; const f = 300 / (300 + z); return [180 + x * f, 180 + y * f, f]; });
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) { const dx = P[i][0] - P[j][0], dy = P[i][1] - P[j][1], d = dx * dx + dy * dy; if (d < 3600) { ctx.strokeStyle = `rgba(129,140,248,${(1 - d / 3600) * 0.35})`; ctx.beginPath(); ctx.moveTo(P[i][0], P[i][1]); ctx.lineTo(P[j][0], P[j][1]); ctx.stroke(); } }
    P.forEach((p, i) => { ctx.fillStyle = i % 5 ? `rgba(165,180,252,${0.35 + p[2] * 0.4})` : "#22d3ee"; ctx.beginPath(); ctx.arc(p[0], p[1], 2 + p[2] * 2.2, 0, 6.28); ctx.fill(); });
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* =============================== ESTRUCTURA =============================== */
function render() {
  if (!st.settings?.enabled) return offView();
  const s = st.settings.stats;
  main.innerHTML = `
    <div class="kb-head"><div><h1>Conocimiento</h1><p>Lo que has preguntado, analizado e informado en PROTHEO, conectado como una red.</p></div></div>
    <div class="kb-status"><span class="kb-dot"></span><b>Base activa</b> · ${s.docs} documentos · ${s.entities} entidades · ${s.edges} conexiones${s.last_at ? ` · último ${esc(fmt(s.last_at))}` : ""}</div>
    <div class="cfg-tabs kb-tabs">${[["grafo", "Vista de grafo"], ["lista", "Vista de lista"], ["fuentes", "Fuentes"], ["ajustes", "Ajustes"]].map(([id, l]) =>
      `<button type="button" class="cfg-tab ${st.tab === id ? "on" : ""}" data-tab="${id}">${l}</button>`).join("")}</div>
    <div id="kbPane"></div>`;
  main.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { st.tab = b.dataset.tab; history.replaceState(null, "", `?tab=${st.tab}`); render(); }));
  ({ grafo: graphView, lista: listView, fuentes: sourcesView, ajustes: settingsView })[st.tab]();
}

/* =============================== GRAFO =============================== */
async function graphView() {
  const pane = main.querySelector("#kbPane");
  pane.innerHTML = `
    <div class="kb-gbar">
      <div class="cfg-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input id="kbQ" type="search" placeholder="Buscar en el grafo y en los documentos" value="${esc(st.q)}" /></div>
      <span class="kb-count" id="kbCount">…</span>
      <button type="button" class="q-btn" id="kbCenter">⟲ Recentrar</button>
      <button type="button" class="q-btn ${st.paused ? "" : "on"}" id="kbPause">${st.paused ? "▶ Animar" : "❚❚ Pausar"}</button>
      <select id="kbKind"><option value="">Todas las fuentes</option>${Object.entries(KIND).map(([k, l]) => `<option value="${k}" ${st.kind === k ? "selected" : ""}>${l}</option>`).join("")}</select>
      <label class="pm-check"><input type="checkbox" id="kbDocs" ${st.withDocs ? "checked" : ""}/> Mostrar documentos</label>
      <span class="kb-legend">${["app", "measure", "dimension", "field", "value", "agent", "concept"].map((t) => `<span><i style="background:${TYPE[t].color}"></i>${TYPE[t].label}</span>`).join("")}</span>
    </div>
    <div class="kb-gwrap"><canvas id="kbCanvas"></canvas><div class="kb-tip" id="kbTip" hidden></div>
      <aside class="kb-detail" id="kbDetail" hidden></aside>
      <div class="kb-hits" id="kbHits" hidden></div></div>`;
  try { st.graph = await api.kbGraph({ limit: 220, kind: st.kind, docs: st.withDocs }); }
  catch (e) { pane.querySelector(".kb-gwrap").innerHTML = `<p class="cfg-err">${esc(e.message)}</p>`; return; }
  pane.querySelector("#kbCount").textContent = `${st.graph.nodes.length} nodos, ${st.graph.edges.length} aristas`;
  if (!st.graph.nodes.length) {
    pane.querySelector(".kb-gwrap").innerHTML = `<div class="kb-empty"><b>La red aún está vacía.</b><p>Haz una pregunta en «Pregúntale a tus datos», genera una historia en Informes o conversa con un agente: cada cosa aparece aquí como nodos conectados.</p></div>`;
    return;
  }
  startSim(pane.querySelector("#kbCanvas"));
  const q = pane.querySelector("#kbQ");
  let t;
  q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => runSearch(q.value), 250); });
  if (st.q) runSearch(st.q);
  pane.querySelector("#kbCenter").addEventListener("click", () => { st.sim.view = { x: 0, y: 0, k: 1 }; st.sim.alpha = 0.6; });
  pane.querySelector("#kbPause").addEventListener("click", (e) => { st.paused = !st.paused; e.target.textContent = st.paused ? "▶ Animar" : "❚❚ Pausar"; e.target.classList.toggle("on", !st.paused); if (!st.paused) st.sim.alpha = Math.max(st.sim.alpha, 0.3); });
  pane.querySelector("#kbKind").addEventListener("change", (e) => { st.kind = e.target.value; graphView(); });
  pane.querySelector("#kbDocs").addEventListener("change", (e) => { st.withDocs = e.target.checked; graphView(); });
}

async function runSearch(q) {
  st.q = q;
  const box = main.querySelector("#kbHits");
  if (!q.trim()) { st.hits = null; if (box) box.hidden = true; return; }
  try {
    const r = await api.kbSearch(q, { limit: 8 });
    st.hits = new Set();
    r.entities.forEach((e) => st.hits.add(e.key));
    r.results.forEach((d) => (d.entities || []).forEach((e) => st.hits.add(e.key)));
    if (st.sim) st.sim.alpha = Math.max(st.sim.alpha, 0.15);
    if (!box) return;
    box.hidden = false;
    box.innerHTML = `<header><b>${r.total} resultado(s)</b><button type="button" data-close>✕</button></header>` + (r.results.map((d) => `<button type="button" class="kb-hit" data-doc="${esc(d.id)}">
      <span class="kb-kind k-${esc(d.kind)}">${esc(KIND[d.kind] || d.kind)}</span><b>${esc(d.title)}</b><small>${esc(d.snippet || "")}</small><em>${(d.score ?? 0).toLocaleString("es-CO")}</em></button>`).join("") || `<p class="cfg-muted">Nada coincide.</p>`);
    box.querySelector("[data-close]").addEventListener("click", () => { box.hidden = true; st.hits = null; main.querySelector("#kbQ").value = ""; st.q = ""; });
    box.querySelectorAll("[data-doc]").forEach((b) => b.addEventListener("click", () => docModal(r.results.find((d) => d.id === b.dataset.doc))));
  } catch (e) { toast(e.message, "err"); }
}

function stopSim() { if (st.sim) { st.sim.stop = true; st.sim = null; } }

/** Simulación de fuerzas en canvas: repulsión, resortes en las aristas, gravedad al centro. Sin librerías. */
function startSim(cv) {
  stopSim();
  const g = st.graph, wrap = cv.parentElement, DPR = Math.min(2, devicePixelRatio || 1);
  const maxW = Math.max(...g.nodes.map((n) => n.weight || 1));
  const nodes = g.nodes.map((n, i) => {
    const ang = i * 2.399963, r = 30 + 9 * Math.sqrt(i);
    return { ...n, x: Math.cos(ang) * r, y: Math.sin(ang) * r, vx: 0, vy: 0, r: (String(n.type).startsWith("doc:") ? 3.5 : 5) + 15 * Math.sqrt((n.weight || 1) / maxW) };
  });
  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  const edges = g.edges.map((e) => ({ a: idx.get(e.source), b: idx.get(e.target), w: e.weight || 1 })).filter((e) => e.a != null && e.b != null);
  const deg = new Map(); edges.forEach((e) => { deg.set(e.a, (deg.get(e.a) || 0) + 1); deg.set(e.b, (deg.get(e.b) || 0) + 1); });
  const nb = nodes.map(() => new Set()); edges.forEach((e) => { nb[e.a].add(e.b); nb[e.b].add(e.a); });
  const sim = st.sim = { nodes, edges, alpha: 1, view: { x: 0, y: 0, k: 1 }, hover: -1, drag: -1, stop: false, pulses: [] };
  let W = 0, H = 0;
  const size = () => { W = wrap.clientWidth; H = wrap.clientHeight; cv.width = W * DPR; cv.height = H * DPR; cv.style.width = W + "px"; cv.style.height = H + "px"; };
  size(); new ResizeObserver(size).observe(wrap);
  const toWorld = (px, py) => ({ x: (px - W / 2 - sim.view.x) / sim.view.k, y: (py - H / 2 - sim.view.y) / sim.view.k });
  const pick = (px, py) => { const p = toWorld(px, py); let best = -1, bd = 1e9; nodes.forEach((n, i) => { const d = (n.x - p.x) ** 2 + (n.y - p.y) ** 2; if (d < (n.r + 4) ** 2 && d < bd) { bd = d; best = i; } }); return best; };
  const dark = () => document.documentElement.getAttribute("data-theme") === "dark";

  function tick() {
    const a = sim.alpha;
    if (a < 0.002) return;
    for (let i = 0; i < nodes.length; i++) {
      const ni = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const nj = nodes[j]; let dx = ni.x - nj.x, dy = ni.y - nj.y; let d2 = dx * dx + dy * dy || 0.01;
        if (d2 > 90000) continue;
        const f = (1800 * a) / d2; const d = Math.sqrt(d2); dx /= d; dy /= d;
        ni.vx += dx * f; ni.vy += dy * f; nj.vx -= dx * f; nj.vy -= dy * f;
      }
    }
    for (const e of edges) {
      const A = nodes[e.a], B = nodes[e.b]; const dx = B.x - A.x, dy = B.y - A.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
      const target = 70 + (A.r + B.r) * 1.4, k = 0.04 * a * Math.min(3, 1 + Math.log(e.w));
      const f = (d - target) * k / d; A.vx += dx * f; A.vy += dy * f; B.vx -= dx * f; B.vy -= dy * f;
    }
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]; if (i === sim.drag) { n.vx = n.vy = 0; continue; }
      n.vx -= n.x * 0.012 * a; n.vy -= n.y * 0.012 * a;
      n.vx *= 0.82; n.vy *= 0.82; n.x += n.vx; n.y += n.vy;
    }
    sim.alpha *= 0.985;
  }

  function draw(t) {
    if (sim.stop || !document.body.contains(cv)) return;
    if (!st.paused) tick();
    const ctx = cv.getContext("2d"); ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, W, H);
    ctx.save(); ctx.translate(W / 2 + sim.view.x, H / 2 + sim.view.y); ctx.scale(sim.view.k, sim.view.k);
    const focus = sim.hover >= 0 ? sim.hover : st.sel != null ? idx.get(st.sel) ?? -1 : -1;
    const lit = (i) => (st.hits ? st.hits.has(nodes[i].id) : true) && (focus < 0 || i === focus || nb[focus].has(i));
    const dk = dark();
    // aristas
    for (const e of edges) {
      const A = nodes[e.a], B = nodes[e.b]; const on = lit(e.a) && lit(e.b);
      ctx.strokeStyle = on ? (dk ? `rgba(148,163,255,${Math.min(0.55, 0.12 + e.w * 0.06)})` : `rgba(79,70,229,${Math.min(0.45, 0.1 + e.w * 0.05)})`) : dk ? "rgba(148,163,184,.05)" : "rgba(100,116,139,.06)";
      ctx.lineWidth = Math.min(3, 0.6 + Math.log(1 + e.w)) / sim.view.k ** 0.3;
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
    }
    // impulsos que viajan por las aristas (sinapsis)
    if (!st.paused && edges.length && Math.random() < 0.35) sim.pulses.push({ e: edges[(Math.random() * edges.length) | 0], t: 0 });
    sim.pulses = sim.pulses.filter((p) => (p.t += 0.018) < 1);
    for (const p of sim.pulses) {
      const A = nodes[p.e.a], B = nodes[p.e.b]; if (!(lit(p.e.a) && lit(p.e.b))) continue;
      const x = A.x + (B.x - A.x) * p.t, y = A.y + (B.y - A.y) * p.t;
      ctx.fillStyle = dk ? "rgba(34,211,238,.9)" : "rgba(6,182,212,.85)"; ctx.beginPath(); ctx.arc(x, y, 2.2, 0, 6.28); ctx.fill();
    }
    // nodos
    nodes.forEach((n, i) => {
      const on = lit(i), c = tcolor(n.type);
      ctx.globalAlpha = on ? 1 : 0.16;
      if (on && (i === focus || (st.hits && st.hits.has(n.id)))) { ctx.shadowColor = c; ctx.shadowBlur = 22; }
      const breathe = 1 + (on ? 0.04 * Math.sin(t / 600 + i) : 0);
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(n.x, n.y, n.r * breathe, 0, 6.28); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = dk ? "rgba(255,255,255,.25)" : "rgba(255,255,255,.9)"; ctx.lineWidth = 1.5; ctx.stroke();
      if (on && (n.r > 11 || i === focus || nb[focus]?.has(i) || (st.hits && st.hits.has(n.id)) || sim.view.k > 1.6)) {
        ctx.font = `${i === focus ? 700 : 600} ${Math.max(10, 12 / sim.view.k ** 0.5)}px Segoe UI, sans-serif`;
        ctx.textAlign = "left"; ctx.textBaseline = "middle";
        const txt = String(n.label).length > 28 ? String(n.label).slice(0, 27) + "…" : String(n.label);
        ctx.lineWidth = 3; ctx.strokeStyle = dk ? "rgba(7,11,24,.85)" : "rgba(255,255,255,.9)"; ctx.strokeText(txt, n.x + n.r + 5, n.y);
        ctx.fillStyle = dk ? "#e2e8f0" : "#1e293b"; ctx.fillText(txt, n.x + n.r + 5, n.y);
      }
      ctx.globalAlpha = 1;
    });
    ctx.restore();
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);

  // interacción
  let pan = null, down = null;
  cv.addEventListener("pointerdown", (e) => {
    const r = cv.getBoundingClientRect(), i = pick(e.clientX - r.left, e.clientY - r.top);
    down = { x: e.clientX, y: e.clientY, i };
    if (i >= 0) { sim.drag = i; sim.alpha = Math.max(sim.alpha, 0.3); } else pan = { x: e.clientX, y: e.clientY, ox: sim.view.x, oy: sim.view.y };
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener("pointermove", (e) => {
    const r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    if (sim.drag >= 0) { const p = toWorld(px, py); nodes[sim.drag].x = p.x; nodes[sim.drag].y = p.y; sim.alpha = Math.max(sim.alpha, 0.2); return; }
    if (pan) { sim.view.x = pan.ox + e.clientX - pan.x; sim.view.y = pan.oy + e.clientY - pan.y; return; }
    const i = pick(px, py); sim.hover = i; cv.style.cursor = i >= 0 ? "pointer" : "grab";
    const tip = main.querySelector("#kbTip");
    if (tip) {
      if (i < 0) tip.hidden = true;
      else { const n = nodes[i]; tip.hidden = false; tip.style.left = px + 14 + "px"; tip.style.top = py + 10 + "px";
        tip.innerHTML = `<b>${esc(n.label)}</b><span><i style="background:${tcolor(n.type)}"></i>${esc((TYPE[String(n.type).startsWith("doc:") ? "doc" : n.type] || TYPE.concept).label)} · ${n.weight} doc(s) · ${nb[i].size} conexiones</span>`; }
    }
  });
  cv.addEventListener("pointerup", (e) => {
    const moved = down && Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) > 4;
    if (down && !moved && down.i >= 0) selectNode(nodes[down.i]);
    if (down && !moved && down.i < 0) { st.sel = null; const d = main.querySelector("#kbDetail"); if (d) d.hidden = true; }
    sim.drag = -1; pan = null; down = null;
  });
  cv.addEventListener("pointerleave", () => { sim.hover = -1; const tip = main.querySelector("#kbTip"); if (tip) tip.hidden = true; });
  cv.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = cv.getBoundingClientRect(), px = e.clientX - r.left - W / 2, py = e.clientY - r.top - H / 2;
    const k = Math.max(0.25, Math.min(4, sim.view.k * (e.deltaY < 0 ? 1.12 : 0.9)));
    sim.view.x = px - ((px - sim.view.x) * k) / sim.view.k; sim.view.y = py - ((py - sim.view.y) * k) / sim.view.k; sim.view.k = k;
  }, { passive: false });
}

async function selectNode(n) {
  const box = main.querySelector("#kbDetail");
  if (String(n.type).startsWith("doc:")) { try { docModal(await api.kbDocs({ limit: 200 }).then((l) => l.find((d) => d.id === n.doc_id))); } catch {} return; }
  st.sel = n.id;
  box.hidden = false;
  box.innerHTML = `<p class="cfg-muted">Cargando…</p>`;
  try {
    const e = await api.kbEntity(n.id);
    box.innerHTML = `<header><span class="kb-type" style="--c:${tcolor(e.type)}">${esc((TYPE[e.type] || TYPE.concept).label)}</span><button type="button" data-close aria-label="Cerrar">✕</button></header>
      <h3>${esc(e.label)}</h3><p class="cfg-muted">${e.docs} documento(s) · ${e.neighbors.length} entidades cercanas</p>
      <h4>Conectado con</h4><div class="kb-nb">${e.neighbors.map((x) => `<button type="button" data-nb="${esc(x.key)}" style="--c:${tcolor(x.type)}"><i></i>${esc(x.label)}<em>${x.weight}</em></button>`).join("") || "<span class='cfg-muted'>—</span>"}</div>
      <h4>Documentos</h4><div class="kb-dl">${e.documents.map((d) => `<button type="button" data-doc="${esc(d.id)}"><span class="kb-kind k-${esc(d.kind)}">${esc(KIND[d.kind] || d.kind)}</span><b>${esc(d.title)}</b><small>${esc(d.app_name || "")} · ${esc(fmt(d.updated_at))}</small></button>`).join("")}</div>`;
    box.querySelector("[data-close]").addEventListener("click", () => { box.hidden = true; st.sel = null; });
    box.querySelectorAll("[data-doc]").forEach((b) => b.addEventListener("click", () => docModal(e.documents.find((d) => d.id === b.dataset.doc))));
    box.querySelectorAll("[data-nb]").forEach((b) => b.addEventListener("click", () => { const m = st.sim?.nodes.find((x) => x.id === b.dataset.nb); if (m) selectNode(m); }));
  } catch (err) { box.innerHTML = `<p class="cfg-err">${esc(err.message)}</p>`; }
}

function docModal(d) {
  if (!d) return;
  const back = document.createElement("div");
  back.className = "q-modal-backdrop cfg-modal-bd";
  back.innerHTML = `<div class="q-modal cfg-modal wide" role="dialog" aria-modal="true"><div class="q-modal-head"><h2>${esc(d.title)}</h2><button class="q-modal-x" data-x aria-label="Cerrar">✕</button></div>
    <div class="q-modal-body cfg-modal-body kb-doc"><p class="kb-doc-meta"><span class="kb-kind k-${esc(d.kind)}">${esc(KIND[d.kind] || d.kind)}</span> ${esc(d.app_name || "Sin aplicación")} · ${esc(fmt(d.created_at))}</p>
      <pre>${esc(d.text || "")}</pre><h4>Entidades</h4><div class="kb-nb">${(d.entities || []).map((e) => `<span style="--c:${tcolor(e.type)}"><i></i>${esc(e.label)}</span>`).join("")}</div></div>
    <div class="q-modal-foot"><button type="button" class="q-btn danger" data-del>Borrar de la base</button><button type="button" class="q-btn" data-x>Cerrar</button></div></div>`;
  document.body.appendChild(back);
  const close = () => back.remove();
  back.querySelectorAll("[data-x]").forEach((b) => b.addEventListener("click", close));
  back.addEventListener("pointerdown", (e) => { if (e.target === back) close(); });
  back.querySelector("[data-del]").addEventListener("click", async () => {
    try { await api.kbDeleteDoc(d.id); toast("Documento borrado."); close(); st.settings = await api.kbSettings(); render(); } catch (e) { toast(e.message, "err"); }
  });
}

/* =============================== LISTA =============================== */
async function listView() {
  stopSim();
  const pane = main.querySelector("#kbPane");
  pane.innerHTML = `
    <div class="kb-gbar"><div class="cfg-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input id="kbLQ" type="search" placeholder="Buscar por relevancia (p. ej. devoluciones yopal)" value="${esc(st.q)}" /></div>
      <select id="kbLKind"><option value="">Todas las fuentes</option>${Object.entries(KIND).map(([k, l]) => `<option value="${k}" ${st.kind === k ? "selected" : ""}>${l}</option>`).join("")}</select>
      <button type="button" class="q-btn primary" id="kbNote">＋ Nota</button></div>
    <div class="kb-list" id="kbList"><p class="cfg-muted">Cargando…</p></div>`;
  const draw = async () => {
    const box = pane.querySelector("#kbList");
    try {
      const list = st.q.trim() ? (await api.kbSearch(st.q, { kind: st.kind, limit: 50 })).results : await api.kbDocs({ kind: st.kind, limit: 100 });
      box.innerHTML = list.map((d) => `<article class="kb-item" data-doc="${esc(d.id)}">
        <span class="kb-kind k-${esc(d.kind)}">${esc(KIND[d.kind] || d.kind)}</span>
        <div><b>${esc(d.title)}</b><p>${esc(d.snippet || String(d.text || "").slice(0, 220))}</p>
          <div class="kb-nb sm">${(d.entities || []).slice(0, 8).map((e) => `<span style="--c:${tcolor(e.type)}"><i></i>${esc(e.label)}</span>`).join("")}</div></div>
        <time>${esc(d.app_name || "")}<br/>${esc(fmt(d.updated_at))}${d.score != null ? `<br/><em>relevancia ${d.score.toLocaleString("es-CO")}</em>` : ""}</time></article>`).join("")
        || `<p class="cfg-muted">${st.q ? "Nada coincide con la búsqueda." : "Aún no hay documentos."}</p>`;
      box.querySelectorAll("[data-doc]").forEach((el) => el.addEventListener("click", () => docModal(list.find((d) => d.id === el.dataset.doc))));
    } catch (e) { box.innerHTML = `<p class="cfg-err">${esc(e.message)}</p>`; }
  };
  let t;
  pane.querySelector("#kbLQ").addEventListener("input", (e) => { st.q = e.target.value; clearTimeout(t); t = setTimeout(draw, 250); });
  pane.querySelector("#kbLKind").addEventListener("change", (e) => { st.kind = e.target.value; draw(); });
  pane.querySelector("#kbNote").addEventListener("click", noteModal);
  draw();
}

function noteModal() {
  const back = document.createElement("div");
  back.className = "q-modal-backdrop cfg-modal-bd";
  back.innerHTML = `<div class="q-modal cfg-modal" role="dialog" aria-modal="true"><div class="q-modal-head"><h2>Nueva nota</h2><button class="q-modal-x" data-x>✕</button></div>
    <div class="q-modal-body cfg-modal-body"><div class="cfg-form"><label>Título<input id="nT" maxlength="200" placeholder="p. ej. Acuerdos del comité comercial"/></label>
      <label>Aplicación<select id="nA"><option value="">Ninguna</option>${st.apps.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join("")}</select></label>
      <label>Texto<textarea id="nX" rows="6" placeholder="Lo que quieras que PROTHEO y tus agentes recuerden."></textarea></label></div><p class="cfg-err" id="nE" hidden></p></div>
    <div class="q-modal-foot"><button type="button" class="q-btn" data-x>Cancelar</button><button type="button" class="q-btn primary" id="nS">Guardar nota</button></div></div>`;
  document.body.appendChild(back);
  const close = () => back.remove();
  back.querySelectorAll("[data-x]").forEach((b) => b.addEventListener("click", close));
  back.querySelector("#nS").addEventListener("click", async () => {
    try {
      await api.kbAddNote({ title: back.querySelector("#nT").value, text: back.querySelector("#nX").value, app_id: back.querySelector("#nA").value || undefined });
      toast("Nota guardada."); close(); st.settings = await api.kbSettings(); render();
    } catch (e) { const er = back.querySelector("#nE"); er.textContent = e.message; er.hidden = false; }
  });
  setTimeout(() => back.querySelector("#nT").focus(), 0);
}

/* =============================== FUENTES =============================== */
function sourcesView() {
  stopSim();
  const s = st.settings, by = s.stats.by_kind, max = Math.max(1, ...Object.values(by));
  main.querySelector("#kbPane").innerHTML = `
    <p class="cfg-hint">Estas acciones alimentan tu base. Apaga las que no quieras guardar: lo ya guardado se conserva.</p>
    <div class="kb-src">${s.source_catalog.map((x) => `<label class="kb-src-it ${s.sources[x.id] ? "on" : ""}">
      <span class="kb-kind k-${esc(x.id)}">${esc(KIND[x.id] || x.label)}</span>
      <div><b>${esc(x.label)}</b><small>${esc(x.description)}</small><i class="pm-bar"><i style="width:${Math.round((by[x.id] / max) * 100)}%"></i></i></div>
      <em>${by[x.id]} doc.</em><input type="checkbox" data-src="${esc(x.id)}" ${s.sources[x.id] ? "checked" : ""} aria-label="${esc(x.label)}"/></label>`).join("")}</div>`;
  main.querySelectorAll("[data-src]").forEach((cb) => cb.addEventListener("change", async () => {
    try { st.settings = await api.kbUpdateSettings({ sources: { [cb.dataset.src]: cb.checked } }); toast(cb.checked ? "Fuente activada." : "Fuente apagada."); sourcesView(); }
    catch (e) { toast(e.message, "err"); }
  }));
}

/* =============================== AJUSTES =============================== */
function settingsView() {
  stopSim();
  const s = st.settings;
  main.querySelector("#kbPane").innerHTML = `
    <div class="kb-set">
      <section><h3>Estado</h3><p>La base está <b>activa</b> desde ${esc(fmt(s.enabled_at) || "—")}. Al apagarla deja de guardar al instante; lo guardado se conserva hasta que lo vacíes.</p>
        <button type="button" class="q-btn" id="kbOff">Apagar la base de conocimiento</button></section>
      <section><h3>Retención</h3><p>Borra automáticamente lo que tenga más de:</p>
        <select id="kbRet">${[[0, "Guardar siempre"], [30, "30 días"], [90, "90 días"], [180, "6 meses"], [365, "1 año"]].map(([v, l]) => `<option value="${v}" ${Number(s.retention_days) === v ? "selected" : ""}>${l}</option>`).join("")}</select></section>
      <section><h3>Exportar</h3><p>Descarga todo (documentos, entidades y ajustes) en JSON.</p><button type="button" class="q-btn" id="kbExp">⇩ Exportar JSON</button></section>
      <section class="danger"><h3>Vaciar</h3><p>Borra los ${s.stats.docs} documentos y la red. No se puede deshacer.</p><button type="button" class="q-btn danger" id="kbClr">Vaciar mi base</button></section>
    </div>`;
  main.querySelector("#kbOff").addEventListener("click", async () => {
    try { st.settings = await api.kbUpdateSettings({ enabled: false }); localStorage.setItem("ds.kb", "0"); renderNav("nav", { active: "conocimiento" }); toast("Base apagada. Ya no guarda nada."); render(); } catch (e) { toast(e.message, "err"); }
  });
  main.querySelector("#kbRet").addEventListener("change", async (e) => { try { st.settings = await api.kbUpdateSettings({ retention_days: Number(e.target.value) }); toast("Retención guardada."); } catch (er) { toast(er.message, "err"); } });
  main.querySelector("#kbExp").addEventListener("click", async () => {
    const data = await api.kbExport();
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    a.download = `protheo-conocimiento-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  main.querySelector("#kbClr").addEventListener("click", async () => {
    if (!confirm(`¿Vaciar tu base de conocimiento (${s.stats.docs} documentos)?`)) return;
    try { await api.kbClear(); st.settings = await api.kbSettings(); toast("Base vaciada."); render(); } catch (e) { toast(e.message, "err"); }
  });
}

/* =============================== ARRANQUE =============================== */
renderNav("nav", { active: "conocimiento" });
wireAppsButton();
renderProfileMenu(authService);

(async () => {
  main.innerHTML = `<p class="cfg-muted" style="padding:24px">Cargando…</p>`;
  try {
    await authService.refresh();
    if (!authService.can("knowledge:use")) { main.innerHTML = `<p class="cfg-err" style="padding:24px">No tienes el permiso «Base de conocimiento» (knowledge:use).</p>`; return; }
    [st.settings, st.apps] = await Promise.all([api.kbSettings(), api.listApps().catch(() => [])]);
  } catch (e) { main.innerHTML = `<p class="cfg-err" style="padding:24px">${esc(e.message)}</p>`; return; }
  localStorage.setItem("ds.kb", st.settings.enabled ? "1" : "0");
  renderNav("nav", { active: "conocimiento" });
  const want = new URLSearchParams(location.search).get("tab");
  if (["grafo", "lista", "fuentes", "ajustes"].includes(want)) st.tab = want;
  render();
})();

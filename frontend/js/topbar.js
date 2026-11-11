// topbar.js — piezas compartidas de la barra superior de TODAS las páginas con barra:
//   · Menú hamburguesa: pliega el menú lateral a una columna de iconos (se recuerda).
//   · Centro de ayuda (botón «?», F1 o «?»): guía, manual técnico, preguntas frecuentes
//     y atajos, con buscador. Contenido en /help/ayuda.json (también lo lee el MCP).
//   · Notificaciones (campana): actividad de la plataforma para el administrador
//     (GET /api/v1/notifications), con contador real, filtros, agrupado por día,
//     marcar leídas / vaciar y avisos emergentes cuando llega algo nuevo.
// Es un módulo ES; se carga en <head> con type="module" (se ejecuta antes de
// DOMContentLoaded, así js/theme.js coloca su botón después de la campana).

import { authService } from "./auth-service.js";
import { ALGOS, ALGO_BY_BACKEND } from "./ml-catalog.js";
import { ICON, DUO, BRAIN } from "./hub-nav.js";
import { authHeader } from "./api.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const isTyping = (e) => { const t = e.target; return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.closest?.(".CodeMirror")); };

const SVG = {
  help: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="currentColor" fill-opacity=".15"/><path d="M9.6 9.5a2.5 2.5 0 0 1 4.8.9c0 1.6-2.4 2-2.4 3.5"/><circle cx="12" cy="17" r=".9" fill="currentColor"/></svg>',
  bell: '<svg viewBox="0 0 24 24"><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z" fill="currentColor" fill-opacity=".15"/><path d="M10 20.6a2 2 0 0 0 4 0"/></svg>',
  burger: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="l1" d="M4 7h16"/><path class="l2" d="M4 12h16"/><path class="l3" d="M4 17h16"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
};

/* =========================================================================
   1. Menú lateral plegable (hamburguesa)
   ========================================================================= */
const SIDE_KEY = "ds.side";
function sideCollapsed() { return document.documentElement.getAttribute("data-side") === "collapsed"; }
function setSide(collapsed) {
  document.documentElement.setAttribute("data-side", collapsed ? "collapsed" : "open");
  try { localStorage.setItem(SIDE_KEY, collapsed ? "collapsed" : "open"); } catch { /* sin storage */ }
  syncBurger();
}
function syncBurger() {
  const b = document.getElementById("dsBurger");
  if (!b) return;
  const narrow = matchMedia("(max-width: 760px)").matches;
  const open = narrow ? document.body.classList.contains("side-open") : !sideCollapsed();
  b.setAttribute("aria-expanded", String(open));
  b.title = open ? "Plegar menú" : "Desplegar menú";
  b.setAttribute("aria-label", b.title);
}
/** Guarda el nombre de cada opción para el tooltip del menú plegado. */
function titleNavItems() {
  document.querySelectorAll(".q-side .q-nav-item").forEach((a) => {
    if (!a.dataset.tip) a.dataset.tip = a.querySelector(".q-nav-label")?.textContent.trim() || "";
    a.setAttribute("aria-label", a.dataset.tip);
  });
}
/** Tooltip con estilo a la derecha de cada icono cuando el menú está plegado. */
let tipEl = null;
function hideTip() { tipEl?.remove(); tipEl = null; }
function wireTips(side) {
  side.addEventListener("pointerover", (e) => {
    const a = e.target.closest(".q-nav-item");
    if (!a || !sideCollapsed() || matchMedia("(max-width: 760px)").matches) return;
    hideTip();
    const r = a.getBoundingClientRect();
    tipEl = document.createElement("div");
    tipEl.className = "ds-tip";
    tipEl.textContent = a.dataset.tip || "";
    tipEl.style.left = `${r.right + 12}px`;
    tipEl.style.top = `${r.top + r.height / 2}px`;
    document.body.appendChild(tipEl);
  });
  side.addEventListener("pointerout", (e) => { if (!e.relatedTarget || !e.relatedTarget.closest?.(".q-nav-item")) hideTip(); });
  side.addEventListener("scroll", hideTip, { passive: true });
}
function mountBurger() {
  const side = document.querySelector(".q-side");
  const bar = document.querySelector(".q-topbar");
  if (!side || !bar || document.getElementById("dsBurger")) return;
  const b = document.createElement("button");
  b.type = "button";
  b.id = "dsBurger";
  b.className = "q-top-ico ds-burger";
  b.setAttribute("aria-controls", side.id || (side.id = "dsSide"));
  b.innerHTML = SVG.burger;
  b.addEventListener("click", () => {
    if (matchMedia("(max-width: 760px)").matches) document.body.classList.toggle("side-open");
    else setSide(!sideCollapsed());
    hideTip();
    syncBurger();
    // Los gráficos (Chart.js) se reajustan al nuevo ancho al terminar la transición.
    setTimeout(() => dispatchEvent(new Event("resize")), 320);
  });
  bar.insertBefore(b, bar.firstElementChild);
  syncBurger();
  // El menú lo pinta cada página (renderNav); se titula cuando aparece.
  titleNavItems();
  new MutationObserver(titleNavItems).observe(side, { childList: true, subtree: true });
  wireTips(side);
}

/* =========================================================================
   2. Botones de la barra (si la página no los trae, se añaden)
   ========================================================================= */
function ensureTopButtons() {
  const bar = document.querySelector(".q-top-actions");
  if (!bar) return {};
  let help = bar.querySelector('[title="Ayuda"]');
  let bell = bar.querySelector('[title="Notificaciones"]');
  const anchor = [...bar.children].find((c) => c.matches(".q-avatar, .q-profile")) || null;
  const mk = (title, svg) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "q-top-ico"; b.title = title; b.setAttribute("aria-label", title); b.innerHTML = svg;
    return b;
  };
  if (!help) { help = mk("Ayuda", SVG.help); bar.insertBefore(help, bell || anchor || null); }
  if (!bell) { bell = mk("Notificaciones", SVG.bell); help.insertAdjacentElement("afterend", bell); }
  [help, bell].forEach((b) => { b.disabled = false; b.removeAttribute("disabled"); b.type = "button"; });
  // Mismo set corporativo en todas las páginas (las maquetas traen iconos antiguos).
  help.innerHTML = SVG.help;
  bell.innerHTML = SVG.bell;
  // El contador estático de las maquetas se sustituye por el real.
  bell.querySelectorAll(".q-badge-dot").forEach((d) => d.remove());
  help.dataset.ds = "help";
  bell.dataset.ds = "bell";
  help.setAttribute("aria-haspopup", "dialog");
  bell.setAttribute("aria-haspopup", "dialog");
  return { help, bell };
}

/* =========================================================================
   3. Centro de ayuda
   ========================================================================= */
let helpData = null;
let helpEl = null;
let helpTab = "inicio";

async function loadHelp() {
  if (helpData) return helpData;
  const r = await fetch("/help/ayuda.json", { cache: "no-store" });
  if (!r.ok) throw new Error("No se pudo cargar la ayuda (" + r.status + ")");
  helpData = await r.json();
  return helpData;
}

/** Markdown mínimo y seguro: párrafos, listas "- ", **negrita** y `código`. */
function md(text) {
  // El código se aparta primero (puede contener «*», p. ej. /api/v1/**) y se repone al final.
  const inline = (s) => {
    const codes = [];
    const t = esc(s).replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; })
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\*([^*]+)\*/g, "<em>$1</em>");
    return t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
  };
  return String(text || "").split(/\n\s*\n/).map((block) => {
    const lines = block.split("\n");
    if (lines.every((l) => l.trim().startsWith("- "))) return "<ul>" + lines.map((l) => "<li>" + inline(l.trim().slice(2)) + "</li>").join("") + "</ul>";
    return "<p>" + lines.map(inline).join("<br>") + "</p>";
  }).join("");
}

const TAB_ICON = {
  guia: '<svg viewBox="0 0 24 24"><path d="M5 4h10l4 4v12H5z"/><path d="M9 12h6M9 16h4"/></svg>',
  manual: '<svg viewBox="0 0 24 24"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19a2 2 0 0 1 2-2h13"/></svg>',
  faq: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 4.5 1.5c0 1.5-2 2-2 3"/><circle cx="12" cy="17" r="0.6" fill="currentColor"/></svg>',
  atajos: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h1M11 10h1M15 10h2M7 14h10"/></svg>',
};

function renderHelp() {
  if (!helpEl || !helpData) return;
  const q = norm(helpEl.querySelector(".ds-help-search input").value).trim();
  const tabs = helpEl.querySelector(".ds-help-tabs");
  const body = helpEl.querySelector(".ds-help-body");
  tabs.innerHTML = helpData.secciones.map((s) => `
    <button type="button" class="ds-help-tab ${!q && s.id === helpTab ? "on" : ""}" data-tab="${esc(s.id)}" role="tab" aria-selected="${!q && s.id === helpTab}">
      ${TAB_ICON[s.tipo] || ""}<span>${esc(s.titulo)}</span></button>`).join("");
  const itemHtml = (s, it, i) => {
    if (s.tipo === "atajos") return `<div class="ds-help-key"><kbd>${esc(it.titulo)}</kbd><span>${esc(it.cuerpo)}</span></div>`;
    if (s.tipo === "faq") return `<details class="ds-help-faq" ${q ? "open" : ""}><summary>${esc(it.titulo)}</summary><div class="ds-help-md">${md(it.cuerpo)}</div></details>`;
    return `<article class="ds-help-card" style="--i:${i}"><h3>${esc(it.titulo)}</h3><div class="ds-help-md">${md(it.cuerpo)}</div></article>`;
  };
  if (q) {
    const words = q.split(/\s+/);
    const hits = [];
    helpData.secciones.forEach((s) => s.items.forEach((it) => {
      const t = norm(it.titulo + " " + it.cuerpo);
      if (words.every((w) => t.includes(w))) hits.push({ s, it });
    }));
    body.innerHTML = hits.length
      ? `<p class="ds-help-count">${hits.length} resultado${hits.length === 1 ? "" : "s"} para «${esc(q)}»</p>` +
        hits.map(({ s, it }, i) => `<div class="ds-help-hit"><span class="ds-help-from">${esc(s.titulo)}</span>${itemHtml(s, it, i)}</div>`).join("")
      : `<div class="ds-help-empty">${SVG.search}<p>Sin resultados para «${esc(q)}».</p><small>Prueba con otras palabras o pregunta al asistente (botón de estrella).</small></div>`;
    highlight(body, words);
    return;
  }
  const s = helpData.secciones.find((x) => x.id === helpTab) || helpData.secciones[0];
  body.innerHTML = `<div class="ds-help-sec ${esc(s.tipo)}">${s.items.map((it, i) => itemHtml(s, it, i)).join("")}</div>`;
  body.scrollTop = 0;
}

/** Resalta las palabras buscadas en los nodos de texto (sin tocar el HTML). */
function highlight(root, words) {
  const w = words.filter((x) => x.length > 1);
  if (!w.length) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach((n) => {
    const txt = n.nodeValue;
    const low = norm(txt);
    const ranges = [];
    w.forEach((word) => { let i = low.indexOf(word); while (i >= 0) { ranges.push([i, i + word.length]); i = low.indexOf(word, i + word.length); } });
    if (!ranges.length) return;
    ranges.sort((a, b) => a[0] - b[0]);
    const frag = document.createDocumentFragment();
    let pos = 0;
    ranges.forEach(([a, b]) => {
      if (a < pos) return;
      frag.appendChild(document.createTextNode(txt.slice(pos, a)));
      const m = document.createElement("mark"); m.textContent = txt.slice(a, b); frag.appendChild(m);
      pos = b;
    });
    frag.appendChild(document.createTextNode(txt.slice(pos)));
    n.parentNode.replaceChild(frag, n);
  });
}

async function openHelp(tab) {
  closeNotif();
  if (tab) helpTab = tab;
  if (!helpEl) {
    helpEl = document.createElement("div");
    helpEl.className = "ds-help-bd";
    helpEl.innerHTML = `
      <aside class="ds-help" role="dialog" aria-modal="true" aria-labelledby="dsHelpTitle">
        <header class="ds-help-head">
          <div class="ds-help-brand"><span class="ds-help-logo">?</span>
            <div><h2 id="dsHelpTitle">Centro de ayuda</h2><small>Manual técnico, guías y preguntas frecuentes</small></div></div>
          <button type="button" class="ds-help-x" aria-label="Cerrar ayuda">${SVG.close}</button>
        </header>
        <label class="ds-help-search">${SVG.search}<input type="search" placeholder="Busca en la ayuda: carga, Athena, clave sintética…" aria-label="Buscar en la ayuda" /></label>
        <nav class="ds-help-tabs" role="tablist"></nav>
        <div class="ds-help-body"><div class="ds-help-loading"><i></i><i></i><i></i></div></div>
        <footer class="ds-help-foot"><span>¿No lo encuentras? Pregunta al asistente de IA (botón de estrella).</span><span class="ds-help-ver"></span></footer>
      </aside>`;
    document.body.appendChild(helpEl);
    helpEl.addEventListener("mousedown", (e) => { if (e.target === helpEl) closeHelp(); });
    helpEl.querySelector(".ds-help-x").addEventListener("click", closeHelp);
    helpEl.querySelector(".ds-help-search input").addEventListener("input", renderHelp);
    helpEl.querySelector(".ds-help-tabs").addEventListener("click", (e) => {
      const t = e.target.closest("[data-tab]");
      if (!t) return;
      helpTab = t.dataset.tab;
      helpEl.querySelector(".ds-help-search input").value = "";
      renderHelp();
    });
  }
  helpEl.hidden = false;
  requestAnimationFrame(() => helpEl.classList.add("open"));
  helpEl.querySelector(".ds-help-search input").focus();
  try {
    await loadHelp();
    helpEl.querySelector(".ds-help-ver").textContent = "Versión " + (helpData.version || "");
    renderHelp();
  } catch (err) {
    helpEl.querySelector(".ds-help-body").innerHTML = `<div class="ds-help-empty"><p>${esc(err.message)}</p></div>`;
  }
}
function closeHelp() {
  if (!helpEl || helpEl.hidden) return;
  helpEl.classList.remove("open");
  setTimeout(() => { if (helpEl && !helpEl.classList.contains("open")) helpEl.hidden = true; }, 220);
}

/* =========================================================================
   4. Notificaciones
   ========================================================================= */
const KIND = {
  app: { label: "Nueva aplicación", group: "apps", color: "#6366f1", icon: ICON.analyze },
  table: { label: "Datos cargados", group: "datos", color: "#06b6d4", icon: ICON.database },
  sheet: { label: "Nueva hoja", group: "hojas", color: "#8b5cf6", icon: ICON.pages },
  collection: { label: "Nueva colección", group: "apps", color: "#f59e0b", icon: ICON.book },
  master: { label: "Nuevo elemento maestro", group: "hojas", color: "#ec4899", icon: ICON.box },
  connection: { label: "Nueva conexión", group: "datos", color: "#0ea5e9", icon: `<rect ${DUO} x="4" y="3.5" width="6" height="7" rx="1.6" transform="rotate(45 7 7)"/><rect ${DUO} x="14" y="13.5" width="6" height="7" rx="1.6" transform="rotate(45 17 17)"/><path d="m9.5 14.5 5-5"/>` },
  experiment: { label: "Nuevo experimento de ML", group: "ml", color: "#10b981", icon: BRAIN },
  run: { label: "Modelo entrenado", group: "ml", color: "#22c55e", icon: `<path ${DUO} stroke="none" d="M3 17c3-6 6-6 8-3s6 3 10-4v11H3z"/><path d="M3 17c3-6 6-6 8-3s6 3 10-4"/><circle cx="21" cy="10" r="1.4" fill="currentColor"/>` },
};
const FILTERS = [
  { id: "all", label: "Todas" }, { id: "unread", label: "No leídas" }, { id: "apps", label: "Apps" },
  { id: "datos", label: "Datos" }, { id: "hojas", label: "Hojas" }, { id: "ml", label: "ML" },
];
const SEEN_KEY = "ds.notif.seen";
let notifEl = null, notifBell = null, feed = { items: [], unread: 0, total: 0 }, filter = "all", limit = 40, polling = null;

const isAdmin = () => { try { return authService.current()?.role === "admin"; } catch { return false; } };

function algoName(a) {
  const k = ALGO_BY_BACKEND(a);
  return (k && ALGOS[k]?.name) || a || "";
}
function describe(n) {
  const k = KIND[n.kind] || { label: "Actividad", color: "#64748b", icon: "" };
  let title = n.title || "";
  let sub = n.detail ? "en " + n.detail : "";
  let metric = "";
  if (n.kind === "run") {
    const [alg, mName, mVal] = String(n.extra || "").split("|");
    title = n.title && n.title !== alg ? n.title : algoName(alg);
    if (title !== algoName(alg) && alg) sub = algoName(alg) + " · " + (n.detail ? "experimento " + n.detail : "");
    else sub = n.detail ? "experimento " + n.detail : "";
    if (mName && mVal) metric = `${mName} ${Number(mVal).toLocaleString("es-CO", { maximumFractionDigits: 3 })}`;
  } else if (n.kind === "connection" && n.extra) sub = (n.extra + " · ") + sub;
  else if (n.kind === "master" && n.extra) sub = (n.extra === "measure" ? "Medida" : "Dimensión") + (sub ? " · " + sub : "");
  else if (n.kind === "table" && n.extra) sub = "desde " + n.extra + (sub ? " · " + sub : "");
  else if (n.kind === "experiment" && n.extra) sub = "tabla " + n.extra + (sub ? " · " + sub : "");
  return { k, title, sub, metric };
}
function rel(iso) {
  const t = Date.parse(iso);
  if (!t) return "";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return "ahora";
  if (s < 3600) return "hace " + Math.round(s / 60) + " min";
  if (s < 86400) return "hace " + Math.round(s / 3600) + " h";
  if (s < 7 * 86400) return "hace " + Math.round(s / 86400) + " d";
  return new Date(t).toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" });
}
function dayGroup(iso) {
  const d = new Date(iso); const now = new Date();
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 86400000);
  if (diff <= 0) return "Hoy";
  if (diff === 1) return "Ayer";
  if (diff < 7) return "Esta semana";
  return "Anteriores";
}

async function fetchFeed() {
  const r = await fetch(`/api/v1/notifications?limit=${limit}`, { cache: "no-store", headers: authHeader() });
  if (!r.ok) throw new Error("No se pudieron cargar las notificaciones (" + r.status + ")");
  return r.json();
}
function setBadge(n) {
  if (!notifBell) return;
  let dot = notifBell.querySelector(".ds-notif-badge");
  if (!n) { dot?.remove(); notifBell.setAttribute("aria-label", "Notificaciones"); return; }
  if (!dot) { dot = document.createElement("span"); dot.className = "q-badge-dot ds-notif-badge"; dot.setAttribute("aria-hidden", "true"); notifBell.appendChild(dot); }
  dot.textContent = n > 99 ? "99+" : String(n);
  notifBell.setAttribute("aria-label", `Notificaciones (${n} sin leer)`);
}

function renderNotif() {
  if (!notifEl) return;
  const list = notifEl.querySelector(".ds-notif-list");
  notifEl.querySelector(".ds-notif-count").textContent = feed.unread ? `${feed.unread} sin leer` : "Al día";
  notifEl.querySelector(".ds-notif-count").classList.toggle("zero", !feed.unread);
  notifEl.querySelector(".ds-notif-filters").innerHTML = FILTERS.map((f) => {
    const c = f.id === "all" ? feed.items.length : f.id === "unread" ? feed.items.filter((n) => !n.read).length : feed.items.filter((n) => KIND[n.kind]?.group === f.id).length;
    return `<button type="button" class="ds-notif-chip ${filter === f.id ? "on" : ""}" data-f="${f.id}">${esc(f.label)}<b>${c}</b></button>`;
  }).join("");
  const items = feed.items.filter((n) => filter === "all" || (filter === "unread" ? !n.read : KIND[n.kind]?.group === filter));
  if (!items.length) {
    list.innerHTML = `<div class="ds-notif-empty"><div class="ds-notif-empty-ico">${SVG.bell}</div><strong>${filter === "unread" ? "Todo al día" : "Sin actividad"}</strong><small>${filter === "unread" ? "No tienes notificaciones sin leer." : "Las nuevas apps, cargas, hojas y modelos aparecerán aquí."}</small></div>`;
    return;
  }
  let prev = "", html = "";
  items.forEach((n, i) => {
    const g = dayGroup(n.created_at);
    if (g !== prev) { html += `<div class="ds-notif-day">${g}</div>`; prev = g; }
    const { k, title, sub, metric } = describe(n);
    html += `
      <a class="ds-notif-item ${n.read ? "" : "unread"}" href="${esc(n.link)}" data-id="${esc(n.id)}" style="--c:${k.color};--i:${Math.min(i, 12)}">
        <span class="ds-notif-ico"><svg viewBox="0 0 24 24">${k.icon}</svg></span>
        <span class="ds-notif-txt">
          <span class="ds-notif-kind">${esc(k.label)}</span>
          <span class="ds-notif-title">${esc(title)}</span>
          ${sub || metric ? `<span class="ds-notif-sub">${esc(sub)}${metric ? `<em>${esc(metric)}</em>` : ""}</span>` : ""}
        </span>
        <span class="ds-notif-time">${esc(rel(n.created_at))}</span>
      </a>`;
  });
  if (feed.total > feed.items.length) html += `<button type="button" class="ds-notif-more">Cargar más (${feed.total - feed.items.length})</button>`;
  list.innerHTML = html;
}

async function refresh(showToasts) {
  if (!isAdmin()) { setBadge(0); return; }
  try {
    const prevIds = new Set(feed.items.map((n) => n.id));
    feed = await fetchFeed();
    setBadge(feed.unread);
    renderNotif();
    // Avisos emergentes: lo nuevo desde la última vez que se vio la página.
    let seen = "";
    try { seen = localStorage.getItem(SEEN_KEY) || ""; } catch { /* noop */ }
    const fresh = feed.items.filter((n) => !n.read && n.created_at > seen && (!prevIds.size || !prevIds.has(n.id)));
    if (showToasts && seen && fresh.length) toast(fresh);
    const newest = feed.items[0]?.created_at;
    if (newest && newest > seen) { try { localStorage.setItem(SEEN_KEY, newest); } catch { /* noop */ } }
  } catch (err) {
    if (notifEl) notifEl.querySelector(".ds-notif-list").innerHTML = `<div class="ds-notif-empty"><strong>Sin conexión</strong><small>${esc(err.message)}</small></div>`;
  }
}

function toast(items) {
  let host = document.getElementById("dsToasts");
  if (!host) { host = document.createElement("div"); host.id = "dsToasts"; host.className = "ds-toasts"; host.setAttribute("aria-live", "polite"); document.body.appendChild(host); }
  const show = items.slice(0, 3);
  show.forEach((n, i) => {
    const { k, title, sub } = describe(n);
    const t = document.createElement("a");
    t.className = "ds-toast"; t.href = n.link; t.style.setProperty("--c", k.color);
    t.innerHTML = `<span class="ds-notif-ico"><svg viewBox="0 0 24 24">${k.icon}</svg></span><span class="ds-notif-txt"><span class="ds-notif-kind">${esc(k.label)}</span><span class="ds-notif-title">${esc(title)}</span>${sub ? `<span class="ds-notif-sub">${esc(sub)}</span>` : ""}</span><button type="button" class="ds-toast-x" aria-label="Cerrar">${SVG.close}</button><i class="ds-toast-bar"></i>`;
    t.querySelector(".ds-toast-x").addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); t.remove(); });
    setTimeout(() => host.appendChild(t), i * 250);
    setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 400); }, 6500 + i * 250);
  });
  if (items.length > 3) {
    const more = document.createElement("button");
    more.type = "button"; more.className = "ds-toast more"; more.textContent = `+${items.length - 3} novedades más · ver todas`;
    more.addEventListener("click", () => { more.remove(); openNotif(); });
    setTimeout(() => host.appendChild(more), 800);
    setTimeout(() => more.remove(), 7500);
  }
}

function placeNotif() {
  if (!notifEl || !notifBell) return;
  const r = notifBell.getBoundingClientRect();
  const panel = notifEl.querySelector(".ds-notif");
  panel.style.top = `${r.bottom + 10}px`;
  panel.style.right = `${Math.max(10, innerWidth - r.right - 8)}px`;
}

async function openNotif() {
  closeHelp();
  if (!notifEl) {
    notifEl = document.createElement("div");
    notifEl.className = "ds-notif-bd";
    notifEl.innerHTML = `
      <section class="ds-notif" role="dialog" aria-label="Notificaciones">
        <header class="ds-notif-head">
          <div><h2>Notificaciones</h2><span class="ds-notif-count">…</span></div>
          <div class="ds-notif-actions">
            <button type="button" class="ds-notif-act" data-act="read">Marcar todo como leído</button>
            <button type="button" class="ds-notif-act" data-act="clear" title="Vacía el panel; no borra ningún dato">Vaciar</button>
          </div>
        </header>
        <div class="ds-notif-filters"></div>
        <div class="ds-notif-list"><div class="ds-help-loading"><i></i><i></i><i></i></div></div>
        <footer class="ds-notif-foot">Actividad de toda la plataforma · se actualiza sola</footer>
      </section>`;
    document.body.appendChild(notifEl);
    notifEl.addEventListener("mousedown", (e) => { if (e.target === notifEl) closeNotif(); });
    notifEl.querySelector(".ds-notif-filters").addEventListener("click", (e) => {
      const c = e.target.closest("[data-f]"); if (!c) return; filter = c.dataset.f; renderNotif();
    });
    notifEl.querySelector(".ds-notif-actions").addEventListener("click", async (e) => {
      const b = e.target.closest("[data-act]"); if (!b) return;
      b.disabled = true;
      try {
        await fetch(`/api/v1/notifications/${b.dataset.act === "read" ? "read-all" : "clear"}`, { method: "POST", headers: authHeader() });
        await refresh(false);
      } finally { b.disabled = false; }
    });
    notifEl.querySelector(".ds-notif-list").addEventListener("click", (e) => {
      const more = e.target.closest(".ds-notif-more");
      if (more) { limit += 40; refresh(false); return; }
      const a = e.target.closest(".ds-notif-item");
      if (a && a.classList.contains("unread")) {
        // Marca como leída antes de navegar (keepalive: sobrevive al cambio de página).
        fetch(`/api/v1/notifications/${encodeURIComponent(a.dataset.id)}/read`, { method: "POST", keepalive: true, headers: authHeader() });
      }
    });
    addEventListener("resize", placeNotif);
  }
  notifEl.hidden = false;
  placeNotif();
  requestAnimationFrame(() => notifEl.classList.add("open"));
  notifBell?.setAttribute("aria-expanded", "true");
  if (!isAdmin()) {
    notifEl.querySelector(".ds-notif-actions").hidden = true;
    notifEl.querySelector(".ds-notif-filters").hidden = true;
    notifEl.querySelector(".ds-notif-list").innerHTML = `<div class="ds-notif-empty"><div class="ds-notif-empty-ico">${SVG.bell}</div><strong>Solo para administradores</strong><small>La actividad de la plataforma (nuevas apps, cargas, hojas y modelos) la recibe el rol administrador.</small></div>`;
    return;
  }
  renderNotif();
  await refresh(false);
}
function closeNotif() {
  if (!notifEl || notifEl.hidden) return;
  notifEl.classList.remove("open");
  notifBell?.setAttribute("aria-expanded", "false");
  setTimeout(() => { if (notifEl && !notifEl.classList.contains("open")) notifEl.hidden = true; }, 200);
}

/* =========================================================================
   Arranque
   ========================================================================= */
function init() {
  if (!document.querySelector(".q-topbar")) return;
  mountBurger();
  const { help, bell } = ensureTopButtons();
  help?.addEventListener("click", (e) => { e.stopPropagation(); helpEl && !helpEl.hidden ? closeHelp() : openHelp(); });
  notifBell = bell || null;
  bell?.addEventListener("click", (e) => { e.stopPropagation(); notifEl && !notifEl.hidden ? closeNotif() : openNotif(); });
  addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeHelp(); closeNotif(); return; }
    if (e.key === "F1" || (e.key === "?" && !isTyping(e) && !e.ctrlKey && !e.metaKey)) { e.preventDefault(); openHelp(); }
  });
  addEventListener("resize", syncBurger);
  // Contador real y avisos de novedades; se refresca cada minuto y al volver a la pestaña.
  refresh(true);
  polling = setInterval(() => { if (!document.hidden) refresh(true); }, 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(true); });
  // El «+» de la barra es el atajo de Crear: no se ofrece a quien no puede crear aplicaciones.
  if (!authService.can("apps:create")) document.querySelectorAll('.q-top-actions [title="Crear"]').forEach((b) => b.remove());
  // Permisos al día: si un administrador cambió el rol o los permisos de esta persona, se recarga una vez.
  const before = JSON.stringify([authService.current()?.role, authService.current()?.permissions]);
  authService.refresh().then((s) => {
    if (s && JSON.stringify([s.role, s.permissions]) !== before) location.reload();
  });
  window.DSHelp = { open: openHelp, close: closeHelp };
  window.DSNotifications = { open: openNotif, close: closeNotif, refresh: () => refresh(false) };
  window.DSSide = { toggle: () => document.getElementById("dsBurger")?.click(), collapsed: sideCollapsed };
}

// Como módulo se ejecuta con el DOM ya analizado y ANTES de DOMContentLoaded, así las
// piezas de la barra existen cuando theme.js monta su botón junto a la campana.
init();

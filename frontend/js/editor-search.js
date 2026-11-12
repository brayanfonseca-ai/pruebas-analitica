// editor-search.js — 🔍 del Editor de carga: búsqueda en TODO el entorno de la app.
//
// Busca una palabra (sin distinguir mayúsculas ni tildes, y también parecidas: "cedla" encuentra "CEDULA")
// en: el script, las tablas y campos del modelo, las notas para agente (descripciones y sinónimos), las hojas
// y las conexiones. Al elegir un resultado del script salta a esa línea; los demás abren su módulo.

import * as api from "./api.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** Distancia de edición acotada (para "se asimile"). */
function near(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return false;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]; prev[0] = i; let rowMin = prev[0];
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp; if (prev[j] < rowMin) rowMin = prev[j];
    }
    if (rowMin > max) return false;
  }
  return prev[b.length] <= max;
}

/** 2 = contiene exacto, 1 = palabra parecida, 0 = no. */
function score(text, q) {
  const t = norm(text);
  if (t.includes(q)) return 2;
  if (q.length < 4) return 0;
  const max = q.length >= 7 ? 2 : 1;
  for (const w of t.split(/[^a-z0-9ñ_]+/)) if (w && near(w, q, max)) return 1;
  return 0;
}

function mark(text, q) {
  const t = String(text ?? "");
  const n = norm(t);
  const i = n.indexOf(q);
  if (i < 0) return esc(t);
  return esc(t.slice(0, i)) + "<mark>" + esc(t.slice(i, i + q.length)) + "</mark>" + esc(t.slice(i + q.length));
}

export function openEnvSearch({ appId, getCode, onJump, initial = "" }) {
  document.querySelector(".es-bd")?.remove();
  const bd = document.createElement("div");
  bd.className = "es-bd";
  bd.innerHTML = `
    <div class="es" role="dialog" aria-modal="true" aria-label="Buscar en todo el entorno">
      <div class="es-in"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input id="esQ" type="search" placeholder="Buscar en script, tablas, campos, notas, hojas y conexiones…" value="${esc(initial)}" autocomplete="off" />
        <kbd>Esc</kbd></div>
      <div class="es-scope">Busca también palabras parecidas (por ejemplo «cedla» encuentra «CEDULA»).</div>
      <div class="es-res" id="esRes"><div class="es-empty">Escribe al menos 2 letras.</div></div>
    </div>`;
  document.body.appendChild(bd);
  const input = bd.querySelector("#esQ");
  const res = bd.querySelector("#esRes");
  const close = () => { bd.remove(); document.removeEventListener("keydown", onKey, true); };
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  document.addEventListener("keydown", onKey, true);
  bd.addEventListener("mousedown", (e) => { if (e.target === bd) close(); });

  // Datos del entorno (una vez).
  const env = { tables: [], notes: null, sheets: [], conns: [] };
  const ready = Promise.allSettled([
    api.listTables(appId).then((x) => { env.tables = x; }),
    api.getNotes(appId).then((x) => { env.notes = x; }),
    api.listSheets(appId).then((x) => { env.sheets = x; }),
    api.listAllConnections().then((x) => { env.conns = x; }),
  ]);

  let items = [];
  async function run() {
    const q = norm(input.value.trim());
    if (q.length < 2) { res.innerHTML = `<div class="es-empty">Escribe al menos 2 letras.</div>`; return; }
    await ready;
    const groups = { script: [], campos: [], notas: [], hojas: [], conexiones: [] };
    // Script, línea a línea.
    getCode().split(/\r?\n/).forEach((line, i) => {
      const s = score(line, q);
      if (s) groups.script.push({ s, title: line.trim() || "(línea vacía)", sub: `Línea ${i + 1}`, run: () => { close(); onJump(i); } });
    });
    // Tablas y campos del modelo.
    for (const t of env.tables) {
      const st = score(t.name, q);
      if (st) groups.campos.push({ s: st + 0.5, title: t.name, sub: `Tabla · ${t.rows} filas`, run: () => jumpTo(t.name) });
      for (const c of t.columns) {
        const sc = score(c.name, q);
        if (sc) groups.campos.push({ s: sc, title: c.name, sub: `Campo de ${t.name}${c.type ? " · " + c.type : ""}`, run: () => jumpTo(c.name) });
      }
    }
    // Notas para agente.
    if (env.notes) {
      const at = score(env.notes.app_text, q);
      if (at) groups.notas.push({ s: at, title: env.notes.app_text, sub: "Contexto del negocio", run: () => { location.href = `notas.html?app=${encodeURIComponent(appId)}`; } });
      for (const t of env.notes.tables || []) {
        const sd = score(t.description, q);
        if (sd) groups.notas.push({ s: sd, title: t.description, sub: `Nota de la tabla ${t.name}`, run: () => { location.href = `notas.html?app=${encodeURIComponent(appId)}`; } });
        for (const c of t.columns || []) {
          const s1 = Math.max(score(c.description, q), score(c.synonyms, q));
          if (s1) groups.notas.push({ s: s1, title: `${c.name}: ${c.description || c.synonyms}`, sub: `Nota de ${t.name}.${c.name}`, run: () => { location.href = `notas.html?app=${encodeURIComponent(appId)}`; } });
        }
      }
    }
    for (const sh of env.sheets) {
      const s = Math.max(score(sh.title, q), score(sh.description, q));
      if (s) groups.hojas.push({ s, title: sh.title, sub: "Hoja", run: () => { location.href = `app.html?app=${encodeURIComponent(appId)}&sheet=${encodeURIComponent(sh.id)}#hoja`; } });
    }
    for (const c of env.conns) {
      const s = Math.max(score(c.name, q), score(c.connector, q), score(JSON.stringify(c.config || {}), q));
      if (s) groups.conexiones.push({ s, title: c.name, sub: `Conexión · ${c.connector}${c.mine === false ? " · compartida" : ""}`, run: () => { location.href = "conexiones.html"; } });
    }
    const LABEL = { script: "Script de carga", campos: "Tablas y campos", notas: "Notas para agente", hojas: "Hojas", conexiones: "Conexiones" };
    items = [];
    let html = "";
    for (const [k, list] of Object.entries(groups)) {
      if (!list.length) continue;
      list.sort((a, b) => b.s - a.s);
      html += `<div class="es-g">${LABEL[k]} <em>${list.length}</em></div>`;
      for (const it of list.slice(0, 30)) {
        items.push(it);
        html += `<button type="button" class="es-it ${it.s < 2 ? "near" : ""}" data-i="${items.length - 1}"><b>${mark(it.title.slice(0, 160), q)}</b><small>${esc(it.sub)}${it.s < 2 ? " · parecida" : ""}</small></button>`;
      }
    }
    res.innerHTML = html || `<div class="es-empty">Nada coincide con «${esc(input.value.trim())}».</div>`;
    res.querySelectorAll("[data-i]").forEach((b) => b.addEventListener("click", () => items[+b.dataset.i].run()));
  }
  function jumpTo(word) {
    const lines = getCode().split(/\r?\n/);
    const i = lines.findIndex((l) => norm(l).includes(norm(word)));
    close();
    if (i >= 0) onJump(i);
  }
  let timer = 0;
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 140); });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && items[0]) items[0].run(); });
  input.focus();
  if (initial) run();
}

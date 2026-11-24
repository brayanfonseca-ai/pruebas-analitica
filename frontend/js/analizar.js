// analizar.js — «Analizar»: la galería de cuadernos de análisis de todas tus aplicaciones.
//
// Un cuaderno (js/app-cuaderno.js) vive dentro de una app y mezcla celdas de SQL, perfil de campos,
// Pareto/ABC, correlación, atípicos y notas. Esta página los reúne: lista las apps visibles
// (GET /apps) y sus cuadernos (GET /apps/{id}/notebooks), con búsqueda, filtro por app y orden.
// «Nuevo cuaderno» pide la app, lo crea (POST /apps/{id}/notebooks) y lo abre en app.html?app=…&nb=…#cuaderno.

import * as api from "./api.js";
import { authService } from "./auth-service.js";
import { modal, toast } from "./ui-kit.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const KIND = { sql: ["SQL", ""], profile: ["Perfil", "k-profile"], pareto: ["Pareto", "k-pareto"], correlation: ["Correlación", "k-correlation"], outliers: ["Atípicos", "k-outliers"], note: ["Nota", "k-note"] };
const href = (n) => `app.html?app=${encodeURIComponent(n.app_id)}&nb=${encodeURIComponent(n.id)}#cuaderno`;

function ago(s) {
  const d = new Date(s);
  if (isNaN(d)) return "";
  const m = Math.round((Date.now() - d) / 60000);
  if (m < 1) return "ahora";
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  const dd = Math.round(h / 24);
  if (dd < 30) return `hace ${dd} ${dd === 1 ? "día" : "días"}`;
  return d.toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" });
}

const st = { apps: [], items: [], q: "", app: "", mine: false, sort: "recent", loading: true, error: "" };

async function pool(tasks, n = 4) {
  let i = 0;
  const run = async () => { while (i < tasks.length) { const t = tasks[i++]; await t(); } };
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, run));
}

export function analizarHtml() {
  return `
    <div class="an-bar">
      <div class="q-filter-search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg><input id="anQ" placeholder="Buscar cuaderno, descripción o autor" aria-label="Buscar cuaderno" /></div>
      <label class="an-sort">Aplicación <select id="anApp"><option value="">Todas</option></select></label>
      <label class="an-chk"><input type="checkbox" id="anMine" /> Solo míos</label>
      <span class="an-sp"></span>
      <label class="an-sort">Ordenar <select id="anSort"><option value="recent">Editados recientemente</option><option value="name">Nombre (A-Z)</option><option value="app">Aplicación</option></select></label>
    </div>
    <div id="anRoot"><p class="cfg-muted"><span class="in-spin"></span> Cargando cuadernos…</p></div>`;
}

export function newNotebookButton() {
  return authService.can("charts:edit") ? `<button class="q-btn primary" id="anNew">＋ Nuevo cuaderno</button>` : "";
}

function card(n) {
  const kinds = Object.entries(n.kinds || {});
  return `<a class="an-card" href="${esc(href(n))}">
    <span class="an-c-app">${esc(n.app_name)}</span>
    <h3 title="${esc(n.name)}">${esc(n.name)}</h3>
    <p>${esc(n.description || "Sin descripción.")}</p>
    <div class="an-kinds">${kinds.map(([k, c]) => `<span class="nb-badge ${KIND[k]?.[1] || ""}">${esc(KIND[k]?.[0] || k)}${c > 1 ? ` ×${c}` : ""}</span>`).join("")}</div>
    <div class="an-foot"><span>${n.cell_count} ${n.cell_count === 1 ? "celda" : "celdas"} · ${esc(n.owner_name || "")}</span><span>${esc(ago(n.updated_at))}</span></div>
  </a>`;
}

function intro() {
  const it = (t, d) => `<div class="nb-wl-it"><b>${t}</b><span>${d}</span></div>`;
  return `<div class="an-intro">
    ${it("SQL sobre tus datos", "SELECT, GROUP BY, HAVING, FILTER (WHERE …), CASE y percentiles, con tabla o gráfico al instante.")}
    ${it("Perfil de campos", "Vacíos, distintos, percentiles, asimetría y distribución de cualquier campo.")}
    ${it("Pareto y ABC", "Qué parte de clientes, productos o rutas explica el 80 % del resultado.")}
    ${it("Correlación y atípicos", "Qué variables se mueven juntas y qué registros se salen de lo normal.")}
  </div>`;
}

function paint(main) {
  const root = main.querySelector("#anRoot");
  if (st.loading) return;
  if (st.error) { root.innerHTML = `<p class="cfg-err">${esc(st.error)}</p>`; return; }
  const me = authService.current() || {};
  const q = norm(st.q);
  let list = st.items.filter((n) => (!st.app || n.app_id === st.app) && (!st.mine || n.owner_id === me.id)
    && (!q || norm(`${n.name} ${n.description || ""} ${n.owner_name || ""} ${n.app_name}`).includes(q)));
  list = list.sort((a, b) => st.sort === "name" ? a.name.localeCompare(b.name, "es")
    : st.sort === "app" ? a.app_name.localeCompare(b.app_name, "es") || String(b.updated_at).localeCompare(String(a.updated_at))
    : String(b.updated_at).localeCompare(String(a.updated_at)));
  const canNew = authService.can("charts:edit") && st.apps.length;
  if (!st.items.length) {
    root.innerHTML = `${intro()}<div class="q-empty-box"><div class="q-empty big"><p class="q-empty-title">Aún no hay cuadernos</p>
      <p class="q-empty-text">Un cuaderno reúne consultas, análisis y notas sobre los datos de una aplicación. Se guarda solo y cualquiera con acceso a la app puede abrirlo.</p>
      ${canNew ? `<button class="q-btn primary" data-new>＋ Crear el primero</button>` : ""}</div></div>`;
    root.querySelector("[data-new]")?.addEventListener("click", () => chooseApp());
    return;
  }
  root.innerHTML = list.length
    ? `<p class="cfg-muted" style="margin:0 0 10px">${list.length} ${list.length === 1 ? "cuaderno" : "cuadernos"}${list.length !== st.items.length ? ` de ${st.items.length}` : ""}</p><div class="an-grid">${list.map(card).join("")}</div>`
    : `<p class="cfg-muted">Ningún cuaderno coincide con los filtros.</p>`;
}

async function load(main) {
  st.loading = true; st.error = "";
  try {
    st.apps = await api.listApps();
    const items = [];
    await pool(st.apps.map((a) => async () => {
      const list = await api.listNotebooks(a.id).catch(() => []);
      list.forEach((n) => items.push({ ...n, app_id: a.id, app_name: a.name }));
    }));
    st.items = items;
  } catch (e) { st.error = e.message; }
  st.loading = false;
  const sel = main.querySelector("#anApp");
  const withNb = new Set(st.items.map((n) => n.app_id));
  sel.innerHTML = `<option value="">Todas</option>` + st.apps.filter((a) => withNb.has(a.id)).map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join("");
  paint(main);
}

function chooseApp() {
  const apps = [...st.apps].sort((a, b) => a.name.localeCompare(b.name, "es"));
  const count = (id) => st.items.filter((n) => n.app_id === id).length;
  const m = modal({
    title: "Nuevo cuaderno",
    body: `<p class="cfg-sub" style="margin:0 0 12px">¿Sobre qué aplicación? El cuaderno usará sus tablas y campos.</p>
      <input class="nb-search" id="anNewQ" placeholder="Buscar aplicación" style="width:100%;box-sizing:border-box;margin:0 0 10px" />
      <div class="an-new-list">${apps.map((a) => `<button type="button" data-app="${esc(a.id)}" data-n="${esc(norm(a.name))}">${esc(a.name)}<small>${count(a.id) ? `${count(a.id)} ${count(a.id) === 1 ? "cuaderno" : "cuadernos"}` : "Sin cuadernos"}</small></button>`).join("")}</div>`,
  });
  const q = m.el.querySelector("#anNewQ");
  q.focus();
  q.addEventListener("input", () => { const v = norm(q.value); m.el.querySelectorAll("[data-app]").forEach((b) => { b.hidden = v && !b.dataset.n.includes(v); }); });
  m.el.querySelectorAll("[data-app]").forEach((b) => b.addEventListener("click", async () => {
    b.disabled = true;
    try {
      const n = await api.createNotebook(b.dataset.app, { name: `Análisis ${new Date().toLocaleDateString("es-CO", { day: "numeric", month: "short" })}` });
      location.href = href({ ...n, app_id: b.dataset.app });
    } catch (e) { toast(e.message, "err"); b.disabled = false; }
  }));
}

export function mountAnalizar(main) {
  main.querySelector("#anQ").addEventListener("input", (e) => { st.q = e.target.value; paint(main); });
  main.querySelector("#anApp").addEventListener("change", (e) => { st.app = e.target.value; paint(main); });
  main.querySelector("#anMine").addEventListener("change", (e) => { st.mine = e.target.checked; paint(main); });
  main.querySelector("#anSort").addEventListener("change", (e) => { st.sort = e.target.value; paint(main); });
  document.getElementById("anNew")?.addEventListener("click", () => chooseApp());
  load(main);
}

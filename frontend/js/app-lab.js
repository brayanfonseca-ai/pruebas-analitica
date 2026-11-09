// app-lab.js — vista "Experimentos de ML" dentro de una aplicación. No duplica
// el estudio: lista los experimentos de ESTA app y abre el módulo independiente
// (experimento.html). "Nuevo experimento" abre la creación con la app preseleccionada.

import * as api from "./api.js";
import { ALGOS, ALGO_BY_BACKEND } from "./ml-catalog.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = (iso) => { const d = new Date(iso); return isNaN(d) ? "—" : d.toLocaleString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); };
const SV = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const FLASK = SV(`<path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3"/><path d="M7.5 15h9"/>`);
const PLUS = SV(`<path d="M12 5v14M5 12h14"/>`);

export async function render(mount, ctx) {
  mount.innerHTML = `<div class="ml-wrap"><p class="ml-muted">Cargando…</p></div>`;
  const wrap = mount.firstElementChild;
  let list = [];
  try { list = (await api.listExperiments()).filter((e) => e.app_id === ctx.appId); }
  catch (e) { wrap.innerHTML = `<div class="ml-note err">No se pudieron cargar los experimentos: ${esc(e.message)}</div>`; return () => {}; }
  const newHref = `experimentos.html?new=1&app=${encodeURIComponent(ctx.appId)}`;
  const algo = (a) => { const k = ALGO_BY_BACKEND(a); return k ? ALGOS[k].name : a || "—"; };
  wrap.innerHTML = `
    <div class="ml-head">
      <div><h2 class="ml-title">Experimentos de ML</h2>
        <p class="ml-sub">Experimentos que usan los datos de esta aplicación. Se crean y trabajan en el módulo de Experimentos.</p></div>
      <div class="ml-card-actions"><a class="ml-btn ghost" href="experimentos.html">Ver todos</a><a class="ml-btn primary" href="${newHref}"><span class="ml-ic">${PLUS}</span>Nuevo experimento</a></div>
    </div>
    ${list.length ? `<div class="ml-scroll mx-list-wrap"><table class="ml-table">
      <thead><tr><th>Experimento</th><th>Tabla</th><th>Ejecuciones</th><th>Último algoritmo</th><th>Actualizado</th><th></th></tr></thead>
      <tbody>${list.map((e) => `<tr><td><strong>${esc(e.name)}</strong></td><td>${esc(e.table_name || "—")}</td><td>${e.runs}</td><td>${esc(algo(e.last_algorithm))}</td><td>${fmtDate(e.updated_at)}</td>
        <td class="mx-actions"><a class="ml-btn ghost small" href="experimento.html?id=${encodeURIComponent(e.id)}">Abrir</a></td></tr>`).join("")}</tbody></table></div>`
      : `<div class="ml-empty"><span class="ml-empty-ico">${FLASK}</span><strong>Sin experimentos en esta aplicación</strong><span class="ml-empty-hint">Crea uno para segmentar, predecir, pronosticar o comparar modelos con AutoML.</span><a class="ml-btn primary" href="${newHref}"><span class="ml-ic">${PLUS}</span>Nuevo experimento</a></div>`}`;
  return () => {};
}

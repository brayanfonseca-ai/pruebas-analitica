// ask-home.js — «Pregúntale a tus datos» y «De archivo a tablero» en Inicio.
//
// · Pregúntale: eliges una app, escribes la pregunta en español y el motor responde con un número, barras o una
//   tendencia, una frase y SIEMPRE cómo se calculó (medida y su fórmula, agrupación, filtros, orden, tabla, filas y
//   la consulta exacta). La interpretación la hace el backend (POST /apps/{id}/ask), sin IA ni costo por pregunta.
// · De archivo a tablero: sueltas un CSV/Excel y en segundos tienes una app con su tablero (KPIs, barras, torta,
//   evolución, detalle y filtros) generado a partir de los datos (POST /apps/{id}/auto-dashboard).

import * as api from "./api.js";
import { authService } from "./auth-service.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nf = (v) => (v == null || isNaN(v) ? "—" : Number(v).toLocaleString("es-CO", { maximumFractionDigits: 2 }));
const LS_APP = "ds.ask.app";

export function mountAsk(host, { onAppsChanged } = {}) {
  if (!host) return;
  const canBuild = authService.can("apps:create") && authService.can("data:import") && authService.can("charts:edit");
  const canSheet = authService.can("charts:edit");
  let apps = [];
  let busy = false;

  host.innerHTML = `
    <div class="ah-card">
      <div class="ah-head">
        <div>
          <h2 class="ah-title"><span class="ah-spark" aria-hidden="true">✦</span> Pregúntale a tus datos</h2>
          <p class="ah-sub">Escribe como hablas: «% de inactivos por sucursal», «top 5 sucursales por cantidad de servicios», «¿cuántos conductores hay en 2025?». Siempre verás cómo se calculó.</p>
        </div>
        ${canBuild ? `<button type="button" class="ah-quick" id="ahQuick">⚡ De archivo a tablero</button>` : ""}
      </div>
      <form class="ah-form" id="ahForm" autocomplete="off">
        <label class="ah-sr" for="ahApp">Aplicación</label>
        <select id="ahApp" class="ah-app" aria-label="Aplicación"></select>
        <label class="ah-sr" for="ahQ">Pregunta</label>
        <input id="ahQ" class="ah-q" type="text" maxlength="400" placeholder="¿Qué quieres saber?" />
        <button type="submit" class="ah-go" id="ahGo">Preguntar</button>
      </form>
      <div class="ah-chips" id="ahChips" aria-label="Preguntas sugeridas"></div>
      <div class="ah-out" id="ahOut" aria-live="polite"></div>
    </div>`;
  const $ = (s) => host.querySelector(s);

  async function loadApps() {
    try { apps = await api.listApps(); } catch { apps = []; }
    const sel = $("#ahApp");
    const last = localStorage.getItem(LS_APP);
    sel.innerHTML = apps.length
      ? apps.map((a) => `<option value="${esc(a.id)}" ${a.id === last ? "selected" : ""}>${esc(a.name)}</option>`).join("")
      : `<option value="">Sin aplicaciones</option>`;
    sel.disabled = !apps.length;
    $("#ahQ").disabled = $("#ahGo").disabled = !apps.length;
    if (apps.length) loadSuggestions();
    else $("#ahChips").innerHTML = `<span class="ah-none">Crea una app o usa «De archivo a tablero» para empezar a preguntar.</span>`;
  }

  async function loadSuggestions() {
    const appId = $("#ahApp").value;
    const chips = $("#ahChips");
    chips.innerHTML = `<span class="ah-none">Buscando preguntas para esta app…</span>`;
    try {
      const s = await api.askSuggestions(appId);
      if ($("#ahApp").value !== appId) return;
      chips.innerHTML = s.length ? s.map((q) => `<button type="button" class="ah-chip" data-q="${esc(q)}">${esc(q)}</button>`).join("")
        : `<span class="ah-none">Esta app aún no tiene datos para preguntar.</span>`;
    } catch { chips.innerHTML = ""; }
  }

  async function ask(question) {
    const appId = $("#ahApp").value;
    const q = (question ?? $("#ahQ").value).trim();
    if (!appId || !q || busy) return;
    $("#ahQ").value = q;
    busy = true; $("#ahGo").disabled = true;
    const out = $("#ahOut");
    out.innerHTML = `<div class="ah-loading"><span class="ah-dot"></span><span class="ah-dot"></span><span class="ah-dot"></span> Calculando…</div>`;
    try {
      const r = await api.askData(appId, q);
      out.innerHTML = r.ok ? answerHtml(r) : notUnderstood(r);
      wireAnswer(out, r, appId);
    } catch (e) {
      out.innerHTML = `<div class="ah-err">No se pudo responder: ${esc(e.message)}</div>`;
    } finally { busy = false; $("#ahGo").disabled = false; }
  }

  function notUnderstood(r) {
    return `<div class="ah-ans no">
      <p class="ah-text">🤔 ${esc(r.message)}</p>
      <p class="ah-hint">Prueba nombrando una medida o un campo de la app (o una métrica certificada) y cómo agruparlo: «total de ventas por ciudad».</p>
      ${(r.suggestions || []).length ? `<div class="ah-chips">${r.suggestions.map((q) => `<button type="button" class="ah-chip" data-q="${esc(q)}">${esc(q)}</button>`).join("")}</div>` : ""}
    </div>`;
  }

  function answerHtml(r) {
    const h = r.how || {};
    const m = h.measure || {};
    const pct = String(m.label || "").startsWith("%");
    const unit = pct ? " %" : "";
    let viz = "";
    if (r.chart === "kpi") {
      viz = `<div class="ah-kpi"><b>${esc(nf(r.result.value))}${unit}</b><span>${esc(m.label)}</span></div>`;
    } else if (r.chart === "line") {
      viz = lineSvg(r.result.labels, r.result.values, unit);
    } else {
      const vals = r.result.values || [];
      const max = Math.max(...vals.map((v) => Math.abs(v)), 0) || 1;
      viz = `<div class="ah-bars" role="list">${(r.result.labels || []).map((l, i) => `
        <div class="ah-bar" role="listitem"><span class="ah-bl" title="${esc(l)}">${esc(l)}</span>
          <span class="ah-bt"><span class="ah-bf" style="width:${Math.max(1.5, Math.abs(vals[i]) / max * 100).toFixed(1)}%"></span></span>
          <span class="ah-bv">${esc(nf(vals[i]))}${unit}</span></div>`).join("")}</div>`;
    }
    const src = { certified: `<span class="ah-cert" title="Definición oficial${m.certified_by ? " · certificada por " + esc(m.certified_by) : ""}">✓ Métrica certificada</span>`,
      master: `<span class="ah-tag">Medida maestra</span>` }[m.source] || "";
    return `<div class="ah-ans">
      <div class="ah-ans-top"><p class="ah-text">${esc(r.answer)}</p>${src}</div>
      ${viz}
      <details class="ah-how" open>
        <summary>Cómo se calculó</summary>
        <ol class="ah-steps">${(h.steps || []).map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
        <div class="ah-expr"><span>Fórmula</span><code>${esc(m.expression)}</code></div>
        <details class="ah-q-json"><summary>Ver la consulta enviada al motor</summary><pre>${esc(JSON.stringify(r.query, null, 2))}</pre></details>
      </details>
      <div class="ah-actions">
        ${canSheet ? `<button type="button" class="ah-btn" data-save>＋ Guardar en una hoja nueva</button>` : ""}
        <a class="ah-btn ghost" href="app.html?app=${encodeURIComponent($("#ahApp").value)}#hoja">Abrir la app</a>
      </div>
    </div>`;
  }

  function lineSvg(labels = [], values = [], unit = "") {
    if (!values.length) return "";
    const W = 640, H = 170, P = 26;
    const mn = Math.min(...values), mx = Math.max(...values);
    const span = mx - mn || 1;
    const x = (i) => P + (values.length === 1 ? (W - 2 * P) / 2 : i * (W - 2 * P) / (values.length - 1));
    const y = (v) => H - P - (v - mn) / span * (H - 2 * P);
    const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const area = `${P},${H - P} ${pts} ${x(values.length - 1).toFixed(1)},${H - P}`;
    const step = Math.max(1, Math.ceil(labels.length / 8));
    return `<figure class="ah-line"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolución de ${esc(labels[0])} a ${esc(labels[labels.length - 1])}">
      <polygon points="${area}" class="ah-area"/><polyline points="${pts}" class="ah-pl"/>
      ${values.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.6" class="ah-pt"><title>${esc(labels[i])}: ${esc(nf(v))}${unit}</title></circle>`).join("")}
      ${labels.map((l, i) => (i % step === 0 || i === labels.length - 1) ? `<text x="${x(i).toFixed(1)}" y="${H - 6}" class="ah-ax" text-anchor="middle">${esc(l)}</text>` : "").join("")}
      <text x="${P}" y="14" class="ah-ax">máx ${esc(nf(mx))}${unit}</text>
    </svg></figure>`;
  }

  function wireAnswer(out, r, appId) {
    out.querySelectorAll("[data-q]").forEach((b) => b.addEventListener("click", () => ask(b.dataset.q)));
    out.querySelector("[data-save]")?.addEventListener("click", async (e) => {
      const b = e.currentTarget;
      b.disabled = true; b.textContent = "Creando hoja…";
      try {
        const o = { ...r.sheetObject, x: 0, y: 0, w: r.chart === "kpi" ? 8 : 16, h: r.chart === "kpi" ? 4 : 8 };
        const sheet = await api.createSheet(appId, { title: r.question.slice(0, 80), description: `Creada desde «Pregúntale a tus datos»: ${r.answer}`, objects: [o] });
        location.href = `app.html?app=${encodeURIComponent(appId)}&sheet=${encodeURIComponent(sheet.id)}#hoja`;
      } catch (ex) { b.disabled = false; b.textContent = `No se pudo crear: ${ex.message}`; }
    });
  }

  $("#ahForm").addEventListener("submit", (e) => { e.preventDefault(); ask(); });
  $("#ahApp").addEventListener("change", () => { localStorage.setItem(LS_APP, $("#ahApp").value); $("#ahOut").innerHTML = ""; loadSuggestions(); });
  $("#ahChips").addEventListener("click", (e) => { const b = e.target.closest("[data-q]"); if (b) ask(b.dataset.q); });
  $("#ahQuick")?.addEventListener("click", () => openQuick({
    onDone: async (appId, question) => {
      localStorage.setItem(LS_APP, appId);
      await loadApps();
      onAppsChanged?.();
      if (question) ask(question);
    },
  }));
  loadApps();
  return { reload: loadApps };
}

/* ======================= De archivo a tablero ======================= */
function openQuick({ onDone }) {
  const wrap = document.createElement("div");
  wrap.className = "ah-modal-bg";
  wrap.innerHTML = `
    <div class="ah-modal" role="dialog" aria-modal="true" aria-labelledby="ahqT">
      <div class="ah-m-head"><h3 id="ahqT">⚡ De archivo a tablero</h3><button type="button" class="ah-x" data-x aria-label="Cerrar">✕</button></div>
      <div class="ah-m-body" id="ahqBody">
        <p class="ah-sub">Sube un CSV o Excel: creo la aplicación, perfilo los datos y te armo un tablero con KPIs, gráficos y filtros. Después puedes preguntarle lo que quieras.</p>
        <label class="ah-drop" id="ahDrop" tabindex="0">
          <input type="file" id="ahFile" accept=".csv,.xlsx,.xls" hidden />
          <span class="ah-drop-ico" aria-hidden="true">⬆</span>
          <b id="ahFileName">Arrastra el archivo aquí o haz clic para elegirlo</b>
          <small>.csv, .xlsx o .xls</small>
        </label>
        <label class="ah-lbl">Nombre de la aplicación<input id="ahName" maxlength="120" placeholder="Se usa el nombre del archivo" /></label>
        <ol class="ah-prog" id="ahProg" hidden>
          <li data-s="app">Crear la aplicación</li>
          <li data-s="up">Subir y perfilar los datos</li>
          <li data-s="dash">Diseñar el tablero</li>
          <li data-s="ok">Listo</li>
        </ol>
        <div class="ah-err" id="ahqErr" role="alert"></div>
      </div>
      <div class="ah-m-foot"><span class="ah-timer" id="ahTimer"></span><button type="button" class="ah-btn ghost" data-x>Cancelar</button><button type="button" class="ah-btn" id="ahBuild" disabled>Crear tablero</button></div>
    </div>`;
  document.body.appendChild(wrap);
  const $ = (s) => wrap.querySelector(s);
  let file = null, running = false;
  const close = () => { if (!running) wrap.remove(); };
  wrap.querySelectorAll("[data-x]").forEach((b) => b.addEventListener("click", close));
  wrap.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  const pick = (f) => {
    if (!f) return;
    if (!/\.(csv|xlsx|xls)$/i.test(f.name)) { $("#ahqErr").textContent = "Formato no soportado: usa .csv, .xlsx o .xls."; return; }
    file = f; $("#ahqErr").textContent = "";
    $("#ahFileName").textContent = `${f.name} · ${(f.size / 1024).toFixed(0)} KB`;
    if (!$("#ahName").value) $("#ahName").value = f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
    $("#ahBuild").disabled = false;
  };
  $("#ahFile").addEventListener("change", (e) => pick(e.target.files[0]));
  const drop = $("#ahDrop");
  ["dragover", "dragenter"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("on"); }));
  ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, () => drop.classList.remove("on")));
  drop.addEventListener("drop", (e) => { e.preventDefault(); pick(e.dataTransfer.files[0]); });
  drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("#ahFile").click(); } });

  $("#ahBuild").addEventListener("click", async () => {
    if (!file || running) return;
    running = true;
    $("#ahBuild").disabled = true;
    $("#ahProg").hidden = false;
    $("#ahqErr").textContent = "";
    const t0 = Date.now();
    const tick = setInterval(() => { $("#ahTimer").textContent = `${((Date.now() - t0) / 1000).toFixed(1)} s`; }, 100);
    const step = (s, state) => { const li = $(`[data-s="${s}"]`); li.className = state; };
    let cur = "app";
    try {
      step("app", "run");
      const app = await api.createApp(($("#ahName").value || file.name).trim().slice(0, 120));
      step("app", "done"); cur = "up"; step("up", "run");
      const t = await api.uploadTable(app.id, file);
      step("up", "done"); cur = "dash"; step("dash", "run");
      const r = await api.autoDashboard(app.id, {});
      step("dash", "done"); step("ok", "done");
      clearInterval(tick);
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      const s = r.summary || {};
      $("#ahqBody").insertAdjacentHTML("beforeend", `
        <div class="ah-done">
          <p><b>Tablero listo en ${secs} s.</b> ${esc(nf(s.rows))} filas y ${esc(s.columns)} columnas de <b>${esc(t?.name || s.table)}</b>; ${esc(s.objects)} objetos.</p>
          <ul class="ah-found">
            ${s.dimensions?.length ? `<li><span>Categorías</span>${s.dimensions.map(esc).join(", ")}</li>` : ""}
            ${s.measures?.length ? `<li><span>Medidas</span>${s.measures.map(esc).join(", ")}</li>` : ""}
            ${s.time ? `<li><span>Tiempo</span>${esc(s.time)}</li>` : ""}
            ${s.id ? `<li><span>Identificador</span>${esc(s.id)}</li>` : ""}
          </ul>
          ${(r.questions || []).length ? `<p class="ah-hint">Ya puedes preguntarle:</p><div class="ah-chips">${r.questions.slice(0, 5).map((q) => `<button type="button" class="ah-chip" data-ask="${esc(q)}">${esc(q)}</button>`).join("")}</div>` : ""}
        </div>`);
      running = false;
      const foot = wrap.querySelector(".ah-m-foot");
      foot.innerHTML = `<span class="ah-timer">${secs} s</span><button type="button" class="ah-btn ghost" data-x>Cerrar</button>
        <a class="ah-btn" href="app.html?app=${encodeURIComponent(app.id)}&sheet=${encodeURIComponent(r.sheet.id)}#hoja">Abrir tablero →</a>`;
      foot.querySelector("[data-x]").addEventListener("click", () => { wrap.remove(); onDone?.(app.id); });
      wrap.querySelectorAll("[data-ask]").forEach((b) => b.addEventListener("click", () => { wrap.remove(); onDone?.(app.id, b.dataset.ask); }));
    } catch (e) {
      clearInterval(tick);
      step(cur, "fail");
      running = false;
      $("#ahqErr").textContent = `No se pudo completar: ${e.message}`;
      $("#ahBuild").disabled = false;
    }
  });
  setTimeout(() => drop.focus(), 30);
}

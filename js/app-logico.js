// app-logico.js — vista "Modelo lógico" (Lógica de negocio), estilo enterprise
// (Qlik Sense Business Logic). Diseño PROFESIONAL y sobrio: iconografía SVG fina
// monocromática, jerarquía tipográfica y color por tipo de campo. La intención
// se comunica por el diseño, sin cajas de texto explicativo ni emojis.
//
// Backend: LogicalModelController (GET genera la lógica por defecto desde los
// datos reales + mezcla lo guardado; PUT/sub-recursos persisten). Azul #172983.

import * as api from "./api.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---- Iconos SVG monocromáticos (stroke currentColor, trazo fino) ---- */
const ICON = {
  // dimensión: columnas/categorías
  dimension: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/></svg>`,
  // medida: barras/suma
  measure: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>`,
  // fecha: calendario
  date: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></svg>`,
  // jerarquía: nodos conectados
  hierarchy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="5" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M12 8v4M12 12H6v4M12 12h6v4"/></svg>`,
  reset: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/></svg>`,
  close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
};

const CLASS = {
  dimension: { label: "Dimensión", ico: ICON.dimension },
  measure:   { label: "Medida",    ico: ICON.measure },
  date:      { label: "Fecha",     ico: ICON.date },
};
const VIS = {
  visible:  { label: "Visible" },
  hidden:   { label: "Oculto" },
  excluded: { label: "Excluido" },
};
const AGG = {
  sum:   "Suma",
  avg:   "Promedio",
  count: "Conteo",
  none:  "Ninguna",
};

export async function render(mount, ctx) {
  const appId = ctx.appId;
  let doc = null;
  let tab = "general";

  mount.innerHTML = `
    <div class="q-subtoolbar">
      <div class="lm-head">
        <div>
          <h2 class="lm-title">Modelo lógico</h2>
          <p class="lm-sub">Define el significado de cada campo para que el análisis y el asistente interpreten tus datos con precisión.</p>
        </div>
        <div class="lm-actions">
          <button class="lm-btn-ghost" id="lmReset" title="Regenerar el modelo a partir de los datos"><span class="lm-ic">${ICON.reset}</span>Restablecer</button>
          <button class="lm-switch" id="lmToggle" role="switch"><span class="lm-switch-track"><span class="lm-switch-thumb"></span></span><span class="lm-switch-label">Lógica</span></button>
        </div>
      </div>
      <div class="lm-tabs" id="lmTabs">
        ${[
          ["general","Resumen"],
          ["campos","Campos"],
          ["jerarquias","Jerarquías"],
          ["calendario","Calendario"],
        ].map(([k,l]) => `<button class="lm-tab ${k==="general"?"active":""}" data-tab="${k}">${l}</button>`).join("")}
      </div>
    </div>
    <div class="lm-wrap" id="lmWrap"><p class="lm-muted">Cargando…</p></div>`;

  const wrap = mount.querySelector("#lmWrap");
  mount.querySelectorAll(".lm-tab").forEach((b) =>
    b.addEventListener("click", () => { tab = b.dataset.tab; mount.querySelectorAll(".lm-tab").forEach((x)=>x.classList.toggle("active",x===b)); renderTab(); }));
  mount.querySelector("#lmReset").addEventListener("click", async () => {
    if (!confirm("¿Regenerar el modelo a partir de tus datos? Se pierden los ajustes manuales.")) return;
    wrap.innerHTML = `<p class="lm-muted">Regenerando…</p>`;
    try { doc = await api.resetLogicalModel(appId); renderTab(); } catch (e) { wrap.innerHTML = err(e); }
  });
  mount.querySelector("#lmToggle").addEventListener("click", async () => {
    try { doc = doc?.enabled ? await api.disableLogicalModel(appId) : await api.enableLogicalModel(appId); syncToggle(); renderTab(); } catch (e) { wrap.innerHTML = err(e); }
  });

  function err(e) { return `<div class="lm-empty lm-err-box">No se pudo cargar: ${esc(e.message || e)}</div>`; }
  function syncToggle() {
    const btn = mount.querySelector("#lmToggle");
    btn.classList.toggle("on", !!doc?.enabled);
    btn.setAttribute("aria-checked", doc?.enabled ? "true" : "false");
    btn.title = doc?.enabled ? "Activa: el asistente usa esta lógica. Clic para desactivar." : "Inactiva. Clic para activar.";
  }

  try { doc = await api.getLogicalModel(appId); } catch (e) { wrap.innerHTML = err(e); return () => {}; }
  syncToggle();
  renderTab();

  function renderTab() {
    if (!doc) return;
    if (tab === "general") return renderGeneral();
    if (tab === "campos") return renderCampos();
    if (tab === "jerarquias") return renderJerarquias();
    if (tab === "calendario") return renderCalendario();
  }

  /* ---------------- Resumen (General) ---------------- */
  function renderGeneral() {
    const s = doc.summary || {};
    const fields = doc.fields || [];
    const nDim = fields.filter((f) => f.classification === "dimension").length;
    const nMea = fields.filter((f) => f.classification === "measure").length;
    const nDate = fields.filter((f) => f.classification === "date").length;
    const card = (cls, ico, n, name) => `
      <div class="lm-card">
        <div class="lm-card-ico ${cls}">${ico}</div>
        <div class="lm-card-meta">
          <div class="lm-big">${n}</div>
          <div class="lm-card-name">${name}</div>
        </div>
      </div>`;
    wrap.innerHTML = `
      <div class="lm-cards">
        ${card("dimension", ICON.dimension, nDim, "Dimensiones")}
        ${card("measure", ICON.measure, nMea, "Medidas")}
        ${card("date", ICON.date, nDate, "Fechas")}
        ${card("hierarchy", ICON.hierarchy, s.hierarchies || 0, "Jerarquías")}
      </div>
      <div class="lm-status ${doc.enabled ? "on" : "off"}">
        <span class="lm-status-dot"></span>
        <span class="lm-status-text">${doc.enabled
          ? "Lógica de negocio activa — el asistente la usa para interpretar tus datos."
          : "Lógica de negocio inactiva — actívala con el interruptor superior."}</span>
      </div>
      ${(s.fieldsHidden||0)+(s.fieldsExcluded||0) > 0 ? `<p class="lm-note">${s.fieldsHidden||0} oculto(s) · ${s.fieldsExcluded||0} excluido(s). Gestiónalos en Campos.</p>` : ""}`;
  }

  /* ---------------- Campos ---------------- */
  function renderCampos() {
    const fields = doc.fields || [];
    wrap.innerHTML = `
      <div class="lm-legend">
        ${Object.entries(CLASS).map(([k,v]) => `<span class="lm-leg"><span class="lm-dot ${k}"></span>${v.label}</span>`).join("")}
      </div>
      <div class="lm-fields">
        ${fields.map((f, i) => fieldCard(f, i)).join("")}
      </div>
      <p class="lm-saved" id="lmSaved"></p>`;
    wrap.querySelectorAll("[data-fi]").forEach((el) => el.addEventListener("change", onFieldChange));
  }

  function fieldCard(f, i) {
    const c = CLASS[f.classification] || CLASS.dimension;
    const isMeasure = f.classification === "measure";
    return `
      <div class="lm-fcard">
        <div class="lm-fcard-head">
          <span class="lm-fico ${f.classification}">${c.ico}</span>
          <div class="lm-fcard-name">
            <strong>${esc(f.display || f.field)}</strong>
            <span class="lm-orig">${f.display && f.display !== f.field ? `${esc(f.field)} · ` : ""}${esc(f.table)}</span>
          </div>
        </div>
        <div class="lm-fcard-ctrls">
          <label class="lm-ctrl"><span>Tipo</span>
            <select data-fi="${i}" data-k="classification">
              ${Object.entries(CLASS).map(([v,o]) => `<option value="${v}" ${f.classification===v?"selected":""}>${o.label}</option>`).join("")}
            </select></label>
          <label class="lm-ctrl"><span>Visibilidad</span>
            <select data-fi="${i}" data-k="visibility">
              ${Object.entries(VIS).map(([v,o]) => `<option value="${v}" ${f.visibility===v?"selected":""}>${o.label}</option>`).join("")}
            </select></label>
          <label class="lm-ctrl ${isMeasure?"":"lm-dim-ctrl"}"><span>Agregación</span>
            <select data-fi="${i}" data-k="defaultAggregation" ${isMeasure?"":"disabled"}>
              ${Object.entries(AGG).map(([v,l]) => `<option value="${v}" ${f.defaultAggregation===v?"selected":""}>${esc(l)}</option>`).join("")}
            </select></label>
        </div>
      </div>`;
  }

  async function onFieldChange(e) {
    const el = e.target;
    const i = +el.dataset.fi, k = el.dataset.k;
    const val = el.type === "checkbox" ? el.checked : el.value;
    doc.fields[i][k] = val;
    const needRerender = (k === "classification");
    const saved = mount.querySelector("#lmSaved");
    if (saved) saved.textContent = "Guardando…";
    try {
      doc = await api.putLogicalModel(appId, doc);
      if (needRerender) renderCampos();
      else if (saved) { saved.textContent = "Guardado"; setTimeout(() => { const s2 = mount.querySelector("#lmSaved"); if (s2) s2.textContent = ""; }, 1500); }
    } catch (err2) {
      if (saved) saved.textContent = "No se pudo guardar: " + (err2.message || err2);
    }
  }

  /* ---------------- Jerarquías ---------------- */
  function renderJerarquias() {
    const hs = doc.hierarchies || [];
    const dimFields = (doc.fields || []).filter((f) => f.classification === "dimension");
    wrap.innerHTML = `
      <div class="lm-section-head">
        <h3>Jerarquías</h3>
        <button class="lm-btn-primary" id="lmAddH" ${dimFields.length < 2 ? "disabled title='Requiere al menos 2 dimensiones'" : ""}><span class="lm-ic">${ICON.plus}</span>Crear jerarquía</button>
      </div>
      ${hs.length ? `<div class="lm-list">${hs.map((h) => `
        <div class="lm-item">
          <div class="lm-item-main">
            <span class="lm-item-ico">${ICON.hierarchy}</span>
            <div>
              <strong>${esc(h.name || "Jerarquía")}</strong>
              <div class="lm-levels">${(h.levels||[]).map((l,idx)=>`${idx?'<span class="lm-arrow">›</span>':''}<span class="lm-level">${esc(l)}</span>`).join("")}</div>
            </div>
          </div>
          <button class="lm-del" data-del="${esc(h.id)}" title="Eliminar">${ICON.trash}</button>
        </div>`).join("")}</div>`
        : emptyState("hierarchy", "Sin jerarquías", dimFields.length < 2 ? "Necesitas al menos 2 dimensiones para crear una ruta de desglose." : "Crea una ruta para profundizar nivel a nivel (p. ej. Región › Categoría).")}`;
    const addBtn = wrap.querySelector("#lmAddH");
    if (addBtn) addBtn.addEventListener("click", () => openHierarchyModal(dimFields));
    wrap.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => {
      if (!confirm("¿Eliminar esta jerarquía?")) return;
      try { doc = await api.deleteHierarchy(appId, b.dataset.del); renderJerarquias(); } catch (e) { alert(e.message); }
    }));
  }

  function openHierarchyModal(dimFields) {
    const bd = document.createElement("div");
    bd.className = "lm-modal-bd";
    bd.innerHTML = `<div class="lm-modal">
      <div class="lm-modal-head"><h3>Nueva jerarquía</h3><button class="lm-x">${ICON.close}</button></div>
      <div class="lm-modal-body">
        <p class="lm-modal-hint">Selecciona las dimensiones en orden, de lo general a lo específico.</p>
        <label class="lm-field"><span>Nombre</span><input id="hName" placeholder="Ej: Geografía"></label>
        <div class="lm-level-pick">${dimFields.map((f) => `<label class="lm-chk"><input type="checkbox" value="${esc(f.display||f.field)}"><span class="lm-pick-num"></span><span class="lm-pick-label">${esc(f.display||f.field)}</span></label>`).join("")}</div>
      </div>
      <div class="lm-modal-foot"><button class="lm-btn-ghost" data-c>Cancelar</button><button class="lm-btn-primary" id="hSave">Crear</button></div>
    </div>`;
    document.body.appendChild(bd);
    const order = [];
    bd.querySelectorAll('.lm-level-pick input').forEach((cb) => cb.addEventListener("change", () => {
      if (cb.checked) order.push(cb.value); else { const i = order.indexOf(cb.value); if (i>=0) order.splice(i,1); }
      bd.querySelectorAll('.lm-level-pick label').forEach((lb) => {
        const v = lb.querySelector("input").value; const pos = order.indexOf(v);
        lb.querySelector(".lm-pick-num").textContent = pos >= 0 ? `${pos+1}` : "";
        lb.classList.toggle("picked", pos >= 0);
      });
    }));
    const close = () => bd.remove();
    bd.querySelector(".lm-x").addEventListener("click", close);
    bd.querySelector("[data-c]").addEventListener("click", close);
    bd.addEventListener("mousedown", (e) => { if (e.target === bd) close(); });
    bd.querySelector("#hSave").addEventListener("click", async () => {
      const name = bd.querySelector("#hName").value.trim() || "Jerarquía";
      if (order.length < 2) { alert("Selecciona al menos 2 niveles, en orden."); return; }
      try { doc = await api.addHierarchy(appId, { name, levels: [...order] }); close(); renderJerarquias(); } catch (e) { alert(e.message); }
    });
  }

  /* ---------------- Calendario ---------------- */
  function renderCalendario() {
    const dateFields = (doc.fields || []).filter((f) => f.classification === "date");
    const ps = doc.calendarPeriods || [];
    if (!dateFields.length) {
      wrap.innerHTML = emptyState("date", "Sin campos de fecha", "Marca un campo como Fecha en la pestaña Campos para habilitar los períodos de calendario.");
      return;
    }
    wrap.innerHTML = `
      <div class="lm-section-head"><h3>Períodos de calendario</h3><button class="lm-btn-primary" id="lmAddP"><span class="lm-ic">${ICON.plus}</span>Crear período</button></div>
      ${ps.length ? `<div class="lm-list">${ps.map((p) => `<div class="lm-item">
        <div class="lm-item-main"><span class="lm-item-ico">${ICON.date}</span>
          <div><strong>${esc(p.name||"Período")}</strong><div class="lm-levels"><span class="lm-level">${esc(p.field||"")}</span><span class="lm-arrow">·</span>${esc(p.granularity||"")}</div></div></div>
        <button class="lm-del" data-del="${esc(p.id)}" title="Eliminar">${ICON.trash}</button></div>`).join("")}</div>`
        : emptyState("date", "Sin períodos", "Crea un período para analizar la evolución por mes, trimestre o año.")}`;
    wrap.querySelector("#lmAddP").addEventListener("click", () => openPeriodModal(dateFields));
    wrap.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => {
      if (!confirm("¿Eliminar este período?")) return;
      try { doc = await api.deleteCalendarPeriod(appId, b.dataset.del); renderCalendario(); } catch (e) { alert(e.message); }
    }));
  }

  function openPeriodModal(dateFields) {
    const bd = document.createElement("div");
    bd.className = "lm-modal-bd";
    bd.innerHTML = `<div class="lm-modal">
      <div class="lm-modal-head"><h3>Nuevo período de calendario</h3><button class="lm-x">${ICON.close}</button></div>
      <div class="lm-modal-body">
        <label class="lm-field"><span>Nombre</span><input id="pName" placeholder="Ej: Mensual"></label>
        <label class="lm-field"><span>Campo de fecha</span><select id="pField">${dateFields.map((f)=>`<option>${esc(f.display||f.field)}</option>`).join("")}</select></label>
        <label class="lm-field"><span>Agrupar por</span><select id="pGran"><option>Día</option><option>Mes</option><option>Trimestre</option><option>Año</option></select></label>
      </div>
      <div class="lm-modal-foot"><button class="lm-btn-ghost" data-c>Cancelar</button><button class="lm-btn-primary" id="pSave">Crear</button></div>
    </div>`;
    document.body.appendChild(bd);
    const close = () => bd.remove();
    bd.querySelector(".lm-x").addEventListener("click", close);
    bd.querySelector("[data-c]").addEventListener("click", close);
    bd.addEventListener("mousedown", (e) => { if (e.target === bd) close(); });
    bd.querySelector("#pSave").addEventListener("click", async () => {
      const name = bd.querySelector("#pName").value.trim() || "Período";
      const field = bd.querySelector("#pField").value;
      const granularity = bd.querySelector("#pGran").value;
      try { doc = await api.addCalendarPeriod(appId, { name, field, granularity }); close(); renderCalendario(); } catch (e) { alert(e.message); }
    });
  }

  /* ---------------- Estado vacío sobrio ---------------- */
  function emptyState(iconKey, title, hint) {
    return `<div class="lm-empty">
      <span class="lm-empty-ico">${ICON[iconKey] || ICON.dimension}</span>
      <strong>${esc(title)}</strong>
      <span class="lm-empty-hint">${esc(hint)}</span>
    </div>`;
  }

  return () => {};
}

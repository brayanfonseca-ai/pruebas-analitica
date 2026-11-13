// embedding.js — módulo Embedding: incrusta un tablero de DataSense en cualquier página web.
//
// Cada embed tiene un ID y un token (dse_…). El token da acceso de SOLO LECTURA a UNA hoja, y solo mientras la
// aplicación esté en Producción y la hoja publicada. Se puede limitar a ciertos sitios (orígenes), ponerle
// vencimiento, rotar el token (el anterior deja de servir al instante) o desactivarlo.
//
// Se usa de tres formas: <iframe>, el SDK de JavaScript (embed-sdk.js) o la API REST con el token.

import { renderNav, wireAppsButton, renderProfileMenu, svg } from "./hub-nav.js";
import { authService } from "./auth-service.js";
import * as api from "./api.js";
import { esc, norm, fmtDate, toast, modal, confirmBox, copyText } from "./ui-kit.js";

if (!authService.isAuthenticated()) location.replace("index.html");
if (!authService.can("embed:manage")) location.replace("inicio.html");

const main = document.getElementById("main");
const st = { embeds: [], apps: [], q: "", status: "", loading: true, error: "" };

const STATUS = {
  active: ["Activo", "ok"], revoked: ["Desactivado", "off"], expired: ["Vencido", "warn"], unpublished: ["Sin publicar", "warn"],
};
const chip = (s) => { const [l, k] = STATUS[s] || [s, "off"]; return `<span class="em-st ${k}"><i></i>${l}</span>`; };
const urlOf = (e) => `${location.origin}/embed/${e.token}`;

async function load() {
  try { [st.embeds, st.apps] = await Promise.all([api.listEmbeds(), api.listApps()]); st.error = ""; } catch (e) { st.error = e.message; }
  st.loading = false;
}

/* ----------------------- Render ----------------------- */
function render() {
  main.innerHTML = `
    <div class="q-greeting"><h1>Embedding</h1></div>
    <p class="cfg-sub">Muestra un tablero de DataSense dentro de otra página web. Cada embed tiene un ID y un token de solo lectura que puedes copiar, rotar o desactivar cuando quieras.</p>
    ${body()}`;
  wire();
}

function filtered() {
  const q = norm(st.q);
  return st.embeds.filter((e) => (!st.status || e.status === st.status) && (!q || norm(`${e.name} ${e.app_name} ${e.sheet_title} ${e.id}`).includes(q)));
}

function body() {
  if (st.loading) return `<p class="cfg-muted">Cargando…</p>`;
  if (st.error) return `<div class="cfg-card cfg-pad"><p class="cn-status err">${esc(st.error)}</p></div>`;
  const bar = `<div class="cfg-bar">
      <div class="cfg-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input id="emQ" type="search" placeholder="Buscar por nombre, app u hoja" value="${esc(st.q)}" aria-label="Buscar embeds" /></div>
      <select id="emSt" aria-label="Filtrar por estado"><option value="">Todos los estados</option>
        ${Object.entries(STATUS).map(([k, [l]]) => `<option value="${k}" ${st.status === k ? "selected" : ""}>${l}</option>`).join("")}</select>
      <span class="cfg-count">${filtered().length} de ${st.embeds.length}</span>
      <button type="button" class="q-btn primary" id="emNew">+ Nuevo embed</button></div>`;
  if (!st.embeds.length) {
    return bar + `<div class="cfg-card cn-empty"><div class="cn-empty-ic">${svg("embed")}</div><h3>Aún no hay embeds</h3>
      <p>Elige una hoja publicada de una aplicación en Producción y obtén el código para pegarla en tu sitio web, intranet o portal de clientes.</p>
      <button type="button" class="q-btn primary" id="emNew2">+ Crear mi primer embed</button></div>`;
  }
  const list = filtered();
  return bar + (list.length ? `<div class="cfg-card"><table class="cfg-table">
    <thead><tr><th>Embed</th><th>Tablero</th><th>Estado</th><th>Vistas</th><th>Último uso</th><th>Vence</th><th></th></tr></thead>
    <tbody>${list.map((e) => `<tr data-id="${esc(e.id)}" class="${e.status === "active" ? "" : "off"}">
      <td><div class="em-n">${svg("embed")}<div><strong>${esc(e.name)}</strong><small>ID <code>${esc(e.id)}</code></small></div></div></td>
      <td>${esc(e.app_name)}<small>${esc(e.sheet_title)}</small></td>
      <td>${chip(e.status)}${e.status === "unpublished" ? `<small class="em-why">${esc(e.status_message)}</small>` : ""}</td>
      <td>${(e.views || 0).toLocaleString("es")}</td>
      <td class="cfg-muted">${esc(fmtDate(e.last_used_at))}</td>
      <td class="cfg-muted">${e.expires_at ? esc(fmtDate(e.expires_at, false)) : "Nunca"}</td>
      <td class="cfg-actions">
        <button type="button" class="cfg-icon" data-act="copy" title="Copiar token" aria-label="Copiar token de ${esc(e.name)}">${svg("key")}</button>
        <button type="button" class="cfg-icon" data-act="open" title="Código, ajustes y vista previa" aria-label="Abrir ${esc(e.name)}">${svg("eye")}</button>
        <button type="button" class="cfg-icon danger" data-act="del" title="Eliminar" aria-label="Eliminar ${esc(e.name)}">${svg("trash")}</button>
      </td></tr>`).join("")}</tbody></table></div>`
    : `<div class="cfg-card cn-empty"><p>Ningún embed coincide con el filtro.</p></div>`)
    + `<p class="cfg-hint">Un embed solo muestra datos si la aplicación está en <strong>Producción</strong> y la hoja está <strong>publicada</strong>. El token es de solo lectura y solo llega a esa hoja.</p>`;
}

/* ----------------------- Nuevo embed ----------------------- */
/** preset {appId, sheetId}: viene del menú «Incluir hoja» de una hoja. */
async function newEmbed(preset = {}) {
  const apps = st.apps;
  if (!apps.length) { toast("Primero crea una aplicación.", "err"); return; }
  const m = modal({
    title: "Nuevo embed", wide: true,
    body: `<div class="cfg-form">
      <label>Nombre<input id="nName" placeholder="Ej.: Portal de clientes" maxlength="80" /></label>
      <div class="em-row">
        <label>Aplicación<select id="nApp">${apps.map((a) => `<option value="${esc(a.id)}">${esc(a.name)} · ${{ personal: "Personal", desarrollo: "Desarrollo", produccion: "Producción" }[a.stage] || a.stage}</option>`).join("")}</select></label>
        <label>Hoja<select id="nSheet"><option>Cargando…</option></select></label>
      </div>
      <p class="em-warn" id="nWarn" hidden></p>
      <div class="em-row">
        <label>Tema<select id="nTheme"><option value="">Automático (el del visitante)</option><option value="light">Claro</option><option value="dark">Oscuro</option></select></label>
        <label>Vence<select id="nExp"><option value="0">Nunca</option><option value="7">En 7 días</option><option value="30">En 30 días</option><option value="90">En 90 días</option><option value="365">En 1 año</option></select></label>
      </div>
      <div class="em-checks">
        <label class="cn-check"><input type="checkbox" id="nTitle" /> Ocultar el título de la hoja</label>
        <label class="cn-check"><input type="checkbox" id="nSel" /> Ocultar la barra de selecciones</label>
      </div>
      <label>Sitios permitidos <small>(uno por línea; vacío = cualquier sitio)</small>
        <textarea id="nOrg" rows="3" placeholder="https://portal.miempresa.com&#10;https://intranet.miempresa.com"></textarea></label>
      <p class="cfg-err" id="nErr" hidden></p>
    </div>`,
    actions: `<button type="button" class="q-btn" data-x>Cancelar</button><button type="button" class="q-btn primary" id="nOk">Crear embed</button>`,
  });
  const $ = (s) => m.el.querySelector(s);
  let sheets = [];
  const warn = () => {
    const app = apps.find((a) => a.id === $("#nApp").value), sh = sheets.find((s) => s.id === $("#nSheet").value);
    const issues = [];
    if (app && app.stage !== "produccion") issues.push("la aplicación está en " + ({ personal: "Personal", desarrollo: "Desarrollo" }[app.stage] || app.stage) + " (debe estar en Producción)");
    if (sh && sh.visibility !== "publica") issues.push("la hoja no está publicada");
    const w = $("#nWarn");
    w.hidden = !issues.length;
    w.innerHTML = issues.length ? `${svg("info")} El embed se creará, pero no mostrará datos hasta que ${issues.join(" y ")}. ${authService.can("apps:publish") ? "Puedes publicarlo desde el detalle del embed." : "Pide a quien pueda publicar que lo haga."}` : "";
  };
  const loadSheets = async () => {
    const sel = $("#nSheet"); sel.innerHTML = `<option>Cargando…</option>`;
    try {
      sheets = await api.listSheets($("#nApp").value);
      sel.innerHTML = sheets.length ? sheets.map((s) => `<option value="${esc(s.id)}" ${s.id === preset.sheetId ? "selected" : ""}>${esc(s.title)}${s.visibility === "publica" ? " · publicada" : ""}</option>`).join("") : `<option value="">(la app no tiene hojas)</option>`;
    } catch (e) { sheets = []; sel.innerHTML = `<option value="">${esc(e.message)}</option>`; }
    warn();
  };
  $("#nApp").addEventListener("change", loadSheets);
  $("#nSheet").addEventListener("change", warn);
  if (preset.appId && apps.some((a) => a.id === preset.appId)) $("#nApp").value = preset.appId;
  loadSheets();
  $("#nOk").addEventListener("click", async () => {
    const err = $("#nErr"); err.hidden = true;
    const origins = $("#nOrg").value.split(/[\n,\s]+/).map((s) => s.trim()).filter(Boolean);
    const body = {
      name: $("#nName").value.trim(), app_id: $("#nApp").value, sheet_id: $("#nSheet").value,
      allowed_origins: origins, expires_in_days: Number($("#nExp").value) || 0,
      options: { theme: $("#nTheme").value, hideTitle: $("#nTitle").checked, hideSelections: $("#nSel").checked },
    };
    if (!body.name) { err.textContent = "Ponle un nombre al embed."; err.hidden = false; return; }
    if (!body.sheet_id) { err.textContent = "Elige una hoja."; err.hidden = false; return; }
    $("#nOk").disabled = true;
    try {
      const e = await api.createEmbed(body);
      m.close(); toast("Embed creado."); await load(); render(); openDetail(e.id);
    } catch (ex) { err.textContent = ex.message; err.hidden = false; $("#nOk").disabled = false; }
  });
}

/* ----------------------- Detalle ----------------------- */
function snippets(e) {
  const url = urlOf(e), origin = location.origin;
  return {
    iframe: `<iframe src="${url}"\n        width="100%" height="600" style="border:0"\n        allow="fullscreen" title="${e.name.replace(/"/g, "&quot;")}"></iframe>`,
    sdk: `<div id="tablero"></div>\n<script src="${origin}/js/embed-sdk.js"><\/script>\n<script>\n  const tablero = DataSense.embed({\n    container: "#tablero",\n    token: "${e.token}",\n    height: "600px",\n    // theme: "dark",\n    onReady: () => console.log("Tablero listo"),\n    onError: (msg) => console.error(msg),\n  });\n<\/script>`,
    api: `# Extraer la hoja incrustada (objetos, propiedades y diseño) en JSON\ncurl -H "Authorization: Bearer ${e.token}" \\\n  ${origin}/api/v1/apps/${e.app_id}/sheets\n\n# Datos de la aplicación (solo lectura)\ncurl -H "Authorization: Bearer ${e.token}" ${origin}/api/v1/apps/${e.app_id}`,
  };
}

function openDetail(id, tab = "codigo") {
  const e = st.embeds.find((x) => x.id === id);
  if (!e) return;
  const m = modal({ title: e.name, wide: true, body: `<div id="emBody"></div>`, actions: `<button type="button" class="q-btn" data-x>Cerrar</button>` });
  m.el.querySelector(".cfg-modal").classList.add("em-modal");
  const host = m.el.querySelector("#emBody");
  let cur = tab;

  const draw = () => {
    const fresh = st.embeds.find((x) => x.id === id);
    if (!fresh) { m.close(); return; }
    const sn = snippets(fresh);
    const tabs = [["codigo", "Código", "api"], ["ajustes", "Ajustes", "settings"], ["vista", "Vista previa", "eye"]];
    host.innerHTML = `
      <div class="em-top">${chip(fresh.status)}<span class="cfg-muted">${esc(fresh.app_name)} · ${esc(fresh.sheet_title)}</span>
        ${fresh.status === "unpublished" && authService.can("apps:publish") ? `<button type="button" class="q-btn primary sm" id="emPub">${svg("rocket")} Publicar app y hoja</button>` : ""}</div>
      ${fresh.status !== "active" ? `<p class="em-warn">${svg("info")} ${esc(fresh.status_message)}</p>` : ""}
      <div class="cfg-tabs sm">${tabs.map(([k, l, ic]) => `<button type="button" class="cfg-tab ${cur === k ? "on" : ""}" data-t="${k}">${svg(ic)}<span>${l}</span></button>`).join("")}</div>
      <div id="emPane">${pane(fresh, sn)}</div>`;
    wireDetail(fresh, sn);
  };

  const pane = (f, sn) => {
    if (cur === "codigo") return `
      <div class="em-ids">
        <label>ID del embed<div class="em-copy"><input readonly value="${esc(f.id)}" /><button type="button" class="q-btn" data-cp="${esc(f.id)}">${svg("copy")}</button></div></label>
        <label>ID de la aplicación<div class="em-copy"><input readonly value="${esc(f.app_id)}" /><button type="button" class="q-btn" data-cp="${esc(f.app_id)}">${svg("copy")}</button></div></label>
        <label>ID de la hoja<div class="em-copy"><input readonly value="${esc(f.sheet_id)}" /><button type="button" class="q-btn" data-cp="${esc(f.sheet_id)}">${svg("copy")}</button></div></label>
        <label>Token<div class="em-copy"><input readonly id="emTok" type="password" value="${esc(f.token)}" />
          <button type="button" class="q-btn" id="emShow" title="Mostrar u ocultar">${svg("eye")}</button>
          <button type="button" class="q-btn" data-cp="${esc(f.token)}" title="Copiar token">${svg("copy")}</button>
          <button type="button" class="q-btn" id="emRot" title="Generar un token nuevo">${svg("refresh")} Rotar</button></div></label>
        <label>URL directa<div class="em-copy"><input readonly value="${esc(urlOf(f))}" /><button type="button" class="q-btn" data-cp="${esc(urlOf(f))}">${svg("copy")}</button><a class="q-btn" href="${esc(urlOf(f))}" target="_blank" rel="noopener">${svg("link")} Abrir</a></div></label>
      </div>
      ${[["iframe", "Opción 1 · iframe (la más simple)", sn.iframe], ["sdk", "Opción 2 · SDK de JavaScript", sn.sdk], ["api", "Opción 3 · API REST (extraer el tablero)", sn.api]].map(([k, t, code]) => `
        <h4 class="em-h">${t}</h4><div class="cn-code"><button type="button" class="cn-code-copy" data-cpc="${k}">${svg("copy")} Copiar</button><pre><code>${esc(code)}</code></pre></div>`).join("")}
      <p class="cfg-hint">Trata el token como una contraseña de solo lectura: quien lo tenga puede ver esa hoja. Si se filtra, usa <strong>Rotar</strong> y el anterior deja de funcionar al instante.</p>`;
    if (cur === "ajustes") return `<div class="cfg-form">
        <label>Nombre<input id="sName" value="${esc(f.name)}" maxlength="80" /></label>
        <div class="em-row">
          <label>Tema<select id="sTheme"><option value="" ${!f.options.theme ? "selected" : ""}>Automático</option><option value="light" ${f.options.theme === "light" ? "selected" : ""}>Claro</option><option value="dark" ${f.options.theme === "dark" ? "selected" : ""}>Oscuro</option></select></label>
          <label>Vencimiento<select id="sExp"><option value="keep">${f.expires_at ? "Vence " + esc(fmtDate(f.expires_at, false)) + " (conservar)" : "Nunca vence (conservar)"}</option><option value="0">Quitar vencimiento</option><option value="7">En 7 días</option><option value="30">En 30 días</option><option value="90">En 90 días</option><option value="365">En 1 año</option></select></label>
        </div>
        <div class="em-checks"><label class="cn-check"><input type="checkbox" id="sTitle" ${f.options.hideTitle ? "checked" : ""}/> Ocultar el título de la hoja</label>
          <label class="cn-check"><input type="checkbox" id="sSel" ${f.options.hideSelections ? "checked" : ""}/> Ocultar la barra de selecciones</label>
          <label class="cn-check"><input type="checkbox" id="sOn" ${f.enabled ? "checked" : ""}/> Embed activo (desmárcalo para revocarlo sin borrarlo)</label></div>
        <label>Sitios permitidos <small>(uno por línea; vacío = cualquier sitio)</small><textarea id="sOrg" rows="3">${esc((f.allowed_origins || []).join("\n"))}</textarea></label>
        <p class="cfg-err" id="sErr" hidden></p>
        <div><button type="button" class="q-btn primary" id="sSave">Guardar ajustes</button></div>
        <p class="cfg-muted">Creado ${esc(fmtDate(f.created_at))} · ${(f.views || 0).toLocaleString("es")} vistas · último uso ${esc(fmtDate(f.last_used_at))}</p></div>`;
    return f.status === "active"
      ? `<div class="em-prev"><iframe src="${esc(urlOf(f))}" title="Vista previa de ${esc(f.name)}" allow="fullscreen"></iframe></div><p class="cfg-hint">Así se verá dentro de tu sitio. Cada carga de la vista previa cuenta como una vista.</p>`
      : `<div class="cfg-card cn-empty"><p>La vista previa estará disponible cuando el embed esté <strong>Activo</strong>.</p></div>`;
  };

  const wireDetail = (f) => {
    host.querySelectorAll("[data-t]").forEach((b) => b.addEventListener("click", () => { cur = b.dataset.t; draw(); }));
    host.querySelectorAll("[data-cp]").forEach((b) => b.addEventListener("click", () => copyText(b.dataset.cp)));
    host.querySelectorAll("[data-cpc]").forEach((b) => b.addEventListener("click", () => copyText(snippets(f)[b.dataset.cpc], "Código copiado.")));
    host.querySelector("#emShow")?.addEventListener("click", () => { const i = host.querySelector("#emTok"); i.type = i.type === "password" ? "text" : "password"; });
    host.querySelector("#emRot")?.addEventListener("click", async () => {
      if (!(await confirmBox({ title: "Rotar token", message: "El token actual <strong>dejará de funcionar al instante</strong>. Tendrás que actualizar el código en los sitios donde lo uses.", okLabel: "Rotar token", danger: true }))) return;
      try { await api.rotateEmbed(f.id); toast("Token nuevo generado."); await load(); draw(); render(); } catch (e) { toast(e.message, "err"); }
    });
    host.querySelector("#emPub")?.addEventListener("click", async () => {
      try {
        const app = st.apps.find((a) => a.id === f.app_id);
        if (!app || app.stage !== "produccion") await api.setAppStage(f.app_id, "produccion");
        await api.setSheetVisibility(f.app_id, f.sheet_id, "publica");
        toast("Aplicación en Producción y hoja publicada."); await load(); draw(); render();
      } catch (e) { toast(e.message, "err"); }
    });
    host.querySelector("#sSave")?.addEventListener("click", async () => {
      const err = host.querySelector("#sErr"); err.hidden = true;
      const exp = host.querySelector("#sExp").value;
      const body = {
        name: host.querySelector("#sName").value.trim(), enabled: host.querySelector("#sOn").checked,
        allowed_origins: host.querySelector("#sOrg").value.split(/[\n,\s]+/).map((s) => s.trim()).filter(Boolean),
        options: { theme: host.querySelector("#sTheme").value, hideTitle: host.querySelector("#sTitle").checked, hideSelections: host.querySelector("#sSel").checked },
      };
      if (exp !== "keep") body.expires_in_days = Number(exp);
      try { await api.updateEmbed(f.id, body); toast("Ajustes guardados."); await load(); draw(); render(); } catch (e) { err.textContent = e.message; err.hidden = false; }
    });
  };
  draw();
}

/* ----------------------- Eventos ----------------------- */
async function remove(e) {
  if (!(await confirmBox({ title: "Eliminar embed", message: `¿Eliminar <strong>${esc(e.name)}</strong>? Las páginas que usen su token dejarán de mostrar el tablero.`, okLabel: "Eliminar", danger: true }))) return;
  try { await api.deleteEmbed(e.id); toast("Embed eliminado."); await load(); render(); } catch (ex) { toast(ex.message, "err"); }
}

function wire() {
  const q = main.querySelector("#emQ");
  if (q) q.addEventListener("input", () => { st.q = q.value; const p = q.selectionStart; render(); const n = main.querySelector("#emQ"); n.focus(); n.setSelectionRange(p, p); });
  main.querySelector("#emSt")?.addEventListener("change", (ev) => { st.status = ev.target.value; render(); });
  main.querySelectorAll("#emNew, #emNew2").forEach((b) => b.addEventListener("click", () => newEmbed()));
  main.querySelectorAll("tr[data-id] [data-act]").forEach((b) => b.addEventListener("click", () => {
    const e = st.embeds.find((x) => x.id === b.closest("tr").dataset.id); if (!e) return;
    if (b.dataset.act === "copy") copyText(e.token, "Token copiado.");
    else if (b.dataset.act === "open") openDetail(e.id);
    else remove(e);
  }));
}

/* ----------------------- Arranque ----------------------- */
renderNav("nav", { active: "embedding" });
wireAppsButton();
renderProfileMenu(authService);
render();
load().then(() => {
  render();
  const p = new URLSearchParams(location.search);
  if (p.get("open")) openDetail(p.get("open"));
  else if (p.get("new") === "1") newEmbed({ appId: p.get("app"), sheetId: p.get("sheet") });
  if (p.has("new")) history.replaceState(null, "", location.pathname);
});

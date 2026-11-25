// configuracion.js — Configuración de PROTHEO (administración).
//
//  · Usuarios: CRUD completo (crear, editar, activar/desactivar, restablecer contraseña, eliminar) con
//    rol y permisos individuales (concedidos / denegados sobre los del rol).
//  · Roles y permisos: matriz de lo que puede hacer cada rol.
//  · Etapas y publicación: etapa de cada aplicación (Personal · Desarrollo · Producción), su dueño y qué
//    hojas están publicadas. Un visualizador solo ve apps en Producción y sus hojas publicadas.
//  · Mi cuenta: perfil, permisos efectivos y cambio de contraseña (para cualquier usuario).
// Todo pasa por la API (/users, /apps/{id}/stage, /auth/…); el servidor aplica las reglas.

import { renderNav, wireAppsButton, renderProfileMenu, svg } from "./hub-nav.js";
import { authService } from "./auth-service.js";
import * as api from "./api.js";

if (!authService.isAuthenticated()) location.replace("index.html");

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const fmt = (iso) => { if (!iso) return "—"; const d = new Date(iso); return isNaN(d) ? "—" : d.toLocaleString("es", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); };
const initials = (n) => String(n || "?").split(/[\s@.]+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

const STAGES = [
  { id: "personal", label: "Personal" },
  { id: "desarrollo", label: "Desarrollo" },
  { id: "produccion", label: "Producción" },
];

const main = document.getElementById("main");
const isAdmin = () => authService.can("users:manage");
const canRoles = () => authService.can("roles:manage");
const canAudit = () => authService.can("audit:view");
const st = {
  roleDraft: {}, tab: "usuarios", catalog: null, users: [], apps: [], q: "", roleFilter: "", expanded: new Set(), sheets: {},
  mx: { q: "", module: "", risk: "", diff: false, focus: "", closed: new Set() }, audit: null, auditQ: "", auditType: "",
};

/* ----------------------- Catálogo detallado ----------------------- */
const ACTION_LABEL = { ver: "Ver", crear: "Crear", editar: "Editar", eliminar: "Eliminar", publicar: "Publicar", ejecutar: "Ejecutar", exportar: "Exportar", administrar: "Administrar" };
const RISK_LABEL = { bajo: "Bajo", medio: "Medio", alto: "Alto" };
const MOD_COLOR = ["#6366f1", "#06b6d4", "#f59e0b", "#8b5cf6", "#10b981", "#ec4899", "#0ea5e9", "#a855f7", "#f43f5e", "#14b8a6", "#eab308", "#64748b", "#22c55e", "#ef4444"];
const perms = () => st.catalog?.permissions || [];
const modules = () => st.catalog?.modules || [];
const modColor = (id) => MOD_COLOR[Math.max(0, modules().findIndex((m) => m.id === id)) % MOD_COLOR.length];
const permIds = () => new Set(perms().map((p) => p.id));
/** Lista con permisos antiguos o detallados → Set de detallados (los antiguos se expanden a lo que cubrían). */
function granular(list) {
  const legacy = new Map((st.catalog?.legacy || []).map((l) => [l.id, l.covers]));
  const ids = permIds(), out = new Set();
  for (const p of list || []) { if (legacy.has(p)) legacy.get(p).forEach((x) => out.add(x)); else if (ids.has(p)) out.add(p); }
  return out;
}
const actTag = (a) => `<span class="pm-act a-${esc(a)}">${esc(ACTION_LABEL[a] || a)}</span>`;
const riskTag = (r) => `<span class="pm-risk r-${esc(r)}" title="Riesgo ${esc(RISK_LABEL[r] || r)}">${r === "alto" ? "▲ Alto" : r === "medio" ? "● Medio" : "○ Bajo"}</span>`;
const modDot = (id) => `<i class="pm-mdot" style="--c:${modColor(id)}"></i>`;
const usersOf = (roleId) => st.users.filter((u) => u.role === roleId).length;

/* ----------------------- Avisos ----------------------- */
function toast(msg, kind = "ok") {
  let host = document.getElementById("cfgToasts");
  if (!host) { host = document.createElement("div"); host.id = "cfgToasts"; host.className = "cfg-toasts"; host.setAttribute("aria-live", "polite"); document.body.appendChild(host); }
  const t = document.createElement("div");
  t.className = `cfg-toast ${kind}`;
  t.textContent = msg;
  host.appendChild(t);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 300); }, kind === "err" ? 6000 : 3200);
}

/* ----------------------- Modal genérico ----------------------- */
function modal({ title, body, actions, wide = false }) {
  const back = document.createElement("div");
  back.className = "q-modal-backdrop cfg-modal-bd";
  back.innerHTML = `
    <div class="q-modal cfg-modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="q-modal-head"><h2>${esc(title)}</h2><button class="q-modal-x" data-x aria-label="Cerrar">✕</button></div>
      <div class="q-modal-body cfg-modal-body">${body}</div>
      <div class="q-modal-foot">${actions}</div>
    </div>`;
  document.body.appendChild(back);
  const close = () => back.remove();
  back.querySelectorAll("[data-x]").forEach((b) => b.addEventListener("click", close));
  back.addEventListener("pointerdown", (e) => { if (e.target === back) close(); });
  const onKey = (e) => { if (e.key === "Escape") { close(); document.removeEventListener("keydown", onKey); } };
  document.addEventListener("keydown", onKey);
  return { el: back, close };
}

/* ----------------------- Datos ----------------------- */
async function loadAll() {
  st.catalog = await api.authCatalog();
  const jobs = [api.listApps().then((a) => { st.apps = a; })];
  if (isAdmin()) jobs.push(api.listUsers().then((u) => { st.users = u; }));
  await Promise.all(jobs);
}
const roleLabel = (id) => st.catalog?.roles.find((r) => r.id === id)?.label || id;
const roleDefaults = (id) => new Set(st.catalog?.roles.find((r) => r.id === id)?.permissions || []);
const permLabel = (id) => st.catalog?.permissions.find((p) => p.id === id)?.label || id;

/* ----------------------- Estructura ----------------------- */
function tabs() {
  const list = isAdmin()
    ? [["usuarios", "Usuarios", "users"], ["roles", "Roles", "lock"], ["matriz", "Matriz de permisos", "analyze"],
       ...(canAudit() ? [["auditoria", "Auditoría", "check"]] : []), ["etapas", "Etapas y publicación", "rocket"], ["cuenta", "Mi cuenta", "assist"]]
    : [["cuenta", "Mi cuenta", "assist"]];
  return `<div class="cfg-tabs" role="tablist">${list.map(([id, label, ic]) =>
    `<button type="button" class="cfg-tab ${st.tab === id ? "on" : ""}" role="tab" aria-selected="${st.tab === id}" data-tab="${id}">${svg(ic)}<span>${label}</span></button>`).join("")}</div>`;
}

function render() {
  const body = { usuarios: usersView, roles: rolesView, matriz: matrixView, auditoria: auditView, etapas: stagesView, cuenta: accountView }[st.tab]();
  main.innerHTML = `
    <div class="q-greeting"><h1>Configuración</h1></div>
    <p class="cfg-sub">${isAdmin() ? "Administra quién entra a PROTHEO, qué puede hacer y qué aplicaciones y hojas ven los visualizadores." : "Tu cuenta y tus permisos."}</p>
    ${tabs()}
    <div class="cfg-pane">${body}</div>`;
  wire();
}

/* =======================  USUARIOS  ======================= */
function filteredUsers() {
  const q = norm(st.q);
  return st.users.filter((u) => (!st.roleFilter || u.role === st.roleFilter) && (!q || norm(u.name + " " + u.email).includes(q)));
}

function usersView() {
  const rows = filteredUsers().map((u) => {
    const g = granular(u.grant), dn = granular(u.deny);
    const custom = g.size + dn.size;
    const eff = (u.permissions || []).filter((p) => permIds().has(p)).length;
    const hi = (u.permissions || []).filter((p) => perms().find((x) => x.id === p)?.risk === "alto").length;
    const me = u.id === authService.current()?.userId;
    const isCustomRole = st.catalog.roles.find((r) => r.id === u.role)?.custom;
    return `<tr class="${u.active ? "" : "off"}" data-id="${esc(u.id)}">
      <td><div class="cfg-user"><span class="cfg-avatar">${esc(initials(u.name))}</span>
        <div><strong>${esc(u.name)}${me ? ' <em class="cfg-me">tú</em>' : ""}</strong><small>${esc(u.email)}</small></div></div></td>
      <td><span class="cfg-role ${esc(isCustomRole ? "custom" : u.role)}">${esc(roleLabel(u.role))}</span></td>
      <td><span class="cfg-state ${u.active ? "on" : "off"}"><i></i>${u.active ? "Activo" : "Inactivo"}</span></td>
      <td><div class="pm-ucount"><b>${eff}</b><span>/ ${perms().length}</span>
        <i class="pm-bar"><i style="width:${Math.round((eff / Math.max(1, perms().length)) * 100)}%"></i></i>
        ${hi ? `<span class="pm-risk r-alto" title="Permisos de riesgo alto">▲ ${hi}</span>` : ""}
        ${g.size ? `<span class="pm-delta add" title="Concedidos: ${esc([...g].map(permLabel).join(", "))}">+${g.size}</span>` : ""}
        ${dn.size ? `<span class="pm-delta sub" title="Denegados: ${esc([...dn].map(permLabel).join(", "))}">−${dn.size}</span>` : ""}
        ${custom ? "" : ""}</div></td>
      <td class="cfg-muted">${esc(fmt(u.last_login))}</td>
      <td class="cfg-actions">
        <button type="button" class="cfg-icon" data-act="edit" title="Editar usuario" aria-label="Editar ${esc(u.name)}">${svg("settings")}</button>
        <button type="button" class="cfg-icon" data-act="eff" title="Ver permisos efectivos y su origen" aria-label="Permisos efectivos de ${esc(u.name)}">${svg("eye")}</button>
        <button type="button" class="cfg-icon" data-act="pw" title="Restablecer contraseña" aria-label="Restablecer contraseña de ${esc(u.name)}">${svg("lock")}</button>
        <button type="button" class="cfg-icon danger" data-act="del" title="Eliminar usuario" aria-label="Eliminar ${esc(u.name)}" ${me ? "disabled" : ""}>${svg("trash")}</button>
      </td></tr>`;
  }).join("");
  return `
    <div class="cfg-bar">
      <div class="cfg-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input id="cfgQ" type="search" placeholder="Buscar por nombre o correo" value="${esc(st.q)}" aria-label="Buscar usuarios" /></div>
      <select id="cfgRole" aria-label="Filtrar por rol"><option value="">Todos los roles</option>
        ${st.catalog.roles.map((r) => `<option value="${esc(r.id)}" ${st.roleFilter === r.id ? "selected" : ""}>${esc(r.label)}</option>`).join("")}</select>
      <span class="cfg-count">${filteredUsers().length} de ${st.users.length}</span>
      <button type="button" class="q-btn primary" id="cfgNewUser">+ Nuevo usuario</button>
    </div>
    <div class="cfg-card"><table class="cfg-table">
      <thead><tr><th>Usuario</th><th>Rol</th><th>Estado</th><th>Permisos</th><th>Último acceso</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="6" class="cfg-empty">Ningún usuario coincide con la búsqueda.</td></tr>`}</tbody>
    </table></div>
    <p class="cfg-hint">Un usuario <strong>Inactivo</strong> no puede entrar. Al cambiar el rol, los permisos o la contraseña de alguien, sus sesiones abiertas se cierran. Siempre debe quedar al menos un administrador activo.</p>`;
}

/**
 * Editor de permisos de una persona, por módulo. Cada permiso tiene tres estados:
 *  · Heredar: lo que diga el rol (✓ o —).
 *  · Conceder: lo tiene aunque el rol no lo dé (excepción a favor).
 *  · Denegar: no lo tiene aunque el rol lo dé (excepción en contra).
 * Solo se guardan las excepciones; si el rol cambia, lo heredado cambia con él.
 */
function permEditor(state) {
  const defs = granular([...roleDefaults(state.role)]);
  const admin = state.role === "admin";
  const q = norm(state.q || "");
  const eff = (p) => admin || ((defs.has(p) || state.grant.has(p)) && !state.deny.has(p));
  const effCount = perms().filter((p) => eff(p.id)).length;
  const rows = (p) => {
    const fromRole = defs.has(p.id);
    const v = state.grant.has(p.id) ? "grant" : state.deny.has(p.id) ? "deny" : "inherit";
    const on = eff(p.id);
    return `<div class="pm-row ${on ? "on" : ""} ${v !== "inherit" ? "changed" : ""}" data-p="${esc(p.id)}">
      <div class="pm-row-main"><span class="pm-state ${on ? "on" : ""}" aria-hidden="true">${on ? "✓" : ""}</span>
        <div><strong>${esc(p.label)}</strong> ${actTag(p.action)} ${riskTag(p.risk)}<small>${esc(p.description)} <code>${esc(p.id)}</code></small></div></div>
      <div class="pm-seg" role="radiogroup" aria-label="${esc(p.label)}">
        <button type="button" data-v="inherit" class="${v === "inherit" ? "on" : ""}" ${admin ? "disabled" : ""} role="radio" aria-checked="${v === "inherit"}"
          title="Lo que diga el rol">Rol ${fromRole || admin ? "✓" : "—"}</button>
        <button type="button" data-v="grant" class="g ${v === "grant" ? "on" : ""}" ${admin || fromRole ? "disabled" : ""} role="radio" aria-checked="${v === "grant"}"
          title="${fromRole ? "El rol ya lo concede" : "Concederlo solo a esta persona"}">Conceder</button>
        <button type="button" data-v="deny" class="d ${v === "deny" ? "on" : ""}" ${admin || !fromRole || p.id === "apps:view" ? "disabled" : ""} role="radio" aria-checked="${v === "deny"}"
          title="${!fromRole ? "El rol no lo concede" : p.id === "apps:view" ? "Ver aplicaciones es la base de todo" : "Quitárselo solo a esta persona"}">Denegar</button>
      </div></div>`;
  };
  const visible = (p) => (!q || norm(`${p.label} ${p.description} ${p.id} ${p.group}`).includes(q))
    && (state.filter !== "changed" || state.grant.has(p.id) || state.deny.has(p.id))
    && (state.filter !== "high" || p.risk === "alto");
  const groups = modules().map((m) => {
    const list = perms().filter((p) => p.module === m.id && visible(p));
    if (!list.length) return "";
    const all = perms().filter((p) => p.module === m.id), n = all.filter((p) => eff(p.id)).length;
    return `<section class="pm-mod" style="--c:${modColor(m.id)}"><header><span>${modDot(m.id)}<b>${esc(m.label)}</b><small>${esc(m.description)}</small></span>
      <em class="pm-mod-n ${n === all.length ? "full" : n ? "part" : ""}">${n}/${all.length}</em></header>${list.map(rows).join("")}</section>`;
  }).join("");
  return `
    <div class="pm-sum">
      <div class="pm-sum-k"><b>${effCount}</b><span>de ${perms().length} efectivos</span></div>
      <div class="pm-sum-k"><b>${admin ? perms().length : perms().filter((p) => defs.has(p.id)).length}</b><span>del rol</span></div>
      <div class="pm-sum-k add"><b>+${state.grant.size}</b><span>concedidos</span></div>
      <div class="pm-sum-k sub"><b>−${state.deny.size}</b><span>denegados</span></div>
      <div class="pm-sum-k hi"><b>${perms().filter((p) => p.risk === "alto" && eff(p.id)).length}</b><span>de riesgo alto</span></div>
    </div>
    ${admin ? `<p class="cfg-callout">El <strong>Administrador</strong> siempre tiene todos los permisos y no se puede restringir.</p>` : ""}
    <div class="pm-tools">
      <div class="cfg-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input type="search" data-pq placeholder="Buscar permiso (p. ej. publicar, PDF, cargar)" value="${esc(state.q || "")}" aria-label="Buscar permiso" /></div>
      <div class="pm-chipset">${[["", "Todos"], ["changed", "Solo excepciones"], ["high", "Riesgo alto"]].map(([v, l]) =>
        `<button type="button" data-pf="${v}" class="${(state.filter || "") === v ? "on" : ""}">${l}</button>`).join("")}</div>
      ${state.grant.size || state.deny.size ? `<button type="button" class="cfg-link" data-pclear>Quitar todas las excepciones</button>` : ""}
    </div>
    <div class="pm-mods">${groups || `<p class="cfg-empty">Ningún permiso coincide.</p>`}</div>`;
}

function userModal(user) {
  const editing = !!user;
  const u = user || { name: "", email: "", role: "viewer", active: true, grant: [], deny: [] };
  const state = { role: u.role, grant: granular(u.grant), deny: granular(u.deny), q: "", filter: "" };
  const m = modal({
    title: editing ? `Editar usuario · ${u.name}` : "Nuevo usuario",
    wide: true,
    body: `
      <div class="cfg-form">
        <label>Nombre<input id="uName" type="text" value="${esc(u.name)}" placeholder="Nombre y apellido" autocomplete="off" /></label>
        <label>Correo electrónico<input id="uMail" type="email" value="${esc(u.email)}" placeholder="persona@empresa.com" autocomplete="off" /></label>
        <label>Rol<select id="uRole" ${canRoles() ? "" : "disabled title=\"Cambiar el rol requiere «Roles y permisos»\""}>${st.catalog.roles.map((r) => `<option value="${esc(r.id)}" ${r.id === u.role ? "selected" : ""}>${esc(r.label)}${r.custom ? " · personalizado" : ""}</option>`).join("")}</select>
          <small id="uRoleDesc"></small></label>
        ${editing ? "" : `<label>Contraseña inicial<span class="cfg-pw"><input id="uPw" type="password" placeholder="Mínimo 8 caracteres" autocomplete="new-password" />
          <button type="button" class="cfg-link" id="uGen">Generar</button><button type="button" class="cfg-link" id="uShow">Mostrar</button></span></label>`}
        <label class="cfg-switch-row"><span>Cuenta activa<small>Si se desactiva, no puede iniciar sesión.</small></span>
          <button type="button" class="ds-tm-switch" role="switch" id="uActive" aria-checked="${u.active}" aria-label="Cuenta activa"></button></label>
      </div>
      <h3 class="cfg-h3">Permisos detallados</h3>
      <p class="cfg-hint">Parte de los permisos del rol. Para cada acción elige <b>Rol</b> (heredar), <b>Conceder</b> (excepción a favor) o <b>Denegar</b> (excepción en contra).
        Solo se guardan las excepciones: si cambias los permisos del rol, esta persona los recibe.${canRoles() ? "" : " <b>Necesitas «Roles y permisos» para cambiarlos.</b>"}</p>
      <div id="uPerms" class="${canRoles() ? "" : "pm-readonly"}"></div>
      <p class="cfg-err" id="uErr" hidden></p>`,
    actions: `<button type="button" class="q-btn" data-x>Cancelar</button><button type="button" class="q-btn primary" id="uSave">${editing ? "Guardar cambios" : "Crear usuario"}</button>`,
  });
  const $ = (s) => m.el.querySelector(s);
  const paint = () => {
    const box = $("#uPerms"), y = box.closest(".cfg-modal-body")?.scrollTop || 0;
    box.innerHTML = permEditor(state);
    $("#uRoleDesc").textContent = st.catalog.roles.find((r) => r.id === state.role)?.description || "";
    if (box.closest(".cfg-modal-body")) box.closest(".cfg-modal-body").scrollTop = y;
  };
  paint();
  $("#uRole").addEventListener("change", (e) => {
    state.role = e.target.value;
    // Al cambiar de rol se descartan las excepciones que ya no tienen sentido (conceder lo que el rol ya da, denegar lo que no da).
    const defs = granular([...roleDefaults(state.role)]);
    state.grant = new Set([...state.grant].filter((p) => !defs.has(p)));
    state.deny = new Set([...state.deny].filter((p) => defs.has(p)));
    paint();
  });
  $("#uPerms").addEventListener("click", (e) => {
    if (!canRoles()) return;
    const b = e.target.closest("[data-v]"), f = e.target.closest("[data-pf]");
    if (f) { state.filter = f.dataset.pf; paint(); return; }
    if (e.target.closest("[data-pclear]")) { state.grant.clear(); state.deny.clear(); paint(); return; }
    if (!b || b.disabled) return;
    const p = b.closest("[data-p]").dataset.p;
    state.grant.delete(p); state.deny.delete(p);
    if (b.dataset.v === "grant") state.grant.add(p);
    if (b.dataset.v === "deny") state.deny.add(p);
    paint();
  });
  $("#uPerms").addEventListener("input", (e) => {
    if (!e.target.matches("[data-pq]")) return;
    state.q = e.target.value; const pos = e.target.selectionStart; paint();
    const i = $("#uPerms [data-pq]"); i.focus(); i.setSelectionRange(pos, pos);
  });
  const sw = $("#uActive");
  sw.addEventListener("click", () => sw.setAttribute("aria-checked", String(sw.getAttribute("aria-checked") !== "true")));
  $("#uGen")?.addEventListener("click", () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    const arr = crypto.getRandomValues(new Uint32Array(12));
    $("#uPw").value = [...arr].map((n) => chars[n % chars.length]).join("");
    $("#uPw").type = "text"; $("#uShow").textContent = "Ocultar";
  });
  $("#uShow")?.addEventListener("click", () => {
    const i = $("#uPw"); const show = i.type === "password";
    i.type = show ? "text" : "password"; $("#uShow").textContent = show ? "Ocultar" : "Mostrar";
  });
  $("#uSave").addEventListener("click", async () => {
    const err = $("#uErr"); err.hidden = true;
    const payload = { name: $("#uName").value.trim(), email: $("#uMail").value.trim(), role: state.role,
      active: sw.getAttribute("aria-checked") === "true" };
    // Sin «Roles y permisos» solo se editan datos de la cuenta: rol y excepciones no se envían.
    if (canRoles()) Object.assign(payload, { grant: [...state.grant], deny: [...state.deny] });
    else delete payload.role;
    if (!payload.name) { err.textContent = "Escribe el nombre."; err.hidden = false; return; }
    if (!editing) payload.password = $("#uPw").value;
    const btn = $("#uSave"); btn.disabled = true;
    try {
      if (editing) { await api.updateUser(user.id, payload); toast("Usuario actualizado."); }
      else { await api.createUser(payload); toast("Usuario creado."); }
      m.close();
      st.users = await api.listUsers();
      if (editing && user.id === authService.current()?.userId) await authService.refresh();
      render();
    } catch (e) { err.textContent = e.message; err.hidden = false; btn.disabled = false; }
  });
  setTimeout(() => $("#uName").focus(), 0);
}

function passwordModal(user) {
  const m = modal({
    title: `Restablecer contraseña · ${user.name}`,
    body: `<div class="cfg-form"><label>Nueva contraseña<span class="cfg-pw"><input id="pPw" type="password" placeholder="Mínimo 8 caracteres" autocomplete="new-password" />
      <button type="button" class="cfg-link" id="pGen">Generar</button><button type="button" class="cfg-link" id="pShow">Mostrar</button></span></label></div>
      <p class="cfg-hint">Se cerrarán las sesiones abiertas de esta persona. Compártele la contraseña por un canal seguro.</p>
      <p class="cfg-err" id="pErr" hidden></p>`,
    actions: `<button type="button" class="q-btn" data-x>Cancelar</button><button type="button" class="q-btn primary" id="pSave">Restablecer</button>`,
  });
  const $ = (s) => m.el.querySelector(s);
  $("#pGen").addEventListener("click", () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    $("#pPw").value = [...crypto.getRandomValues(new Uint32Array(12))].map((n) => chars[n % chars.length]).join("");
    $("#pPw").type = "text"; $("#pShow").textContent = "Ocultar";
  });
  $("#pShow").addEventListener("click", () => { const i = $("#pPw"); const s = i.type === "password"; i.type = s ? "text" : "password"; $("#pShow").textContent = s ? "Ocultar" : "Mostrar"; });
  $("#pSave").addEventListener("click", async () => {
    const err = $("#pErr"); err.hidden = true;
    $("#pSave").disabled = true;
    try { await api.resetUserPassword(user.id, $("#pPw").value); toast("Contraseña restablecida."); m.close(); }
    catch (e) { err.textContent = e.message; err.hidden = false; $("#pSave").disabled = false; }
  });
  setTimeout(() => $("#pPw").focus(), 0);
}

function deleteModal(user) {
  const owned = st.apps.filter((a) => a.owner_id === user.id).length;
  const m = modal({
    title: "Eliminar usuario",
    body: `<p>¿Eliminar a <strong>${esc(user.name)}</strong> (${esc(user.email)})? Esta acción no se puede deshacer.</p>
      ${owned ? `<p class="cfg-hint">Sus <strong>${owned}</strong> aplicaciones pasarán a ser tuyas para que no se pierdan.</p>` : ""}
      <p class="cfg-err" id="dErr" hidden></p>`,
    actions: `<button type="button" class="q-btn" data-x>Cancelar</button><button type="button" class="q-btn danger" id="dGo">Eliminar</button>`,
  });
  m.el.querySelector("#dGo").addEventListener("click", async () => {
    m.el.querySelector("#dGo").disabled = true;
    try {
      await api.deleteUser(user.id);
      toast("Usuario eliminado.");
      m.close();
      st.users = await api.listUsers();
      st.apps = await api.listApps();
      render();
    } catch (e) { const er = m.el.querySelector("#dErr"); er.textContent = e.message; er.hidden = false; m.el.querySelector("#dGo").disabled = false; }
  });
}

/* =======================  PERMISOS EFECTIVOS DE UNA PERSONA  ======================= */
async function effectiveModal(user) {
  const m = modal({ title: `Permisos efectivos · ${user.name}`, wide: true, body: `<p class="cfg-muted">Calculando…</p>`,
    actions: `<button type="button" class="q-btn" data-x>Cerrar</button>${isAdmin() ? `<button type="button" class="q-btn primary" id="eEdit">Editar permisos</button>` : ""}` });
  m.el.querySelector("#eEdit")?.addEventListener("click", () => { m.close(); userModal(user); });
  let data;
  try { data = await api.userEffective(user.id); } catch (e) { m.el.querySelector(".cfg-modal-body").innerHTML = `<p class="cfg-err">${esc(e.message)}</p>`; return; }
  const SRC = { rol: ["Del rol", "role"], concedido: ["Concedido", "add"], denegado: ["Denegado", "sub"], ninguno: ["Sin acceso", "none"] };
  const by = (s) => data.permissions.filter((p) => p.source === s).length;
  const body = `
    <div class="pm-sum">
      <div class="pm-sum-k"><b>${data.granted}</b><span>de ${data.total} efectivos</span></div>
      <div class="pm-sum-k"><b>${by("rol")}</b><span>del rol ${esc(roleLabel(data.role))}</span></div>
      <div class="pm-sum-k add"><b>+${by("concedido")}</b><span>concedidos</span></div>
      <div class="pm-sum-k sub"><b>−${by("denegado")}</b><span>denegados</span></div>
    </div>
    <div class="pm-eff">${modules().map((mo) => {
      const list = data.permissions.filter((p) => p.module === mo.id);
      if (!list.length) return "";
      return `<section class="pm-mod" style="--c:${modColor(mo.id)}"><header><span>${modDot(mo.id)}<b>${esc(mo.label)}</b></span>
        <em class="pm-mod-n">${list.filter((p) => p.granted).length}/${list.length}</em></header>
        ${list.map((p) => `<div class="pm-row ${p.granted ? "on" : ""}"><div class="pm-row-main"><span class="pm-state ${p.granted ? "on" : ""}">${p.granted ? "✓" : ""}</span>
          <div><strong>${esc(p.label)}</strong> ${actTag(p.action)} ${riskTag(p.risk)}</div></div>
          <span class="pm-src ${SRC[p.source][1]}">${SRC[p.source][0]}</span></div>`).join("")}</section>`;
    }).join("")}</div>`;
  m.el.querySelector(".cfg-modal-body").innerHTML = body;
}

/* =======================  ROLES  ======================= */
// Borrador de la matriz: rol -> Set de permisos marcados (solo roles editables).
const draftOf = (r) => (st.roleDraft[r.id] ||= new Set(granular(r.permissions)));
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const roleDirty = (r) => r.editable && st.roleDraft[r.id] && !sameSet(st.roleDraft[r.id], granular(r.permissions));

function rolesView() {
  const roles = st.catalog.roles, total = perms().length;
  const card = (r) => {
    const set = r.editable ? granular(r.permissions) : permIds();
    const hi = perms().filter((p) => p.risk === "alto" && set.has(p.id)).length;
    const mods = modules().map((mo) => {
      const all = perms().filter((p) => p.module === mo.id), n = all.filter((p) => set.has(p.id)).length;
      return `<i title="${esc(mo.label)}: ${n}/${all.length}" style="--c:${modColor(mo.id)};--f:${all.length ? n / all.length : 0}"></i>`;
    }).join("");
    const kind = !r.editable ? "Protegido" : r.custom ? "Personalizado" : r.customized ? "Modificado" : "De fábrica";
    return `<article class="pm-rcard ${esc(r.custom ? "custom" : r.id)}" data-role="${esc(r.id)}">
      <header><span class="cfg-role ${esc(r.custom ? "custom" : r.id)}">${esc(r.label)}</span><em class="pm-kind">${kind}</em></header>
      <p>${esc(r.description || "Sin descripción.")}</p>
      <div class="pm-rstats"><div><b>${usersOf(r.id)}</b><span>personas</span></div><div><b>${set.size}</b><span>de ${total} permisos</span></div>
        <div class="${hi ? "hi" : ""}"><b>${hi}</b><span>de riesgo alto</span></div></div>
      <div class="pm-heat" aria-label="Cobertura por módulo">${mods}</div>
      <footer>${r.editable && canRoles() ? `<button type="button" class="q-btn sm primary" data-r="matrix">Editar permisos</button>` : `<button type="button" class="q-btn sm" data-r="matrix">Ver permisos</button>`}
        ${canRoles() ? `<button type="button" class="q-btn sm" data-r="dup" title="Crear un rol nuevo a partir de este">${svg("copy")} Duplicar</button>` : ""}
        ${canRoles() && r.custom ? `<button type="button" class="q-btn sm" data-r="ren">Renombrar</button><button type="button" class="q-btn sm danger" data-r="del">${svg("trash")}</button>` : ""}
        ${canRoles() && r.customized && !r.custom ? `<button type="button" class="q-btn sm" data-r="reset" title="Volver a los permisos de fábrica">Restablecer</button>` : ""}</footer>
    </article>`;
  };
  return `
    <div class="cfg-callout">Un <strong>rol</strong> es un paquete de permisos para un puesto de trabajo (p. ej. «Analista financiero» o «Auditor»). Crea los tuyos
      copiando uno existente y ajusta en la <strong>Matriz de permisos</strong>. A una persona concreta le puedes conceder o denegar permisos sueltos en <strong>Usuarios</strong>.</div>
    <div class="pm-rgrid">${roles.map(card).join("")}
      ${canRoles() ? `<button type="button" class="pm-rcard pm-new" id="pmNewRole"><span>＋</span><b>Crear rol</b><small>Desde cero o copiando otro</small></button>` : ""}</div>`;
}

function roleFormModal({ role = null, copyFrom = "" } = {}) {
  const editing = !!role;
  const m = modal({
    title: editing ? `Renombrar rol · ${role.label}` : "Nuevo rol",
    body: `<div class="cfg-form">
      <label>Nombre<input id="rLabel" maxlength="60" value="${esc(role?.label || (copyFrom ? `${roleLabel(copyFrom)} (copia)` : ""))}" placeholder="p. ej. Analista financiero" /></label>
      <label>Descripción<input id="rDesc" maxlength="200" value="${esc(role?.description || "")}" placeholder="Para qué puesto es y qué puede hacer" /></label>
      ${editing ? "" : `<label>Partir de<select id="rFrom">${st.catalog.roles.map((r) => `<option value="${esc(r.id)}" ${r.id === (copyFrom || "viewer") ? "selected" : ""}>${esc(r.label)} · ${granular(r.editable ? r.permissions : [...permIds()]).size} permisos</option>`).join("")}</select>
        <small>Se copian sus permisos; luego los ajustas en la matriz.</small></label>`}
    </div><p class="cfg-err" id="rErr" hidden></p>`,
    actions: `<button type="button" class="q-btn" data-x>Cancelar</button><button type="button" class="q-btn primary" id="rSave">${editing ? "Guardar" : "Crear rol"}</button>`,
  });
  const $ = (s) => m.el.querySelector(s);
  $("#rSave").addEventListener("click", async () => {
    const err = $("#rErr"); err.hidden = true; $("#rSave").disabled = true;
    try {
      const body = { label: $("#rLabel").value.trim(), description: $("#rDesc").value.trim() };
      const saved = editing ? await api.updateRole(role.id, body) : await api.createRole({ ...body, copy_from: $("#rFrom").value });
      toast(editing ? "Rol actualizado." : `Rol «${saved.label}» creado.`);
      m.close();
      st.catalog = await api.authCatalog();
      if (!editing) { st.tab = "matriz"; st.mx.focus = saved.id; }
      render();
    } catch (e) { err.textContent = e.message; err.hidden = false; $("#rSave").disabled = false; }
  });
  setTimeout(() => $("#rLabel").select(), 0);
}

function roleDeleteModal(role) {
  const n = usersOf(role.id);
  const m = modal({
    title: `Borrar rol · ${role.label}`,
    body: `<p>¿Borrar el rol <strong>${esc(role.label)}</strong>? No se puede deshacer.</p>
      ${n ? `<p class="cfg-hint"><strong>${n}</strong> persona(s) lo tienen. Elige a qué rol pasan:</p>
        <label class="cfg-form"><select id="rTo">${st.catalog.roles.filter((r) => r.id !== role.id && r.id !== "admin").map((r) => `<option value="${esc(r.id)}" ${r.id === "viewer" ? "selected" : ""}>${esc(r.label)}</option>`).join("")}</select></label>` : ""}
      <p class="cfg-err" id="rdErr" hidden></p>`,
    actions: `<button type="button" class="q-btn" data-x>Cancelar</button><button type="button" class="q-btn danger" id="rdGo">Borrar rol</button>`,
  });
  m.el.querySelector("#rdGo").addEventListener("click", async () => {
    try {
      await api.deleteRole(role.id, n ? m.el.querySelector("#rTo").value : "");
      toast(`Rol «${role.label}» borrado.`);
      m.close();
      st.catalog = await api.authCatalog();
      await refreshUsers();
      render();
    } catch (e) { const er = m.el.querySelector("#rdErr"); er.textContent = e.message; er.hidden = false; }
  });
}

/* =======================  MATRIZ DE PERMISOS  ======================= */
function matrixView() {
  const roles = st.catalog.roles;
  const mx = st.mx, q = norm(mx.q);
  const has = (r, p) => (r.editable ? draftOf(r).has(p) : true);
  const differs = (p) => new Set(roles.map((r) => has(r, p.id))).size > 1;
  const visible = (p) => (!q || norm(`${p.label} ${p.description} ${p.id}`).includes(q)) && (!mx.module || p.module === mx.module)
    && (!mx.risk || p.risk === mx.risk) && (!mx.diff || differs(p));
  const head = roles.map((r) => `<th class="c pm-colh ${mx.focus === r.id ? "focus" : ""}" data-col="${esc(r.id)}">
      <span class="cfg-role ${esc(r.custom ? "custom" : r.id)}">${esc(r.label)}</span>
      <small>${usersOf(r.id)} pers. · ${r.editable ? draftOf(r).size : perms().length}/${perms().length}</small>${roleDirty(r) ? `<em class="pm-dirty">sin guardar</em>` : ""}</th>`).join("");
  const body = modules().map((mo) => {
    const list = perms().filter((p) => p.module === mo.id && visible(p));
    if (!list.length) return "";
    const closed = mx.closed.has(mo.id);
    const modCell = (r) => {
      const all = perms().filter((p) => p.module === mo.id), n = all.filter((p) => has(r, p.id)).length;
      const state = n === all.length ? "full" : n ? "part" : "none";
      const can = r.editable && canRoles();
      return `<td class="c ${mx.focus === r.id ? "focus" : ""}"><button type="button" class="pm-modtog ${state}" ${can ? "" : "disabled"} data-modtog="${esc(mo.id)}" data-role="${esc(r.id)}"
        title="${can ? (state === "full" ? "Quitar todo el módulo" : "Dar todo el módulo") : ""}">${n}/${all.length}</button></td>`;
    };
    return `<tr class="pm-grp" style="--c:${modColor(mo.id)}"><td><button type="button" class="pm-fold" data-fold="${esc(mo.id)}" aria-expanded="${!closed}">${closed ? "▸" : "▾"}</button>
        ${modDot(mo.id)}<b>${esc(mo.label)}</b><small>${esc(mo.description)}</small></td>${roles.map(modCell).join("")}</tr>` +
      (closed ? "" : list.map((p) => `<tr class="pm-prow ${differs(p) ? "diff" : ""}"><td><div class="pm-pcell"><strong>${esc(p.label)}</strong>${actTag(p.action)}${riskTag(p.risk)}
          <small>${esc(p.description)} <code>${esc(p.id)}</code></small></div></td>
        ${roles.map((r) => {
          if (!r.editable) return `<td class="c ${mx.focus === r.id ? "focus" : ""}"><span class="pm-ok" title="El administrador siempre tiene todo">✓</span></td>`;
          const on = draftOf(r).has(p.id), locked = p.id === "apps:view" || !canRoles();
          const changed = on !== granular(r.permissions).has(p.id);
          return `<td class="c ${mx.focus === r.id ? "focus" : ""} ${changed ? "chg" : ""}"><label class="pm-cb"><input type="checkbox" class="pm-cbx" data-role="${esc(r.id)}" data-perm="${esc(p.id)}" ${on ? "checked" : ""} ${locked ? "disabled" : ""}
            aria-label="${esc(p.label)} para ${esc(r.label)}" /><i></i></label></td>`;
        }).join("")}</tr>`).join(""));
  }).join("");
  const dirty = roles.filter(roleDirty);
  return `
    <div class="pm-mxbar">
      <div class="cfg-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input id="mxQ" type="search" placeholder="Buscar permiso" value="${esc(mx.q)}" aria-label="Buscar permiso" /></div>
      <select id="mxMod" aria-label="Módulo"><option value="">Todos los módulos</option>${modules().map((mo) => `<option value="${esc(mo.id)}" ${mx.module === mo.id ? "selected" : ""}>${esc(mo.label)}</option>`).join("")}</select>
      <select id="mxRisk" aria-label="Riesgo"><option value="">Todo riesgo</option>${["alto", "medio", "bajo"].map((r) => `<option value="${r}" ${mx.risk === r ? "selected" : ""}>Riesgo ${RISK_LABEL[r].toLowerCase()}</option>`).join("")}</select>
      <label class="pm-check"><input type="checkbox" id="mxDiff" ${mx.diff ? "checked" : ""}/> Solo donde los roles difieren</label>
      <span class="pm-legend">${Object.entries(ACTION_LABEL).map(([a]) => actTag(a)).join("")}</span>
    </div>
    ${dirty.length ? `<div class="pm-savebar"><span><b>${dirty.length}</b> rol(es) con cambios sin guardar: ${dirty.map((r) => {
        const before = granular(r.permissions), now = draftOf(r);
        const add = [...now].filter((p) => !before.has(p)).length, rem = [...before].filter((p) => !now.has(p)).length;
        return `<em>${esc(r.label)} <b class="add">+${add}</b> <b class="sub">−${rem}</b> · ${usersOf(r.id)} pers.</em>`; }).join(" ")}</span>
      <button type="button" class="q-btn" id="mxUndo">Descartar</button><button type="button" class="q-btn primary" id="mxSave">Guardar cambios</button></div>` : ""}
    <div class="cfg-card pm-mxwrap"><table class="pm-matrix">
      <thead><tr><th>Permiso</th>${head}</tr></thead>
      <tbody>${body || `<tr><td colspan="${roles.length + 1}" class="cfg-empty">Ningún permiso coincide con el filtro.</td></tr>`}</tbody>
      <tfoot><tr><td></td>${roles.map((r) => r.editable && canRoles() && !r.custom ? `<td class="c"><button type="button" class="q-btn sm" data-reset-role="${esc(r.id)}" ${r.customized ? "" : "disabled"} title="Volver a los permisos de fábrica">Restablecer</button></td>` : "<td></td>").join("")}</tr></tfoot>
    </table></div>
    <p class="cfg-hint">El rol Administrador siempre tiene todo. «Ver aplicaciones» es obligatorio en todo rol. Los cambios se aplican al instante a todas las personas del rol y quedan en la <b>Auditoría</b>.</p>`;
}

async function saveDirtyRoles() {
  const dirty = st.catalog.roles.filter(roleDirty);
  try {
    for (const r of dirty) await api.setRolePermissions(r.id, [...draftOf(r)]);
    toast(dirty.length === 1 ? `Permisos de «${dirty[0].label}» guardados.` : `${dirty.length} roles guardados.`);
    st.roleDraft = {};
    st.catalog = await api.authCatalog();
    await refreshUsers();
    await authService.refresh();
    render();
  } catch (e) { toast(e.message, "err"); }
}

/* =======================  AUDITORÍA  ======================= */
const AUDIT_ICON = { "user.create": "＋", "user.delete": "✕", "user.role": "⇄", "user.permissions": "⚿", "user.password": "⚷", "user.activate": "●", "user.deactivate": "○",
  "role.create": "＋", "role.delete": "✕", "role.permissions": "⚿", "role.reset": "↺", "role.rename": "✎" };
function auditView() {
  if (!st.audit) { api.securityAudit({ limit: 200 }).then((a) => { st.audit = a; if (st.tab === "auditoria") render(); }).catch((e) => toast(e.message, "err")); return `<p class="cfg-muted">Cargando auditoría…</p>`; }
  const q = norm(st.auditQ);
  const list = st.audit.filter((e) => (!st.auditType || e.target_type === st.auditType) && (!q || norm(`${e.summary} ${e.actor_name} ${e.target_label} ${e.action}`).includes(q)));
  const chips = (arr, cls) => (arr || []).map((p) => `<span class="pm-delta ${cls}">${cls === "add" ? "+" : "−"} ${esc(permLabel(p))}</span>`).join("");
  const detail = (e) => {
    const d = e.detail || {};
    if (d.added || d.removed) return chips(d.added, "add") + chips(d.removed, "sub");
    if (d.grant || d.deny) return chips(d.grant?.added, "add") + chips(d.grant?.removed, "sub") + chips(d.deny?.added, "sub") + chips(d.deny?.removed, "add");
    return "";
  };
  return `
    <div class="cfg-bar">
      <div class="cfg-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input id="auQ" type="search" placeholder="Buscar por persona, rol o cambio" value="${esc(st.auditQ)}" aria-label="Buscar en la auditoría" /></div>
      <div class="pm-chipset">${[["", "Todo"], ["user", "Usuarios"], ["role", "Roles"]].map(([v, l]) => `<button type="button" data-au="${v}" class="${st.auditType === v ? "on" : ""}">${l}</button>`).join("")}</div>
      <span class="cfg-count">${list.length} evento(s)</span>
      <button type="button" class="q-btn" id="auRefresh">${svg("refresh")} Actualizar</button>
    </div>
    <ol class="pm-audit">${list.map((e) => `<li class="t-${esc(e.target_type)} a-${esc(String(e.action).replace(".", "-"))}">
      <span class="pm-au-ico">${AUDIT_ICON[e.action] || "•"}</span>
      <div><p><b>${esc(e.actor_name || "Sistema")}</b> · ${esc(e.target_type === "role" ? "rol" : "usuario")} <b>${esc(e.target_label || e.target_id || "")}</b></p>
        <p class="pm-au-sum">${esc(e.summary || e.action)}</p><div class="pm-au-det">${detail(e)}</div></div>
      <time>${esc(fmt(e.at))}</time></li>`).join("") || `<li class="cfg-empty">Aún no hay cambios registrados. Cada cambio de rol, permiso o cuenta aparecerá aquí.</li>`}</ol>`;
}

async function resetRole(roleId) {
  const r = st.catalog.roles.find((x) => x.id === roleId);
  try {
    await api.resetRolePermissions(roleId);
    toast(`El rol ${r.label} volvió a sus permisos de fábrica.`);
    delete st.roleDraft[roleId];
    st.catalog = await api.authCatalog();
    await refreshUsers();
    render();
  } catch (e) { toast(e.message, "err"); }
}
async function refreshUsers() { try { st.users = await api.listUsers(); } catch { /* sin cambios */ } }

/* =======================  ETAPAS Y PUBLICACIÓN  ======================= */
function stagesView() {
  const cards = st.catalog.stages.map((s, i) => `
    <div class="cfg-stage-card ${esc(s.id)}"><span class="ds-stage ${esc(s.id)}"><span class="ds-stage-dot"></span>${esc(s.label)}</span><p>${esc(s.description)}</p></div>${i < 2 ? '<span class="cfg-arrow" aria-hidden="true">→</span>' : ""}`).join("");
  const rows = st.apps.map((a) => {
    const open = st.expanded.has(a.id);
    return `<tr data-app="${esc(a.id)}">
      <td><button type="button" class="cfg-exp ${open ? "on" : ""}" data-act="expand" aria-expanded="${open}" aria-label="Ver hojas de ${esc(a.name)}">▸</button> <strong>${esc(a.name)}</strong></td>
      <td><select data-act="owner" aria-label="Dueño de ${esc(a.name)}">${st.users.map((u) => `<option value="${esc(u.id)}" ${u.id === a.owner_id ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></td>
      <td><select data-act="stage" class="cfg-stage-sel ${esc(a.stage)}" aria-label="Etapa de ${esc(a.name)}">${STAGES.map((s) => `<option value="${s.id}" ${a.stage === s.id ? "selected" : ""}>${s.label}</option>`).join("")}</select></td>
      <td>${a.sheets ? `${a.published}/${a.sheets}` : "—"} publicadas</td>
      <td class="cfg-muted">${esc(fmt(a.created_at))}</td></tr>
      ${open ? `<tr class="cfg-sheets-row"><td colspan="5">${sheetsBlock(a)}</td></tr>` : ""}`;
  }).join("");
  return `
    <div class="cfg-flow">${cards}</div>
    <div class="cfg-callout">
      <strong>Cómo se publica.</strong> Toda aplicación nueva nace en <em>Personal</em>. El equipo la construye en <em>Desarrollo</em>. Para que la vea un
      <strong>Visualizador</strong> debe estar en <em>Producción</em> <u>y</u> la hoja debe estar <em>publicada</em>; lo que esté en borrador o en otra etapa no aparece.
      Pasar a Producción o publicar hojas requiere el permiso <code>Publicar</code>.
    </div>
    <div class="cfg-card"><table class="cfg-table">
      <thead><tr><th>Aplicación</th><th>Dueño</th><th>Etapa</th><th>Hojas</th><th>Creada</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5" class="cfg-empty">Aún no hay aplicaciones.</td></tr>`}</tbody>
    </table></div>`;
}

function sheetsBlock(a) {
  const list = st.sheets[a.id];
  if (!list) return `<div class="cfg-muted">Cargando hojas…</div>`;
  if (!list.length) return `<div class="cfg-muted">Esta aplicación no tiene hojas todavía.</div>`;
  return `<ul class="cfg-sheets">${list.map((s) => `<li data-sheet="${esc(s.id)}"><span>${svg("pages")}<strong>${esc(s.title)}</strong></span>
    <span class="cfg-pub ${s.visibility === "publica" ? "on" : ""}">${s.visibility === "publica" ? "Publicada" : "Borrador"}</span>
    <button type="button" class="q-btn" data-act="pub" data-to="${s.visibility === "publica" ? "privada" : "publica"}">${s.visibility === "publica" ? "Despublicar" : "Publicar"}</button></li>`).join("")}</ul>
    <p class="cfg-hint">${a.stage === "produccion" ? "La app está en Producción: los visualizadores ven solo las hojas publicadas." : "La app aún no está en Producción: ningún visualizador la ve, aunque sus hojas estén publicadas."}</p>`;
}

/* =======================  MI CUENTA  ======================= */
function accountView() {
  const me = authService.current() || {};
  const perms = me.permissions || [];
  return `
    <div class="cfg-account">
      <div class="cfg-card cfg-me-card">
        <span class="cfg-avatar big">${esc(initials(me.name))}</span>
        <div><h2>${esc(me.name)}</h2><p class="cfg-muted">${esc(me.email)}</p><span class="cfg-role ${esc(me.role)}">${esc(roleLabel(me.role))}</span></div>
      </div>
      <div class="cfg-card cfg-pad"><h3 class="cfg-h3">Mis permisos <small class="cfg-muted">${perms.filter((p) => permIds().has(p)).length} de ${permIds().size}</small></h3>
        <div class="pm-mine">${modules().map((mo) => {
          const mine = st.catalog.permissions.filter((p) => p.module === mo.id && perms.includes(p.id));
          if (!mine.length) return "";
          return `<div class="pm-mine-m" style="--c:${modColor(mo.id)}"><b>${modDot(mo.id)}${esc(mo.label)}</b><ul class="cfg-chips">${mine.map((p) => `<li title="${esc(p.description)}">${esc(p.label)}</li>`).join("")}</ul></div>`;
        }).join("") || "<p>Sin permisos</p>"}</div></div>
      <div class="cfg-card cfg-pad"><h3 class="cfg-h3">Cambiar contraseña</h3>
        <form id="pwForm" class="cfg-form" autocomplete="off">
          <label>Contraseña actual<input id="cPw0" type="password" autocomplete="current-password" /></label>
          <label>Nueva contraseña<input id="cPw1" type="password" placeholder="Mínimo 8 caracteres" autocomplete="new-password" /></label>
          <label>Repite la nueva contraseña<input id="cPw2" type="password" autocomplete="new-password" /></label>
          <p class="cfg-err" id="cErr" hidden></p>
          <button type="submit" class="q-btn primary">Cambiar contraseña</button>
        </form></div>
    </div>`;
}

/* ----------------------- Eventos ----------------------- */
function wire() {
  main.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { st.tab = b.dataset.tab; history.replaceState(null, "", `?tab=${st.tab}`); render(); }));

  main.querySelector("#cfgNewUser")?.addEventListener("click", () => userModal(null));
  // Matriz de permisos (borrador por rol; se guarda todo junto)
  const keepScroll = (fn) => { const w = main.querySelector(".pm-mxwrap"), y = window.scrollY, x = w?.scrollLeft || 0; fn(); window.scrollTo(0, y); const w2 = main.querySelector(".pm-mxwrap"); if (w2) w2.scrollLeft = x; };
  main.querySelectorAll("input.pm-cbx").forEach((cb) => cb.addEventListener("change", () => {
    const d = draftOf(st.catalog.roles.find((x) => x.id === cb.dataset.role));
    if (cb.checked) d.add(cb.dataset.perm); else d.delete(cb.dataset.perm);
    keepScroll(render);
  }));
  main.querySelectorAll("[data-modtog]").forEach((b) => b.addEventListener("click", () => {
    const d = draftOf(st.catalog.roles.find((x) => x.id === b.dataset.role));
    const all = perms().filter((p) => p.module === b.dataset.modtog).map((p) => p.id);
    const full = all.every((p) => d.has(p));
    all.forEach((p) => { if (full && p !== "apps:view") d.delete(p); else d.add(p); });
    keepScroll(render);
  }));
  main.querySelectorAll("[data-fold]").forEach((b) => b.addEventListener("click", () => {
    const id = b.dataset.fold; if (st.mx.closed.has(id)) st.mx.closed.delete(id); else st.mx.closed.add(id); keepScroll(render);
  }));
  main.querySelectorAll("th[data-col]").forEach((th) => th.addEventListener("click", () => { st.mx.focus = st.mx.focus === th.dataset.col ? "" : th.dataset.col; keepScroll(render); }));
  main.querySelector("#mxQ")?.addEventListener("input", (e) => { st.mx.q = e.target.value; const pos = e.target.selectionStart; render(); const i = main.querySelector("#mxQ"); i.focus(); i.setSelectionRange(pos, pos); });
  main.querySelector("#mxMod")?.addEventListener("change", (e) => { st.mx.module = e.target.value; render(); });
  main.querySelector("#mxRisk")?.addEventListener("change", (e) => { st.mx.risk = e.target.value; render(); });
  main.querySelector("#mxDiff")?.addEventListener("change", (e) => { st.mx.diff = e.target.checked; render(); });
  main.querySelector("#mxSave")?.addEventListener("click", saveDirtyRoles);
  main.querySelector("#mxUndo")?.addEventListener("click", () => { st.roleDraft = {}; render(); });
  main.querySelectorAll("[data-reset-role]").forEach((b) => b.addEventListener("click", () => resetRole(b.dataset.resetRole)));
  // Tarjetas de roles
  main.querySelector("#pmNewRole")?.addEventListener("click", () => roleFormModal());
  main.querySelectorAll(".pm-rcard[data-role] [data-r]").forEach((b) => b.addEventListener("click", () => {
    const r = st.catalog.roles.find((x) => x.id === b.closest("[data-role]").dataset.role);
    const act = b.dataset.r;
    if (act === "matrix") { st.tab = "matriz"; st.mx.focus = r.id; history.replaceState(null, "", "?tab=matriz"); render(); }
    else if (act === "dup") roleFormModal({ copyFrom: r.id });
    else if (act === "ren") roleFormModal({ role: r });
    else if (act === "del") roleDeleteModal(r);
    else if (act === "reset") resetRole(r.id);
  }));
  // Auditoría
  main.querySelector("#auQ")?.addEventListener("input", (e) => { st.auditQ = e.target.value; const pos = e.target.selectionStart; render(); const i = main.querySelector("#auQ"); i.focus(); i.setSelectionRange(pos, pos); });
  main.querySelectorAll("[data-au]").forEach((b) => b.addEventListener("click", () => { st.auditType = b.dataset.au; render(); }));
  main.querySelector("#auRefresh")?.addEventListener("click", () => { st.audit = null; render(); });
  main.querySelector("#cfgQ")?.addEventListener("input", (e) => {
    st.q = e.target.value; const pos = e.target.selectionStart; render();
    const i = main.querySelector("#cfgQ"); i.focus(); i.setSelectionRange(pos, pos);
  });
  main.querySelector("#cfgRole")?.addEventListener("change", (e) => { st.roleFilter = e.target.value; render(); });
  main.querySelectorAll("tr[data-id] [data-act]").forEach((b) => b.addEventListener("click", () => {
    const u = st.users.find((x) => x.id === b.closest("tr").dataset.id);
    if (!u) return;
    if (b.dataset.act === "edit") userModal(u);
    else if (b.dataset.act === "eff") effectiveModal(u);
    else if (b.dataset.act === "pw") passwordModal(u);
    else if (b.dataset.act === "del") deleteModal(u);
  }));

  // Etapas
  main.querySelectorAll("tr[data-app] [data-act]").forEach((el) => {
    const row = el.closest("tr");
    const app = st.apps.find((x) => x.id === row.dataset.app);
    if (!app) return;
    if (el.dataset.act === "expand") el.addEventListener("click", async () => {
      if (st.expanded.has(app.id)) st.expanded.delete(app.id);
      else {
        st.expanded.add(app.id);
        render();
        try { st.sheets[app.id] = await api.listSheets(app.id); } catch (e) { st.sheets[app.id] = []; toast(e.message, "err"); }
      }
      render();
    });
    if (el.dataset.act === "stage") el.addEventListener("change", async () => {
      const target = el.value;
      if (target === "produccion" && !(app.published > 0) && !confirm("Esta app no tiene hojas publicadas: los visualizadores la verán vacía. ¿Pasarla a Producción de todos modos?")) { el.value = app.stage; return; }
      try { Object.assign(app, await api.setAppStage(app.id, target)); toast(`«${app.name}» ahora está en ${STAGES.find((s) => s.id === target).label}.`); }
      catch (e) { toast(e.message, "err"); }
      render();
    });
    if (el.dataset.act === "owner") el.addEventListener("change", async () => {
      try { Object.assign(app, await api.setAppStage(app.id, app.stage, el.value)); toast("Dueño actualizado."); }
      catch (e) { toast(e.message, "err"); el.value = app.owner_id; }
    });
  });
  main.querySelectorAll("li[data-sheet] [data-act=pub]").forEach((b) => b.addEventListener("click", async () => {
    const appId = b.closest("tr").previousElementSibling.dataset.app;
    const sheetId = b.closest("li").dataset.sheet;
    b.disabled = true;
    try {
      const saved = await api.setSheetVisibility(appId, sheetId, b.dataset.to);
      const list = st.sheets[appId];
      const i = list.findIndex((s) => s.id === sheetId);
      if (i >= 0) list[i] = saved;
      const app = st.apps.find((x) => x.id === appId);
      app.published = list.filter((s) => s.visibility === "publica").length;
      app.sheets = list.length;
      toast(saved.visibility === "publica" ? "Hoja publicada." : "Hoja devuelta a borrador.");
    } catch (e) { toast(e.message, "err"); }
    render();
  }));

  // Mi cuenta
  main.querySelector("#pwForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = main.querySelector("#cErr"); err.hidden = true;
    const p0 = main.querySelector("#cPw0").value, p1 = main.querySelector("#cPw1").value, p2 = main.querySelector("#cPw2").value;
    if (p1 !== p2) { err.textContent = "Las contraseñas nuevas no coinciden."; err.hidden = false; return; }
    try {
      const r = await api.changeMyPassword(p0, p1);
      // El servidor cierra todas las sesiones y devuelve una nueva: se conserva la actual con el token nuevo.
      const s = authService.current();
      localStorage.setItem("ds.session", JSON.stringify({ ...s, token: r.token, exp: r.expires_at }));
      toast("Contraseña cambiada."); e.target.reset();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  });
}

/* ----------------------- Arranque ----------------------- */
renderNav("nav", { active: "configuracion" });
wireAppsButton();
renderProfileMenu(authService);

(async () => {
  main.innerHTML = `<p class="cfg-muted" style="padding:20px">Cargando…</p>`;
  try {
    await authService.refresh();
    await loadAll();
  } catch (e) {
    main.innerHTML = `<p class="cfg-err" style="padding:20px">No se pudo cargar la configuración: ${esc(e.message)}</p>`;
    return;
  }
  const want = new URLSearchParams(location.search).get("tab");
  const allowed = ["usuarios", "roles", "matriz", "etapas", "cuenta", ...(canAudit() ? ["auditoria"] : [])];
  st.tab = isAdmin() ? (allowed.includes(want) ? want : "usuarios") : "cuenta";
  render();
})();

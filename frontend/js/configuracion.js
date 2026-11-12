// configuracion.js — Configuración de DataSense (administración).
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
const st = { roleDraft: {}, tab: "usuarios", catalog: null, users: [], apps: [], q: "", roleFilter: "", expanded: new Set(), sheets: {} };

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
    ? [["usuarios", "Usuarios", "users"], ["roles", "Roles y permisos", "lock"], ["etapas", "Etapas y publicación", "rocket"], ["cuenta", "Mi cuenta", "assist"]]
    : [["cuenta", "Mi cuenta", "assist"]];
  return `<div class="cfg-tabs" role="tablist">${list.map(([id, label, ic]) =>
    `<button type="button" class="cfg-tab ${st.tab === id ? "on" : ""}" role="tab" aria-selected="${st.tab === id}" data-tab="${id}">${svg(ic)}<span>${label}</span></button>`).join("")}</div>`;
}

function render() {
  const body = { usuarios: usersView, roles: rolesView, etapas: stagesView, cuenta: accountView }[st.tab]();
  main.innerHTML = `
    <div class="q-greeting"><h1>Configuración</h1></div>
    <p class="cfg-sub">${isAdmin() ? "Administra quién entra a DataSense, qué puede hacer y qué aplicaciones y hojas ven los visualizadores." : "Tu cuenta y tus permisos."}</p>
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
    const custom = (u.grant?.length || 0) + (u.deny?.length || 0);
    const me = u.id === authService.current()?.userId;
    return `<tr class="${u.active ? "" : "off"}" data-id="${esc(u.id)}">
      <td><div class="cfg-user"><span class="cfg-avatar">${esc(initials(u.name))}</span>
        <div><strong>${esc(u.name)}${me ? ' <em class="cfg-me">tú</em>' : ""}</strong><small>${esc(u.email)}</small></div></div></td>
      <td><span class="cfg-role ${esc(u.role)}">${esc(roleLabel(u.role))}</span></td>
      <td><span class="cfg-state ${u.active ? "on" : "off"}"><i></i>${u.active ? "Activo" : "Inactivo"}</span></td>
      <td>${u.permissions.length} ${u.permissions.length === 1 ? "permiso" : "permisos"}${custom ? ` <span class="cfg-chip" title="Concedidos: ${esc((u.grant || []).map(permLabel).join(", ") || "ninguno")}. Denegados: ${esc((u.deny || []).map(permLabel).join(", ") || "ninguno")}">${custom} personalizados</span>` : ""}</td>
      <td class="cfg-muted">${esc(fmt(u.last_login))}</td>
      <td class="cfg-actions">
        <button type="button" class="cfg-icon" data-act="edit" title="Editar usuario" aria-label="Editar ${esc(u.name)}">${svg("settings")}</button>
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

/** Selector de permisos individuales: parte de los del rol y registra solo las diferencias (conceder / denegar). */
function permPicker(role, grant, deny) {
  const g = new Set(grant), d = new Set(deny);
  const defs = roleDefaults(role);
  const admin = role === "admin";
  const groups = [...new Set(st.catalog.permissions.map((p) => p.group))];
  return `<div class="cfg-perms" data-role="${esc(role)}">
    ${admin ? `<p class="cfg-hint">El administrador siempre tiene todos los permisos y no se puede restringir.</p>` : ""}
    ${groups.map((grp) => `<div class="cfg-perm-grp"><h4>${esc(grp)}</h4>
      ${st.catalog.permissions.filter((p) => p.group === grp).map((p) => {
        const fromRole = defs.has(p.id);
        const on = admin || ((fromRole || g.has(p.id)) && !d.has(p.id));
        const tag = admin ? "" : g.has(p.id) && !fromRole ? '<em class="cfg-tag add">extra</em>' : d.has(p.id) && fromRole ? '<em class="cfg-tag sub">quitado</em>' : fromRole ? '<em class="cfg-tag role">del rol</em>' : "";
        return `<label class="cfg-perm ${on ? "on" : ""}"><input type="checkbox" data-perm="${esc(p.id)}" ${on ? "checked" : ""} ${admin ? "disabled" : ""} />
          <span><strong>${esc(p.label)}</strong> ${tag}<small>${esc(p.description)}</small></span></label>`;
      }).join("")}</div>`).join("")}
  </div>`;
}

function userModal(user) {
  const editing = !!user;
  const u = user || { name: "", email: "", role: "viewer", active: true, grant: [], deny: [] };
  const state = { role: u.role, grant: [...(u.grant || [])], deny: [...(u.deny || [])] };
  const m = modal({
    title: editing ? `Editar usuario · ${u.name}` : "Nuevo usuario",
    wide: true,
    body: `
      <div class="cfg-form">
        <label>Nombre<input id="uName" type="text" value="${esc(u.name)}" placeholder="Nombre y apellido" autocomplete="off" /></label>
        <label>Correo electrónico<input id="uMail" type="email" value="${esc(u.email)}" placeholder="persona@empresa.com" autocomplete="off" /></label>
        <label>Rol<select id="uRole">${st.catalog.roles.map((r) => `<option value="${esc(r.id)}" ${r.id === u.role ? "selected" : ""}>${esc(r.label)}</option>`).join("")}</select>
          <small id="uRoleDesc"></small></label>
        ${editing ? "" : `<label>Contraseña inicial<span class="cfg-pw"><input id="uPw" type="password" placeholder="Mínimo 8 caracteres" autocomplete="new-password" />
          <button type="button" class="cfg-link" id="uGen">Generar</button><button type="button" class="cfg-link" id="uShow">Mostrar</button></span></label>`}
        <label class="cfg-switch-row"><span>Cuenta activa<small>Si se desactiva, no puede iniciar sesión.</small></span>
          <button type="button" class="ds-tm-switch" role="switch" id="uActive" aria-checked="${u.active}" aria-label="Cuenta activa"></button></label>
      </div>
      <h3 class="cfg-h3">Permisos</h3>
      <p class="cfg-hint">Parte de los permisos del rol. Marca o desmarca para concederle algo extra o quitárselo solo a esta persona.</p>
      <div id="uPerms"></div>
      <p class="cfg-err" id="uErr" hidden></p>`,
    actions: `<button type="button" class="q-btn" data-x>Cancelar</button><button type="button" class="q-btn primary" id="uSave">${editing ? "Guardar cambios" : "Crear usuario"}</button>`,
  });
  const $ = (s) => m.el.querySelector(s);
  const paint = () => {
    $("#uPerms").innerHTML = permPicker(state.role, state.grant, state.deny);
    $("#uRoleDesc").textContent = st.catalog.roles.find((r) => r.id === state.role)?.description || "";
  };
  paint();
  $("#uRole").addEventListener("change", (e) => {
    state.role = e.target.value;
    // Al cambiar de rol se descartan los extras/quitados que ya no tienen sentido.
    const defs = roleDefaults(state.role);
    state.grant = state.grant.filter((p) => !defs.has(p));
    state.deny = state.deny.filter((p) => defs.has(p));
    paint();
  });
  $("#uPerms").addEventListener("change", (e) => {
    const cb = e.target.closest("[data-perm]");
    if (!cb) return;
    const p = cb.dataset.perm, fromRole = roleDefaults(state.role).has(p);
    state.grant = state.grant.filter((x) => x !== p);
    state.deny = state.deny.filter((x) => x !== p);
    if (cb.checked && !fromRole) state.grant.push(p);
    if (!cb.checked && fromRole) state.deny.push(p);
    paint();
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
      active: sw.getAttribute("aria-checked") === "true", grant: state.grant, deny: state.deny };
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

/* =======================  ROLES Y PERMISOS  ======================= */
// Borrador de la matriz: rol -> Set de permisos marcados (solo roles editables).
const draftOf = (r) => (st.roleDraft[r.id] ||= new Set(r.permissions));
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const roleDirty = (r) => r.editable && st.roleDraft[r.id] && !sameSet(st.roleDraft[r.id], new Set(r.permissions));

function rolesView() {
  const roles = st.catalog.roles;
  const groups = [...new Set(st.catalog.permissions.map((p) => p.group))];
  const cell = (r, p) => {
    if (!r.editable) return `<td class="c"><span class="cfg-ok" title="El administrador siempre tiene todos los permisos" aria-label="Sí">✓</span></td>`;
    const on = draftOf(r).has(p.id);
    const locked = p.id === "dashboard:view"; // todo rol debe poder ver tableros publicados
    return `<td class="c"><input type="checkbox" class="cfg-perm" data-role="${esc(r.id)}" data-perm="${esc(p.id)}" ${on ? "checked" : ""} ${locked ? "disabled" : ""}
      aria-label="${esc(p.label)} para ${esc(r.label)}" /></td>`;
  };
  return `
    <div class="cfg-roles">${roles.map((r) => `<div class="cfg-role-card ${esc(r.id)}"><span class="cfg-role ${esc(r.id)}">${esc(r.label)}</span><p>${esc(r.description)}</p>
      <small>${draftOf(r).size} de ${st.catalog.permissions.length} permisos · ${st.users.filter((u) => u.role === r.id).length} usuarios${r.customized ? " · <b>personalizado</b>" : ""}</small></div>`).join("")}</div>
    <div class="cfg-callout">Marca o desmarca lo que puede hacer cada rol y pulsa <strong>Guardar</strong>: se aplica al instante a todas las personas con ese rol
      (quien ya tenga la sesión abierta lo recibe en unos segundos). El rol Administrador siempre tiene todo.</div>
    <div class="cfg-card"><table class="cfg-table cfg-matrix">
      <thead><tr><th>Permiso</th>${roles.map((r) => `<th class="c">${esc(r.label)}</th>`).join("")}</tr></thead>
      <tbody>${groups.map((g) => `<tr class="grp"><td colspan="${roles.length + 1}">${esc(g)}</td></tr>` +
        st.catalog.permissions.filter((p) => p.group === g).map((p) => `<tr><td><strong>${esc(p.label)}</strong><small>${esc(p.description)}</small></td>
          ${roles.map((r) => cell(r, p)).join("")}</tr>`).join("")).join("")}
      </tbody>
      <tfoot><tr><td></td>${roles.map((r) => r.editable ? `<td class="c cfg-role-actions">
        <button type="button" class="q-btn primary sm" data-save-role="${esc(r.id)}" ${roleDirty(r) ? "" : "disabled"}>Guardar</button>
        <button type="button" class="q-btn sm" data-reset-role="${esc(r.id)}" ${r.customized || roleDirty(r) ? "" : "disabled"} title="Volver a los permisos de fábrica">Restablecer</button></td>` : "<td></td>").join("")}</tr></tfoot>
      </table></div>
    <p class="cfg-hint">Los roles son la base. En <strong>Usuarios</strong> puedes conceder o quitar permisos sueltos a una persona sin cambiarle el rol.</p>`;
}

async function saveRole(roleId) {
  const r = st.catalog.roles.find((x) => x.id === roleId);
  try {
    await api.setRolePermissions(roleId, [...draftOf(r)]);
    toast(`Permisos del rol ${r.label} guardados.`);
    delete st.roleDraft[roleId];
    st.catalog = await api.authCatalog();
    await refreshUsers();
    render();
  } catch (e) { toast(e.message, "err"); }
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
      <div class="cfg-card cfg-pad"><h3 class="cfg-h3">Mis permisos</h3>
        <ul class="cfg-chips">${perms.length ? perms.map((p) => `<li>${esc(permLabel(p))}</li>`).join("") : "<li>Sin permisos</li>"}</ul></div>
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
  // Roles y permisos (matriz editable)
  main.querySelectorAll("input.cfg-perm").forEach((cb) => cb.addEventListener("change", () => {
    const r = st.catalog.roles.find((x) => x.id === cb.dataset.role);
    const d = draftOf(r);
    if (cb.checked) d.add(cb.dataset.perm); else d.delete(cb.dataset.perm);
    render();
  }));
  main.querySelectorAll("[data-save-role]").forEach((b) => b.addEventListener("click", () => saveRole(b.dataset.saveRole)));
  main.querySelectorAll("[data-reset-role]").forEach((b) => b.addEventListener("click", () => resetRole(b.dataset.resetRole)));
  main.querySelector("#cfgQ")?.addEventListener("input", (e) => {
    st.q = e.target.value; const pos = e.target.selectionStart; render();
    const i = main.querySelector("#cfgQ"); i.focus(); i.setSelectionRange(pos, pos);
  });
  main.querySelector("#cfgRole")?.addEventListener("change", (e) => { st.roleFilter = e.target.value; render(); });
  main.querySelectorAll("tr[data-id] [data-act]").forEach((b) => b.addEventListener("click", () => {
    const u = st.users.find((x) => x.id === b.closest("tr").dataset.id);
    if (!u) return;
    if (b.dataset.act === "edit") userModal(u);
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
  st.tab = isAdmin() ? (["usuarios", "roles", "etapas", "cuenta"].includes(want) ? want : "usuarios") : "cuenta";
  render();
})();

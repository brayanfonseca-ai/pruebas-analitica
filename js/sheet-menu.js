// sheet-menu.js — menú contextual de la hoja (botón "···" de la barra superior),
// replicando el de Qlik Sense. Cada acción está declarada como dato (id, label,
// icon, enabled, run) y el render es genérico: así se prueba y se extiende sin
// tocar la barra. La lógica de datos (duplicar/eliminar/estado) la provee el host
// a través de `ctx`; este módulo no habla con el backend directamente.
//
// Acciones basadas en la documentación de Qlik Sense (menú de hoja):
// Copiar enlace · Detalles · Hacer pública · Suscribirse · Descargar PDF ·
// Duplicar · Eliminar · Incluir (embed) · Modo pantalla táctil · Configurar.
// Contenido reformulado de help.qlik.com para cumplir restricciones de licencia.

/**
 * @typedef {Object} SheetMenuCtx
 * @property {() => {id:string,title:string,description?:string,visibility?:string}|null} getSheet  Hoja activa.
 * @property {() => string} appId                     Id de la app abierta.
 * @property {(role?:string)=>boolean} can            Gating de permisos (UI).
 * @property {() => Promise<void>} duplicateSheet      Duplica la hoja activa.
 * @property {() => Promise<void>} deleteSheet         Elimina la hoja activa.
 * @property {(v:string)=>Promise<void>} setVisibility Cambia visibilidad (privada|publica).
 * @property {() => void} openDetails                  Abre el panel de detalles.
 * @property {(on:boolean)=>void} setTouchMode         Activa/desactiva modo táctil.
 * @property {() => boolean} touchMode                 Estado actual del modo táctil.
 * @property {(msg:string, kind?:string)=>void} toast  Notifica al usuario.
 */

const ICONS = {
  link: '<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="8" r="0.7" fill="currentColor"/>',
  public: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  subscribe: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  pdf: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M12 12v5M9.5 14.5 12 17l2.5-2.5"/>',
  duplicate: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V5a1 1 0 0 1 1-1h11"/>',
  delete: '<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/>',
  embed: '<path d="m8 6-6 6 6 6M16 6l6 6-6 6"/>',
  touch: '<path d="M9 11V6a2 2 0 0 1 4 0v5"/><path d="M13 11V9a2 2 0 0 1 4 0v5a6 6 0 0 1-6 6h-1a5 5 0 0 1-4-2l-3-4 2-1 3 2"/>',
  config: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 4.6 15H4a2 2 0 0 1 0-4h.1A1.6 1.6 0 0 0 5.6 7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 11 4.6V4a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.6 1.6 0 0 0 21 11h.1a2 2 0 0 1 0 4H21z"/>',
};

const svg = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ""}</svg>`;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/**
 * Declara las acciones del menú. Cada una sabe si está habilitada y qué hacer.
 * @param {SheetMenuCtx} ctx
 * @returns {Array<{id:string,label:string,icon:string,sep?:boolean,toggle?:boolean,on?:boolean,badge?:string,enabled:boolean,run:Function}>}
 */
function buildActions(ctx) {
  const sheet = ctx.getSheet();
  const hasSheet = !!sheet;
  const canEdit = ctx.can("charts:edit");
  const isPublic = sheet?.visibility === "publica";
  return [
    {
      id: "link", label: "Copiar enlace", icon: "link", enabled: hasSheet,
      run: async () => {
        const url = `${location.origin}${location.pathname}?app=${encodeURIComponent(ctx.appId())}#hoja:${encodeURIComponent(sheet.id)}`;
        try { await navigator.clipboard.writeText(url); ctx.toast("Enlace copiado al portapapeles."); }
        catch { ctx.toast("No se pudo copiar automáticamente. Enlace: " + url, "warn"); }
      },
    },
    { id: "details", label: "Detalles", icon: "info", enabled: hasSheet, run: () => ctx.openDetails() },
    { sep: true },
    {
      id: "public", label: isPublic ? "Hacer la hoja privada" : "Hacer la hoja pública", icon: "public",
      enabled: hasSheet && canEdit,
      run: () => ctx.setVisibility(isPublic ? "privada" : "publica"),
    },
    {
      id: "subscribe", label: "Suscribirse a la hoja", icon: "subscribe", enabled: hasSheet, badge: "Próximamente",
      run: () => ctx.toast("Las suscripciones por correo llegan con el módulo de Informes. Próximamente.", "warn"),
    },
    {
      id: "pdf", label: "Descargar hoja como PDF", icon: "pdf", enabled: hasSheet,
      run: () => { ctx.toast("Preparando impresión… usa «Guardar como PDF» en el diálogo del navegador."); setTimeout(() => window.print(), 300); },
    },
    { sep: true },
    { id: "duplicate", label: "Duplicar hoja", icon: "duplicate", enabled: hasSheet && canEdit, run: () => ctx.duplicateSheet() },
    { id: "delete", label: "Eliminar hoja", icon: "delete", danger: true, enabled: hasSheet && canEdit, run: () => ctx.deleteSheet() },
    { sep: true },
    {
      id: "embed", label: "Incluir hoja", icon: "embed", enabled: hasSheet,
      run: () => ctx.openEmbed(),
    },
    {
      id: "touch", label: "Modo pantalla táctil", icon: "touch", toggle: true, on: ctx.touchMode(), enabled: true,
      run: () => ctx.setTouchMode(!ctx.touchMode()),
    },
    { sep: true },
    {
      id: "config", label: "Configurar", icon: "config", badge: "Preview", enabled: hasSheet,
      run: () => ctx.openConfig(),
    },
  ];
}

/**
 * Monta el botón "···" y su popover dentro de `anchorHost`.
 * Devuelve una función de limpieza.
 * @param {HTMLElement} anchorHost  contenedor donde se inserta el botón.
 * @param {SheetMenuCtx} ctx
 */
export function mountSheetMenu(anchorHost, ctx) {
  anchorHost.innerHTML = `
    <button class="q-crumb-more" id="crumbMore" aria-haspopup="true" aria-expanded="false" title="Más acciones de la hoja">···</button>
    <div class="q-crumb-pop" id="crumbPop" hidden role="menu"></div>`;
  const btn = anchorHost.querySelector("#crumbMore");
  const pop = anchorHost.querySelector("#crumbPop");

  const close = () => { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); };
  const open = () => {
    pop.innerHTML = buildActions(ctx).map((a) => {
      if (a.sep) return `<div class="q-crumb-sep"></div>`;
      return `<button class="q-crumb-item ${a.danger ? "danger" : ""}" role="menuitem" data-id="${a.id}" ${a.enabled ? "" : "disabled"}>
        <span class="q-crumb-ico">${svg(a.icon)}</span>
        <span class="q-crumb-label">${esc(a.label)}</span>
        ${a.toggle ? `<span class="q-crumb-toggle ${a.on ? "on" : ""}"></span>` : ""}
        ${a.badge ? `<span class="q-crumb-badge">${esc(a.badge)}</span>` : ""}
      </button>`;
    }).join("");
    pop.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    const actions = buildActions(ctx);
    pop.querySelectorAll("[data-id]").forEach((el) => {
      if (el.disabled) return;
      el.addEventListener("click", async () => {
        const action = actions.find((a) => a.id === el.dataset.id);
        close();
        try { await action.run(); } catch (err) { ctx.toast("Error: " + err.message, "error"); }
      });
    });
  };

  btn.addEventListener("click", (e) => { e.stopPropagation(); pop.hidden ? open() : close(); });
  const onDoc = (e) => { if (!anchorHost.contains(e.target)) close(); };
  document.addEventListener("click", onDoc);

  return () => { document.removeEventListener("click", onDoc); anchorHost.innerHTML = ""; };
}

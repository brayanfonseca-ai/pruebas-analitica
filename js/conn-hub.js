// conn-hub.js — abre el asistente de CONEXIONES DE DATOS desde el hub
// (p.ej. Crear → tarjeta "Conexión de datos"). Reutiliza el mismo
// openConnectionWizard() del editor, pero aporta un `host` autónomo (modal +
// toast) porque las páginas del hub solo cargan hub.css.
//
// Las conexiones viven en una app (como en Qlik, dentro de un espacio). Si no
// hay ninguna app todavía, se crea una app contenedora "Conexiones de datos"
// para alojarlas; si ya existen, se usa la más reciente.

import { openConnectionWizard } from "./connections.js";
import { listApps, createApp } from "./api.js";

/* ---- Modal genérico (autónomo, no depende del editor) ---- */
function makeModalHost() {
  let backdrop = null;
  function closeModal() {
    if (backdrop) { backdrop.remove(); backdrop = null; }
  }
  function openModal(title, bodyHTML, footHTML) {
    closeModal();
    backdrop = document.createElement("div");
    backdrop.className = "cnh-backdrop";
    backdrop.innerHTML = `
      <div class="cnh-modal" role="dialog" aria-modal="true">
        <div class="cnh-head"><h2></h2><button class="cnh-x" aria-label="Cerrar">✕</button></div>
        <div class="cnh-body"></div>
        <div class="cnh-foot"></div>
      </div>`;
    backdrop.querySelector(".cnh-head h2").textContent = title;
    backdrop.querySelector(".cnh-body").innerHTML = bodyHTML;
    backdrop.querySelector(".cnh-foot").innerHTML = footHTML || "";
    document.body.appendChild(backdrop);

    const close = () => closeModal();
    backdrop.querySelector(".cnh-x").addEventListener("click", close);
    backdrop.addEventListener("mousedown", (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));
    return backdrop; // el wizard consulta/escucha dentro de este elemento
  }
  function toast(msg) {
    const t = document.createElement("div");
    t.className = "cnh-toast";
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 220); }, 2600);
  }
  return { openModal, closeModal, toast, space: "DEV_MODELOS_IA" };
}

async function resolveAppId() {
  let apps = [];
  try { apps = await listApps(); } catch { apps = []; }
  if (Array.isArray(apps) && apps.length) {
    // La más reciente si viene con fecha; si no, la primera.
    const sorted = [...apps].sort((a, b) =>
      String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
    return sorted[0].id;
  }
  const app = await createApp("Conexiones de datos");
  return app.id;
}

/**
 * Abre el asistente de conexiones desde el hub.
 * @param {function} [onCreated] callback con la conexión creada.
 */
export async function openConnectionsFromHub(onCreated) {
  const host = makeModalHost();
  // Modal de "cargando" mientras resolvemos la app contenedora.
  host.openModal("Crear conexión de datos",
    `<p class="ed-muted">Preparando espacio de conexiones…</p>`,
    `<button class="ho-btn" data-close>Cancelar</button>`);
  let appId;
  try {
    appId = await resolveAppId();
  } catch (e) {
    host.openModal("Crear conexión de datos",
      `<p class="cn-status err">No se pudo preparar el espacio: ${e.message}</p>`,
      `<button class="ho-btn" data-close>Cerrar</button>`);
    return;
  }
  openConnectionWizard(appId, host, (created) => { onCreated && onCreated(created); });
}

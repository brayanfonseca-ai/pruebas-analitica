// conn-hub.js — abre el asistente de CONEXIONES DE DATOS desde el hub
// (p.ej. Crear → tarjeta "Conexión de datos"). Reutiliza el mismo
// openConnectionWizard() del editor, pero aporta un `host` autónomo (modal +
// toast) porque las páginas del hub solo cargan hub.css.
//
// Las conexiones son del usuario (se crean una vez y sirven en todos sus proyectos).

import { openConnectionWizard } from "./connections.js";

/* ---- Modal genérico (autónomo, no depende del editor) ---- */
export function makeModalHost() {
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

/**
 * Abre el asistente de conexiones desde el hub. Las conexiones son del USUARIO (no de una app),
 * así que ya no hace falta una app contenedora.
 * @param {function} [onCreated] callback con la conexión creada.
 * @param {object} [opts] {connector?, connection?} (ver openConnectionWizard)
 */
export function openConnectionsFromHub(onCreated, opts = {}) {
  const host = makeModalHost();
  openConnectionWizard(null, host, (created) => { onCreated && onCreated(created); }, opts);
  return host;
}
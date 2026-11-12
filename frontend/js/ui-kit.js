// ui-kit.js — utilidades de interfaz compartidas por las páginas nuevas del hub
// (Conexiones, Notas para agente, Embedding): escape HTML, fechas, avisos, modal y copiar al portapapeles.
// Usa las mismas clases (cfg-toast, q-modal…) que Configuración para que todo se vea igual.

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
export const initials = (n) => String(n || "?").split(/[\s@.]+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
export function fmtDate(iso, withTime = true) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  const o = { day: "numeric", month: "short", year: "numeric" };
  if (withTime) Object.assign(o, { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleString("es", o);
}

export function toast(msg, kind = "ok") {
  let host = document.getElementById("cfgToasts");
  if (!host) { host = document.createElement("div"); host.id = "cfgToasts"; host.className = "cfg-toasts"; host.setAttribute("aria-live", "polite"); document.body.appendChild(host); }
  const t = document.createElement("div");
  t.className = `cfg-toast ${kind}`;
  t.textContent = msg;
  host.appendChild(t);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 300); }, kind === "err" ? 6000 : 3200);
}

export function modal({ title, body, actions = "", wide = false }) {
  const back = document.createElement("div");
  back.className = "q-modal-backdrop cfg-modal-bd";
  back.innerHTML = `
    <div class="q-modal cfg-modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="q-modal-head"><h2>${esc(title)}</h2><button class="q-modal-x" data-x aria-label="Cerrar">✕</button></div>
      <div class="q-modal-body cfg-modal-body">${body}</div>
      <div class="q-modal-foot">${actions}</div>
    </div>`;
  document.body.appendChild(back);
  const onKey = (e) => { if (e.key === "Escape") close(); };
  const close = () => { back.remove(); document.removeEventListener("keydown", onKey); };
  back.querySelectorAll("[data-x]").forEach((b) => b.addEventListener("click", close));
  back.addEventListener("pointerdown", (e) => { if (e.target === back) close(); });
  document.addEventListener("keydown", onKey);
  return { el: back, close };
}

/** Confirmación con el mismo modal (en lugar de confirm() del navegador). Devuelve Promise<boolean>. */
export function confirmBox({ title, message, okLabel = "Confirmar", danger = false }) {
  return new Promise((resolve) => {
    const m = modal({
      title,
      body: `<p class="cfg-confirm">${message}</p>`,
      actions: `<button type="button" class="q-btn" data-x>Cancelar</button><button type="button" class="q-btn ${danger ? "danger" : "primary"}" id="ukOk">${esc(okLabel)}</button>`,
    });
    let done = false;
    const fin = (v) => { if (done) return; done = true; m.close(); resolve(v); };
    m.el.querySelector("#ukOk").addEventListener("click", () => fin(true));
    m.el.querySelectorAll("[data-x]").forEach((b) => b.addEventListener("click", () => fin(false)));
    m.el.addEventListener("pointerdown", (e) => { if (e.target === m.el) fin(false); });
    m.el.querySelector("#ukOk").focus();
  });
}

export async function copyText(text, okMsg = "Copiado al portapapeles.") {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMsg);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); toast(okMsg); } catch { toast("No se pudo copiar: selecciona el texto y copia con Ctrl+C.", "err"); }
    ta.remove();
  }
}

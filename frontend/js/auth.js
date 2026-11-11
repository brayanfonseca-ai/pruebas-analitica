// auth.js — controlador de la vista de login (profesional y robusto).
//
// Robustez: todo el cableado va dentro de DOMContentLoaded y en try/catch, de
// modo que un fallo puntual nunca deja el botón "sin hacer nada" en silencio;
// siempre se muestra un mensaje de error legible.

import { authService } from "./auth-service.js";

function ready(fn) {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
  else fn();
}

ready(() => {
  // Guard: si ya hay sesión válida, saltar directo al hub.
  try {
    if (authService.isAuthenticated()) {
      location.replace("inicio.html");
      return;
    }
  } catch { /* sesión corrupta: seguimos mostrando el login */ }

  const form = document.getElementById("loginForm");
  const emailEl = document.getElementById("email");
  const pwEl = document.getElementById("password");
  const errorEl = document.getElementById("formError");
  const btn = document.getElementById("submitBtn");
  const togglePw = document.getElementById("togglePw");

  if (!form || !emailEl || !pwEl || !btn) return;

  const setError = (msg) => {
    if (errorEl) errorEl.textContent = msg || "";
    emailEl.classList.toggle("bad", !!msg);
    pwEl.classList.toggle("bad", !!msg);
  };

  const clearError = () => setError("");
  emailEl.addEventListener("input", clearError);
  pwEl.addEventListener("input", clearError);

  // Mostrar / ocultar contraseña.
  togglePw?.addEventListener("click", () => {
    const show = pwEl.type === "password";
    pwEl.type = show ? "text" : "password";
    togglePw.textContent = show ? "Ocultar" : "Mostrar";
    pwEl.focus();
  });

  // "¿Olvidaste tu contraseña?" — nota local (sin backend de correo).
  document.getElementById("forgot")?.addEventListener("click", (e) => {
    e.preventDefault();
    setError("");
    if (errorEl) { errorEl.style.color = "var(--muted)"; errorEl.textContent = "Pídele a un administrador que restablezca tu contraseña en Configuración → Usuarios."; }
  });

  // Animación count-up de los KPIs del panel de analítica (solo estético).
  document.querySelectorAll(".viz .kpi-v[data-count]").forEach((el) => {
    const target = el.getAttribute("data-count");
    const num = parseFloat(String(target).replace(/[^\d.]/g, ""));
    if (!isFinite(num)) { el.textContent = target; return; }
    const prefix = String(target).startsWith("+") ? "+" : "";
    const suffix = String(target).replace(/[\d.+]/g, "");
    let cur = 0; const step = num / 28;
    const tick = () => {
      cur += step;
      if (cur >= num) { el.textContent = target; return; }
      el.textContent = prefix + (num >= 100 ? Math.round(cur) : cur.toFixed(num % 1 ? 1 : 0)) + suffix;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  function submit() {
    clearError();
    const email = (emailEl.value || "").trim();
    const password = pwEl.value || "";

    if (!email) { setError("Ingresa tu correo electrónico."); emailEl.focus(); return; }
    if (!password) { setError("Ingresa tu contraseña."); pwEl.focus(); return; }

    // Estado de carga (feedback visible). Pequeño retardo para que se perciba.
    btn.classList.add("loading");
    btn.disabled = true;

    (async () => {
      let result;
      try {
        result = await authService.login(email, password);
      } catch (e) {
        result = { ok: false, error: "No se pudo iniciar sesión. Inténtalo de nuevo." };
      }
      if (!result || !result.ok) {
        btn.classList.remove("loading");
        btn.disabled = false;
        setError((result && result.error) || "Correo o contraseña incorrectos.");
        pwEl.focus();
        return;
      }
      // Éxito → al hub.
      location.href = "inicio.html";
    })();
  }

  form.addEventListener("submit", (e) => { e.preventDefault(); submit(); });

  emailEl.focus();
});

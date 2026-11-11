// auth-service.js — sesión y permisos del cliente.
//
// La autenticación y la autorización REALES viven en el backend: POST /api/v1/auth/login valida la
// contraseña (PBKDF2) y emite un token; cada petición a /api/v1/** lo lleva en Authorization y el
// servidor aplica rol, permisos individuales y la etapa de la app (js/api.js). Aquí solo se guarda la
// sesión en localStorage y se proyectan los permisos efectivos en la interfaz (ocultar/deshabilitar),
// nunca como única barrera.

import { session } from "./store.js";
import { apiLogin, authMe, authHeader } from "./api.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toSession(token, expiresAt, user) {
  return {
    token,
    exp: expiresAt,
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    permissions: user.permissions || [],
  };
}

export const authService = {
  /** Inicia sesión contra el backend. Devuelve {ok} o {ok:false, error}. */
  async login(email, password) {
    email = (email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return { ok: false, error: "Ingresa un correo válido." };
    try {
      const r = await apiLogin(email, password);
      session.set(toSession(r.token, r.expires_at, r.user));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message || "Correo o contraseña incorrectos." };
    }
  },

  /** Cierra la sesión: borra la local al instante y avisa al servidor (keepalive sobrevive a la navegación). */
  logout() {
    const headers = authHeader();
    session.clear();
    try { fetch("/api/v1/auth/logout", { method: "POST", headers, keepalive: true }).catch(() => {}); } catch { /* sin red */ }
  },

  /** Sesión local (sin red). */
  current() {
    return session.get();
  },

  isAuthenticated() {
    return session.isValid();
  },

  /**
   * Vuelve a pedir el usuario al servidor (rol y permisos pueden haber cambiado) y actualiza la sesión.
   * Si el servidor responde 401, api.js limpia la sesión y vuelve al login.
   */
  async refresh() {
    const s = session.get();
    if (!s || !s.token) return null;
    try {
      const u = await authMe();
      session.set({ ...s, userId: u.id, email: u.email, name: u.name, role: u.role, permissions: u.permissions || [] });
      return session.get();
    } catch {
      return s;
    }
  },

  role() {
    return this.current()?.role ?? null;
  },

  /** ¿Tiene el permiso? (el administrador siempre puede; el servidor es quien manda). */
  can(permission) {
    const s = this.current();
    if (!s) return false;
    if (s.role === "admin") return true;
    return (s.permissions || []).includes(permission);
  },
};

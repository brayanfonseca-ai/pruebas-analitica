// auth-service.js — autenticación y autorización (demo local).
// Valida contra la lista de usuarios de store.users y emite una sesión con rol.
// En un backend real: POST /api/v1/auth/login -> JWT con claims de rol; la autz
// verdadera vive en el backend (guards). Aquí solo proyectamos permisos en la UI.

import { session, users, ROLES } from "./store.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TTL_MS = 1000 * 60 * 60 * 8; // 8 horas
const SEED_ADMIN_EMAIL = "admin@datasense.io";

// Matriz de permisos por rol (lo que la UI habilita/oculta).
const PERMISSIONS = {
  admin: ["dashboard:view", "charts:edit", "data:import", "users:manage"],
  editor: ["dashboard:view", "charts:edit", "data:import"],
  viewer: ["dashboard:view"],
};

function fakeToken(email) {
  return btoa(`${email}:${Date.now()}:${Math.random().toString(36).slice(2)}`);
}

// Migra/cura sesiones de versiones viejas que se guardaron SIN rol (rol UNDEFINED).
// Re-deriva el rol del usuario guardado; si tampoco lo tiene, aplica respaldo
// (el admin sembrado o el único usuario -> admin) y reescribe sesión y usuario.
// Devuelve la sesión (posiblemente actualizada) o null.
function healSession() {
  const s = session.get();
  if (!s || !s.email) return s;

  // Repara una sesión sin exp (versiones viejas) dándole una nueva caducidad,
  // para que isValid() no rechace una sesión por lo demás válida.
  if (!s.exp) {
    s.exp = Date.now() + TTL_MS;
    session.set(s);
  }

  if (ROLES.includes(s.role)) return s; // ya tiene rol válido

  const list = users.all();
  let user = users.findByEmail(s.email);
  let role = user && ROLES.includes(user.role) ? user.role : null;

  if (!role) {
    // Respaldo: admin sembrado, o si solo hay un usuario, es admin.
    if (s.email === SEED_ADMIN_EMAIL || list.length === 1) role = "admin";
    else role = "viewer";

    // Persistir el rol en el usuario (si existe) para que sea consistente.
    if (user && !ROLES.includes(user.role)) {
      users.updateRole(user.id, role);
    }
  }

  const healed = { ...s, role, userId: s.userId ?? user?.id };
  session.set(healed);
  return healed;
}

export const authService = {
  login(email, password) {
    email = (email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return { ok: false, error: "Ingresa un correo válido." };
    }
    const user = users.findByEmail(email);
    if (!user || user.password !== password) {
      return { ok: false, error: "Correo o contraseña incorrectos." };
    }
    session.set({
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      token: fakeToken(user.email),
      exp: Date.now() + TTL_MS,
    });
    return { ok: true };
  },

  logout() {
    session.clear();
  },

  current() {
    return healSession();
  },

  isAuthenticated() {
    healSession(); // repara exp/rol ANTES de validar, para no rechazar sesiones viejas
    if (!session.isValid()) return false;
    return true;
  },

  role() {
    return this.current()?.role ?? null;
  },

  can(permission) {
    const r = this.role();
    if (!r) return false;
    if (r === "admin") return true; // admin: permisos absolutos, siempre todo
    return (PERMISSIONS[r] || []).includes(permission);
  },
};

export { PERMISSIONS };

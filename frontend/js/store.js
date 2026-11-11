// store.js — capa de estado/persistencia del CLIENTE (localStorage).
// Tras FEAT-002/003 el backend (motor Python + SQLite) es la ÚNICA fuente de
// verdad de los DATOS de la aplicación (apps, tablas, asociaciones, modelo,
// gráficas). Aquí SOLO se conservan preocupaciones de cliente:
//   - session  (sesión del usuario, consumida por auth-service.js)
//   - theme    (preferencia día/noche)
//   - prefs    (preferencias de UI)
//
// Los antiguos slices datasets/dashboards/loadscript y su "seed" de datos demo
// fueron ELIMINADOS: duplicaban el trabajo del backend. Namespacing bajo "ds.*".

const K = {
  session: "ds.session",
  theme: "ds.theme",
  defaultChartColor: "ds.defaultChartColor",
};

function read(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "null");
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}
function uid(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/* ----------------------- Sesión ----------------------- */
export const session = {
  get() {
    return read(K.session, null);
  },
  set(value) {
    write(K.session, value);
  },
  clear() {
    localStorage.removeItem(K.session);
  },
  isValid() {
    const s = this.get();
    return !!(s && s.token && s.email && s.exp && Date.now() < s.exp);
  },
};

/* ----------------------- Roles ----------------------- */
// Los usuarios, contraseñas y permisos viven en el backend (Configuración → Usuarios).
export const ROLES = ["admin", "editor", "viewer"];

/* ----------------------- Tema (día / noche) ----------------------- */
export const theme = {
  get() {
    const t = localStorage.getItem(K.theme);
    return t === "dark" ? "dark" : "light";
  },
  set(value) {
    localStorage.setItem(K.theme, value === "dark" ? "dark" : "light");
  },
  toggle() {
    const next = this.get() === "dark" ? "light" : "dark";
    this.set(next);
    return next;
  },
};

/* ----------------------- Preferencias de UI ----------------------- */
export const prefs = {
  defaultChartColor() {
    return localStorage.getItem(K.defaultChartColor) || "#172983";
  },
  setDefaultChartColor(color) {
    localStorage.setItem(K.defaultChartColor, color || "#172983");
  },
};

export { uid };

// store.js — capa de estado/persistencia del CLIENTE (localStorage).
// Tras FEAT-002/003 el backend (motor Python + SQLite) es la ÚNICA fuente de
// verdad de los DATOS de la aplicación (apps, tablas, asociaciones, modelo,
// gráficas). Aquí SOLO se conservan preocupaciones de cliente:
//   - session  (sesión del usuario, consumida por auth-service.js)
//   - users    (usuarios demo + roles, consumidos por auth-service.js)
//   - theme    (preferencia día/noche)
//   - prefs    (preferencias de UI)
//
// Los antiguos slices datasets/dashboards/loadscript y su "seed" de datos demo
// fueron ELIMINADOS: duplicaban el trabajo del backend. Namespacing bajo "ds.*".

const K = {
  session: "ds.session",
  users: "ds.users",
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

/* ----------------------- Usuarios y roles ----------------------- */
export const ROLES = ["admin", "editor", "viewer"];

// Siembra usuarios de prueba (uno por rol) la primera vez.
// Demo: contraseñas en claro SOLO para la maqueta local. Nunca en producción.
// NOTA DE SEGURIDAD: la autenticación aquí es de CLIENTE y NO es seguridad real;
// en un despliegue real la autz la impondría el backend (motor Python).
function seedUsers() {
  const now = Date.now();
  const seeded = [
    { id: uid("usr"), email: "admin@datasense.io", name: "Admin", role: "admin", password: "admin123", createdAt: now },
    { id: uid("usr"), email: "editor@datasense.io", name: "Editor", role: "editor", password: "editor123", createdAt: now },
    { id: uid("usr"), email: "viewer@datasense.io", name: "Viewer", role: "viewer", password: "viewer123", createdAt: now },
  ];
  write(K.users, seeded);
  return seeded;
}

export const users = {
  all() {
    const list = read(K.users, null);
    if (!list || !Array.isArray(list) || list.length === 0) {
      return seedUsers();
    }
    return list;
  },
  findByEmail(email) {
    email = (email || "").trim().toLowerCase();
    return this.all().find((u) => u.email === email) || null;
  },
  create({ email, name, role, password }) {
    email = (email || "").trim().toLowerCase();
    const list = this.all();
    if (list.some((u) => u.email === email)) {
      return { ok: false, error: "Ya existe un usuario con ese correo." };
    }
    if (!ROLES.includes(role)) {
      return { ok: false, error: "Rol inválido." };
    }
    const user = {
      id: uid("usr"),
      email,
      name: name?.trim() || email.split("@")[0],
      role,
      password,
      createdAt: Date.now(),
    };
    list.push(user);
    write(K.users, list);
    return { ok: true, user };
  },
  updateRole(id, role) {
    if (!ROLES.includes(role)) return { ok: false, error: "Rol inválido." };
    const list = this.all();
    const u = list.find((x) => x.id === id);
    if (!u) return { ok: false, error: "Usuario no encontrado." };
    u.role = role;
    write(K.users, list);
    return { ok: true };
  },
  remove(id) {
    let list = this.all();
    const target = list.find((u) => u.id === id);
    if (!target) return { ok: false, error: "Usuario no encontrado." };
    const admins = list.filter((u) => u.role === "admin");
    if (target.role === "admin" && admins.length <= 1) {
      return { ok: false, error: "No puedes eliminar el último administrador." };
    }
    list = list.filter((u) => u.id !== id);
    write(K.users, list);
    return { ok: true };
  },
};

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

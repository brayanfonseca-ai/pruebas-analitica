# Módulo: Login y Hub (Inicio / Catálogo / Crear)

El punto de entrada y la navegación general antes de abrir una app.

## A nivel de usuario
- **Login** (`index.html`): pantalla de inicio de sesión con diseño moderno (panel visual + formulario), "Recordarme", mostrar/ocultar contraseña. **No muestra credenciales demo** a la vista. Credenciales de prueba: `admin@datasense.io` / `admin123`.
- **Inicio** (`inicio.html`): página de bienvenida con accesos a lo usado recientemente y apps para explorar.
- **Catálogo** (`catalogo.html`): lista todas las apps; desde aquí abres una (va a `app.html?app=<id>`).
- **Crear** (`crear.html`): tarjetas para crear Aplicación, Conexión de datos, etc., al estilo del Activity Center de Qlik.
- **Menú de perfil** (avatar arriba a la derecha): Ir al catálogo, Cerrar sesión, rol del usuario.

## A nivel visual
- Paleta de marca **azul empresarial `#172983`** (acento), oscuro `#101d5e` para hovers, fondos claros `#e8ebf7`.
- Barra superior común (`q-topbar`): botón de apps, logo, buscador, iconos, avatar.
- Estilos en `css/hub.css`. El menú de perfil (`.q-prof-*`) es compartido por todas las páginas del hub vía `js/hub-nav.js` (`renderProfileMenu`).

## A nivel de desarrollo
- **Sesión**: `js/auth-service.js` + `js/store.js`. La sesión vive en `localStorage["ds.session"]` con `{userId,email,name,role,token,exp}`. `isAuthenticated()` valida y "sana" sesiones viejas.
- **Guard**: cada página del hub y `app.js` hacen `if (!authService.isAuthenticated()) location.replace("index.html")`.
- **Navegación compartida**: `js/hub-nav.js` expone `renderNav`, `wireAppsButton`, `renderProfileMenu`, `svg`. Lo usan `inicio.js`, `hub.js`, `crear.js`, `catalogo.js`.
- **Roles/permisos**: `admin`, `editor`, `viewer`. `authService.can(permiso)` habilita/oculta acciones (p.ej. `charts:edit`, `data:import`).

## Archivos
`index.html`, `inicio.html`, `hub.html`, `catalogo.html`, `crear.html`,
`js/auth.js`, `js/auth-service.js`, `js/store.js`, `js/hub-nav.js`,
`js/inicio.js`, `js/hub.js`, `js/catalogo.js`, `js/crear.js`, `css/hub.css`.

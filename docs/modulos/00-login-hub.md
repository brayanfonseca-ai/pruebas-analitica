# Módulo: Login y Hub (Inicio / Catálogo / Crear)

El punto de entrada y la navegación general antes de abrir una app.

## A nivel de usuario
- **Login** (`frontend/pages/index.html`): pantalla de inicio de sesión con diseño moderno (panel visual + formulario), "Recordarme", mostrar/ocultar contraseña. **No muestra credenciales demo** a la vista. Credenciales de prueba: `admin@datasense.io` / `admin123`.
- **Inicio** (`frontend/pages/inicio.html`): página de bienvenida con accesos a lo usado recientemente y apps para explorar.
- **Catálogo** (`frontend/pages/catalogo.html`): lista todas las apps; desde aquí abres una (va a `pages/app.html?app=<id>`).
- **Crear** (`frontend/pages/crear.html`): tarjetas para crear Aplicación, Conexión de datos, etc., al estilo del Activity Center de Qlik.
- **Menú de perfil** (avatar arriba a la derecha): Ir al catálogo, Mi cuenta, Cerrar sesión, rol del usuario.
- **Depuración**: se retiraron las pantallas de relleno sin funcionalidad (Páginas, Alimentar, Favoritos, Mercado de datos, Productos de datos, Calidad de los datos, Asistentes, Automatizaciones, Alertas, Suscripciones, Información y Preparar datos) y las vistas «Próximamente» dentro de las apps.

## A nivel visual
- Paleta de marca **azul empresarial `#172983`** (acento), oscuro `#101d5e` para hovers, fondos claros `#e8ebf7`.
- Barra superior común (`q-topbar`): botón de apps, logo, buscador, iconos, avatar.
- Estilos en `frontend/css/hub.css`. El menú de perfil (`.q-prof-*`) es compartido por todas las páginas del hub vía `frontend/js/hub-nav.js` (`renderProfileMenu`).

## A nivel de desarrollo
- **Sesión**: el login llama a `POST /api/v1/auth/login` (contraseña verificada en el servidor) y guarda en `localStorage["ds.session"]` `{token,exp,userId,email,name,role,permissions}`. Cada petición lleva `Authorization: Bearer` (`js/api.js`); ante 401 se vuelve al login.
- **Guard**: cada página del hub y `app.js` hacen `if (!authService.isAuthenticated()) location.replace("index.html")`; el servidor vuelve a validar todo.
- **Navegación compartida**: `frontend/js/hub-nav.js` expone `renderNav`, `wireAppsButton`, `renderProfileMenu`, `svg`. El menú se depuró a: Inicio, Crear, Colecciones, Catálogo, Analizar, Experimentos de ML, Temas y **Configuración** (al pie); cada opción puede exigir un permiso (`perm`).
- **Roles/permisos y etapas**: ver [12 · Configuración, usuarios, permisos y etapas](./12-configuracion-seguridad.md). `authService.can(permiso)` oculta lo que no se puede usar.

## Archivos
`frontend/pages/index.html`, `frontend/pages/inicio.html`, `frontend/pages/hub.html`, `frontend/pages/catalogo.html`, `frontend/pages/crear.html`,
`frontend/js/auth.js`, `frontend/js/auth-service.js`, `frontend/js/store.js`, `frontend/js/hub-nav.js`,
`frontend/js/inicio.js`, `frontend/js/hub.js`, `frontend/js/catalogo.js`, `frontend/js/crear.js`, `frontend/css/hub.css`.

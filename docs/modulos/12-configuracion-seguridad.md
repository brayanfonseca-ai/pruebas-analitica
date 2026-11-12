# 12 · Configuración, usuarios, permisos y etapas

Seguridad real de DataSense: usuarios con contraseña, roles, permisos por persona y **etapas** de las
aplicaciones (Personal · Desarrollo · Producción) con publicación de hojas. Todo lo aplica el **servidor**
en cada petición a `/api/v1/**`; la interfaz solo oculta lo que no se puede usar.

## A nivel de usuario

### Dónde está
Menú lateral → **Configuración** (al pie, solo administradores) → `pages/configuracion.html`. Cualquier
usuario llega a **Mi cuenta** desde el menú de su perfil (avatar).

### Pestañas
- **Usuarios**: crear, editar, activar/desactivar, restablecer contraseña y eliminar. Cada persona tiene un
  **rol** y, además, permisos sueltos: se parte de los del rol y se marca o desmarca (queda como «extra» o
  «quitado»). Buscador y filtro por rol.
- **Roles y permisos**: matriz de lo que puede hacer cada rol.
- **Etapas y publicación**: etapa y dueño de cada aplicación, y qué hojas están publicadas (se pueden
  publicar o devolver a borrador desde aquí).
- **Mi cuenta**: perfil, permisos efectivos y cambio de contraseña.

### Roles y permisos

| Permiso | Administrador | Desarrollador (`editor`) | Visualizador (`viewer`) |
|---|:-:|:-:|:-:|
| `dashboard:view` Ver tableros publicados | ✓ | ✓ | ✓ |
| `ai:use` Usar el asistente de IA | ✓ | ✓ | |
| `apps:create` Crear aplicaciones | ✓ | ✓ | |
| `charts:edit` Editar tableros | ✓ | ✓ | |
| `data:import` Cargar y preparar datos | ✓ | ✓ | |
| `connections:manage` Gestionar conexiones | ✓ | ✓ | |
| `ml:run` Experimentos de ML | ✓ | ✓ | |
| `apps:delete` Eliminar aplicaciones | ✓ | | |
| `apps:publish` Publicar (Producción y hojas) | ✓ | ✓ | |
| `users:manage` Administrar usuarios | ✓ | | |
| `embed:manage` Gestionar embedding (tokens para incrustar tableros) | ✓ | | |

Son **11 permisos**. Las conexiones son privadas por usuario (ni el administrador ve las ajenas): ver [07](./07-conexiones.md). Las notas para agente exigen `charts:edit` ([13](./13-notas-agente.md)) y el módulo Embedding `embed:manage` ([14](./14-embedding.md)).

El administrador no se puede restringir. Cualquier permiso se puede conceder o quitar a una persona concreta
sin cambiarle el rol.

### Etapas de una aplicación

| Etapa | Quién la ve | Para qué |
|---|---|---|
| **Personal** | Solo su dueño (y el admin) | Toda app nueva nace aquí |
| **Desarrollo** | El equipo técnico (quien puede editar o cargar datos) | Construir y probar |
| **Producción** | Todos con `dashboard:view`; el **visualizador solo ve las hojas publicadas** | Publicada |

**Regla de oro**: un visualizador ve un tablero únicamente si la app está en *Producción* **y** la hoja está
*publicada*. En otra etapa, o con la hoja en borrador, no ve nada (la API responde como si no existiera).
Pasar a/salir de Producción y publicar hojas exige `apps:publish`; modificar una app ya en Producción también.
La etapa se cambia en la miga de la barra superior de la app, en el Catálogo/Analizar (se filtra por etapa) o
en Configuración → Etapas; las hojas, en el menú «···» → *Publicar hoja*.
El desarrollador también puede publicar. Para no hacerlo hoja por hoja, cada tarjeta de aplicación (Inicio, Catálogo, Analizar) tiene un menú «⋯» con **Publicar (app y todas sus hojas)**, accesos al Gestor de datos, Editor de carga, Modelo lógico, Informes, Notas para agente, nuevo experimento de ML, Conexiones y Embedding (cada opción solo aparece si hay permiso). Código: `frontend/js/app-menu.js`.

### Protecciones
- Contraseñas de 8+ caracteres, guardadas con PBKDF2-HMAC-SHA256 y sal aleatoria (nunca en claro).
- Siempre queda al menos un administrador activo; nadie se borra ni se desactiva a sí mismo.
- Cambiar rol, permisos o contraseña de alguien, o desactivarlo, **cierra sus sesiones**.
- 5 intentos fallidos en 15 minutos bloquean el correo temporalmente (HTTP 429).
- Al borrar a un usuario, sus aplicaciones pasan a quien lo elimina.
- Las apps que ya existían antes de esta función quedaron en *Desarrollo* a nombre del administrador: nadie con
  rol visualizador las verá hasta que se publiquen.

## A nivel de desarrollo

**Backend** (`io.datasense.auth` + `web`):

| Clase | Rol |
|---|---|
| `Permissions` | Catálogo de roles/permisos/etapas y `required(método, ruta)`: permiso que exige cada endpoint. |
| `AuthInterceptor` | Guarda de `/api/v1/**`: Bearer → usuario, permiso de la ruta, visibilidad y escritura de la app. 401/403/404 con `{detail}`. |
| `AccessService` | Reglas por etapa (`canSee`, `canWrite`, `visibleApps`, `visibleSheets`). |
| `AuthService` | Login (token de 256 bits; en BD solo su SHA-256), validación, logout, revocación y bloqueo por intentos. |
| `PasswordHasher`, `UserRepository`, `UserRecord`, `AuthBootstrap` | Hash, acceso a `users`, DTO, siembra de cuentas demo y asignación de dueño. |
| `AuthController` | `POST /auth/login` (público), `GET /auth/me`, `POST /auth/logout`, `PUT /auth/password`, `GET /auth/catalog`. |
| `UserController` | CRUD `/users` y `PUT /users/{id}/password`. |
| `AppController` | Lista filtrada por etapa y `PUT /apps/{id}/stage` {stage, owner_id?}. |
| `SheetController` | Un visualizador solo recibe hojas con `visibility = publica`. |

Tablas nuevas: `users`, `sessions`; en `apps`: `owner_id` y `stage`. `AppOut` ahora incluye
`stage, owner_id, owner_name, sheets, published`.

**Frontend**: `js/auth-service.js` (sesión con token y permisos efectivos; `refresh()` los actualiza),
`js/api.js` (`Authorization: Bearer`; ante 401 limpia la sesión y vuelve al login), `js/configuracion.js` +
`pages/configuracion.html`, estilos `.cfg-*` y `.ds-stage*` en `css/theme.css`. El menú oculta lo que exige un
permiso que no se tiene (`NAV[].perm`) y `app.js` hace lo mismo con las vistas (`VIEW_GROUPS[].perm`).

**MCP** (paridad): `get_current_user`, `get_security_catalog`, `list_users`, `create_user`, `update_user`,
`reset_user_password`, `delete_user`, `set_app_stage` y `set_sheet_visibility` (publicar). El MCP inicia
sesión con `DATASENSE_USER` / `DATASENSE_PASSWORD` (por defecto la cuenta admin de demostración): si cambias
esa contraseña, actualiza las variables en `mcp.json`.

## Limitaciones honestas
- Es seguridad de aplicación para uso local/equipo: no hay HTTPS, recuperación por correo ni doble factor.
- Los experimentos de ML se filtran por permiso (`ml:run`), no por la etapa de su app.
- Las notificaciones y la Configuración son para administradores.


## Permisos de cada rol, editables por el administrador

En **Configuración → Roles y permisos** la matriz es editable: el administrador marca o desmarca qué puede hacer el **Desarrollador** y el **Visualizador** (por ejemplo, quitarle o darle *Publicar*) y pulsa **Guardar**. Se aplica al instante a todas las personas con ese rol; **Restablecer** vuelve a los permisos de fábrica. Reglas: el Administrador siempre tiene todo y no se edita; todo rol conserva `dashboard:view`. Los permisos sueltos por usuario (Usuarios → editar) siguen aplicándose encima del rol.

- Tabla `role_permissions (role, permissions)`; `Permissions.setRoleOverride/roleDefaults` aplican lo guardado.
- API (`users:manage`): `PUT /api/v1/users/roles/{role}` `{permissions:[…]}` y `DELETE /api/v1/users/roles/{role}`; `GET /auth/catalog` devuelve por rol `permissions` (vigentes), `factory`, `customized` y `editable`.
- MCP: `set_role_permissions`, `reset_role_permissions`.

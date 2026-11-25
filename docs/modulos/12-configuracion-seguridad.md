# 12 · Configuración, usuarios, permisos y etapas

Seguridad real de PROTHEO: usuarios con contraseña, roles, permisos por persona y **etapas** de las
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

### Permisos detallados (modelo empresarial)

Cada permiso es **una acción en un módulo**, con su tipo (Ver, Crear, Editar, Eliminar, Publicar, Ejecutar, Exportar, Administrar) y su **nivel de riesgo** (bajo, medio, alto). Son **42 permisos en 14 módulos**:

| Módulo | Permisos (id) | Admin | Desarrollador | Visualizador |
|---|---|:-:|:-:|:-:|
| Aplicaciones | `apps:view` ver · `apps:create` crear · `apps:edit` editar · `apps:delete` eliminar (alto) · `apps:publish` publicar (alto) | todos | todos menos eliminar | ver |
| Hojas y tableros | `sheets:create` · `sheets:edit` · `sheets:delete` · `sheets:publish` (alto) | todos | todos | — |
| Datos | `data:upload` · `data:script` · `data:reload` · `data:model` · `data:schedule` | todos | todos | — |
| Capa de negocio | `business:edit` · `business:certify` (alto) · `notes:edit` | todos | todos | — |
| Análisis | `analysis:ask` · `analysis:insights` · `analysis:notebooks` · `notebooks:edit` · `comments:write` | todos | todos | todos menos guardar cuadernos |
| Informes | `reports:view` · `reports:export` (PDF) | todos | todos | ver |
| Asistente de IA | `ai:chat` · `ai:expressions` | todos | todos | — |
| Agentes y conocimiento | `agents:use` · `agents:build` · `knowledge:use` | todos | todos | — |
| Machine Learning | `ml:view` · `ml:train` · `ml:associate` | todos | todos | — |
| Automatizaciones | `flows:view` · `flows:edit` · `flows:run` | todos | todos | — |
| Alertas y vigilancia | `alerts:manage` | ✓ | ✓ | ✓ |
| Conexiones | `connections:use` · `connections:share` (alto) | todos | todos | — |
| Embedding | `embed:manage` (alto) | ✓ | — | — |
| Administración | `users:manage` · `roles:manage` · `audit:view` | todos | — | — |

El servidor exige el permiso exacto de cada acción: por ejemplo, borrar una hoja pide `sheets:delete`, ejecutar «Cargar datos» pide `data:reload`, certificar una métrica `business:certify`, compartir una conexión `connections:share`, ejecutar una automatización a mano `flows:run` y guardar un cuaderno `notebooks:edit`. La exportación a PDF (`reports:export`) la controla la interfaz; los datos que lee el informe ya los controla el servidor.

**Compatibilidad**: los 11 permisos anteriores (`dashboard:view`, `charts:edit`, `data:import`, `ai:use`, `ml:run`, `connections:manage`, `apps:publish`, `users:manage`…) siguen funcionando. Una persona «tiene» un permiso antiguo si tiene su permiso **ancla** (p. ej. `charts:edit` ⇐ `sheets:edit`, `data:import` ⇐ `data:reload`, `dashboard:view` ⇐ `apps:view`). Si un rol o una excepción guardados antes usaban un permiso antiguo, se **expande** a los detallados que cubría. Así nada de lo anterior se rompe.

### Roles personalizados
Además de Administrador, Desarrollador y Visualizador, el administrador crea roles para cada puesto («Analista financiero», «Auditor», «Coordinador regional»…): **desde cero o copiando** otro, con nombre y descripción. Se renombran y se borran; si alguien tiene el rol, al borrarlo se elige a qué rol pasan esas personas. Todo rol debe incluir `apps:view`.

### Excepciones por persona (tres estados)
En **Usuarios → editar**, cada permiso tiene tres estados: **Rol** (hereda lo que diga el rol), **Conceder** (lo tiene aunque el rol no lo dé) y **Denegar** (no lo tiene aunque el rol lo dé). Solo se guardan las excepciones: si cambian los permisos del rol, la persona los recibe. El botón 👁 muestra los **permisos efectivos** de alguien y el **origen** de cada uno (del rol, concedido, denegado o sin acceso).

### Matriz de permisos y auditoría
- **Matriz**: filas = permisos agrupados por módulo, columnas = roles. Buscador, filtros por módulo y riesgo, «solo donde los roles difieren», interruptor por módulo y rol («dar / quitar todo el módulo»), resaltado de la columna elegida. Los cambios quedan en borrador con una barra «+N / −N · afecta a X personas» hasta **Guardar cambios** o **Descartar**.
- **Auditoría** (`audit:view`): quién cambió qué y cuándo. Cubre crear, borrar, activar o desactivar cuentas; cambios de rol; excepciones; restablecer contraseñas; y crear, renombrar, cambiar, restablecer o borrar roles. Muestra el detalle de permisos añadidos y quitados. Solo se agrega, nunca se edita.
- **Separación de funciones**: `users:manage` administra cuentas; cambiar el rol o las excepciones de alguien exige además `roles:manage`, y **solo un administrador puede dar el rol Administrador** (nadie se escala a sí mismo). Las conexiones son privadas por usuario (ni el administrador ve las ajenas): ver [07](./07-conexiones.md). Las notas para agente exigen `charts:edit` ([13](./13-notas-agente.md)) y el módulo Embedding `embed:manage` ([14](./14-embedding.md)). Las **Automatizaciones** (`/flows/**`) exigen `charts:edit`, corren con los permisos de quien las creó y sus credenciales son privadas. Su webhook `/api/v1/hooks/flows/{token}` es **público**: `AuthInterceptor` lo exime y se autentica solo con el token (regenerarlo invalida el anterior) ([18](./18-automatizaciones.md)).

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
- La Configuración es para administradores. La campana la tiene todo usuario: cada uno ve sus alertas y cargas programadas, y solo el administrador ve además la actividad de la plataforma (ver [16](./16-automatizar.md)).
- Alertas: las crea cualquiera que vea la app; editar o borrar una ajena exige `apps:publish`. Programar la carga exige `data:import` y corre con los permisos de quien la guardó.


## Permisos de cada rol, editables por el administrador

En **Configuración → Roles y permisos** la matriz es editable: el administrador marca o desmarca qué puede hacer el **Desarrollador** y el **Visualizador** (por ejemplo, quitarle o darle *Publicar*) y pulsa **Guardar**. Se aplica al instante a todas las personas con ese rol; **Restablecer** vuelve a los permisos de fábrica. Reglas: el Administrador siempre tiene todo y no se edita; todo rol conserva `dashboard:view`. Los permisos sueltos por usuario (Usuarios → editar) siguen aplicándose encima del rol.

- Tablas `role_permissions (role, permissions)`, `custom_roles (id, label, description, permissions, …)` y `security_audit`. `Permissions.setRoleOverride/putCustomRole/roleDefaults/expand/effective/explain` aplican lo guardado; `Permissions.required(método, ruta)` devuelve el permiso detallado y `modifiesApp` decide si además hace falta poder escribir en la app según su etapa.
- API (`roles:manage` para escribir): `POST /api/v1/users/roles` {label, description?, copy_from?, permissions?}, `PUT /api/v1/users/roles/{role}` {permissions?, label?, description?}, `DELETE /api/v1/users/roles/{role}[?reassign_to=]`; `GET /api/v1/users/{id}/effective` (`users:manage`); `GET /api/v1/users/audit?limit=&target_type=&target_id=` (`audit:view`). `GET /auth/catalog` devuelve `roles` (con `custom`, `customized`, `factory`), `permissions` (con `module`, `action`, `risk`), `modules`, `actions`, `legacy` y `stages`.
- MCP: `get_security_catalog`, `set_role_permissions`, `reset_role_permissions`, `create_role`, `update_role`, `delete_role` (ACCIÓN DESTRUCTIVA), `get_effective_permissions`, `list_security_audit`; `create_user`/`update_user` aceptan roles personalizados y permisos detallados.
- Frontend: `js/configuracion.js` (pestañas Usuarios · Roles · Matriz de permisos · Auditoría · Etapas · Mi cuenta), estilos `.pm-*` en `css/theme.css` (sección «Permisos empresariales»).

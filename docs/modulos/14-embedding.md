# 14 · Embedding

## A nivel de usuario
Muestra una hoja de DataSense dentro de otra página web (portal de clientes, intranet…). Cada **embed** tiene un **ID** y un **token** (`dse_…`) de solo lectura que da acceso a **una hoja**.

- **Requisitos**: la app debe estar en **Producción** y la hoja **publicada** (la misma regla que ve un visualizador). Si no, el estado es *Sin publicar*; el botón **Publicar app y hoja** lo resuelve (requiere `apps:publish`).
- **Estados**: Activo, Desactivado, Vencido, Sin publicar.
- **Controles**: sitios permitidos (orígenes), vencimiento (7/30/90/365 días o nunca), tema (automático/claro/oscuro), ocultar título y barra de selecciones, **rotar token** (el anterior deja de servir al instante), desactivar y eliminar.
- **Tres formas de usarlo** (el detalle del embed trae el código listo para copiar):
  1. `<iframe src="https://SERVIDOR/embed/TOKEN">`.
  2. SDK: `<script src="https://SERVIDOR/js/embed-sdk.js">` + `DataSense.embed({container, token, height, theme, onReady, onError})`; `setTheme()` y `destroy()`.
  3. API REST con `Authorization: Bearer TOKEN` (`GET /api/v1/apps/{appId}/sheets` devuelve la hoja en JSON).
- Requiere el permiso `embed:manage` (solo administrador por defecto).

## A nivel visual
`frontend/pages/embedding.html`: tabla con estado, vistas, último uso y vencimiento; asistente «Nuevo embed» con aviso si falta publicar; detalle con pestañas **Código**, **Ajustes** y **Vista previa** en vivo. La página pública `frontend/pages/embed.html` muestra solo el tablero (sin menú, sin asistente, sin edición).

## A nivel de desarrollo
- Tabla `embeds` (id, app, hoja, token, enabled, allowed_origins, expires_at, options_json, views, last_used_at).
- `GET /embed/{token}` (`EmbedPageController`, fuera de `/api/v1`): inyecta `window.__DS_EMBED`, fija `Content-Security-Policy: frame-ancestors` con los orígenes permitidos (o `*`) y rechaza con 403 un `Origin/Referer` no autorizado.
- `AuthInterceptor`: un Bearer `dse_…` se autentica con `EmbedService` y actúa como **visualizador de solo lectura limitado a su app** (no lista apps, no ve `/auth`, `/users`, `/embeds`, conexiones ni notas; no escribe). `SheetController.list` devuelve solo su hoja. Lectura de `GET /ml/experiments/{id}[/runs/{runId}]` permitida para gráficos de ML de esa app.
- `js/embed.js` reutiliza `app-hoja.js` en modo solo lectura (`ctx.embed`); `api.js` usa siempre el token del embed y no redirige al login en 401. `js/embed-sdk.js` es el SDK público.
- API (`embed:manage`): `GET/POST /embeds`, `PUT/DELETE /embeds/{id}`, `POST /embeds/{id}/rotate`.
- MCP: `list_embeds`, `create_embed`, `update_embed`, `rotate_embed_token`, `delete_embed`.
- **Seguridad**: el token es una credencial de lectura; se guarda en claro para poder copiarlo de nuevo y se puede rotar. Los orígenes permitidos se aplican con CSP en el navegador; fuera de él, el token por sí solo da acceso a la hoja.

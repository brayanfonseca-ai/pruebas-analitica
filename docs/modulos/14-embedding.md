# 14 · Embedding

## A nivel de usuario
Muestra una o **varias hojas** de una app de DataSense dentro de otra página web (portal de clientes, intranet…). Cada **embed** tiene un **ID** y un **token** (`dse_…`) de solo lectura que da acceso a las hojas elegidas.

- **Varias hojas**: al crear o en **Ajustes** se marcan las hojas con casillas (**Todas**, **Ninguna**, **Solo publicadas**; cada una indica si está publicada). Con más de una, el tablero incrustado muestra **pestañas** arriba, en el orden elegido. Al cambiar de pestaña **se conservan los filtros**. Hasta 20 hojas.
- **Requisitos**: la app debe estar en **Producción**. De sus hojas se muestran las **publicadas**: si alguna elegida no lo está, no aparece (el detalle lo avisa); si no hay ninguna publicada, el estado es *Sin publicar*. El botón **Publicar app y hojas** lo resuelve (requiere `apps:publish`).
- **Estados**: Activo, Desactivado, Vencido, Sin publicar.
- **Controles**:
  - sitios permitidos (orígenes);
  - vencimiento (7/30/90/365 días o nunca);
  - tema (automático/claro/oscuro);
  - ocultar el título, la barra de filtros o las **pestañas de hojas**;
  - **rotar token** (el anterior deja de servir al instante);
  - desactivar y eliminar.
  - Cambiar las hojas no cambia el token: el código ya pegado en el sitio sigue sirviendo.
- **Tres formas de usarlo** (el detalle del embed trae el código listo para copiar):
  1. `<iframe src="https://SERVIDOR/embed/TOKEN">`.
  2. SDK: `<script src="https://SERVIDOR/js/embed-sdk.js">` + `DataSense.embed({container, token, height, theme, onReady, onSheetChange, onError})`; `setTheme()`, `setSheet(id)` (abrir otra de sus hojas desde tu página) y `destroy()`.
  3. API REST con `Authorization: Bearer TOKEN` (`GET /api/v1/apps/{appId}/sheets` devuelve sus hojas publicadas en JSON, en el orden del embed).
- Requiere el permiso `embed:manage` (solo administrador por defecto).

## A nivel visual
`frontend/pages/embedding.html`: tabla con estado, hojas («3 hojas · …»), vistas, último uso y vencimiento; asistente «Nuevo embed» con selector de varias hojas y aviso de las que falta publicar; detalle con pestañas **Código** (ID de cada hoja), **Ajustes** y **Vista previa** en vivo. La página pública `frontend/pages/embed.html` muestra solo el tablero y, con varias hojas, sus pestañas.

## A nivel de desarrollo
- Tabla `embeds` (id, app, `sheet_id` = primera hoja, `sheet_ids` = todas separadas por coma en orden, token, enabled, allowed_origins, expires_at, options_json, views, last_used_at). Los embeds anteriores (sin `sheet_ids`) siguen funcionando con su única hoja.
- API: `POST /embeds` acepta `sheet_ids: [..]` (o `sheet_id`); `PUT /embeds/{id}` acepta `sheet_ids` (reemplaza). Se validan: al menos una, todas de la app, sin repetidas, máx. 20. La respuesta trae `sheet_ids` y `sheets: [{id, title, published}]`. Opciones: `theme`, `hideTitle`, `hideSelections`, `hideTabs`.
- `EmbedService.publishedSheets(e)`: hojas del embed que existen, son de su app y están publicadas; el estado es `unpublished` si la app no está en Producción o la lista queda vacía.
- `GET /embed/{token}` (`EmbedPageController`, fuera de `/api/v1`): inyecta `window.__DS_EMBED` con `sheetId` y `sheetIds` (solo publicadas), fija `Content-Security-Policy: frame-ancestors` con los orígenes permitidos (o `*`) y rechaza con 403 un `Origin/Referer` no autorizado.
- `AuthInterceptor`: un Bearer `dse_…` se autentica con `EmbedService` y actúa como **visualizador de solo lectura limitado a su app** (no lista apps, no ve `/auth`, `/users`, `/embeds`, conexiones ni notas; no escribe). `SheetController.list` devuelve solo sus hojas (publicadas), en el orden del embed. Lectura de `GET /ml/experiments/{id}[/runs/{runId}]` permitida para gráficos de ML de esa app.
- `js/embed.js` reutiliza `app-hoja.js` en modo solo lectura (`ctx.embed`). Con `ctx.onSheets` recibe la lista y una función para abrir otra hoja sin recargar (los filtros viven fuera de la hoja), y con `ctx.onSheetChange` marca la pestaña activa. Mensajes con la página que incrusta: `ds-embed:ready {sheetId, sheetIds}`, `ds-embed:sheetchange {sheetId}`, `ds-embed:sheet {sheetId}` (entrante). `api.js` usa siempre el token del embed y no redirige al login en 401. `js/embed-sdk.js` es el SDK público.
- MCP: `list_embeds`, `create_embed` (`sheetIds` o `sheetId`), `update_embed` (`sheetIds`), `rotate_embed_token`, `delete_embed`.
- **Seguridad**: el token es una credencial de lectura; se guarda en claro para poder copiarlo de nuevo y se puede rotar. Los orígenes permitidos se aplican con CSP en el navegador; fuera de él, el token por sí solo da acceso a sus hojas publicadas.

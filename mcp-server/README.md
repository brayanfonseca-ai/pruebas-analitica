# Servidor MCP de DataSense

Servidor [MCP](https://modelcontextprotocol.io) standalone en TypeScript/Node que expone el backend REST de **DataSense** (clon local de Qlik Sense) como herramientas para un agente de IA. El servidor habla por **STDIO** y consume la API `/api/v1` del backend.

El servidor **no modifica el backend Java**: todas las tools se apoyan en endpoints REST existentes.

## Requisitos

- **Node.js 18 o superior** (se usa el `fetch` global; no se instala `node-fetch`).
- En este entorno Windows, `node`/`npm` pueden no estar en el PATH. Invocalos por **ruta absoluta**:
  - `"C:\Program Files\nodejs\node.exe"`
  - `"C:\Program Files\nodejs\npm.cmd"`
- El backend DataSense corriendo y accesible (por defecto en `http://localhost:8080`).

## Instalar dependencias

Desde la carpeta `mcp-server`:

```
"C:\Program Files\nodejs\npm.cmd" install
```

## Compilar (build)

```
"C:\Program Files\nodejs\npm.cmd" run build
```

Ejecuta `tsc` y genera el JavaScript en `dist/` (entrypoint en `dist/src/index.js`). La carpeta `dist/` es generada y no se versiona.

## Ejecutar

El servidor se comunica por STDIO (lo arranca el cliente MCP, no se usa de forma interactiva):

```
"C:\Program Files\nodejs\node.exe" dist/src/index.js
```

o con el script de npm:

```
"C:\Program Files\nodejs\npm.cmd" start
```

## Configuracion

La URL base del backend es configurable con la variable de entorno **`DATASENSE_BASE_URL`**:

- Si no se define, se usa `http://localhost:8080` por defecto.
- Se normaliza quitando la barra final (ej. `http://host:9000/` -> `http://host:9000`).

El backend exige sesión en toda la API. El MCP inicia sesión solo con **`DATASENSE_USER`** y **`DATASENSE_PASSWORD`**
(por defecto `admin@datasense.io` / `admin123`, la cuenta de demostración) y renueva el token si caduca. Con un usuario
que no sea administrador, las tools respetan sus permisos y etapas (el servidor responde 403/404 con el motivo). Si cambias
la contraseña del administrador, añade ambas variables en `env` de `mcp.json`.

## Conectar un cliente MCP

Copia el bloque de [`mcp.config.example.json`](./mcp.config.example.json) en la configuracion de tu cliente MCP y **ajusta las rutas**:

- `command`: ruta absoluta a `node.exe` (ej. `C:\\Program Files\\nodejs\\node.exe`).
- `args`: ruta absoluta a `dist/src/index.js`. Sustituye `<ABS>` por la ruta real donde clonaste el proyecto; por ejemplo, si el proyecto esta en `C:\proyectos\Preuba`, el valor seria `C:\\proyectos\\Preuba\\mcp-server\\dist\\src\\index.js`.
- `env.DATASENSE_BASE_URL`: URL del backend (por defecto `http://localhost:8080`).

En JSON los backslash de Windows se escapan como doble backslash (`\\`).

## Catalogo de tools

### Tools de contexto (lectura)

| Tool | Que hace | Endpoint |
| --- | --- | --- |
| `list_apps` | Lista todas las aplicaciones. | `GET /api/v1/apps` |
| `get_app` | Detalle de una aplicacion por `appId`. | `GET /api/v1/apps/{appId}` |
| `list_tables` | Lista las tablas de una aplicacion. | `GET /api/v1/apps/{appId}/tables` |
| `read_table` | Lee una tabla: `columns`, `rows` (total) y `preview`. | `GET /api/v1/apps/{appId}/tables/{tableId}` |
| `get_fields` | Campos (dimensiones y medidas) de una aplicacion. | `GET /api/v1/apps/{appId}/fields` |
| `get_field_values` | Valores distintos de un campo. | `POST /api/v1/apps/{appId}/fields/values` |
| `get_model` | Modelo de datos (grafo de nodos/enlaces/avisos). | `GET /api/v1/apps/{appId}/model` |
| `get_script` | Lee el script de carga. | `GET /api/v1/apps/{appId}/script` |
| `list_sheets` | Lista las hojas (dashboards). | `GET /api/v1/apps/{appId}/sheets` |
| `list_connections` | Lista las conexiones de datos. | `GET /api/v1/apps/{appId}/connections` |
| `ai_health` | Estado del agente de IA del backend. | `GET /api/v1/ai/health` |

> **ADVERTENCIA sobre `read_table`:** el campo `preview` esta **CAPADO a 50 filas** y **no** es el dataset completo. El total real de filas esta en `rows`. Para calculos o agregaciones sobre TODO el dataset usa la tool `run_query` (el motor agrega sin traer las filas).

### Tools de accion (ejecucion)

| Tool | Que hace | Endpoint |
| --- | --- | --- |
| `create_app` | Crea una aplicacion. | `POST /api/v1/apps` |
| `delete_app` | **Destructiva:** elimina una aplicacion y su contenido. | `DELETE /api/v1/apps/{appId}` |
| `run_query` | Query/agregacion sobre todo el dataset (KPI o labels+series). | `POST /api/v1/apps/{appId}/query` |
| `set_script` | Guarda (reemplaza) el script de carga. | `PUT /api/v1/apps/{appId}/script` |
| `run_script` | Ejecuta el script y recarga el modelo. | `POST /api/v1/apps/{appId}/script/run` |
| `create_sheet` | Crea una hoja/dashboard con objetos de visualizacion. | `POST /api/v1/apps/{appId}/sheets` |
| `update_sheet` | Actualiza una hoja existente. | `PUT /api/v1/apps/{appId}/sheets/{sheetId}` |
| `create_connection` | Crea una conexion de datos (del usuario del MCP, privada hasta compartirla). | `POST /api/v1/connections` |
| `test_connection` | Prueba una conexion sin crearla. | `POST /api/v1/connections/test` |
| `ai_modelar` | IA: propone un modelado de datos. | `POST /api/v1/ai/modelar` |
| `ai_analizar` | IA: responde una pregunta sobre los datos. | `POST /api/v1/ai/analizar` |
| `ai_disenar` | IA: propone el diseno de un dashboard. | `POST /api/v1/ai/disenar` |

En `run_query` las medidas aceptan `agg` en `sum|count|avg|min|max` (default `sum`). Sin `dimension` el resultado es un KPI escalar (`QueryResult.value`); con `dimension` devuelve `labels` + `series`.

### Tools de plataforma (`src/tools/platform-tools.ts`)

Cubren el resto de la plataforma para que el agente pueda hacer **todo** lo que hace la UI (88 tools en total):

| Grupo | Tools |
|---|---|
| Catalogos | `list_chart_types`, `list_ml_algorithms` |
| Conexiones por usuario (privadas; se comparten) | `update_connection`, `get_connection_share_targets`, `share_connection` (más `create_connection`, `test_connection` y `delete_connection`, que ahora son del usuario) |
| Notas para agente | `get_data_notes`, `update_data_notes`, `get_agent_context`, `suggest_data_notes` |
| Embedding | `list_embeds`, `create_embed`, `update_embed`, `rotate_embed_token`, `delete_embed` |
| Conexiones realizadas | `list_all_connections`, `browse_connection`, `preview_connection`, `transform_preview`, `parse_load_script`, `load_connection` (mode + transform), `delete_connection` |
| Datos | `upload_table`, `delete_table`, `get_field_overrides`, `set_field_overrides` |
| Asociaciones | `recommend_associations`, `list_associations`, `save_association`, `delete_association` |
| Elementos maestros | `list_master_items`, `save_master_item`, `delete_master_item`, `parse_expression` |
| Modelo logico | `get_logical_model`, `set_logical_model`, `logical_model_action`, `logical_model_item` |
| Hojas | `delete_sheet`, `set_sheet_visibility`, `add_ml_chart` |
| Experimentos de ML | `list_experiments`, `create_experiment`, `get_experiment`, `update_experiment`, `delete_experiment`, `train_model`, `get_ml_run`, `delete_ml_run`, `associate_ml_run`, `ml_datasets` |
| Colecciones | `list_collections`, `create_collection`, `delete_collection` |
| Usuarios y etapas | `get_current_user`, `get_security_catalog`, `list_users`, `create_user`, `update_user`, `reset_user_password`, `delete_user`, `set_app_stage` |
| Notificaciones | `list_notifications`, `mark_notifications_read`, `clear_notifications` (`/api/v1/notifications`) |
| Ayuda | `get_help` (lee `/help/ayuda.json`: manual técnico, FAQ, atajos; admite `query` y `section`) |

`create_sheet` / `update_sheet` aceptan cualquier tipo de objeto, incluidos los graficos de ML (`ml-clustermap`, `ml-silhouette`, `ml-roc`… con `props.ml = {experimentId, runId}`).

**Regla de paridad:** cada funcionalidad nueva de DataSense debe exponerse tambien aqui en el mismo cambio (ver `.kiro/steering/mcp-paridad.md`).

## Nota

El backend (carpeta `backend-springboot/`) **no se modifica**. Este servidor MCP es independiente y solo consume su API REST.

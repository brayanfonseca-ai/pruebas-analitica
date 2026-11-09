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
| `create_connection` | Crea una conexion de datos real (aws, postgres, csv...). | `POST /api/v1/apps/{appId}/connections` |
| `test_connection` | Prueba una conexion sin crearla. | `POST /api/v1/apps/{appId}/connections/test` |
| `ai_modelar` | IA: propone un modelado de datos. | `POST /api/v1/ai/modelar` |
| `ai_analizar` | IA: responde una pregunta sobre los datos. | `POST /api/v1/ai/analizar` |
| `ai_disenar` | IA: propone el diseno de un dashboard. | `POST /api/v1/ai/disenar` |

En `run_query` las medidas aceptan `agg` en `sum|count|avg|min|max` (default `sum`). Sin `dimension` el resultado es un KPI escalar (`QueryResult.value`); con `dimension` devuelve `labels` + `series`.

## Nota

El backend (carpeta `backend-springboot/`) **no se modifica**. Este servidor MCP es independiente y solo consume su API REST.

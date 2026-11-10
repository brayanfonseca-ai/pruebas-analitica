# Módulo: Servidor MCP (Model Context Protocol)

Un servidor **MCP en TypeScript** que expone DataSense como herramientas para agentes de IA (como Kiro). Permite a un agente obtener contexto de la plataforma y **operarla**: leer datos reales, consultar, crear hojas, etc.

## A nivel de usuario
- No es una pantalla: es un servicio que se conecta a un cliente MCP (p.ej. Kiro) vía `mcp.json`.
- Una vez conectado, el agente puede "ver" tus apps y datos y ejecutar acciones reales sobre el backend.
- Útil para que el asistente responda **con datos reales leídos por MCP**, no adivinando.

## A nivel de desarrollo
- Proyecto en `mcp-server/` (TypeScript, Node 26, `@modelcontextprotocol/sdk`, transporte **stdio**). Compila con `tsc` a `dist/`.
- Consume la API REST del backend (`DATASENSE_BASE_URL`, default `http://localhost:8080`).
- **62 herramientas**: cubren todo lo que hace la plataforma (regla de paridad en `.kiro/steering/mcp-paridad.md`: cada funcionalidad nueva debe exponerse también como tool).

| Grupo | Tools |
|---|---|
| Contexto (`context-tools.ts`) | `list_apps`, `get_app`, `list_tables`, `read_table`, `get_fields`, `get_field_values`, `get_model`, `get_script`, `list_sheets`, `list_connections`, `ai_health` |
| Acción (`action-tools.ts`) | `create_app`, `delete_app`, `run_query`, `set_script`, `run_script`, `create_sheet`, `update_sheet` (cualquier tipo de gráfico, incluidos los `ml-*`), `create_connection`, `test_connection`, `ai_modelar`, `ai_analizar`, `ai_disenar` |
| Catálogos | `list_chart_types` (datos + 19 gráficos de ML), `list_ml_algorithms` (24 algoritmos y sus params) |
| Conexiones realizadas | `list_all_connections`, `browse_connection`, `preview_connection` (muestra + script LIB CONNECT/SQL), `load_connection`, `delete_connection` |
| Datos | `upload_table` (CSV/Excel desde una ruta local), `delete_table`, `get_field_overrides`, `set_field_overrides` |
| Asociaciones | `recommend_associations`, `list_associations`, `save_association`, `delete_association` |
| Elementos maestros | `list_master_items`, `save_master_item`, `delete_master_item`, `parse_expression` |
| Modelo lógico | `get_logical_model`, `set_logical_model`, `logical_model_action` (reset/enable/disable), `logical_model_item` (grupos, paquetes, jerarquías, comportamientos, periodos) |
| Hojas | `delete_sheet`, `set_sheet_visibility`, `add_ml_chart` (valida que el gráfico aplique a la ejecución y busca hueco libre) |
| Experimentos de ML | `list_experiments`, `create_experiment`, `get_experiment`, `update_experiment`, `delete_experiment`, `train_model`, `get_ml_run`, `delete_ml_run`, `associate_ml_run` (tabla ML_ + hoja con gráficos), `ml_datasets` |
| Colecciones | `list_collections`, `create_collection`, `delete_collection` |

- Verificado por stdio con un cliente MCP real: conexión Athena → explorar → vista previa → cargar → subir CSV → script con LIB CONNECT → recarga → experimento → K-Means y AutoML → Asociar a → añadir gráficos ML → hoja libre con `ml-elbow` + barras → limpieza.
- Manejo de error legible por herramienta; el server no cae si el backend falla.

## Cómo conectarlo
1. Construir: en `mcp-server/`, `npm install` y `npm run build` (Node de `C:\Program Files\nodejs`).
2. Añadir a `~/.kiro/settings/mcp.json` (sin borrar lo existente):
```json
{
  "mcpServers": {
    "datasense": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["<ruta-abs>/mcp-server/dist/src/index.js"],
      "env": { "DATASENSE_BASE_URL": "http://localhost:8080" },
      "transport": "stdio"
    }
  }
}
```
3. El backend debe estar corriendo en `:8080`. Reconectar los servidores MCP en el cliente.

## Requisitos de entorno
- Node.js + npm reales (instalados: Node 26 + npm 11 en `C:\Program Files\nodejs`). El `node` interno de la herramienta de IA NO sirve para compilar.

## Archivos
`mcp-server/src/index.ts`, `mcp-server/src/http-client.ts`, `mcp-server/src/tools/*`,
`mcp-server/mcp.config.example.json`, `mcp-server/README.md`.

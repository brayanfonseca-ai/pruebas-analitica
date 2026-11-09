# Módulo: Servidor MCP (Model Context Protocol)

Un servidor **MCP en TypeScript** que expone DataSense como herramientas para agentes de IA (como Kiro). Permite a un agente obtener contexto de la plataforma y **operarla**: leer datos reales, consultar, crear hojas, etc.

## A nivel de usuario
- No es una pantalla: es un servicio que se conecta a un cliente MCP (p.ej. Kiro) vía `mcp.json`.
- Una vez conectado, el agente puede "ver" tus apps y datos y ejecutar acciones reales sobre el backend.
- Útil para que el asistente responda **con datos reales leídos por MCP**, no adivinando.

## A nivel de desarrollo
- Proyecto en `mcp-server/` (TypeScript, Node 26, `@modelcontextprotocol/sdk`, transporte **stdio**). Compila con `tsc` a `dist/`.
- Consume la API REST del backend (`DATASENSE_BASE_URL`, default `http://localhost:8080`).
- **23 herramientas** agrupadas:
  - *Contexto*: `list_apps`, `get_app`, `list_tables`, `read_table`, `get_fields`, `get_field_values`, `get_model`, `get_script`, `list_sheets`, `list_connections`, `ai_health`.
  - *Acción*: `create_app`, `delete_app`, `run_query`, `set_script`, `run_script`, `create_sheet`, `update_sheet`, `create_connection`, `test_connection`, `ai_modelar`, `ai_analizar`, `ai_disenar`.
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

---
inclusion: always
---

# Paridad MCP: todo lo que hace DataSense lo puede hacer el MCP

Regla del proyecto (pedida por el usuario): **cada cambio o funcionalidad nueva de DataSense debe poder ejecutarse también desde el servidor MCP** (`mcp-server/`). Un cambio no está terminado si la UI o el backend pueden hacer algo que el MCP no.

## Cómo cumplirla en cada cambio

1. **Endpoint nuevo o modificado en el backend** (`backend-springboot/.../web/*Controller.java`, `ml/*Controller.java`):
   añade o actualiza la tool correspondiente en `mcp-server/src/tools/`:
   - lectura → `context-tools.ts`
   - acciones básicas (apps, query, script, hojas, conexiones, IA) → `action-tools.ts`
   - resto de la plataforma (conexiones realizadas, ML, modelo lógico, maestros, asociaciones, colecciones…) → `platform-tools.ts`
2. **Funcionalidad solo de frontend** (p. ej. un tipo de gráfico nuevo en `chart-types.js` / `ml-views.js`): actualiza los catálogos `CHART_TYPES` / `ML_SIZES` / `ML_TITLES` / `mlFits` de `platform-tools.ts` y la descripción de `type` en `schemas.ts`, para que el agente sepa crearlo con `create_sheet` / `add_ml_chart`.
3. Cada tool: nombre en snake_case, descripción con qué hace, qué devuelve y la ruta REST exacta; marca `ACCION DESTRUCTIVA` cuando borre.
4. Compila: `npm run build` en `mcp-server/` (genera `dist/src/index.js`, el que usa `~/.kiro/settings/mcp.json`).
5. Verifica con un cliente MCP real por stdio (SDK `Client` + `StdioClientTransport`) contra el backend vivo, ejecutando el flujo nuevo solo con tools. Borra el script de prueba al terminar.
6. Actualiza `docs/modulos/10-mcp.md` (tabla de tools) y `mcp-server/README.md`.
7. Tras compilar, el usuario debe reconectar el servidor `datasense` en el panel MCP de Kiro para ver las tools nuevas.

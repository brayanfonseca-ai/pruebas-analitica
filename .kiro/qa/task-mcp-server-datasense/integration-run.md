# Verificación de integración CRUZADA cross-FEAT — MCP server DataSense

Iteración 1 (no existía verdict.json). Sin commit: el workspace NO es un repositorio git
(decisión intencional del proyecto; no se ejecutó `git init` ni en Preuba ni en mcp-server).

cwd de build/test/smoke = `Preuba/mcp-server`. node/npm invocados por ruta absoluta
(`C:\Program Files\nodejs\npm.cmd`, `C:\Program Files\nodejs\node.exe`).

## BUILD
Comando: `"C:\Program Files\nodejs\npm.cmd" run build`  (ejecuta `tsc`)
Resultado: **EXITCODE=0**. `dist/src/index.js` generado.

## TESTS
Comando: `"C:\Program Files\nodejs\npm.cmd" test`  (`node --test "dist/test/*.test.js"`)
Resultado: **16 tests, 16 pass, 0 fail, 0 cancelled, 0 skipped — EXITCODE=0**.
Re-ejecutado tras la corrección de costura en http-client.ts → sigue **16/16 pass, EXITCODE=0**.

Tests cubiertos: http-client (get/post/put/del, URL base+path, cabeceras JSON,
!ok→Error con status, 204→null, DATASENSE_BASE_URL con barra final) y tools
(list_apps GET /api/v1/apps, run_query POST .../query con y sin dimension,
create_sheet POST .../sheets, validación zod de agg/measures/tipos de objeto).

## SMOKE STDIO (backend VIVO en http://localhost:8080)
Cliente MCP efímero (SDK oficial `Client` + `StdioClientTransport`) que lanza
`dist/src/index.js` por STDIO con `DATASENSE_BASE_URL=http://localhost:8080`.
(El harness efímero `smoke-client.mjs` se usó solo para verificar y se eliminó.)

- initialize → OK
- tools/list → **23 tools** (FEAT de contexto + FEAT de acción, ambas registradas):
  ai_analizar, ai_disenar, ai_health, ai_modelar, create_app, create_connection,
  create_sheet, delete_app, get_app, get_field_values, get_fields, get_model,
  get_script, list_apps, list_connections, list_sheets, list_tables, read_table,
  run_query, run_script, set_script, test_connection, update_sheet
- ai_health → isError=false → `{ok:true, agent:"prueba", model:"us.amazon.nova-micro-v1:0", region:"us-east-2"}`
- list_apps → isError=false → **9 apps reales** del backend vivo, incluyendo las dos esperadas:
  - `73f59275cdab49e49646ff4007e1ddbb` — "Mi aplicación"
  - `a2ba7ea7c2424182a5c42aa185139ff5` — "Dashboard de pruebas"

Nota: la primera ejecución de smoke mostró "fetch failed" porque corrió contra un
`dist` previo a la recompilación; tras rebuild la invocación STDIO devuelve datos reales.
Comprobado aparte que el backend responde por Node fetch en `localhost` y `127.0.0.1`
(GET /api/v1/ai/health → 200), descartando problema de red/IPv6.

## Costura (seam) corregida entre FEATs
`src/http-client.ts`: todas las llamadas fetch pasan por un helper `doFetch` que, ante
un fallo de red (sin respuesta HTTP), lanza un Error con la URL destino y la causa
subyacente (p. ej. ECONNREFUSED) en lugar del opaco "fetch failed". Mejora el
diagnóstico que recibe el agente cuando el backend está caído/inalcanzable. No cambia
el comportamiento en respuestas OK ni en errores HTTP (el test de 404 sigue pasando).

## Restricciones respetadas
- No se tocó `backend-springboot/`.
- No se reinició ni liberó el puerto 8080 (backend reutilizado).
- No se añadió node-fetch (fetch global de Node).
- No se inicializó git ni se hizo commit (workspace no es repo, por diseño).

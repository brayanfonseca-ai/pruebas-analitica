# Módulo: Editor de carga de datos

Edición del **script de carga** estilo Qlik y subida de archivos. Equivale al "Editor de carga de datos" de Qlik Sense.

## A nivel de usuario
- Un editor de código (CodeMirror) con el script `LOAD ... FROM [lib://DataFiles/...]` de la app.
- Panel derecho "Añadir datos": subir Excel/CSV (arrastrar o seleccionar), incluir script, y **Conexiones de datos** (crear/usar conexiones reales).
- Botones: **Cargar datos** (ejecuta el script y reconstruye el modelo, mostrando el progreso en un modal), **Ver vista previa**, **Guardar script**, **Historial**, **Depurar**.
- Al cargar un archivo, su tabla queda disponible y el script auto-generado se actualiza.
- El **asistente "estrellita"** aquí es un *ingeniero de datos*: propone el modelo (estrella/copo/araña), llaves y script.

## A nivel visual
- Layout de 3 zonas: editor (centro), panel "Añadir datos" (derecha), bandeja inferior con "Vista previa / Resultado".
- **Modal de progreso de carga**: ventana emergente que muestra los pasos del motor y, si hay error, lo destaca dentro del modal.
- Estilos en `frontend/css/editor.css`. Acento azul de marca.

## A nivel de desarrollo
- Frontend: `frontend/js/app-editor.js`. Funciones clave: `getCode()/setCode()`, `saveScript()` (`PUT /script`), `runNow()` (`POST /script/run` + modal de progreso), `doUpload()` (`POST /tables`, multipart), `renderConnections()`.
- Backend:
  - `ScriptController` — `GET/PUT /script`, `POST /script/run`. Genera el script por defecto desde las tablas y refleja los field-overrides (alias `AS`, omite ocultos).
  - `DataController` — `POST /tables` (sube y perfila con `Profiler`), sirve tablas.
  - `TableStore` — materializa/lee los CSV; `TableReader` lee Excel (POI) y CSV.
- El asistente usa `aiModelar(appId, {pregunta, contexto})`; el contexto se arma de `listTables`.

## Archivos
`frontend/js/app-editor.js`, `frontend/css/editor.css`,
`backend: web/ScriptController.java`, `web/DataController.java`,
`engine/Profiler.java`, `engine/TableReader.java`, `engine/TableStore.java`.


## Herramientas de la barra (actualización)

- **Scroll**: el script ocupa el alto disponible y se desplaza dentro del editor (la rejilla usa `grid-template-rows: minmax(0, 1fr)`).
- **🔍 Buscar en todo el entorno** (`Ctrl+F`, `js/editor-search.js`): busca una palabra, sin distinguir mayúsculas ni tildes y también parecidas («cedla» → «CEDULA»), en el script, tablas y campos del modelo, notas para agente, hojas y conexiones. Un resultado del script salta a la línea y la resalta.
- **// Comentar** (`Ctrl+/`): comenta o descomenta las líneas seleccionadas. En las tablas cargadas por conexión, un campo comentado dentro de su `LOAD` **no se carga** al pulsar *Cargar datos*: `ScriptController.run` interpreta el bloque de cada tabla (`DataTransform.parseBlock`) y aplica columnas excluidas, renombres `AS`, `WHERE` y `DISTINCT`; las excluidas se conservan para volver a incluirlas al descomentarlas. Otros comentarios `//` son solo documentación.
- **⇥ Sangrar**: igual que antes.
- **Ver una vista previa de los datos** (`js/editor-workflow.js`): abre el **Flujo de datos**, un workflow de 5 etapas conectadas (Fuente → Extracción → Transformación → Modelo → Asociaciones) con indicadores, recorrido resaltado al pasar el cursor y, al hacer clic en una tabla, sus campos (los comentados tachados) y una muestra real de datos; «Ir al bloque en el script» salta a su `LOAD`.
- **Guardar script** (`Ctrl+S`): pide una descripción del cambio y crea una **versión** nueva (ver [13 · Versiones del script](./13-notas-agente.md)).

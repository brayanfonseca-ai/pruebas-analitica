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
- Estilos en `css/editor.css`. Acento azul de marca.

## A nivel de desarrollo
- Frontend: `js/app-editor.js`. Funciones clave: `getCode()/setCode()`, `saveScript()` (`PUT /script`), `runNow()` (`POST /script/run` + modal de progreso), `doUpload()` (`POST /tables`, multipart), `renderConnections()`.
- Backend:
  - `ScriptController` — `GET/PUT /script`, `POST /script/run`. Genera el script por defecto desde las tablas y refleja los field-overrides (alias `AS`, omite ocultos).
  - `DataController` — `POST /tables` (sube y perfila con `Profiler`), sirve tablas.
  - `TableStore` — materializa/lee los CSV; `TableReader` lee Excel (POI) y CSV.
- El asistente usa `aiModelar(appId, {pregunta, contexto})`; el contexto se arma de `listTables`.

## Archivos
`js/app-editor.js`, `css/editor.css`,
`backend: web/ScriptController.java`, `web/DataController.java`,
`engine/Profiler.java`, `engine/TableReader.java`, `engine/TableStore.java`.

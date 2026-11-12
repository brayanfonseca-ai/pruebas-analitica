# 13 · Notas para agente (diccionario de datos)

## A nivel de usuario
Al cargar datos en una aplicación, **Notas para agente** lista sus tablas y columnas. Para cada una escribes qué significa, de qué tipo es, cómo se le llama en el negocio y con qué otras columnas se puede cruzar. El asistente de IA y los agentes MCP leen ese texto, así entienden tus datos y saben cómo fusionarlos y modelarlos sin adivinar.

- **Lista de apps** con el % documentado de cada una.
- **Editor por app**: contexto del negocio (texto general), descripción y granularidad de cada tabla, y por columna: *qué significa*, *tipo* (Identificador, Dimensión, Medida, Fecha, Categoría, Texto libre, Indicador), *también se llama* (sinónimos) y *se cruza con*.
- **Cruces sugeridos**: columnas con el mismo nombre en otras tablas aparecen como chips punteados; un clic los agrega. También se pueden agregar cruces manuales con una nota (p. ej. «usar LEFT JOIN»).
- **Autocompletar con IA**: propone borradores solo para lo no documentado; se revisan y nada se guarda hasta pulsar *Guardar*.
- **Lo que recibe el agente**: vista previa del texto exacto que se entrega a la IA.
- Requiere el permiso `charts:edit` (administrador y desarrollador).

## A nivel visual
`frontend/pages/notas.html`: anillo de cobertura por app, secciones plegables por tabla con barra de progreso, tabla de columnas con tipo, muestras de valores y marca ✓ en las documentadas; punto naranja en lo no guardado. Estilos en `theme.css` (sección 26).

## A nivel de desarrollo
- Tablas: `app_notes`, `table_notes`, `column_notes` (sinónimos como texto; cruces como JSON `[{table, column, note}]`).
- `NotesRepository.get` (perfil + notas + muestras + cruces automáticos + cobertura), `save` (upsert parcial; columna vacía se borra; tipo semántico validado), `contextFor` (markdown, máx. 12 000 caracteres).
- `AiController` añade `contextFor(appId)` al *system prompt* cuando la petición trae `appId` y el usuario ve esa app.
- API (`/api/v1/apps/{appId}/notes`): `GET`, `PUT {app_text?, tables:[{name, description?, grain?, columns:[{name, description?, semantic?, synonyms?, joins?}]}]}`, `GET /context`, `POST /suggest {table?}` (no guarda).
- MCP: `get_data_notes`, `update_data_notes`, `get_agent_context`, `suggest_data_notes`.


## Versiones del script de carga (control de versiones)

Al final de cada app en **Notas para agente** está la línea de tiempo **Versiones del script de carga**, al estilo git:
- Cada **Guardar script** con cambios crea una versión nueva (v1, v2, …) con su mensaje («¿Qué cambiaste?»), autor y fecha; queda como **PRINCIPAL** y la anterior baja al historial. Guardar sin cambios no crea versión. Pulsar *Cargar datos* con cambios sin guardar también crea una («Guardado automático al cargar datos»).
- **Ver cambios**: diff línea a línea contra la versión anterior (verde = añadido, rojo = quitado; las líneas sin cambios se pliegan).
- **Restaurar esta versión**: no reescribe la historia; crea una versión nueva con ese contenido y la deja como principal.
- Si la app ya tenía un script guardado antes de existir el control de versiones, ese contenido se conserva como v1.
- Tabla `script_versions (app_id, version, text, message, author_id, author_name, created_at)`; `ScriptVersionRepository` (diff LCS).
- API (`data:import`): `PUT /apps/{id}/script {text, message?}` → `{version, version_created, version_message}`; `GET /apps/{id}/script/versions`; `GET /apps/{id}/script/versions/{v}` (texto + `diff`); `POST /apps/{id}/script/versions/{v}/restore`.
- MCP: `set_script` (con `message`), `list_script_versions`, `get_script_version`, `restore_script_version`.

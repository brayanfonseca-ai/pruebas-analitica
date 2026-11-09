# Módulo: Editor de hoja — Construir dashboards

El modo **edición** de la Hoja: construir el dashboard arrastrando gráficos, campos y elementos maestros a la rejilla, y ajustar propiedades.

## A nivel de usuario
- Botón **Editar hoja** activa el modo edición (botón pasa a **Listo**).
- Riel izquierdo de **activos**: Hojas, Marcadores, Campos, Elementos maestros, **Gráficos** (catálogo de tipos), Variables.
- Arrastras un tipo de gráfico a la rejilla, o un campo sobre un objeto para asignarlo como dimensión/medida.
- Panel derecho de **Propiedades**: título, dimensiones, medidas, estilo (orientación, dona, etiquetas de valor, etc.).
- El **asistente "estrellita"** aquí es un *diseñador*: propone y **crea** gráficos/KPIs/estructura; puede construir un dashboard completo de una instrucción.

## A nivel visual
- Rejilla de 24 columnas con objetos redimensionables/movibles; fantasma de posición al arrastrar.
- Catálogo de tipos en `chart-types.js` (barras, tarta, línea, combo, treemap, embudo, cascada, mapa, KPI, tabla, filtro, etc.; los `available:true` se pueden usar).
- Estilos en `frontend/css/hoja.css`.

## A nivel de desarrollo
- `frontend/js/app-hoja.js`: `setEdit(v)`, `renderChrome()`, drag & drop (`dragPayload`, `dropRect`), `addItem`, `defaultProps`. Objeto = `{id, type, x, y, w, h, props:{title, dims:[{source,table,field}], measures:[{...,agg}], look}}`.
- Persistencia: `POST/PUT /sheets`. El backend **normaliza** objetos "planos" (los que manda el MCP/IA con `dimension`/`measure`) al formato interno vía `SheetObjectNormalizer` (resuelve tabla, genera `id`, arma `props.dims/measures`). Por eso una hoja creada por IA se pinta igual que una hecha a mano.
- El asistente usa `aiDisenar`; si devuelve `action` (`build-sheet`/`add-objects`), `applyPlan()` crea los objetos reales en la hoja.

## Archivos
`frontend/js/app-hoja.js`, `frontend/js/chart-types.js`, `frontend/js/hoja-templates.js`, `frontend/js/hoja-render.js`,
`backend: web/SheetController.java`, `repo/SheetRepository.java`, `repo/SheetObjectNormalizer.java`.

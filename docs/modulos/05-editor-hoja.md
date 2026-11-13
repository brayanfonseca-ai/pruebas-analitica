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


## Dimensiones calculadas

Una dimensión ya no tiene que ser un campo: puede ser una **expresión por fila**.

- **Dónde**: Hoja en modo edición → *Elementos maestros* → **Dimensiones +** → pestaña **Calculada (expresión)**. También en el editor *fx* de la dimensión de un gráfico.
- **Ejemplos**:
  - `If([EDAD EN AÑOS] >= 40, 'Mayor de 40', 'Menor de 40')`
  - `Class([ANTIGÜEDAD EN MESES], 12)` → rangos «0 - 12», «12 - 24»…
  - `Year([FECHA RETIRO])`, `Month([FECHA CONTRATO])`
  - `[EMPRESA] & ' - ' & [CARGO]`
  - `If([ESTADO CONTRATO] = 'Activo', 'Vigente', 'Retirado')`
- **Funciones**: If, Class (rangos), Match, Year, Month, Day, Round, Floor, Ceil, Abs, Upper, Lower, Trim, Len, Left, Right, Mid, Replace, Alt, IsNull, Num, Text, Date; operadores `&` `+ - * /` `= <> < > <= >=` `AND OR NOT`.
- **Probar** muestra la tabla, cuántos valores distintos da y unos ejemplos antes de guardar.
- **Reglas**: todos los campos deben estar en una misma tabla; el **nombre** es el campo por el que se agrupa, selecciona y filtra, así que no puede coincidir con un campo existente ni con otra dimensión calculada.
- **Cómo funciona**: `Expressions.compile` marca la dimensión como calculada (`resolved = {table, field: nombre, expr, calculated}`); en cada `/query` `QueryController` añade a la tabla una columna con `Expressions.withCalculated` (evaluada con `RowExpression`) para las dimensiones calculadas maestras y la de la propia consulta (`dimension.expr`). Así funcionan igual que un campo: agrupación, selecciones, filtros por objeto, panel de filtrado (`/fields/values`) y asociación con otras tablas.
- **MCP**: `save_master_item` (kind `dimension` con la expresión) y `parse_expression` (con `name`) para probarla.


## Estudio de expresiones

Crear o editar una **medida** o **dimensión** maestra, y el botón **fx** de un gráfico, abren el **Estudio de expresiones** (`frontend/js/expr-studio.js`): una ventana amplia (hasta 1320 × 820 px) con tres zonas.
- **Izquierda**: nombre, descripción (amplia) y **tipo detectado en vivo** (Campo · Dimensión calculada · Medida).
- **Centro**: editor grande con números de línea y **resaltado de sintaxis** (campos, textos, números, funciones, operadores), barra de operadores, **Probar** (`Ctrl+Enter`, valida en el motor y muestra tabla, campos usados y valores de ejemplo; en medidas, el resultado con todos los datos), **Ordenar** (`Ctrl+Shift+F`, parte If anidados en varias líneas), aviso inmediato de paréntesis, corchetes o comillas sin cerrar, y contador de caracteres y líneas.
- **Derecha**: catálogo con **Campos** (buscables, por tabla, con tipo; en medidas, accesos rápidos Σ Sum y # Count), **Funciones** (firma y descripción; un clic inserta la plantilla) y **Ejemplos** construidos con los campos reales del modelo.
- Las expresiones en varias líneas se guardan en una sola línea para el motor.

## Medidas compuestas

Una medida ya no es solo una agregación sobre un campo. Puedes escribir:
- **Aritmética entre agregaciones**: `Count([FECHA RETIRO]) / Count([CEDULA]) * 100`, `Max([EDAD EN AÑOS]) - Min([EDAD EN AÑOS])`, `Sum([VALOR MOVIMIENTO]) / Count(DISTINCT [CEDULA])`.
- **Agregación sobre una expresión por fila**: `Sum(If([ESTADO CONTRATO] = 'Inactivo', 1, 0))` (cuántos cumplen una condición). Dentro de la agregación valen todas las funciones de las dimensiones calculadas (If, Year, Upper…) y también los nombres de las dimensiones calculadas maestras.
- **Count(DISTINCT [campo])**: valores distintos (personas únicas).
- **Funciones sobre el resultado**: `Round(Sum(If([ESTADO CONTRATO] = 'Inactivo', 1, 0)) / Count([CEDULA]) * 100, 2)`, `If(Count([x]) > 0, …, 0)`.
- **Reglas**: cada campo va dentro de una agregación; todos los campos en una misma tabla; no se anidan agregaciones (`Sum(Count(…))`). Dentro de una compuesta, **Count cuenta valores no vacíos** y una división por cero da 0.
- **Cómo funciona**: `Expressions.compile` extrae cada `Func(...)` (paréntesis balanceados), lo sustituye por `[__a0]`, `[__a1]`… y devuelve `{table, field, agg, formula, parts:[{agg, field|expr, distinct}], composite:true}`. `QueryEngine.aggregateComposite` calcula cada parte sobre las filas del grupo y evalúa la fórmula con `RowExpression`. Si la dimensión está en otra tabla, cada fila de la tabla de la medida toma la etiqueta por la clave compartida (no se pre-agrega, porque un % no es aditivo). `/expressions/parse` devuelve además `value` (el total con todos los datos) y el estudio lo muestra al **Probar**, con las agregaciones combinadas.

## Métricas certificadas e historial

- En el estudio de un elemento maestro existente aparece el bloque **Gobierno**: estado (✓ Métrica certificada, por quién, cuándo y la nota) y los botones **✓ Certificar / Quitar certificación** (solo con `apps:publish`) y **⟲ Historial · vN**.
- Una métrica certificada lleva la insignia **✓ Certificada** en *Elementos maestros* y aparece primero (con ✓) al elegir una medida para un gráfico. Solo quien puede publicar la modifica o la borra (403 para el resto). La IA la recibe en su contexto como definición oficial y la usa tal cual.
- **Historial**: cada cambio de nombre, expresión o descripción crea una versión (`master_item_versions`) con autor, fecha y mensaje («Creación», «Cambio de expresión»…). Desde el historial puedes **Ver** una versión (la carga en el editor) o **Restaurar** (se valida y queda como versión nueva; nada se reescribe).
- API: `POST /apps/{id}/master-items/{itemId}/certify` `{certified, note?}`, `GET …/versions`, `POST …/versions/{v}/restore`. MCP: `certify_master_item`, `list_master_item_versions`, `restore_master_item_version`.

## Comentarios sobre objetos

- Menú **⋯** de cualquier objeto → **Comentarios (N)**. El hilo muestra autor, fecha, el punto al que se refiere y acciones **Ver ese punto** (vuelve a aplicar la selección que había al comentar), **Marcar resuelto / Reabrir** y **Borrar** (autor o quien publica).
- Al escribir con selecciones activas puedes **anclar el comentario a la selección actual** («EMPRESA = Vigía»). `Ctrl+Enter` envía.
- Los objetos con comentarios sin resolver muestran el chip **💬 N** en la esquina inferior izquierda; un clic abre el hilo.
- Cualquiera que vea la app comenta (también un visualizador en Producción). No aparece en tableros incrustados.
- API: `GET/POST /apps/{id}/comments`, `PUT/DELETE /apps/{id}/comments/{commentId}` (tabla `comments`). MCP: `list_comments`, `add_comment`, `resolve_comment`, `delete_comment`.

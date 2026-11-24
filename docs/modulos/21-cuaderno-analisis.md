# 21 · Cuaderno de análisis y la página Analizar

Un cuaderno, al estilo de Jupyter o Hex, para explorar los datos de una aplicación: celdas de SQL, análisis estadísticos y notas, en orden, guardadas y reutilizables. «Analizar» (menú principal) es la galería de cuadernos de todas las apps.

## A nivel de usuario

### Dónde está
- Dentro de cada app: menú lateral **Explorar → Cuaderno de análisis** (atajo Alt+Shift+N). URL: `app.html?app=<id>&nb=<cuaderno>#cuaderno`.
- En el menú principal: **Analizar** muestra todos los cuadernos que puedes ver, con búsqueda (nombre, descripción o autor), filtro por aplicación, «Solo míos» y orden (editados recientemente, nombre o aplicación). **＋ Nuevo cuaderno** pregunta la app y lo abre.

### La pantalla
- **Panel izquierdo**: los cuadernos de la app y el árbol de datos (tablas con sus filas y columnas, con el tipo: `#` número, `◷` fecha, `Aa` texto). Clic en una columna la inserta en la consulta activa; `◔` abre su perfil; `⌗` en una tabla crea una consulta sobre ella.
- **Cabecera**: nombre y descripción editables, autor y última edición, estado de guardado, **▶ Ejecutar todo**, **⧉ Duplicar**, **⤓ .sql** (exporta las consultas y notas) y borrar.
- **Celdas**: cada una con número, tipo, título, tiempo de ejecución y acciones (ejecutar, subir, bajar, duplicar, añadir debajo, quitar). La barra inferior añade celdas de cualquier tipo.

### Tipos de celda
| Tipo | Qué hace | Resultado |
|---|---|---|
| **Consulta (modo Visual)** | Sin escribir código: **Tabla**, **Ver por** (campos que agrupan o columnas a mostrar), **Calcular** (contar registros, suma, promedio, mínimo, máximo, mediana o valores distintos de un campo), **Filtrar** (es igual, distinto, mayor, menor, contiene, empieza por, es uno de, está vacío; con sugerencias de valores reales), **Ordenar** y **Mostrar n filas**. Una frase arriba dice qué responde la consulta («Suma de Ventas por Región, solo donde Mes es igual a «Ene», de mayor a menor») y el SQL generado se puede ver o pasar a modo SQL. Cada cambio se ejecuta solo. | Igual que la consulta SQL. |
| **Consulta (modo SQL)** | `SELECT [DISTINCT] … FROM tabla [WHERE] [GROUP BY] [HAVING] [ORDER BY] [LIMIT]` sobre una tabla de la app. Agregaciones `SUM`, `AVG`, `COUNT`, `COUNT(DISTINCT …)`, `MIN`, `MAX`, `MEDIAN`, `STDDEV`, `PERCENTILE(campo, p)`, cada una con `FILTER (WHERE …)`; `CASE`, `LIKE`, `IN`, `BETWEEN`, `IS NULL` y las funciones del lenguaje de expresiones. `GROUP BY`/`ORDER BY` aceptan alias y posición (`GROUP BY 1`). Una columna puede usar el alias de una anterior (`SUM(v) AS v, v / 2 AS mitad`). | Tabla ordenable o gráfico (barras, líneas, torta, número, dispersión; se sugiere uno según las columnas), CSV. Un resultado de un solo número se puede **guardar como medida** de la app (el `WHERE` pasa a `FILTER (WHERE …)`). |
| **Perfil** | Un campo: vacíos, distintos, tipo; en números mínimo, percentiles 5/25/50/75/95, máximo, media, desviación, coeficiente de variación, asimetría y atípicos; en texto los valores más frecuentes; en fechas el rango y la serie mensual. | Indicadores, histograma o barras, tabla y observaciones («muy sesgado», «posible identificador»…). |
| **Pareto / ABC** | Dimensión + medida SQL (`SUM(ventas)`, `COUNT(*)`…) y filtro opcional. Clase A hasta el 80 % acumulado, B hasta el 95 %, C el resto. | Cuántos elementos explican el 80 %, barras por clase con la curva acumulada, tabla ABC y **Ver SQL** (abre la consulta que usa). |
| **Correlación** | Matriz de Pearson entre campos numéricos (todos o los que elijas). | Mapa de calor (azul directa, rojo inversa) y parejas ordenadas por fuerza con su lectura («Fuerte», «Débil»…). |
| **Atípicos** | Método de Tukey: fuera de [Q1 − k·IQR, Q3 + k·IQR] con k = 1,5 (estándar), 3 (solo extremos) o 1 (sensible). | Altos y bajos, rango normal, diagrama de caja y los registros (más lejanos primero) con su z-score. |
| **Nota** | Texto con `#` títulos, `**negrita**`, `*cursiva*`, `` `código` `` y listas `-`. | Se ve formateada; clic para editar. |

### Empezar rápido
- **Cómo funciona**: recuadro de tres pasos al abrir un cuaderno (se puede ocultar).
- **¿Qué quieres saber?**: ideas armadas con los campos reales de la tabla principal (registros por un campo, top 10, evolución por mes, resumen de un número, distribución, Pareto). Un clic crea la celda ya ejecutada.
- **Clic en un campo del panel**: con una consulta visual activa de esa tabla, un texto o fecha se agrega a «Ver por» y un número a «Calcular» (suma o, si es edad, porcentaje o tasa, promedio). En modo SQL se agrega a la lista del `SELECT` (y al `GROUP BY` si la consulta agrupa), nunca al final del texto. Si el campo es de otra tabla, crea una consulta nueva.
- Pareto se configura con selectores («¿Qué elementos?» y «¿Medidos por?»).

### Atajos y guardado
- **Ctrl+Enter** ejecuta la celda; **Mayús+Enter** ejecuta y pasa a la siguiente (o crea una); **Ctrl+S** guarda; **Tab** indenta en el SQL.
- Se guarda solo 1,2 s después de cada cambio. Los resultados no se guardan: al abrir un cuaderno se ejecutan todas sus celdas con los datos actuales. Si cambias una celda, su resultado se marca como desactualizado hasta que la ejecutes.

### Quién puede qué
- Ver y ejecutar: cualquiera que pueda ver la app (los visualizadores, solo en apps en Producción).
- Crear y duplicar: permiso «Editar contenido» (`charts:edit`), también en apps en Producción.
- Cambiar o borrar: el autor o un administrador. Los demás lo ven en solo lectura y pueden duplicarlo.
- Los tokens de embedding no tienen acceso.

### Límites
- Una tabla por consulta: sin `JOIN` ni `WITH` (las tablas ya se relacionan en el modelo). Solo lectura: cualquier cosa que no empiece por `SELECT` se rechaza.
- `LIMIT` 1000 por defecto y 10 000 como máximo; el total real se informa siempre.
- Hasta 80 celdas por cuaderno y 20 000 caracteres por celda.

## A nivel de desarrollo
- **Backend** (`backend-springboot/src/main/java/io/datasense/notebook/`):
  - `NotebookSql`: motor de SQL de una tabla sobre los `DataFrame` de la app (`AskService.frames`). Separa las cláusulas fuera de comillas y paréntesis, extrae cada agregación a una columna interna `__aN` y compila las expresiones por fila con `ExprLang.sqlToNative` → `RowExpression`. Agrupa, filtra `HAVING`, ordena (vacíos al final), aplica `DISTINCT` y `LIMIT`. Un nombre que no es columna ni alias explícito da error con sugerencia. Los códigos con ceros a la izquierda se quedan como texto.
  - `NotebookStats`: perfil, Pareto/ABC, correlación y atípicos.
  - `NotebookRepository`: tabla `notebooks (id, app_id, name, description, cells_json, owner_id, owner_name, created_at, updated_at)`, creada en `DatabaseConfig`.
  - `NotebookController`: rutas en [`api-referencia.md`](../api-referencia.md#cuadernos-de-análisis). `Permissions.required` devuelve VIEW para `notebooks`; el controlador exige `charts:edit` para guardar y autor o administrador para cambiar o borrar. La visibilidad de la app la aplica `AuthInterceptor`.
- **Constructor visual**: `frontend/js/notebook-builder.js` (`toSql`, `describe`, `builderHtml`, `ideas`). La celda guarda `builder: {table, dims, metrics[{agg, field}], filters[{field, op, value}], order{by, dir}, limit, manual?}` junto al `sql` generado; el backend lo persiste tal cual y ejecuta el `sql`.
- **Frontend**: `frontend/js/app-cuaderno.js` (vista de la app, registrada en `app.js` → `VIEW_GROUPS` Explorar), `frontend/js/analizar.js` (galería en `hub.html?page=analizar`), funciones `listNotebooks`, `getNotebook`, `createNotebook`, `updateNotebook`, `deleteNotebook`, `notebookSchema`, `runNotebookCell` en `api.js`. Estilos `.nb-*` y `.an-*` en `css/theme.css`. Gráficos con Chart.js.
- **MCP**: `list_notebooks`, `get_notebook`, `notebook_schema`, `save_notebook`, `delete_notebook`, `run_notebook_cell` en `mcp-server/src/tools/platform-tools.ts` (ver [10](./10-mcp.md)).
- Sustituye al «pulso del negocio» anterior de Analizar, que repetía lo que ya hacen «Explicar y actuar» y las alertas.

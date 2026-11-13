# 15 · Pregúntale a tus datos y De archivo a tablero

Dos atajos en **Inicio** para quien empieza: preguntar en español y obtener la respuesta explicada, y pasar de un archivo a un tablero en segundos.

## Pregúntale a tus datos
- **Dónde**: Inicio → bloque *Pregúntale a tus datos*. Eliges la app (se recuerda la última), escribes la pregunta o pulsas una sugerencia.
- **Ejemplos** (app de rotación): «% de inactivos por sucursal», «Top 5 sucursales por cantidad de servicios», «¿Cuántos conductores hay en 2025?», «Promedio de edad por cargo», «los 3 cargos con menor antigüedad promedio», «Evolución de cantidad de servicios por periodo».
- **Respuesta**: una frase (mayor/menor, % del total, variación en el tiempo), la visualización (número, barras o línea) y **Cómo se calculó**: medida y su fórmula fx, agrupación, filtros (con la palabra de la pregunta que los activó), orden/top, tabla y filas consideradas. **Ver la consulta enviada al motor** muestra el `QuerySpec` exacto. Si la medida es una **métrica certificada** aparece el sello ✓.
- **Guardar en una hoja nueva** crea una hoja con ese gráfico (medida fx o maestra y los filtros) y la abre.
- **Qué entiende** (`AskService`, determinista, sin IA ni costo por pregunta):
  - Medidas maestras por su nombre (certificadas primero).
  - Campos por nombre, nombre visible (rename), sinónimos de las *Notas para agente* y palabras distintivas («edad» → EDAD EN AÑOS).
  - Valores de los campos como filtros («inactivos» → ESTADO CONTRATO = Inactivo, «2025» → ANIO = 2025).
  - Agregaciones: cuántos/cantidad (en números = total), total/suma, promedio, máximo, mínimo, distintos/únicos, % («% de X por Y» = porcentaje de filas con X en cada Y).
  - Personas («conductores», «empleados», «clientes») = valores distintos del identificador.
  - Agrupación: «por …», «según …», «de cada …»; «evolución / tendencia / mensual / anual» usa el campo de tiempo.
  - Top N: «top 5 …», «los 3 …», «5 mayores/menores».
  - Campos que no se suman (edad, antigüedad, probabilidad, %) se promedian por defecto.
  - Entre tablas con campos homónimos (Anio ↔ ANIO) usa el de la tabla de la medida.
- Si no entiende responde «No encontré…» con preguntas sugeridas que sí funcionan.
- **Rendimiento**: el modelo de la app (tablas, valores, sinónimos) se guarda en caché y se invalida al cambiar tablas, maestros, notas u overrides; una pregunta tarda ~50–200 ms.

## De archivo a tablero
- **Dónde**: Inicio → **⚡ De archivo a tablero** (requiere crear apps, importar datos y editar hojas).
- Sueltas un CSV/Excel → se crea la app → se sube y perfila → **AutoDashboardService** diseña la hoja → *Abrir tablero*. Muestra el tiempo total y lo detectado (categorías, medidas, tiempo, identificador) y propone preguntas.
- **Tablero** (rejilla 24×12): KPIs (métricas certificadas, Registros, distintos del identificador, totales o promedios), barras por la mejor categoría, torta, evolución en el tiempo (o barras), tabla de detalle y panel de filtros.

## API
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/apps/{appId}/ask` | `{question}` → `{ok, answer, chart, result, how, query, sheetObject}` o `{ok:false, message, suggestions}` (`dashboard:view`). |
| GET | `/apps/{appId}/ask/suggestions` | Preguntas de ejemplo verificadas. |
| POST | `/apps/{appId}/auto-dashboard` | `{table?, title?}` → 201 `{sheet, summary, questions}` (`charts:edit`). |

## MCP
`ask_data`, `ask_suggestions`, `auto_dashboard` (flujo: `create_app` → `upload_table` → `auto_dashboard`).

## Archivos
`backend-springboot/.../ask/AskService.java`, `AutoDashboardService.java`, `AskController.java`; `frontend/js/ask-home.js`, `pages/inicio.html`, `css/theme.css` (sección 35).

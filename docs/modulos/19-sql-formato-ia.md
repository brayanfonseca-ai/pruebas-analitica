# 19 · Lenguaje SQL, formato de presentación y ayuda de IA

DataSense usa **SQL** (estándar abierto, sin licencias de terceros) en tres sitios:

1. el script del editor de carga;
2. las medidas y dimensiones (maestras y fx de los gráficos);
3. las condiciones por fila («Actuar», listas, automatizaciones).

La sintaxis anterior, estilo Qlik (`Sum([x])`, `If(…)`, `LOAD … ;`), se sigue aceptando y se convierte a SQL con un clic.

## Medidas y dimensiones en SQL

| Qué | SQL |
|---|---|
| Suma / conteo / promedio | `SUM(valor)` · `COUNT(cedula)` · `COUNT(*)` · `AVG(edad)` · `MIN` · `MAX` |
| Valores distintos | `COUNT(DISTINCT cedula)` |
| Condición | `COUNT(*) FILTER (WHERE "ESTADO CONTRATO" = 'Inactivo')` · `SUM(valor) FILTER (WHERE sucursal IN ('CALI','NEIVA'))` |
| Porcentaje | `ROUND(100.0 * COUNT(*) FILTER (WHERE …) / COUNT(cedula), 2)` |
| Por fila | `SUM(CASE WHEN … THEN 1 ELSE 0 END)` |
| Dimensión calculada | `CASE WHEN "EDAD EN AÑOS" >= 40 THEN 'Mayor' ELSE 'Menor' END` · `YEAR(fecha)` · `empresa \|\| ' - ' \|\| cargo` · `CLASS(edad, 10)` |
| Funciones | `CASE`, `COALESCE`, `NULLIF`, `CAST(x AS INTEGER\|DOUBLE\|VARCHAR\|DATE)`, `x::INTEGER`, `ROUND`, `FLOOR`, `CEIL`, `ABS`, `UPPER`, `LOWER`, `TRIM`, `LENGTH`, `SUBSTRING`, `LEFT`, `RIGHT`, `REPLACE`, `CONCAT`, `YEAR`, `MONTH`, `DAY`, `EXTRACT(YEAR FROM x)`, `DATE_PART('year', x)`, `GREATEST`, `LEAST`, `IN`, `BETWEEN`, `LIKE 'AB%'`/`'%AB'`/`'%AB%'`, `IS [NOT] NULL`, `\|\|` |

- **Campos**: sin comillas si el nombre es simple (`cedula`) o entre comillas dobles si tiene espacios, tildes o símbolos (`"ESTADO CONTRATO"`). No distingue mayúsculas, tildes, espacios ni `_`, así que `estado_contrato` encuentra «ESTADO CONTRATO».
- Si un nombre puede ser de dos tablas (por ejemplo `cedula` en predicción y `CEDULA` en rotación), se elige la tabla que contiene **todos** los campos de la expresión.
- `COUNT(*)` solo cuenta las filas de la tabla principal (la que tiene más campos).
- **Mismos números**: el SQL se traduce al formato interno del motor (`engine/ExprLang.java`) y se calcula igual que antes. Se verificó sobre los datos de la app de rotación comparando 12 medidas escritas en SQL con su versión en la sintaxis anterior (valores idénticos), además de dimensiones calculadas y condiciones de filas de «Actuar».
- Los errores son legibles. Por ejemplo, «El campo «estado_contrat» no existe en el modelo de datos. ¿Quisiste decir "ESTADO CONTRATO"?»; también se avisa si una función no está disponible, con la lista de las que sí lo están.
- **No disponible todavía**: `%` (módulo), `LIKE` con `_` o con `%` en medio, funciones de ventana (`OVER`), subconsultas dentro de una medida.

### Estudio de expresiones
- La etiqueta **SQL** indica el lenguaje. El resaltado, el catálogo de funciones y los ejemplos (con tus campos reales) están en SQL.
- Al abrir una medida o dimensión escrita con la sintaxis anterior, se **convierte a SQL** automáticamente; un aviso permite ver la original. Al guardar queda en SQL.
- **Ayuda de IA** (encima del editor, **máximo 500 caracteres**). Escribes lo que necesitas, por ejemplo «porcentaje de conductores inactivos sobre el total», y la IA (Bedrock):
  - escribe la expresión SQL con los campos de la app;
  - la valida en el motor y, si falla, la corrige una vez;
  - la deja en el editor ya probada, con una explicación corta y el resultado.
  - **Deshacer** devuelve lo que había antes.
  - La IA solo ve el catálogo de campos (nombre, tabla, tipo y hasta 10 valores de los campos de texto con pocos valores), nunca filas completas. Requiere `ai:use`.

## Cómo se arma una expresión en el estudio
- **Clic en un campo:**
  - Si el editor está vacío o solo tiene un campo, lo sustituye.
  - Si tiene una agregación simple como `SUM(Gasto)` y el cursor está al final, cambia el campo de dentro (`SUM(Ingreso)`).
  - Si hay texto seleccionado (por ejemplo `campo` de una plantilla), lo reemplaza.
  - En otro caso, se inserta en el cursor separado con espacios. Nunca queda pegado (`GastoEdad`).
- **Σ / #** junto a un campo: ponen `SUM(campo)` / `COUNT(campo)` con las mismas reglas. Con un operador antes, se compone: `COUNT(Cliente) / SUM(Gasto)`.
- **Ejemplos** sustituyen la expresión entera.
- **Nombre sugerido** (maestros nuevos): se escribe solo según la expresión y la sigue mientras la cambias. Por ejemplo, «Total de Gasto», «% de Gasto», «Grupos de Edad» o «Gasto redondeado». Se ve en cursiva y se fija en cuanto escribes el tuyo. Editar un maestro existente nunca cambia su nombre.
- Una **dimensión calculada no puede llamarse como un campo**. Si pasa, el error ofrece un nombre válido con un clic.
- Si cambias la expresión después de **Probar**, el resultado anterior se atenúa con el aviso «La expresión cambió».

## Formato de presentación
Disponible en el Estudio de expresiones (panel izquierdo, junto al editor) y en el panel de propiedades de cada gráfico (botón **Formato** de cada medida y dimensión).

El panel tiene pestañas por categoría: **General · Moneda · Escala · Unidades** en medidas y **General · Fecha · Texto** en dimensiones. Cada opción es una tarjeta con su nombre y un ejemplo del resultado. Un punto en la pestaña indica dónde está el formato elegido. Debajo, **Ajustar** permite afinar decimales, escala, texto antes y después y el separador de miles.

- **Medidas**: Automático, Número, Entero, Porcentaje, Pesos $, Dólares US$, Euros €, Miles (mil), Millones (M), Miles de millones, Abreviado automático, $ en millones, kg, toneladas, litros, galones, km, °C, °, horas, días, personas.
- **Ajustes de medida**: decimales (0–3), escala (sin escala / mil / M / mil M / automática), texto antes y después (por ejemplo `kg`, `L`, `°C`) y separador de miles.
- **Dimensiones**: número sin decimales, código sin puntos, pesos, fechas (`31/12/2026`, `31 dic 2026`, `dic 2026`, `2026-12`, año) y texto en MAYÚSCULAS, minúsculas o Tipo Título.
- Muestra una **vista previa en vivo**: en el estudio, con el valor real que dio **Probar** (por ejemplo `6.000.000,62 → $ 6,0 M`).
- **Dónde aplica**: KPI, ejes, tooltips, etiquetas de valor y tablas.
- **Precedencia**: el formato del gráfico manda; si no tiene, se usa el de la medida o dimensión maestra; si tampoco, el automático.
- **Dónde se guarda**: en una maestra, en `master_items.format_json`. Cambiar solo el formato **no** crea una versión nueva, porque no cambia la definición. En un gráfico, en `props.measures[i].fmt` / `props.dims[i].fmt`.

## Script del editor de carga en SQL
```sql
-- #pestaña Principal
USE CONNECTION 'Postgres ventas';

CREATE TABLE ventas AS
SELECT DISTINCT
    cliente,
    CAST(valor AS DOUBLE) AS valor,
    -- comentario,                       ← columna que NO se carga
    CASE WHEN valor > 100 THEN 'Alta' ELSE 'Baja' END AS rango
FROM (
    SELECT * FROM public.ventas          ← consulta que se envía a la conexión (en su propio SQL)
) AS origen
WHERE cliente IS NOT NULL;

CREATE TABLE archivo AS
SELECT * FROM read_file('lib://DataFiles/archivo.csv');
```
- Un script nuevo (auto-generado) sale en SQL.
- Si el script guardado está en la sintaxis anterior, el editor muestra **Sintaxis anterior** y el botón **Convertir a SQL**. El script convertido no se guarda solo: lo revisas y pulsas **Guardar script**.
- Al **guardar** se valida. Si hay un error se rechaza indicando la tabla y la línea, por ejemplo «Tabla «x» (línea 1): Falta el FROM…».
- Al **cargar**, el SQL se traduce al formato interno de la extracción (`engine/connect/ScriptSql.java`). Por eso la carga hace exactamente lo mismo que antes:
  - columnas comentadas con `--` no se cargan;
  - `AS` renombra;
  - `CAST` cambia el tipo;
  - `COALESCE` llena vacíos;
  - `WHERE` y `DISTINCT` filtran;
  - las columnas calculadas con `CASE`/`||` se crean.
- **Scripts mixtos**: las partes que sigan en la sintaxis anterior se respetan.
- **Editor**:
  - los comentarios usan `--` (Ctrl+/);
  - las secciones se marcan con `-- #pestaña Nombre`;
  - el selector de datos de una conexión entrega el bloque en SQL;
  - la vista de flujo («Ver una vista previa de los datos») lee el SQL.
- **No disponible todavía**: `COPY … TO` (exportar) y `JOIN` entre tablas del script. Las relaciones se siguen haciendo con el modelo asociativo y las asociaciones.

## API
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/apps/{id}/expressions/parse` | Acepta SQL o la sintaxis anterior; en SQL devuelve además `{language:"sql", native}` |
| POST | `/apps/{id}/expressions/translate` | `{expression, to: "sql"\|"native"}` → `{expression, to, from}` |
| POST | `/apps/{id}/expressions/assist` | `{kind, prompt (≤500), current?}` → `{ok, expression, explanation, table, value?, sample?, attempts}` (`ai:use`) |
| POST/PUT | `/apps/{id}/master-items` | Aceptan `format` (objeto o `null`); PUT solo con `{format}` cambia el formato sin versión nueva |
| GET | `/apps/{id}/script` | Devuelve además `language: "sql"\|"qlik"` |
| POST | `/apps/{id}/script/convert` | `{text?, to: "sql"\|"qlik"}` → `{text, language}` (sin guardar) |
| PUT | `/apps/{id}/script` | Valida el SQL antes de guardar (400 con la tabla y la línea) |

## MCP
`translate_expression`, `suggest_expression`, `convert_script` (nuevas).
- `save_master_item` acepta `format`.
- `create_sheet` y `update_sheet` aceptan `fmt` en cada medida.
- `parse_expression`, `run_query`, `get_script` y `set_script` documentan SQL.

## Archivos
- Backend:
  - `engine/ExprLang.java` (SQL ⇄ formato interno)
  - `engine/Expressions.java` (entrada SQL)
  - `engine/connect/ScriptSql.java` (script SQL)
  - `LoadScripts.blockSql`
  - `DataTransform.parseBlock` (bloques SQL)
  - `ask/ExpressionAssist.java` (IA)
  - `ask/InsightService.nativeWhere`
  - `web/MasterController.java` (translate, assist, formato)
  - `web/ScriptController.java` (convert, validación, carga)
  - `repo/MasterItemRepository.java` (`format_json`)
  - `repo/SheetObjectNormalizer.java` (conserva `label`/`fmt`)
- Frontend:
  - `js/num-format.js` (módulo de formato)
  - `js/expr-studio.js` (SQL, IA, formato)
  - `js/hoja-render.js` (`fmtAs`/`fmtDim`)
  - `js/app-hoja.js` (botón Formato, formato de la maestra)
  - `js/app-editor.js` y `js/editor-workflow.js` (script SQL)
  - `css/theme.css`

# Módulo: Conexiones de datos (reales)

Conectar a fuentes externas y traer datos de verdad. Catálogo amplio de conectores; S3 y Athena verificados en vivo.

## A nivel de usuario
- Asistente de conexión (desde el Editor de carga o desde el hub "Crear → Conexión de datos"): eliges un conector del catálogo, llenas sus campos, pulsas **Probar conexión** (prueba REAL) y **Crear**.
- Catálogo (~30 conectores agrupados): Almacenamiento en la nube (S3, OneDrive, SharePoint, GDrive, GCS, Azure Blob, Dropbox), Bases de datos (Athena, Redshift, RDS, DynamoDB, Postgres, MySQL, SQL Server, Oracle, Snowflake, BigQuery, Databricks, MongoDB, ODBC), APIs y web (REST, GraphQL, OData, archivo web), IA/analítica AWS (Bedrock, SageMaker, Comprehend, OpenAI, Azure OpenAI) y **MCP** (stdio / HTTP).
- **Conexiones realizadas** (panel *Añadir datos* del Editor de carga): es el stack de TODAS las conexiones creadas, en cualquier aplicación o desde el hub. Cada tarjeta muestra el conector, un resumen (base · workgroup · región, bucket, host…) y la app donde se creó. Al crear una conexión nueva aparece aquí y se abre su selector de datos.
- **Selector de datos** (ventana emergente casi a pantalla completa al pulsar una conexión, estilo Power Query):
  1. **Explorador**: bases de datos y tablas con su número de campos (Athena), tablas/vistas (JDBC) o archivos CSV/Excel (S3), con buscador.
  2. **Extracción**: desplegable **Todo** (sin límite) · **Parcial** (primeras N filas) · **Muestra aleatoria** (N filas al azar), con la **cantidad** libre. Consulta SQL propia opcional (sección plegable).
  3. **Validar extracción**: trae una muestra REAL de 50 filas sin cargarla; los errores de la fuente se muestran tal cual (p. ej. `TABLE_NOT_FOUND`).
  4. Cuatro entornos sobre la misma extracción:
     - **Vista previa**: la muestra ya transformada. En el encabezado de cada columna: **check para incluirla o quitarla**, **nombre editable** y **tipo** (Automático, Texto, Entero, Decimal, Fecha). Las columnas quitadas quedan como chips para volver a incluirlas; se marca cuántos vacíos tiene cada columna.
     - **Transformar**: tabla de columnas con incluir, nombre, tipo, texto (recortar, MAYÚSCULAS, minúsculas), vacíos (conservar, quitar filas, reemplazar por un valor); **columnas calculadas** con expresión (`[A] + [B]`, `[Nombre] & ' ' & [Apellido]`, `If(…)`, `Round(…)`, `Year(…)`…, con botones para insertar campos y funciones); **filtro de filas**; **quitar duplicados**; y **Pasos aplicados** (cada paso se deshace con ✕).
     - **Ver script**: el bloque que se añadirá al editor, generado de lo anterior (renombres como `[CEDULA] AS [CODIGO]`, tipos con `Round(Num(…))`/`Num()`/`Text()`/`Date()`, vacíos con `Alt(…,'valor')` y `WHERE NOT IsNull(…)`, calculadas `expr AS [Nombre]`, `LOAD DISTINCT`, `SQL SELECT` solo con las columnas necesarias y con `LIMIT`/`ORDER BY rand()` según el modo).
     - **Editar script**: el desarrollador modifica el bloque a mano y **Aplicar script** lo interpreta de vuelta: el asistente, la vista previa y el SQL quedan sincronizados (también se puede cambiar el `SQL SELECT` por una consulta libre).
  5. **Cargar datos** extrae con el modo elegido, aplica las transformaciones en el motor y deja el código en el editor para empezar a modelar. **Insertar script** solo añade el bloque. La recarga del script vuelve a aplicar las mismas transformaciones.
  - Las columnas calculadas y el filtro leen los valores de origen (antes del cambio de tipo o la limpieza), como un `LOAD` de Qlik; se pueden escribir con el nombre nuevo o el de origen.
- Volver a cargar la misma tabla la **reemplaza** (no duplica). **Cargar datos** del editor (ejecutar script) **re-extrae** de la fuente las tablas que vienen de una conexión, con los mismos parámetros.

## A nivel visual
- Rejilla de conectores agrupada y buscable; iconos por tipo con color. Formulario dinámico por conector. Estados de prueba ok/err. Estilos en `frontend/css/editor.css` y `frontend/css/connections-hub.css`.

## A nivel de desarrollo
- Backend:
  - `ConnectionController` — `GET/POST /apps/{appId}/connections`, `POST …/connections/test` (prueba REAL), `POST …/connections/{id}/load` (materializa tabla; acepta conexiones de cualquier app; reemplaza la tabla si ya existe; devuelve `script`), `DELETE`.
  - `GlobalConnectionController` — `GET /api/v1/connections` (stack completo con `app_name`), `POST /connections/{id}/browse` (`{database?}` / `{prefix?}` → `{level, items}`), `POST /connections/{id}/preview` (muestra de 50 filas sin materializar + `sql` + `script`).
  - `ConnectionExecutor.browse()` (Athena: `ListDatabases` / `ListTableMetadata`; JDBC: `DatabaseMetaData.getTables`; S3: `ListObjectsV2`) y parámetro `maxRows` en `load()` para la vista previa.
  - `LoadScripts` — SQL de extracción por dialecto (modos `all`/`partial`/`sample`: `LIMIT`, `TOP`, `FETCH FIRST`, `ORDER BY rand()/random()/RAND()/NEWID()`, poda de columnas) y bloque `LIB CONNECT TO` + `LOAD` + `SQL SELECT` (o `FROM [lib://…]` para S3). Athena cita identificadores.
  - `engine/transform/DataTransform` — spec de transformaciones (`columns[{source, include, name, type, text, nulls, fill}]`, `computed[{name, expr}]`, `filter`, `distinct`): `apply()` sobre el DataFrame, `loadItems()`/`where()` para el script y `parseBlock()` para reconstruir el spec desde un script editado. `RowExpression` (expresiones por fila sin eval) y `Values` (números, enteros y fechas tolerantes a formatos). `Extraction.load()` = extraer + transformar (carga, recarga del script).
  - `POST /connections/{id}/transform` (re-aplica a la muestra sin ir a la fuente) y `POST /connections/{id}/parse-script` (script → params + transform).
  - Frontend: `frontend/js/data-selector.js` (selector) y estilos `.ed-ds-*` en `frontend/css/editor.css`.
  - Tabla `table_sources` (tabla → conexión + parámetros): `ScriptController` la usa para el script auto-generado y para re-extraer al ejecutar la carga.
  - `engine/connect/` — `ConnectionExecutor` por tipo: `S3Executor` (AWS SDK v2: HeadBucket/ListObjects/lee objeto), `AthenaExecutor` (StartQueryExecution/SELECT), `JdbcExecutor` (Postgres/MySQL/MariaDB/SQL Server/Oracle/Redshift: SELECT real), `HttpExecutor` (REST/webfile GET), y `StubExecutor` (conectores sin credenciales disponibles: error honesto, no fingido).
  - `ConnectionRepository` — enmascara secretos (claves, tokens, contraseñas) en las respuestas.
- Frontend: `frontend/js/connections.js` (catálogo + `openConnectionWizard`), `frontend/js/conn-hub.js` (desde el hub), métodos en `frontend/js/api.js`.

## Estado honesto de los conectores
- **Verificados en vivo** (con credenciales del usuario, `us-east-2`): **S3** (carga real de tablas) y **Athena** (consulta real). Conexión de trabajo: **Athena Vigia Analytics PRD** (app *Athena (AWS)*) — catálogo `AwsDataCatalog`, base `vigia_datalake_database_analytics_prd`, workgroup `vigia-data-lake-dl-datalake-workgroup-prd` (su ubicación de resultados en S3 la impone el workgroup; el workgroup `primary` no tiene ubicación configurada). Probado: exploración de 13 bases y 79 tablas, vista previa, carga de `analytics_vehiculos`, recarga desde el script y uso de la conexión desde otra app.
- **Reales, pendientes de un servidor accesible**: bases de datos JDBC (el intento de conexión es real).
- **Implementados, pendientes de credenciales/registro de app**: OneDrive, BigQuery, Snowflake, etc. (devuelven error claro, no éxito fingido).

## Seguridad
Credenciales AWS desde `~/.aws` (nunca en el repo). Secretos enmascarados en la API. La base de datos con las conexiones (`data/`) está excluida de git.

## Archivos
`frontend/js/connections.js`, `frontend/js/conn-hub.js`, `frontend/css/connections-hub.css`,
`frontend/js/app-editor.js` (Conexiones realizadas + selector de datos), `frontend/css/editor.css` (`.ed-ds-*`),
`backend: web/ConnectionController.java`, `web/GlobalConnectionController.java`, `web/ScriptController.java`, `repo/ConnectionRepository.java`, `engine/connect/*` (incl. `LoadScripts.java`).

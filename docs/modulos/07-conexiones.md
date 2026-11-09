# Módulo: Conexiones de datos (reales)

Conectar a fuentes externas y traer datos de verdad. Catálogo amplio de conectores; S3 y Athena verificados en vivo.

## A nivel de usuario
- Asistente de conexión (desde el Editor de carga o desde el hub "Crear → Conexión de datos"): eliges un conector del catálogo, llenas sus campos, pulsas **Probar conexión** (prueba REAL) y **Crear**.
- Catálogo (~30 conectores agrupados): Almacenamiento en la nube (S3, OneDrive, SharePoint, GDrive, GCS, Azure Blob, Dropbox), Bases de datos (Athena, Redshift, RDS, DynamoDB, Postgres, MySQL, SQL Server, Oracle, Snowflake, BigQuery, Databricks, MongoDB, ODBC), APIs y web (REST, GraphQL, OData, archivo web), IA/analítica AWS (Bedrock, SageMaker, Comprehend, OpenAI, Azure OpenAI) y **MCP** (stdio / HTTP).
- Desde una conexión creada puedes **Cargar datos** → se materializa una tabla del modelo.

## A nivel visual
- Rejilla de conectores agrupada y buscable; iconos por tipo con color. Formulario dinámico por conector. Estados de prueba ok/err. Estilos en `frontend/css/editor.css` y `frontend/css/connections-hub.css`.

## A nivel de desarrollo
- Backend:
  - `ConnectionController` — `GET/POST /connections`, `POST /connections/test` (prueba REAL), `POST /connections/{id}/load` (materializa tabla), `DELETE`.
  - `engine/connect/` — `ConnectionExecutor` por tipo: `S3Executor` (AWS SDK v2: HeadBucket/ListObjects/lee objeto), `AthenaExecutor` (StartQueryExecution/SELECT), `JdbcExecutor` (Postgres/MySQL/MariaDB/SQL Server/Oracle/Redshift: SELECT real), `HttpExecutor` (REST/webfile GET), y `StubExecutor` (conectores sin credenciales disponibles: error honesto, no fingido).
  - `ConnectionRepository` — enmascara secretos (claves, tokens, contraseñas) en las respuestas.
- Frontend: `frontend/js/connections.js` (catálogo + `openConnectionWizard`), `frontend/js/conn-hub.js` (desde el hub), métodos en `frontend/js/api.js`.

## Estado honesto de los conectores
- **Verificados en vivo** (con credenciales del usuario, `us-east-2`): **S3** (carga real de tablas) y **Athena** (consulta real).
- **Reales, pendientes de un servidor accesible**: bases de datos JDBC (el intento de conexión es real).
- **Implementados, pendientes de credenciales/registro de app**: OneDrive, BigQuery, Snowflake, etc. (devuelven error claro, no éxito fingido).

## Seguridad
Credenciales AWS desde `~/.aws` (nunca en el repo). Secretos enmascarados en la API. La base de datos con las conexiones (`data/`) está excluida de git.

## Archivos
`frontend/js/connections.js`, `frontend/js/conn-hub.js`, `frontend/css/connections-hub.css`,
`backend: web/ConnectionController.java`, `repo/ConnectionRepository.java`, `engine/connect/*`.

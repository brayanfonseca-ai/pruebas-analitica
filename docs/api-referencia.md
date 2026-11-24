# Referencia de API REST

Base: `http://localhost:8080/api/v1`. Todas las respuestas son JSON. Los errores
de negocio devuelven códigos claros (400/404); la IA y las conexiones degradan a
`{ok:false, message}` con 200 en lugar de 500.

**Autenticación**: toda la API (salvo `POST /auth/login`) exige `Authorization: Bearer <token>`. Sin sesión → 401;
sin el permiso de la ruta → 403; una app que el usuario no puede ver (por su etapa) → 404. Errores con forma `{detail}`.
Permiso exigido por ruta: ver [`modulos/12-configuracion-seguridad.md`](./modulos/12-configuracion-seguridad.md).

## Sesión, usuarios y permisos
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/auth/login` | `{email, password}` → `{token, expires_at, user}` (público). 401 si falla; 429 tras 5 intentos fallidos. |
| GET | `/auth/me` | Usuario actual con `permissions` efectivos. |
| POST | `/auth/logout` | Cierra la sesión. |
| PUT | `/auth/password` | `{current, password}` cambia la contraseña propia → `{token}` nuevo. |
| GET | `/auth/catalog` | Roles (con permisos), catálogo de permisos y etapas. |
| GET/POST | `/users` | (`users:manage`) Lista / crea `{email, name, password, role, active?, grant?, deny?}`. |
| GET/PUT/DELETE | `/users/{id}` | Detalle / edita `{email?, name?, role?, active?, grant?, deny?}` / elimina (sus apps pasan a quien borra). |
| PUT | `/users/{id}/password` | `{password}` restablece y cierra sus sesiones. |

## Apps
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/apps` | Apps que el usuario puede ver: `[{id, name, created_at, stage, owner_id, owner_name, sheets, published}]`. |
| POST | `/apps` | Crea app `{name}` → 201 `AppOut` (etapa `personal`, dueño el creador). |
| GET | `/apps/{appId}` | Detalle de una app. |
| PUT | `/apps/{appId}/stage` | `{stage: personal\|desarrollo\|produccion, owner_id?}`. Entrar/salir de `produccion` exige `apps:publish`. |
| DELETE | `/apps/{appId}` | Elimina la app y su contenido (`apps:delete`). |

## Tablas y datos
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/apps/{appId}/tables` | Lista tablas (con preview ≤ 50 filas). |
| POST | `/apps/{appId}/tables` | Sube un archivo (multipart `file`) → crea tabla. |
| GET | `/apps/{appId}/tables/{tableId}` | Tabla: columns (perfil), rows (total), preview. |
| GET | `/apps/{appId}/fields` | `{dimensions:[{table,field,type}], measures:[...]}`. |
| POST | `/apps/{appId}/fields/values` | Valores distintos de un campo `{field}`. |

## Consulta
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/apps/{appId}/query` | Agrega. Body `{dimension?:{table,field,expr?}, measures:[{table,field,agg,label?,formula?,parts?}], selections?}`. Sin dimensión → KPI escalar; con dimensión → labels+values. `formula`+`parts` = medida compuesta (los devuelve `/expressions/parse`). |
| POST | `/apps/{appId}/expressions/parse` | `{kind, expression, name?}` → spec compilado; en medidas incluye `value` (total) y, si es compuesta, `{composite, formula, parts, fields}`. |

## Pregúntale a tus datos y De archivo a tablero
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/apps/{appId}/ask` | `{question}` → `{ok, answer, chart, result, how, query, sheetObject}` o `{ok:false, message, suggestions}`. Ver [`modulos/15`](./modulos/15-preguntale-y-autotablero.md). |
| GET | `/apps/{appId}/ask/suggestions` | Preguntas sugeridas verificadas. |
| POST | `/apps/{appId}/auto-dashboard` | `{table?, title?}` → 201 `{sheet, summary, questions}`. |

## Automatizar: carga programada, alertas y salud
| Método | Ruta | Descripción |
|---|---|---|
| GET/PUT/DELETE | `/apps/{appId}/schedule` | Programación de la carga (`PUT`: `{frequency interval\|hourly\|daily\|weekly, interval_minutes?, time_of_day?, weekday?, notify fail\|always\|never, enabled?}`, `data:import`). |
| POST | `/apps/{appId}/schedule/run` | Ejecuta la carga ahora. |
| GET | `/apps/{appId}/reload-runs?limit=` | Historial de cargas. |
| GET/POST | `/apps/{appId}/alerts` | Alertas `{name, expression \| master_id, op, threshold, selections?, check_mode reload\|interval, interval_minutes?, enabled?}`. |
| PUT/DELETE | `/apps/{appId}/alerts/{id}` · POST `/alerts/{id}/check` | Editar / borrar (dueño o `apps:publish`) · revisar ahora. |
| GET | `/apps/{appId}/health` | Salud de datos `{score, status, tables, issues, counts}`. Ver [`modulos/16`](./modulos/16-automatizar.md). |

## Qué cambió · ¿qué pasaría si…? · del dato a la acción · agente de guardia
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/apps/{appId}/insights/explain` | Compara una medida entre dos periodos y la descompone por dimensión (relato + aportes). |
| POST | `/apps/{appId}/insights/rows` · `/insights/rows.csv` | Registros detrás de una cifra (filtros + condición por fila); CSV para Excel. |
| POST | `/apps/{appId}/insights/whatif` | Escenario hipotético sobre una copia de los datos: medidas antes/después. |
| GET/POST/PUT/DELETE | `/apps/{appId}/actions[/{id}]` · POST `/{id}/run` · GET `/{id}/export.csv` | Listas de acción (exportar / enviar a webhook). |
| GET/PUT/DELETE | `/apps/{appId}/watchdog` · POST `/watchdog/run` | Agente de guardia. Ver [`modulos/17`](./modulos/17-que-cambio-simular-actuar.md). |

## SQL, formato y ayuda de IA
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/apps/{appId}/expressions/translate` | `{expression, to: sql\|native}` → `{expression, to, from}` (`dashboard:view`). |
| POST | `/apps/{appId}/expressions/assist` | `{kind, prompt ≤500, current?}` → expresión SQL validada por el motor (`ai:use`). |
| POST/PUT | `/apps/{appId}/master-items[/{id}]` | Aceptan `format` (presentación); PUT solo con `{format}` no crea versión. |
| POST | `/apps/{appId}/script/convert` | `{text?, to: sql\|qlik}` → `{text, language}` sin guardar. `GET /script` devuelve `language`; `PUT /script` valida el SQL. Ver [`modulos/19`](./modulos/19-sql-formato-ia.md). |

## Automatizaciones por nodos (`charts:edit`)
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/flows/catalog` · `/flows/templates` | Catálogo de 23 nodos (parámetros, puertos, credenciales) y plantillas. |
| GET/POST | `/flows` | Lista / crea `{name, description?, graph {nodes, edges}}` (201). |
| GET/PUT/DELETE | `/flows/{id}` | Leer (con `problems`, `webhook_path`) / reemplazar / borrar. |
| POST | `/flows/{id}/enabled` · `/flows/{id}/run` · `/flows/{id}/webhook/rotate` | Activar/pausar `{enabled}` · ejecutar `{data?}` → `{run_id, status, steps[], output}` · URL nueva. |
| GET | `/flows/{id}/runs?limit=` · `/flows/{id}/runs/{runId}` | Historial y detalle por nodo. |
| GET/POST/PUT/DELETE | `/flows/credentials[/{id}]` · POST `/{id}/test` | Credenciales privadas (SMTP, WhatsApp Meta/Twilio, webhook de canal, cabecera HTTP); secretos ocultos. |
| POST/GET | `/hooks/flows/{token}` | **Público** (solo el token): dispara el flujo y responde `{ok, run_id, data}`; 404 token inválido, 409 pausada. Ver [`modulos/18`](./modulos/18-automatizaciones.md). |

## Cuadernos de análisis
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/apps/{appId}/notebooks` | Lista sin celdas: `[{id, name, description, cell_count, kinds, owner_id, owner_name, created_at, updated_at}]`. |
| POST | `/apps/{appId}/notebooks` | `{name, description?, cells?}` → 201 con celdas (`charts:edit`). Sin `cells` arranca con una consulta de la tabla principal. |
| GET/PUT/DELETE | `/apps/{appId}/notebooks/{id}` | Leer con celdas / actualizar `{name?, description?, cells?}` / borrar. Cambiar o borrar: solo el autor o un administrador. |
| GET | `/apps/{appId}/notebooks/schema` | `[{table, rows, columns:[{name, type, display?}]}]`. |
| POST | `/apps/{appId}/notebooks/run` | `{cell:{kind: sql\|profile\|pareto\|correlation\|outliers, sql?, params?}}` → resultado (solo lectura). Ver [`modulos/21`](./modulos/21-cuaderno-analisis.md). |

## Elementos maestros, métricas certificadas y comentarios
| Método | Ruta | Descripción |
|---|---|---|
| GET/POST | `/apps/{appId}/master-items` | Lista / crea (crea la versión 1). Cada ítem trae `certified, certified_by, certified_at, certified_note, version`. |
| PUT/DELETE | `/apps/{appId}/master-items/{itemId}` | Edita (versión nueva si cambia nombre/expresión/descripción; `message?`) / borra. Si está certificado exige `apps:publish`. |
| POST | `/apps/{appId}/master-items/{itemId}/certify` | `{certified, note?}` (`apps:publish`). |
| GET | `/apps/{appId}/master-items/{itemId}/versions` | Historial (más reciente primero). |
| POST | `/apps/{appId}/master-items/{itemId}/versions/{v}/restore` | Restaura como versión nueva. |
| GET/POST | `/apps/{appId}/comments` | `?sheetId=&objectId=` / `{sheetId, objectId, text, point?, selections?}` (`dashboard:view`). |
| PUT/DELETE | `/apps/{appId}/comments/{id}` | `{resolved}` / borrar (autor o `apps:publish`). |

## Modelo de datos
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/apps/{appId}/model` | Grafo de tablas/enlaces/avisos. |

## Script de carga
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/apps/{appId}/script` | `{app_id, text, is_custom}`. |
| PUT | `/apps/{appId}/script` | Guarda el script `{text}`. |
| POST | `/apps/{appId}/script/run` | Ejecuta la carga → `{ok, log[], tables[]}`. |

## Hojas
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/apps/{appId}/sheets` | Lista hojas. |
| POST | `/apps/{appId}/sheets` | Crea hoja `{title, description, objects, props}`. Normaliza objetos planos (ver SheetObjectNormalizer). |
| PUT | `/apps/{appId}/sheets/{sheetId}` | Actualiza. |
| PUT | `/apps/{appId}/sheets/{sheetId}/visibility` | Cambia visibilidad. |
| DELETE | `/apps/{appId}/sheets/{sheetId}` | Elimina. |

## Field overrides (preparación de datos)
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/apps/{appId}/tables/{tableId}/field-overrides` | Overrides de la tabla. |
| PUT | `/apps/{appId}/tables/{tableId}/field-overrides` | Guarda rename/forced_type/hidden. `forced_type ∈ {text,number,date}`. |

## Modelo lógico (Business Logic)
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/apps/{appId}/logical-model` | Documento efectivo (default + guardado) con `summary` y `enabled`. |
| PUT | `/apps/{appId}/logical-model` | Guarda el documento (campos, clasificación…). |
| POST | `/apps/{appId}/logical-model/reset` | Regenera desde los datos. |
| POST | `/apps/{appId}/logical-model/enable` · `/disable` | Habilita/deshabilita la lógica. |
| POST/PUT/DELETE | `.../groups`, `.../packages`, `.../hierarchies`, `.../behaviors`, `.../calendar-periods` | CRUD de cada colección. |

## Conexiones de datos
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/apps/{appId}/connections` | Lista (secretos enmascarados). |
| POST | `/apps/{appId}/connections` | Crea `{name, connector, space?, config}`. |
| POST | `/apps/{appId}/connections/test` | Prueba REAL de conexión → `{ok, message}`. |
| POST | `/apps/{appId}/connections/{connId}/load` | Carga datos a una tabla de `appId` (la conexión puede ser de otra app). Params `{table?, database?, query?, key?, limit?, tableName?}`. Reemplaza la tabla si ya existe. → `{ok, message, table, replaced, script}`. |
| DELETE | `/apps/{appId}/connections/{connId}` | Elimina. |
| GET | `/connections` | **Conexiones realizadas**: todas las conexiones (cualquier app) con `app_name`; secretos enmascarados. |
| POST | `/connections/{connId}/browse` | Explora: Athena `{}` → bases, `{database}` → tablas con columnas; JDBC → tablas/vistas; S3 `{prefix?}` → CSV/Excel. → `{ok, level, items}`. |
| POST | `/connections/{connId}/preview` | Valida la extracción sin materializar. Body = params de carga `{table\|query\|key, database?, mode: all\|partial\|sample, limit, tableName?, transform?}` → `{ok, raw:{columns,rows}, columns, rows (transformadas), nulls, warnings, transformError?, tableName, mode, limit, sql, script, elapsedMs}`; error real de la fuente → `{ok:false, message}`. |
| POST | `/connections/{connId}/transform` | `{params, columns, rows}` → mismo formato que preview, sin volver a la fuente. |
| POST | `/connections/{connId}/parse-script` | `{script, columns?, params?}` → `{ok, params (table/query, database, mode, limit, tableName, transform), script, sql}` o `{ok:false, message}`. |

## Asistente de IA
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/ai/health` | `{ok, agent, model, region}`. |
| POST | `/ai/modelar` | Ingeniero de datos: propone modelo + script. |
| POST | `/ai/analizar` | Analista: responde `{pregunta, contexto}`. |
| POST | `/ai/disenar` | Diseñador: propone dashboard; puede devolver `action`. |

Respuesta IA: `{ok, message, agent, action?}`. `action` puede traer un plan
(`build-sheet`/`add-objects`/`apply-script`) que el frontend ejecuta.

## Experimentos de ML
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/ml/experiments` | Lista con app, tabla, nº de ejecuciones y último algoritmo. |
| POST | `/ml/experiments` | Crea `{appId, name, description?, table?}`. Sin nombre o app → 400. |
| GET | `/ml/experiments/{id}` | Detalle: `tables`, `dataset` (campos por tipo con distintos/vacíos + `preview`) y `runList`. |
| PUT | `/ml/experiments/{id}` | Edita `{name?, description?, table?}`. |
| DELETE | `/ml/experiments/{id}` | Elimina el experimento y sus ejecuciones. |
| POST | `/ml/experiments/{id}/runs` | Entrena `{algorithm, params, label?, save?}`; guarda la ejecución (salvo `save:false` o `params.input`) y devuelve el resultado con `runId`. |
| GET | `/ml/experiments/{id}/runs/{runId}` | Resultado completo de una ejecución guardada. |
| DELETE | `/ml/experiments/{id}/runs/{runId}` | Elimina una ejecución. |
| POST | `/ml/experiments/{id}/runs/{runId}/associate` | **Asociar a**: `{appId?, sheetTitle?}` → crea/reemplaza la tabla `ML_…` (resultado por fila enlazado por clave, o tabla resumen) y la hoja con `props.ml`. → `{ok, appId, table:{id,name,rows,fields}, key, sheet:{id,title,objects}, message}`. |
| GET | `/apps/{appId}/ml/datasets` | Tablas de una app con campos agrupados (`numeric`, `categorical`, `dates`). |
| POST | `/apps/{appId}/ml/run` | Ejecución directa sin guardar: `{table, algorithm, params}`. |

`algorithm` ∈ `kmeans`, `hierarchical`, `dbscan`, `pca`, `correlation`, `anomaly`, `rules`,
`linear`, `ridge`, `lasso`, `poly`, `tree`, `forest`, `gbm`, `knn`, `logistic`, `bayes`,
`forecast`, `automl`.

| Algoritmo | `params` |
|---|---|
| `kmeans` | `features[]`, `k` (0 = automático), `standardize` |
| `hierarchical` | `features[]`, `linkage` (`ward`/`average`/`complete`/`single`), `k` (0 = automático) |
| `dbscan` | `features[]`, `eps?`, `minPts?` (automáticos si faltan) |
| `pca`, `correlation` | `features[]` |
| `anomaly` | `features[]`, `method` (`both`/`zscore`/`iqr`), `threshold` |
| `rules` | `features[]` categóricas, `minSupport`, `minConfidence` |
| `linear`, `ridge`, `lasso`, `poly` | `target`, `features[]`, `testSize`; `lambda` (ridge/lasso/poly), `degree` (poly) |
| `tree`, `forest`, `gbm`, `knn` | `target`, `features[]`, `task` (`regression`/`classification`), `testSize` y sus hiperparámetros (`maxDepth`, `minLeaf`, `nTrees`, `rounds`, `learningRate`, `k`) |
| `logistic`, `bayes` | `target`, `features[]`, `testSize`, `positive?`, `threshold?` |
| `forecast` | `measure`, `period`, `horizon`, `aggregation` (`sum`/`avg`) |
| `automl` | `target`, `features[]`, `task`, `testSize` (y `positive?`/`threshold?` en clasificación) |

Con `params.input` (`{campo: valor}`) en K-Means y en cualquier modelo supervisado o AutoML,
la respuesta incluye `prediction` para ese caso. Todas las respuestas traen `insights[]`, `n`,
`elapsedMs` y `table`. Errores de entrada: **400** con `message` legible.


## Conexiones por usuario, notas para agente y embeds (nuevo)

Las conexiones son **del usuario** (privadas; se comparten): ver [`modulos/07-conexiones.md`](./modulos/07-conexiones.md).
Notas y embeds: ver [`modulos/13-notas-agente.md`](./modulos/13-notas-agente.md) y [`modulos/14-embedding.md`](./modulos/14-embedding.md).

| Método | Ruta | Permiso | Descripción |
|---|---|---|---|
| POST | `/connections` · `/connections/test` | `connections:manage` | Crear / probar conexión del usuario. |
| PUT, DELETE | `/connections/{id}` | `connections:manage` (dueño) | Editar / eliminar. |
| GET | `/connections/share-targets` | `connections:manage` | Personas con quienes compartir. |
| PUT | `/connections/{id}/shares` | `connections:manage` (dueño) | `{user_ids}`. |
| GET, PUT | `/apps/{appId}/notes` | `charts:edit` | Diccionario de datos. |
| GET | `/apps/{appId}/notes/context` | `charts:edit` | Texto que recibe el agente. |
| POST | `/apps/{appId}/notes/suggest` | `charts:edit` | Borradores con IA (no guarda). |
| GET, POST | `/embeds` | `embed:manage` | Listar / crear `{name, app_id, sheet_ids: [..] (o sheet_id), allowed_origins?, expires_in_days?, options? {theme, hideTitle, hideSelections, hideTabs}}`. Devuelve `sheet_ids` y `sheets:[{id, title, published}]`. |
| PUT, DELETE | `/embeds/{id}` | `embed:manage` | Editar (`enabled`, `sheet_ids` (reemplaza; el token no cambia)…) / eliminar. |
| POST | `/embeds/{id}/rotate` | `embed:manage` | Token nuevo. |
| GET | `/embed/{token}` (fuera de `/api/v1`) | público | Página incrustable. |

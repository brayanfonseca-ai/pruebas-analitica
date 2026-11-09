# Referencia de API REST

Base: `http://localhost:8080/api/v1`. Todas las respuestas son JSON. Los errores
de negocio devuelven códigos claros (400/404); la IA y las conexiones degradan a
`{ok:false, message}` con 200 en lugar de 500.

## Apps
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/apps` | Lista apps `[{id, name, created_at}]`. |
| POST | `/apps` | Crea app `{name}` → 201 `AppOut`. |
| GET | `/apps/{appId}` | Detalle de una app. |
| DELETE | `/apps/{appId}` | Elimina la app y su contenido. |

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
| POST | `/apps/{appId}/query` | Agrega. Body `{dimension?:{table,field}, measures:[{table,field,agg}], selections?}`. Sin dimensión → KPI escalar; con dimensión → labels+values. |

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
| POST | `/apps/{appId}/connections/{connId}/load` | Carga datos de la conexión a una tabla. |
| DELETE | `/apps/{appId}/connections/{connId}` | Elimina. |

## Asistente de IA
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/ai/health` | `{ok, agent, model, region}`. |
| POST | `/ai/modelar` | Ingeniero de datos: propone modelo + script. |
| POST | `/ai/analizar` | Analista: responde `{pregunta, contexto}`. |
| POST | `/ai/disenar` | Diseñador: propone dashboard; puede devolver `action`. |

Respuesta IA: `{ok, message, agent, action?}`. `action` puede traer un plan
(`build-sheet`/`add-objects`/`apply-script`) que el frontend ejecuta.

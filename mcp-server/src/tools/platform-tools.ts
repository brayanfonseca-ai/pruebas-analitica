/**
 * Tools de PLATAFORMA del MCP de DataSense: cubren todo lo que hace la UI y no
 * estaba en las tools de contexto/accion originales.
 *
 *  - Conexiones realizadas (stack global): listar, explorar, vista previa, cargar, borrar.
 *  - Datos: subir archivo (CSV/Excel), borrar tabla, preparacion de campos (overrides).
 *  - Modelo: asociaciones (recomendar, crear, aceptar, borrar).
 *  - Elementos maestros y validador de expresiones.
 *  - Modelo logico (documento, activar/reset, grupos, paquetes, jerarquias, comportamientos, periodos).
 *  - Hojas: borrar, visibilidad, catalogo de tipos, anadir gráficos de ML.
 *  - Experimentos de ML: CRUD, entrenar, ejecuciones, "Asociar a" (tabla + hoja).
 *  - Colecciones.
 *
 * REGLA DEL PROYECTO: toda funcionalidad nueva de DataSense debe exponerse aqui
 * (o en action/context-tools) en el mismo cambio. Ver .kiro/steering/mcp-paridad.md.
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { z } from "zod";
import { get, post, put, del, postForm, toToolText } from "../http-client.js";
import type { ContextTool } from "./context-tools.js";

const id = (d: string) => z.string().min(1).describe(d);
const appId = { appId: id("Identificador de la aplicacion (appId).") };
const A = (appIdValue: unknown) => `/api/v1/apps/${encodeURIComponent(String(appIdValue))}`;
const E = (v: unknown) => encodeURIComponent(String(v));
const free = (d: string) => z.record(z.string(), z.any()).describe(d);

/** Quita claves undefined para no enviarlas al backend. */
function pick(args: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (args[k] !== undefined) out[k] = args[k];
  return out;
}

/* ------------------------------------------------------------------------ */
/* Catalogos estaticos (para que el agente sepa que puede pedir)             */
/* ------------------------------------------------------------------------ */

const ML_ALGORITHMS = {
  nota: "POST train_model con {algorithm, params}. 'features' = lista de campos numericos (rules: categoricos). Campos por nombre fisico de la tabla del experimento.",
  segmentacion: {
    kmeans: { params: { features: "string[] (>=2 numericos)", k: "int (0/omitir = automatico por silueta)", standardize: "bool (default true)" } },
    hierarchical: { params: { features: "string[] (>=2)", linkage: "ward|average|complete|single", k: "int (0 = automatico)" } },
    dbscan: { params: { features: "string[] (>=2)", eps: "number (omitir = automatico)", minPts: "int (omitir = automatico)" } },
  },
  exploracion: {
    pca: { params: { features: "string[] (>=2)" } },
    correlation: { params: { features: "string[] (>=2)" } },
    anomaly: { params: { features: "string[] (>=1)", method: "both|zscore|iqr", threshold: "number (default 2.5)" } },
    rules: { params: { features: "string[] categoricos (>=2)", minSupport: "0.01-0.9 (0.1)", minConfidence: "0.05-1 (0.5)" } },
  },
  regresion: {
    linear: { params: { target: "campo numerico", features: "string[]", testSize: "0-0.5 (0.2)" } },
    ridge: { params: { target: "", features: "", lambda: "number (1)", testSize: "" } },
    lasso: { params: { target: "", features: "", lambda: "number (0.1)", testSize: "" } },
    poly: { params: { target: "", features: "", degree: "2|3|4", lambda: "number (1)", testSize: "" } },
    tree: { params: { task: "regression", target: "", features: "", maxDepth: "1-12 (5)", minLeaf: "int (5)" } },
    forest: { params: { task: "regression", target: "", features: "", nTrees: "5-300 (60)", maxDepth: "1-12 (8)", minLeaf: "int (3)" } },
    gbm: { params: { task: "regression", target: "", features: "", rounds: "10-400 (80)", learningRate: "0.01-1 (0.1)", maxDepth: "1-6 (3)" } },
    knn: { params: { task: "regression", target: "", features: "", k: "1-50 (5)" } },
  },
  clasificacion: {
    logistic: { params: { target: "campo (categorico o numerico con threshold)", features: "string[]", positive: "valor de la clase positiva (opcional)", threshold: "number (objetivo numerico)", testSize: "" } },
    bayes: { params: { target: "", features: "", positive: "", threshold: "" } },
    tree: { params: { task: "classification", target: "", features: "", maxDepth: "", minLeaf: "" } },
    forest: { params: { task: "classification", target: "", features: "", nTrees: "", maxDepth: "" } },
    gbm: { params: { task: "classification", target: "", features: "", rounds: "", learningRate: "", maxDepth: "" } },
    knn: { params: { task: "classification", target: "", features: "", k: "" } },
  },
  series: { forecast: { params: { measure: "campo numerico", period: "campo de periodo (fecha, mes, anio…)", horizon: "1-24 (3)", aggregation: "sum|avg" } } },
  automl: { automl: { params: { task: "regression|classification", target: "", features: "", testSize: "", positive: "(clasificacion)" } } },
  probar_un_caso: "Anadir params.input = {campo: valor, ...} devuelve 'prediction' sin guardar la ejecucion.",
};

const CHART_TYPES = {
  datos: {
    nota: "Formato plano en create_sheet/update_sheet: {type, title, dimension:'campo' | ['c1','c2'], measure:{field,agg} | [..], x,y,w,h}. Rejilla de 24 columnas, sin solapes.",
    visualizaciones: ["bar", "line", "pie", "combo", "scatter", "kpi", "gauge", "table", "pivot", "annotationtable", "filterpane", "histogram", "boxplot", "distribution", "block", "gridchart", "funnel", "waterfall", "bulletchart", "mekko", "sankey", "map", "orgchart"],
    cuadro_de_mando: ["text (props.text)", "button", "hline", "navmenu", "image", "video", "layoutcontainer", "tabcontainer", "matrixcontainer"],
    heredado: ["radar", "network", "wordcloud", "variance"],
  },
  machine_learning: {
    nota: "Dibujan una ejecucion guardada de Experimentos de ML: props.ml = {experimentId, runId}. Usa add_ml_chart para anadirlos con la ejecucion validada.",
    clusterizacion: { "ml-clustermap": "Mapa de clusters (12x9)", "ml-elbow": "Eleccion de k: inercia y silueta (12x9)", "ml-silhouette": "Silhouette score (6x4)", "ml-segments": "Perfiles de segmentos (24x8)", "ml-profile": "Perfil z por segmento (12x8)", "ml-sizes": "Tamano de segmentos (12x8)" },
    regresion: { "ml-actualpred": "Real vs predicho (12x9)", "ml-importance": "Importancia de variables (12x8)", "ml-coefs": "Coeficientes (12x8)" },
    clasificacion: { "ml-roc": "Curva ROC (12x9)", "ml-confusion": "Matriz de confusion (10x8)" },
    series: { "ml-forecast": "Pronostico (24x9)" },
    exploracion: { "ml-corr": "Matriz de correlacion (12x9)", "ml-pca": "Varianza PCA (12x8)", "ml-anomaly": "Distribucion de atipicos (12x8)", "ml-rules": "Reglas de asociacion (24x8)" },
    cualquier_modelo: { "ml-metrics": "Metricas del modelo (24x3)", "ml-insights": "Lectura del resultado (12x5)", "ml-leaderboard": "Ranking AutoML (12x9, solo automl)" },
    presentacion: "props.look.legend (bool), props.look.tooltip (bool), props.look.mlPalette ('datasense'|'sense').",
  },
};

const ML_SIZES: Record<string, [number, number]> = {
  "ml-clustermap": [12, 9], "ml-elbow": [12, 9], "ml-silhouette": [6, 4], "ml-segments": [24, 8], "ml-profile": [12, 8], "ml-sizes": [12, 8],
  "ml-actualpred": [12, 9], "ml-importance": [12, 8], "ml-coefs": [12, 8], "ml-roc": [12, 9], "ml-confusion": [10, 8], "ml-leaderboard": [12, 9],
  "ml-forecast": [24, 9], "ml-corr": [12, 9], "ml-pca": [12, 8], "ml-anomaly": [12, 8], "ml-rules": [24, 8], "ml-metrics": [24, 3], "ml-insights": [12, 5],
};
const ML_TITLES: Record<string, string> = {
  "ml-clustermap": "Mapa de clusters", "ml-elbow": "Elección de k (inercia y silueta)", "ml-silhouette": "Silhouette score", "ml-segments": "Perfiles de segmentos",
  "ml-profile": "Perfil z por segmento", "ml-sizes": "Tamaño de segmentos", "ml-actualpred": "Real vs predicho", "ml-importance": "Importancia de variables",
  "ml-coefs": "Coeficientes", "ml-roc": "Curva ROC", "ml-confusion": "Matriz de confusión", "ml-leaderboard": "Ranking AutoML", "ml-forecast": "Pronóstico",
  "ml-corr": "Matriz de correlación", "ml-pca": "Varianza explicada (PCA)", "ml-anomaly": "Distribución de atípicos", "ml-rules": "Reglas de asociación",
  "ml-metrics": "Métricas del modelo", "ml-insights": "Lectura del resultado",
};

/** ¿La vista ML se puede dibujar con este resultado? (misma regla que frontend/js/ml-views.js) */
function mlFits(type: string, r: Record<string, any>): boolean {
  const b = r?.algorithm === "automl" && r.best ? r.best : r;
  const cluster = ["kmeans", "hierarchical", "dbscan"].includes(b?.algorithm);
  const cls = b?.task === "classification" || b?.algorithm === "logistic";
  const reg = !cls && (b?.task === "regression" || b?.algorithm === "linear");
  switch (type) {
    case "ml-clustermap": case "ml-elbow": case "ml-segments": case "ml-profile": case "ml-sizes": return cluster;
    case "ml-silhouette": return cluster && b.silhouette != null;
    case "ml-actualpred": return reg && !!b.scatter?.length;
    case "ml-importance": return !!b?.importance?.length;
    case "ml-coefs": return !!b?.coefficients?.length;
    case "ml-roc": return cls && !!b.roc?.length;
    case "ml-confusion": return cls && !!b.confusion;
    case "ml-leaderboard": return r?.algorithm === "automl";
    case "ml-forecast": return r?.algorithm === "forecast";
    case "ml-corr": return r?.algorithm === "correlation";
    case "ml-pca": return r?.algorithm === "pca";
    case "ml-anomaly": return r?.algorithm === "anomaly";
    case "ml-rules": return r?.algorithm === "rules";
    case "ml-metrics": case "ml-insights": return true;
    default: return false;
  }
}

/** Primer hueco libre w×h en la rejilla de 24 columnas. */
function freeSlot(objects: Array<Record<string, any>>, w: number, h: number): { x: number; y: number } {
  const occ = (x: number, y: number) => objects.some((o) => x < (o.x ?? 0) + (o.w ?? 0) && x + w > (o.x ?? 0) && y < (o.y ?? 0) + (o.h ?? 0) && y + h > (o.y ?? 0));
  for (let y = 0; y < 400; y++) for (let x = 0; x + w <= 24; x++) if (!occ(x, y)) return { x, y };
  return { x: 0, y: objects.reduce((m, o) => Math.max(m, (o.y ?? 0) + (o.h ?? 0)), 0) };
}

/** Parametros de extraccion comunes a preview_connection / load_connection. */
const EXTRACTION = {
  table: z.string().optional().describe("Tabla (SQL/Athena)."),
  database: z.string().optional().describe("Base (Athena)."),
  query: z.string().optional().describe("Consulta SQL propia (reemplaza 'table')."),
  key: z.string().optional().describe("Objeto S3 (CSV/xlsx)."),
  mode: z.enum(["all", "partial", "sample"]).optional().describe("all = todo sin limite; partial = primeras 'limit' filas (default); sample = 'limit' filas aleatorias."),
  limit: z.number().optional().describe("Cantidad de filas para partial/sample (default 1000)."),
  tableName: z.string().optional().describe("Nombre de la tabla destino."),
  transform: z.object({
    columns: z.array(z.object({
      source: z.string().describe("Columna de origen."),
      include: z.boolean().optional().describe("false = no se carga."),
      name: z.string().optional().describe("Nuevo nombre (en el script: [origen] AS [nombre])."),
      type: z.enum(["auto", "text", "integer", "decimal", "date"]).optional(),
      text: z.enum(["none", "trim", "upper", "lower"]).optional(),
      nulls: z.enum(["keep", "remove", "fill"]).optional().describe("remove = quitar filas con vacio; fill = reemplazar por 'fill'."),
      fill: z.string().optional(),
    }).passthrough()).optional(),
    computed: z.array(z.object({ name: z.string(), expr: z.string().describe("Ej: [A] + [B], [Nombre] & ' ' & [Apellido], If([x] > 0, 'Si', 'No'), Round([v], 2), Year([fecha]).") })).optional(),
    filter: z.string().optional().describe("Condicion de filas a conservar, ej: [ANIO] >= 2024 AND [ESTADO] = 'ACTIVO'."),
    distinct: z.boolean().optional().describe("Quitar filas duplicadas."),
  }).optional().describe("Transformaciones previas a la carga (estilo Power Query)."),
};
const EXTRACTION_KEYS = Object.keys(EXTRACTION);

const mlChartType = z.enum(Object.keys(ML_SIZES) as [string, ...string[]]).describe("Tipo de grafico de ML (ver list_chart_types).");
const logicalCollections = z.enum(["groups", "packages", "hierarchies", "behaviors", "calendar-periods"]).describe("Coleccion del modelo logico.");

export const platformTools: ContextTool[] = [
  /* ============================ Catalogos ============================ */
  {
    name: "list_chart_types",
    title: "Catalogo de tipos de grafico",
    description: "Devuelve todos los tipos de objeto de hoja que se pueden crear (datos y Machine Learning) con su formato y tamano por defecto.",
    inputShape: {},
    handler: async () => toToolText(CHART_TYPES),
  },
  {
    name: "list_ml_algorithms",
    title: "Catalogo de algoritmos de ML",
    description: "Devuelve los 24 algoritmos de Experimentos de ML con los params que acepta train_model (features, target, k, task, horizon…).",
    inputShape: {},
    handler: async () => toToolText(ML_ALGORITHMS),
  },

  /* ============================ Conexiones realizadas ============================ */
  {
    name: "list_all_connections",
    title: "Conexiones realizadas (todas las apps)",
    description: "Conexiones de la cuenta del MCP: las que creo ('mine':true, con 'shared_with') y las que le compartieron ('mine':false, con 'owner_name'). Las conexiones son del USUARIO y privadas: ni siquiera el admin ve las ajenas no compartidas. Secretos enmascarados. GET /api/v1/connections.",
    inputShape: {},
    handler: async () => toToolText(await get("/api/v1/connections")),
  },
  {
    name: "browse_connection",
    title: "Explorar una conexion",
    description: "Explora objetos de una conexion. Athena: sin 'database' lista bases; con 'database' lista tablas con columnas. JDBC: tablas/vistas. S3: archivos CSV/Excel bajo 'prefix'. POST /api/v1/connections/{connId}/browse.",
    inputShape: { connId: id("Id de la conexion."), database: z.string().optional().describe("Base (Athena)."), prefix: z.string().optional().describe("Prefijo/carpeta (S3).") },
    handler: async (a) => toToolText(await post(`/api/v1/connections/${E(a.connId)}/browse`, pick(a, ["database", "prefix"]))),
  },
  {
    name: "preview_connection",
    title: "Validar extraccion (vista previa)",
    description: "Valida la extraccion: trae una muestra REAL (max 50 filas, todas las columnas en 'raw') SIN cargarla, le aplica 'transform' y devuelve {raw, columns, rows (transformadas), nulls por columna, warnings, transformError?, sql, script}. Errores reales de la fuente en {ok:false,message}. POST /api/v1/connections/{connId}/preview.",
    inputShape: { connId: id("Id de la conexion."), ...EXTRACTION },
    handler: async (a) => toToolText(await post(`/api/v1/connections/${E(a.connId)}/preview`, pick(a, EXTRACTION_KEYS))),
  },
  {
    name: "transform_preview",
    title: "Re-aplicar transformaciones a una muestra",
    description: "Aplica 'params.transform' a una muestra ya extraida (columns + rows de preview_connection.raw) sin volver a la fuente. Devuelve columnas/filas transformadas, avisos, el SQL y el script de carga (LOAD con AS, Num(), Alt(), WHERE…). POST /api/v1/connections/{connId}/transform.",
    inputShape: {
      connId: id("Id de la conexion."), params: free("Params de carga (table/query, database, mode, limit, tableName, transform)."),
      columns: z.array(z.string()).describe("Columnas de origen de la muestra."), rows: z.array(z.array(z.any())).describe("Filas de la muestra."),
    },
    handler: async (a) => toToolText(await post(`/api/v1/connections/${E(a.connId)}/transform`, pick(a, ["params", "columns", "rows"]))),
  },
  {
    name: "parse_load_script",
    title: "Interpretar un script de carga editado",
    description: "Convierte un bloque de script ([Tabla]: LOAD campos [AS …] [WHERE …]; SQL SELECT …;) en params de carga + transform, para luego usar load_connection. Las columnas conocidas no listadas quedan excluidas. POST /api/v1/connections/{connId}/parse-script.",
    inputShape: {
      connId: id("Id de la conexion."), script: id("Bloque de script."),
      columns: z.array(z.string()).optional().describe("Columnas de origen conocidas (de preview_connection.raw.columns)."),
      params: free("Params actuales (p. ej. database).").optional(),
    },
    handler: async (a) => toToolText(await post(`/api/v1/connections/${E(a.connId)}/parse-script`, pick(a, ["script", "columns", "params"]))),
  },
  {
    name: "load_connection",
    title: "Cargar datos desde una conexion",
    description: "Trae datos de una conexion (de cualquier app), aplica 'transform' (quitar/renombrar columnas, tipos, limpieza de nulos, calculadas, filtro, duplicados) y los materializa como tabla del modelo de 'appId'. mode: all (todo) | partial (primeras 'limit') | sample (aleatorias 'limit'). Reemplaza la tabla si existe; el script auto-generado queda con LIB CONNECT + LOAD + SQL y run_script re-extrae con las mismas transformaciones. Devuelve {ok, message, table, rowsExtracted, warnings?, replaced, script}. POST /api/v1/apps/{appId}/connections/{connId}/load.",
    inputShape: { ...appId, connId: id("Id de la conexion."), ...EXTRACTION },
    handler: async (a) => toToolText(await post(`${A(a.appId)}/connections/${E(a.connId)}/load`, pick(a, EXTRACTION_KEYS))),
  },
  {
    name: "delete_connection",
    title: "Borrar conexion",
    description: "ACCION DESTRUCTIVA: elimina una conexion propia (deja de estar disponible tambien para quienes la compartieron). Solo el dueno puede borrarla. Las tablas ya cargadas no se borran. DELETE /api/v1/connections/{connId}.",
    inputShape: { appId: z.string().optional().describe("Obsoleto, se ignora (las conexiones son del usuario)."), connId: id("Id de la conexion.") },
    handler: async (a) => toToolText(await del(`/api/v1/connections/${E(a.connId)}`)),
  },
  {
    name: "update_connection",
    title: "Editar una conexion propia",
    description: "Cambia nombre, espacio, descripcion o configuracion de una conexion propia ({name?, space?, description?, config?}). Los secretos enmascarados ('••••••') se conservan. Solo el dueno puede editarla. PUT /api/v1/connections/{connId}.",
    inputShape: {
      connId: id("Id de la conexion."), name: z.string().optional().describe("Nombre nuevo."), space: z.string().optional().describe("Espacio."),
      description: z.string().optional().describe("Descripcion."), config: free("Configuracion del conector (parcial o completa).").optional(),
    },
    handler: async (a) => toToolText(await put(`/api/v1/connections/${E(a.connId)}`, pick(a, ["name", "space", "description", "config"]))),
  },
  {
    name: "get_connection_share_targets",
    title: "Con quien se puede compartir una conexion",
    description: "Usuarios activos con permiso connections:manage (distintos de la cuenta del MCP) a quienes se puede compartir una conexion: [{id, name, email, role}]. GET /api/v1/connections/share-targets.",
    inputShape: {},
    handler: async () => toToolText(await get("/api/v1/connections/share-targets")),
  },
  {
    name: "share_connection",
    title: "Compartir una conexion",
    description: "Define con quien se comparte una conexion PROPIA (reemplaza la lista; [] la vuelve privada). Quien la recibe puede usarla (explorar, vista previa, cargar datos) pero no editarla, borrarla ni re-compartirla. Ej.: el admin crea una conexion y se la comparte al desarrollador. PUT /api/v1/connections/{connId}/shares con {user_ids}.",
    inputShape: { connId: id("Id de la conexion."), userIds: z.array(z.string()).describe("Ids de usuario (de get_connection_share_targets o list_users). [] = privada.") },
    handler: async (a) => toToolText(await put(`/api/v1/connections/${E(a.connId)}/shares`, { user_ids: a.userIds })),
  },

  /* ============================ Notas para el agente (diccionario de datos) ============================ */
  {
    name: "get_data_notes",
    title: "Notas para el agente (leer)",
    description: "Diccionario de datos de una app: contexto del negocio, tablas y columnas con tipo, muestras, descripcion, tipo semantico (id|dimension|measure|date|category|text|flag), sinonimos, cruces definidos y cruces sugeridos por nombre, mas la cobertura (% documentado). Requiere charts:edit. GET /api/v1/apps/{appId}/notes.",
    inputShape: appId,
    handler: async (a) => toToolText(await get(`${A(a.appId)}/notes`)),
  },
  {
    name: "update_data_notes",
    title: "Notas para el agente (guardar)",
    description: "Guarda (upsert) el diccionario de datos: {app_text?, tables:[{name, description?, grain?, columns:[{name, description?, semantic?, synonyms? (texto), joins?:[{table, column, note?}]}]}]}. Solo cambia lo enviado; una columna sin nada se borra. Los asistentes de IA y get_agent_context leen estas notas. PUT /api/v1/apps/{appId}/notes.",
    inputShape: { ...appId, appText: z.string().optional().describe("Contexto general del negocio para la app."), tables: z.array(free("Tabla: {name, description?, grain?, columns:[...]}")).optional().describe("Tablas y columnas a documentar.") },
    handler: async (a) => toToolText(await put(`${A(a.appId)}/notes`, { ...(a.appText !== undefined ? { app_text: a.appText } : {}), ...(a.tables ? { tables: a.tables } : {}) })),
  },
  {
    name: "get_agent_context",
    title: "Contexto de datos para el agente",
    description: "Texto (markdown) con lo documentado de la app: que es cada tabla/columna, sinonimos y con que se cruza. Leelo ANTES de analizar o modelar los datos de una app. Si viene vacio, documenta con update_data_notes o suggest_data_notes. GET /api/v1/apps/{appId}/notes/context.",
    inputShape: appId,
    handler: async (a) => toToolText(await get(`${A(a.appId)}/notes/context`)),
  },
  {
    name: "suggest_data_notes",
    title: "Notas para el agente: borradores con IA",
    description: "Pide a la IA borradores de descripcion y tipo semantico para lo no documentado ({table?} limita a una tabla). NO guarda: revisa y guarda con update_data_notes. Devuelve {ok, tables:[{name, description, columns:[{name, description, semantic}]}]}. POST /api/v1/apps/{appId}/notes/suggest.",
    inputShape: { ...appId, table: z.string().optional().describe("Solo esta tabla.") },
    handler: async (a) => toToolText(await post(`${A(a.appId)}/notes/suggest`, pick(a, ["table"]))),
  },

  /* ============================ Embedding (tableros incrustables) ============================ */
  {
    name: "list_embeds",
    title: "Embeds de tableros",
    description: "Lista los embeds con id, token (dse_…), app, hoja, estado (active|revoked|expired|unpublished), orígenes permitidos, vencimiento, vistas y URL (/embed/{token}). Requiere embed:manage. GET /api/v1/embeds.",
    inputShape: {},
    handler: async () => toToolText(await get("/api/v1/embeds")),
  },
  {
    name: "create_embed",
    title: "Crear un embed",
    description: "Crea un embed (ID + token de solo lectura) de UNA hoja para incrustarla en otra pagina web con <iframe src='{base}/embed/{token}'> o el SDK /js/embed-sdk.js. Solo muestra datos si la app esta en produccion (set_app_stage) y la hoja publicada (set_sheet_visibility). {name, appId, sheetId, allowedOrigins? (vacio = cualquier sitio), expiresInDays? (0/omitir = nunca), options? {theme: light|dark, hideTitle, hideSelections}}. POST /api/v1/embeds.",
    inputShape: {
      name: id("Nombre del embed."), appId: id("Id de la app."), sheetId: id("Id de la hoja."),
      allowedOrigins: z.array(z.string()).optional().describe("Sitios que pueden incrustarlo, ej. https://portal.miempresa.com."),
      expiresInDays: z.number().int().min(0).optional().describe("Dias hasta que vence el token (0 = nunca)."),
      options: free("{theme?, hideTitle?, hideSelections?}").optional(),
    },
    handler: async (a) => toToolText(await post("/api/v1/embeds", {
      name: a.name, app_id: a.appId, sheet_id: a.sheetId,
      ...(a.allowedOrigins ? { allowed_origins: a.allowedOrigins } : {}),
      ...(a.expiresInDays !== undefined ? { expires_in_days: a.expiresInDays } : {}),
      ...(a.options ? { options: a.options } : {}),
    })),
  },
  {
    name: "update_embed",
    title: "Editar, activar o desactivar un embed",
    description: "{name?, enabled? (false = revoca sin borrar), allowedOrigins?, expiresInDays? (0 = quitar vencimiento), options?}. PUT /api/v1/embeds/{embedId}.",
    inputShape: {
      embedId: id("Id del embed."), name: z.string().optional().describe("Nombre."), enabled: z.boolean().optional().describe("Activo o revocado."),
      allowedOrigins: z.array(z.string()).optional().describe("Sitios permitidos (reemplaza)."), expiresInDays: z.number().int().min(0).optional().describe("Dias hasta vencer; 0 = nunca."),
      options: free("{theme?, hideTitle?, hideSelections?}").optional(),
    },
    handler: async (a) => toToolText(await put(`/api/v1/embeds/${E(a.embedId)}`, {
      ...pick(a, ["name", "enabled", "options"]),
      ...(a.allowedOrigins ? { allowed_origins: a.allowedOrigins } : {}),
      ...(a.expiresInDays !== undefined ? { expires_in_days: a.expiresInDays } : {}),
    })),
  },
  {
    name: "rotate_embed_token",
    title: "Rotar el token de un embed",
    description: "Genera un token nuevo; el anterior deja de servir AL INSTANTE (hay que actualizar el codigo donde se use). Devuelve el embed con el token nuevo. POST /api/v1/embeds/{embedId}/rotate.",
    inputShape: { embedId: id("Id del embed.") },
    handler: async (a) => toToolText(await post(`/api/v1/embeds/${E(a.embedId)}/rotate`, {})),
  },
  {
    name: "delete_embed",
    title: "Borrar un embed",
    description: "ACCION DESTRUCTIVA: elimina el embed; las paginas que usen su token dejan de mostrar el tablero. DELETE /api/v1/embeds/{embedId}.",
    inputShape: { embedId: id("Id del embed.") },
    handler: async (a) => toToolText(await del(`/api/v1/embeds/${E(a.embedId)}`)),
  },

  /* ============================ Datos ============================ */
  {
    name: "upload_table",
    title: "Subir archivo (CSV/Excel) como tabla",
    description: "Sube un archivo local (.csv, .xlsx, .xls) a una app y lo materializa como tabla. POST multipart /api/v1/apps/{appId}/tables.",
    inputShape: { ...appId, filePath: id("Ruta absoluta del archivo en el equipo donde corre el MCP.") },
    handler: async (a) => {
      const path = String(a.filePath);
      const buf = await readFile(path);
      const form = new FormData();
      form.append("file", new Blob([buf]), basename(path));
      return toToolText(await postForm(`${A(a.appId)}/tables`, form));
    },
  },
  {
    name: "delete_table",
    title: "Borrar tabla",
    description: "ACCION DESTRUCTIVA: elimina una tabla del modelo. DELETE /api/v1/apps/{appId}/tables/{tableId}.",
    inputShape: { ...appId, tableId: id("Id de la tabla.") },
    handler: async (a) => toToolText(await del(`${A(a.appId)}/tables/${E(a.tableId)}`)),
  },
  {
    name: "get_field_overrides",
    title: "Preparacion de campos (leer)",
    description: "Renombres, tipos forzados y campos ocultos de una tabla. GET /api/v1/apps/{appId}/tables/{tableId}/field-overrides.",
    inputShape: { ...appId, tableId: id("Id de la tabla.") },
    handler: async (a) => toToolText(await get(`${A(a.appId)}/tables/${E(a.tableId)}/field-overrides`)),
  },
  {
    name: "set_field_overrides",
    title: "Preparacion de campos (guardar)",
    description: "Reemplaza la preparacion de campos: [{source_field, rename?, forced_type? (text|number|date), hidden?}]. PUT /api/v1/apps/{appId}/tables/{tableId}/field-overrides.",
    inputShape: { ...appId, tableId: id("Id de la tabla."), overrides: z.array(z.record(z.string(), z.any())).describe("Lista de overrides.") },
    handler: async (a) => toToolText(await put(`${A(a.appId)}/tables/${E(a.tableId)}/field-overrides`, a.overrides)),
  },

  /* ============================ Asociaciones ============================ */
  {
    name: "recommend_associations",
    title: "Asociaciones recomendadas",
    description: "Asociaciones entre tablas por campos con el mismo nombre (con confianza). GET /api/v1/apps/{appId}/associations/recommend.",
    inputShape: appId,
    handler: async (a) => toToolText(await get(`${A(a.appId)}/associations/recommend`)),
  },
  {
    name: "list_associations",
    title: "Asociaciones guardadas",
    description: "GET /api/v1/apps/{appId}/associations.",
    inputShape: appId,
    handler: async (a) => toToolText(await get(`${A(a.appId)}/associations`)),
  },
  {
    name: "save_association",
    title: "Crear o aceptar asociacion",
    description: "mode=create: crea una asociacion personalizada; mode=accept: acepta una recomendada. Body {left_table, right_table, fields:[...], ...}. POST|PUT /api/v1/apps/{appId}/associations.",
    inputShape: { ...appId, mode: z.enum(["create", "accept"]).describe("create|accept"), association: free("Cuerpo de la asociacion.") },
    handler: async (a) => toToolText(a.mode === "accept"
      ? await put(`${A(a.appId)}/associations`, a.association)
      : await post(`${A(a.appId)}/associations`, a.association)),
  },
  {
    name: "delete_association",
    title: "Borrar asociacion",
    description: "DELETE /api/v1/apps/{appId}/associations/{assocId}.",
    inputShape: { ...appId, assocId: id("Id de la asociacion.") },
    handler: async (a) => toToolText(await del(`${A(a.appId)}/associations/${E(a.assocId)}`)),
  },

  /* ============================ Elementos maestros ============================ */
  {
    name: "list_master_items",
    title: "Elementos maestros",
    description: "Dimensiones y medidas maestras. kind opcional dimension|measure. GET /api/v1/apps/{appId}/master-items.",
    inputShape: { ...appId, kind: z.enum(["dimension", "measure"]).optional() },
    handler: async (a) => toToolText(await get(`${A(a.appId)}/master-items${a.kind ? `?kind=${E(a.kind)}` : ""}`)),
  },
  {
    name: "save_master_item",
    title: "Crear/editar elemento maestro",
    description: "Sin itemId crea; con itemId actualiza. {kind: dimension|measure, name, expression (ej. Sum([Ventas])), description?}. POST|PUT /api/v1/apps/{appId}/master-items.",
    inputShape: {
      ...appId, itemId: z.string().optional().describe("Id para actualizar."),
      kind: z.enum(["dimension", "measure"]).optional(), name: z.string().optional(), expression: z.string().optional(), description: z.string().optional(),
    },
    handler: async (a) => {
      const body = pick(a, ["kind", "name", "expression", "description"]);
      return toToolText(a.itemId ? await put(`${A(a.appId)}/master-items/${E(a.itemId)}`, body) : await post(`${A(a.appId)}/master-items`, body));
    },
  },
  {
    name: "delete_master_item",
    title: "Borrar elemento maestro",
    description: "DELETE /api/v1/apps/{appId}/master-items/{itemId}.",
    inputShape: { ...appId, itemId: id("Id del elemento.") },
    handler: async (a) => toToolText(await del(`${A(a.appId)}/master-items/${E(a.itemId)}`)),
  },
  {
    name: "parse_expression",
    title: "Validar expresion fx",
    description: "Valida una expresion (ej. Sum([Ventas])/Count([Cliente])) contra los campos de la app. POST /api/v1/apps/{appId}/expressions/parse.",
    inputShape: { ...appId, expression: id("Expresion."), kind: z.enum(["dimension", "measure"]).optional().describe("default measure") },
    handler: async (a) => toToolText(await post(`${A(a.appId)}/expressions/parse`, { kind: String(a.kind ?? "measure"), expression: String(a.expression) })),
  },

  /* ============================ Modelo logico ============================ */
  {
    name: "get_logical_model",
    title: "Modelo logico (leer)",
    description: "Documento del modelo logico (Business Logic): campos clasificados, grupos, paquetes, jerarquias, comportamientos, periodos de calendario. GET /api/v1/apps/{appId}/logical-model.",
    inputShape: appId,
    handler: async (a) => toToolText(await get(`${A(a.appId)}/logical-model`)),
  },
  {
    name: "set_logical_model",
    title: "Modelo logico (guardar documento)",
    description: "Reemplaza el documento completo del modelo logico. PUT /api/v1/apps/{appId}/logical-model.",
    inputShape: { ...appId, document: free("Documento del modelo logico.") },
    handler: async (a) => toToolText(await put(`${A(a.appId)}/logical-model`, a.document)),
  },
  {
    name: "logical_model_action",
    title: "Modelo logico: reset/activar/desactivar",
    description: "POST /api/v1/apps/{appId}/logical-model/{reset|enable|disable}.",
    inputShape: { ...appId, action: z.enum(["reset", "enable", "disable"]) },
    handler: async (a) => toToolText(await post(`${A(a.appId)}/logical-model/${a.action}`)),
  },
  {
    name: "logical_model_item",
    title: "Modelo logico: crear/editar/borrar elemento",
    description: "op=create|update|delete sobre groups|packages|hierarchies|behaviors|calendar-periods. update/delete requieren itemId. POST|PUT|DELETE /api/v1/apps/{appId}/logical-model/{collection}[/{id}].",
    inputShape: { ...appId, collection: logicalCollections, op: z.enum(["create", "update", "delete"]), itemId: z.string().optional(), item: free("Cuerpo del elemento.").optional() },
    handler: async (a) => {
      const base = `${A(a.appId)}/logical-model/${a.collection}`;
      if (a.op === "create") return toToolText(await post(base, a.item ?? {}));
      if (!a.itemId) throw new Error("itemId es obligatorio para update/delete.");
      return toToolText(a.op === "update" ? await put(`${base}/${E(a.itemId)}`, a.item ?? {}) : await del(`${base}/${E(a.itemId)}`));
    },
  },

  /* ============================ Hojas ============================ */
  {
    name: "delete_sheet",
    title: "Borrar hoja",
    description: "ACCION DESTRUCTIVA: elimina una hoja. DELETE /api/v1/apps/{appId}/sheets/{sheetId}.",
    inputShape: { ...appId, sheetId: id("Id de la hoja.") },
    handler: async (a) => toToolText(await del(`${A(a.appId)}/sheets/${E(a.sheetId)}`)),
  },
  {
    name: "set_sheet_visibility",
    title: "Publicar / privatizar hoja",
    description:
      "visibility = privada (borrador) | publica (publicada). Un visualizador solo ve hojas publicadas de apps en produccion (ver set_app_stage). " +
      "Requiere el permiso apps:publish. PUT /api/v1/apps/{appId}/sheets/{sheetId}/visibility.",
    inputShape: { ...appId, sheetId: id("Id de la hoja."), visibility: id("privada|publica|comunidad") },
    handler: async (a) => toToolText(await put(`${A(a.appId)}/sheets/${E(a.sheetId)}/visibility`, { visibility: String(a.visibility) })),
  },
  {
    name: "add_ml_chart",
    title: "Anadir grafico de ML a una hoja",
    description: "Anade un grafico de Machine Learning (ml-clustermap, ml-elbow, ml-silhouette, ml-segments, ml-roc, ml-confusion, ml-actualpred, ml-forecast…) a una hoja existente, ligado a una ejecucion guardada. Valida que el grafico aplique al resultado. Sin x/y lo coloca en el primer hueco libre. Si la hoja la creo associate_ml_run y no se pasa runId, usa su ejecucion.",
    inputShape: {
      ...appId, sheetId: id("Id de la hoja."), type: mlChartType,
      experimentId: z.string().optional(), runId: z.string().optional(), title: z.string().optional(),
      x: z.number().optional(), y: z.number().optional(), w: z.number().optional(), h: z.number().optional(),
      look: free("Presentacion: {legend, tooltip, mlPalette: datasense|sense}.").optional(),
    },
    handler: async (a) => {
      const sheets = (await get(`${A(a.appId)}/sheets`)) as Array<Record<string, any>>;
      const sheet = sheets.find((s) => s.id === a.sheetId);
      if (!sheet) throw new Error(`Hoja no encontrada: ${a.sheetId}`);
      let expId = a.experimentId as string | undefined, runId = a.runId as string | undefined;
      if (!runId && sheet.props?.ml?.ejecucionId) { expId = sheet.props.ml.experimentoId; runId = sheet.props.ml.ejecucionId; }
      if (!expId || !runId) throw new Error("Indica experimentId y runId (list_experiments / get_experiment).");
      const result = (await get(`/api/v1/ml/experiments/${E(expId)}/runs/${E(runId)}`)) as Record<string, any>;
      const type = String(a.type);
      if (!mlFits(type, result)) throw new Error(`El grafico ${type} no aplica a una ejecucion de ${result.algorithm}${result.task ? " (" + result.task + ")" : ""}.`);
      const [dw, dh] = ML_SIZES[type];
      const w = Number(a.w ?? dw), h = Number(a.h ?? dh);
      const objects = (sheet.objects || []) as Array<Record<string, any>>;
      const pos = a.x !== undefined && a.y !== undefined ? { x: Number(a.x), y: Number(a.y) } : freeSlot(objects, w, h);
      const obj = {
        id: `ml${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, type, ...pos, w, h,
        props: { title: a.title ?? ML_TITLES[type], dims: [], measures: [], ml: { experimentId: expId, runId }, ...(a.look ? { look: a.look } : {}) },
      };
      const saved = await put(`${A(a.appId)}/sheets/${E(a.sheetId)}`, {
        title: sheet.title, description: sheet.description, objects: [...objects, obj], props: { ...(sheet.props || {}), ...(pos.y + h > 18 ? { extend: true } : {}) },
      }) as Record<string, any>;
      return toToolText({ ok: true, added: obj, sheet: { id: saved.id, title: saved.title, objects: saved.objects?.length } });
    },
  },

  /* ============================ Experimentos de ML ============================ */
  {
    name: "list_experiments",
    title: "Experimentos de ML",
    description: "Lista experimentos con app, tabla, n de ejecuciones y ultimo algoritmo. GET /api/v1/ml/experiments.",
    inputShape: {},
    handler: async () => toToolText(await get("/api/v1/ml/experiments")),
  },
  {
    name: "create_experiment",
    title: "Crear experimento de ML",
    description: "Crea un experimento sobre una tabla de una app. {appId, name, description?, table? (id o nombre)}. POST /api/v1/ml/experiments.",
    inputShape: { ...appId, name: id("Nombre."), description: z.string().optional(), table: z.string().optional().describe("Id o nombre de la tabla.") },
    handler: async (a) => toToolText(await post("/api/v1/ml/experiments", pick(a, ["appId", "name", "description", "table"]))),
  },
  {
    name: "get_experiment",
    title: "Detalle de experimento",
    description: "Experimento con tablas de la app, perfil del dataset (campos numericos/categoricos/fechas) y lista de ejecuciones (runList). GET /api/v1/ml/experiments/{id}.",
    inputShape: { experimentId: id("Id del experimento.") },
    handler: async (a) => toToolText(await get(`/api/v1/ml/experiments/${E(a.experimentId)}`)),
  },
  {
    name: "update_experiment",
    title: "Editar experimento",
    description: "{name?, description?, table?}. PUT /api/v1/ml/experiments/{id}.",
    inputShape: { experimentId: id("Id del experimento."), name: z.string().optional(), description: z.string().optional(), table: z.string().optional() },
    handler: async (a) => toToolText(await put(`/api/v1/ml/experiments/${E(a.experimentId)}`, pick(a, ["name", "description", "table"]))),
  },
  {
    name: "delete_experiment",
    title: "Borrar experimento",
    description: "ACCION DESTRUCTIVA: elimina el experimento y sus ejecuciones. DELETE /api/v1/ml/experiments/{id}.",
    inputShape: { experimentId: id("Id del experimento.") },
    handler: async (a) => toToolText(await del(`/api/v1/ml/experiments/${E(a.experimentId)}`)),
  },
  {
    name: "train_model",
    title: "Entrenar modelo (ejecucion de ML)",
    description: "Entrena un algoritmo en el experimento y guarda la ejecucion (runId). {algorithm, params, label?, save?}. Ver list_ml_algorithms. Con params.input devuelve la prediccion de un caso sin guardar. POST /api/v1/ml/experiments/{id}/runs.",
    inputShape: {
      experimentId: id("Id del experimento."), algorithm: id("kmeans|hierarchical|dbscan|pca|correlation|anomaly|rules|linear|ridge|lasso|poly|tree|forest|gbm|knn|logistic|bayes|forecast|automl"),
      params: free("Parametros (features, target, task, k, horizon…)."), label: z.string().optional(), save: z.boolean().optional(),
    },
    handler: async (a) => toToolText(await post(`/api/v1/ml/experiments/${E(a.experimentId)}/runs`, pick(a, ["algorithm", "params", "label", "save"]))),
  },
  {
    name: "get_ml_run",
    title: "Resultado de una ejecucion",
    description: "Resultado completo de una ejecucion guardada (metricas, segmentos, coeficientes, lectura…). GET /api/v1/ml/experiments/{id}/runs/{runId}.",
    inputShape: { experimentId: id("Id del experimento."), runId: id("Id de la ejecucion.") },
    handler: async (a) => toToolText(await get(`/api/v1/ml/experiments/${E(a.experimentId)}/runs/${E(a.runId)}`)),
  },
  {
    name: "delete_ml_run",
    title: "Borrar ejecucion",
    description: "DELETE /api/v1/ml/experiments/{id}/runs/{runId}.",
    inputShape: { experimentId: id("Id del experimento."), runId: id("Id de la ejecucion.") },
    handler: async (a) => toToolText(await del(`/api/v1/ml/experiments/${E(a.experimentId)}/runs/${E(a.runId)}`)),
  },
  {
    name: "associate_ml_run",
    title: "Asociar a (ML -> tabla del modelo + hoja)",
    description: "Lleva una ejecucion a una app: crea la tabla ML_... con el resultado por registro (segmento, prediccion, probabilidad, atipico) enlazada por clave, y una hoja con graficos de ML (mapa de clusters, silueta, ROC…) y de datos; el analista IA puede explicarla. Re-asociar reemplaza tabla y hoja. {appId? (default la del experimento), sheetTitle?}. POST /api/v1/ml/experiments/{id}/runs/{runId}/associate.",
    inputShape: { experimentId: id("Id del experimento."), runId: id("Id de la ejecucion."), appId: z.string().optional(), sheetTitle: z.string().optional() },
    handler: async (a) => toToolText(await post(`/api/v1/ml/experiments/${E(a.experimentId)}/runs/${E(a.runId)}/associate`, pick(a, ["appId", "sheetTitle"]))),
  },
  {
    name: "ml_datasets",
    title: "Tablas de una app para ML",
    description: "Tablas con campos agrupados (numeric, categorical, dates). GET /api/v1/apps/{appId}/ml/datasets.",
    inputShape: appId,
    handler: async (a) => toToolText(await get(`${A(a.appId)}/ml/datasets`)),
  },

  /* ============================ Colecciones ============================ */
  {
    name: "list_collections",
    title: "Colecciones",
    description: "GET /api/v1/collections.",
    inputShape: {},
    handler: async () => toToolText(await get("/api/v1/collections")),
  },
  {
    name: "create_collection",
    title: "Crear coleccion",
    description: "{name, description?}. POST /api/v1/collections.",
    inputShape: { name: id("Nombre."), description: z.string().optional() },
    handler: async (a) => toToolText(await post("/api/v1/collections", pick(a, ["name", "description"]))),
  },
  {
    name: "delete_collection",
    title: "Borrar coleccion",
    description: "DELETE /api/v1/collections/{id}.",
    inputShape: { collectionId: id("Id de la coleccion.") },
    handler: async (a) => toToolText(await del(`/api/v1/collections/${E(a.collectionId)}`)),
  },

  /* ============================ Notificaciones ============================ */
  {
    name: "list_notifications",
    title: "Notificaciones de actividad",
    description:
      "Actividad de la plataforma para el administrador (lo que muestra la campana): nuevas apps, datos cargados, hojas, " +
      "colecciones, elementos maestros, conexiones, experimentos y ejecuciones de ML. Devuelve {items:[{id, kind, title, " +
      "detail, app_id, ref_id, extra, created_at, read, link}], unread, total}. GET /api/v1/notifications?limit=&unread=.",
    inputShape: {
      limit: z.number().int().min(1).max(200).optional().describe("Máximo de notificaciones (por defecto 50)."),
      unreadOnly: z.boolean().optional().describe("Solo las no leídas."),
    },
    handler: async (a) => {
      const qs = new URLSearchParams();
      if (a.limit !== undefined) qs.set("limit", String(a.limit));
      if (a.unreadOnly) qs.set("unread", "true");
      const q = qs.toString();
      return toToolText(await get(`/api/v1/notifications${q ? `?${q}` : ""}`));
    },
  },
  {
    name: "mark_notifications_read",
    title: "Marcar notificaciones como leídas",
    description:
      "Sin notificationId marca TODAS como leídas (POST /api/v1/notifications/read-all); con notificationId " +
      "(p. ej. 'sheet:<id>') marca solo esa (POST /api/v1/notifications/{id}/read).",
    inputShape: { notificationId: z.string().optional().describe("Id de la notificación (kind:id). Omitir para todas.") },
    handler: async (a) =>
      toToolText(a.notificationId
        ? (await post(`/api/v1/notifications/${E(a.notificationId)}/read`)) ?? { ok: true }
        : await post("/api/v1/notifications/read-all")),
  },
  {
    name: "clear_notifications",
    title: "Vaciar el panel de notificaciones",
    description: "Oculta del panel todas las notificaciones actuales; NO borra apps, hojas ni datos. POST /api/v1/notifications/clear.",
    inputShape: {},
    handler: async () => toToolText(await post("/api/v1/notifications/clear")),
  },

  /* ============================ Usuarios, roles, permisos y etapas ============================ */
  {
    name: "get_current_user",
    title: "Usuario con el que opera el MCP",
    description: "Usuario autenticado (rol y permisos efectivos). GET /api/v1/auth/me. Las credenciales salen de DATASENSE_USER / DATASENSE_PASSWORD.",
    inputShape: {},
    handler: async () => toToolText(await get("/api/v1/auth/me")),
  },
  {
    name: "get_security_catalog",
    title: "Catalogo de roles, permisos y etapas",
    description:
      "Roles (admin, editor, viewer) con sus permisos, catálogo de permisos y las etapas de una app " +
      "(personal → desarrollo → produccion). GET /api/v1/auth/catalog.",
    inputShape: {},
    handler: async () => toToolText(await get("/api/v1/auth/catalog")),
  },
  {
    name: "list_users",
    title: "Usuarios",
    description: "Lista los usuarios con rol, estado y permisos efectivos (requiere users:manage). GET /api/v1/users.",
    inputShape: {},
    handler: async () => toToolText(await get("/api/v1/users")),
  },
  {
    name: "create_user",
    title: "Crear usuario",
    description:
      "{email, name?, password (8+), role: admin|editor|viewer, active?, grant?: [permisos extra], deny?: [permisos quitados]}. " +
      "POST /api/v1/users. Permisos válidos: ver get_security_catalog.",
    inputShape: {
      email: id("Correo (único)."),
      name: z.string().optional().describe("Nombre visible."),
      password: z.string().min(8).describe("Contraseña inicial (mínimo 8 caracteres)."),
      role: z.enum(["admin", "editor", "viewer"]).describe("Rol base."),
      active: z.boolean().optional(),
      grant: z.array(z.string()).optional().describe("Permisos extra sobre los del rol."),
      deny: z.array(z.string()).optional().describe("Permisos que se le quitan aunque su rol los tenga."),
    },
    handler: async (a) => toToolText(await post("/api/v1/users", pick(a, ["email", "name", "password", "role", "active", "grant", "deny"]))),
  },
  {
    name: "update_user",
    title: "Editar usuario",
    description:
      "Cambia nombre, correo, rol, estado o permisos individuales (solo lo enviado). Al cambiar acceso se cierran sus sesiones. " +
      "Nunca deja la plataforma sin un administrador activo. PUT /api/v1/users/{id}.",
    inputShape: {
      userId: id("Id del usuario."),
      email: z.string().optional(), name: z.string().optional(),
      role: z.enum(["admin", "editor", "viewer"]).optional(), active: z.boolean().optional(),
      grant: z.array(z.string()).optional(), deny: z.array(z.string()).optional(),
    },
    handler: async (a) => toToolText(await put(`/api/v1/users/${E(a.userId)}`, pick(a, ["email", "name", "role", "active", "grant", "deny"]))),
  },
  {
    name: "reset_user_password",
    title: "Restablecer contrasena",
    description: "Fija una nueva contraseña (8+) y cierra las sesiones de ese usuario. PUT /api/v1/users/{id}/password.",
    inputShape: { userId: id("Id del usuario."), password: z.string().min(8).describe("Nueva contraseña.") },
    handler: async (a) => toToolText(await put(`/api/v1/users/${E(a.userId)}/password`, { password: a.password })),
  },
  {
    name: "delete_user",
    title: "Eliminar usuario",
    description:
      "ACCION DESTRUCTIVA: elimina al usuario; sus aplicaciones pasan a quien ejecuta la acción. No permite borrar la propia cuenta " +
      "ni al último administrador. DELETE /api/v1/users/{id}.",
    inputShape: { userId: id("Id del usuario.") },
    handler: async (a) => toToolText(await del(`/api/v1/users/${E(a.userId)}`)),
  },
  {
    name: "set_app_stage",
    title: "Etapa de una aplicacion",
    description:
      "Mueve una app entre personal | desarrollo | produccion (y opcionalmente cambia su dueño con ownerId, solo admin). Entrar o salir de " +
      "produccion exige el permiso apps:publish. Un visualizador solo ve apps en produccion y sus hojas publicadas " +
      "(set_sheet_visibility publica/privada). PUT /api/v1/apps/{appId}/stage.",
    inputShape: {
      ...appId,
      stage: z.enum(["personal", "desarrollo", "produccion"]).describe("Etapa de destino."),
      ownerId: z.string().optional().describe("Nuevo dueño (id de usuario). Solo administradores."),
    },
    handler: async (a) => toToolText(await put(`${A(a.appId)}/stage`, a.ownerId ? { stage: a.stage, owner_id: a.ownerId } : { stage: a.stage })),
  },

  /* ============================ Centro de ayuda ============================ */
  {
    name: "get_help",
    title: "Centro de ayuda (manual técnico y FAQ)",
    description:
      "Contenido del centro de ayuda de DataSense (botón «?»): primeros pasos, manual técnico, preguntas frecuentes y " +
      "atajos. Con 'query' devuelve solo los artículos que contienen todas las palabras; con 'section' (inicio | manual | " +
      "faq | atajos) solo esa sección. Fuente: GET /help/ayuda.json.",
    inputShape: {
      query: z.string().optional().describe("Palabras a buscar (sin distinguir tildes ni mayúsculas)."),
      section: z.enum(["inicio", "manual", "faq", "atajos"]).optional().describe("Sección concreta."),
    },
    handler: async (a) => {
      const data = (await get("/help/ayuda.json")) as { secciones: Array<{ id: string; titulo: string; items: Array<{ titulo: string; cuerpo: string }> }> };
      const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const words = a.query ? norm(String(a.query)).split(/\s+/).filter(Boolean) : [];
      const secciones = data.secciones
        .filter((s) => !a.section || s.id === a.section)
        .map((s) => ({ ...s, items: s.items.filter((it) => words.every((w) => norm(`${it.titulo} ${it.cuerpo}`).includes(w))) }))
        .filter((s) => s.items.length);
      return toToolText({ resultados: secciones.reduce((n, s) => n + s.items.length, 0), secciones });
    },
  },
];

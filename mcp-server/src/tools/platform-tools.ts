/**
 * Tools de PLATAFORMA del MCP de PROTHEO: cubren todo lo que hace la UI y no
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
 * REGLA DEL PROYECTO: toda funcionalidad nueva de PROTHEO debe exponerse aqui
 * (o en action/context-tools) en el mismo cambio. Ver .kiro/steering/mcp-paridad.md.
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { z } from "zod";
import { get, post, put, del, postForm, toToolText } from "../http-client.js";
import type { ContextTool } from "./context-tools.js";
import { buildStory } from "./story.js";

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

  /* ============================ Permisos por rol ============================ */
  {
    name: "set_role_permissions",
    title: "Permisos de un rol",
    description: "Fija la lista COMPLETA de permisos detallados de un rol (editor = Desarrollador, viewer = Visualizador o un rol personalizado r-…; el admin siempre tiene todo). Se aplica al instante a todas las personas con ese rol; los permisos sueltos por usuario siguen encima. Debe incluir apps:view. Ids detallados en get_security_catalog (p. ej. sheets:delete, data:reload, business:certify, reports:export); los nombres antiguos (charts:edit, data:import…) se aceptan y se expanden a los detallados que cubrian. Requiere roles:manage. Queda en la auditoria. Devuelve {id, label, permissions, custom, customized, users}. PUT /api/v1/users/roles/{role} con {permissions}.",
    inputShape: { role: id("Id del rol: editor | viewer | r-…"), permissions: z.array(z.string()).describe("Lista completa de permisos del rol.") },
    handler: async (a) => toToolText(await put(`/api/v1/users/roles/${E(a.role)}`, { permissions: a.permissions })),
  },
  {
    name: "reset_role_permissions",
    title: "Restablecer permisos de un rol de fabrica",
    description: "Devuelve un rol de fabrica (editor | viewer) a sus permisos de fabrica. Con un rol personalizado usa delete_role. Requiere roles:manage. DELETE /api/v1/users/roles/{role}.",
    inputShape: { role: id("editor | viewer.") },
    handler: async (a) => toToolText(await del(`/api/v1/users/roles/${E(a.role)}`)),
  },
  {
    name: "create_role",
    title: "Crear rol personalizado",
    description: "Crea un rol para un puesto de trabajo (p. ej. «Analista financiero»). Con copy_from copia los permisos de otro rol; con permissions fija la lista (debe incluir apps:view); sin nada parte del Visualizador. El id se genera (r-analista-financiero). Requiere roles:manage. Devuelve 201 {id, label, description, permissions, custom:true, users}. POST /api/v1/users/roles con {label, description?, copy_from?, permissions?}.",
    inputShape: {
      label: id("Nombre visible del rol (unico, max 60)."), description: z.string().optional(),
      copy_from: z.string().optional().describe("Rol del que copiar los permisos (admin | editor | viewer | r-…)."),
      permissions: z.array(z.string()).optional().describe("Permisos detallados del rol."),
    },
    handler: async (a) => toToolText(await post("/api/v1/users/roles", pick(a, ["label", "description", "copy_from", "permissions"]))),
  },
  {
    name: "update_role",
    title: "Renombrar o cambiar un rol personalizado",
    description: "Cambia nombre, descripcion y/o permisos de un rol personalizado (r-…). En roles de fabrica solo se cambian los permisos (usa set_role_permissions). Requiere roles:manage. PUT /api/v1/users/roles/{role} con {label?, description?, permissions?}.",
    inputShape: { role: id("Id del rol personalizado (r-…)."), label: z.string().optional(), description: z.string().optional(), permissions: z.array(z.string()).optional() },
    handler: async (a) => toToolText(await put(`/api/v1/users/roles/${E(a.role)}`, pick(a, ["label", "description", "permissions"]))),
  },
  {
    name: "delete_role",
    title: "Borrar rol personalizado",
    description: "ACCION DESTRUCTIVA. Borra un rol personalizado. Si alguien lo tiene responde 409 salvo que se indique reassign_to (rol al que pasan esas personas). Requiere roles:manage. DELETE /api/v1/users/roles/{role}?reassign_to=….",
    inputShape: { role: id("Id del rol personalizado (r-…)."), reassign_to: z.string().optional().describe("Rol de destino para quienes lo tienen.") },
    handler: async (a) => toToolText(await del(`/api/v1/users/roles/${E(a.role)}${a.reassign_to ? `?reassign_to=${E(a.reassign_to)}` : ""}`)),
  },
  {
    name: "get_effective_permissions",
    title: "Permisos efectivos de una persona",
    description: "Cada permiso detallado de un usuario con su origen: source = rol | concedido (excepcion a favor) | denegado (el rol lo da pero se le quito) | ninguno, y granted. Devuelve {user, role, permissions:[{id, label, module, action, risk, source, granted}], granted, total}. Requiere users:manage. GET /api/v1/users/{id}/effective.",
    inputShape: { userId: id("Id del usuario.") },
    handler: async (a) => toToolText(await get(`/api/v1/users/${E(a.userId)}/effective`)),
  },
  {
    name: "list_security_audit",
    title: "Auditoria de seguridad",
    description: "Historial (mas reciente primero) de cambios de cuentas, roles y permisos: [{at, actor_name, action (user.create|user.role|user.permissions|user.password|user.activate|user.deactivate|user.delete|role.create|role.permissions|role.rename|role.reset|role.delete), target_type user|role, target_id, target_label, summary, detail}]. Requiere audit:view. GET /api/v1/users/audit?limit=&target_type=&target_id=.",
    inputShape: { limit: z.number().int().min(1).max(500).optional(), target_type: z.enum(["user", "role"]).optional(), target_id: z.string().optional() },
    handler: async (a) => {
      const qs = [`limit=${a.limit ?? 100}`, a.target_type ? `target_type=${E(a.target_type)}` : "", a.target_id ? `target_id=${E(a.target_id)}` : ""].filter(Boolean).join("&");
      return toToolText(await get(`/api/v1/users/audit?${qs}`));
    },
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
    description: "Lista los embeds con id, token (dse_…), app, hojas (sheet_ids y sheets:[{id, title, published}]; sheet_id = la primera), estado (active|revoked|expired|unpublished), orígenes permitidos, vencimiento, vistas y URL (/embed/{token}). Requiere embed:manage. GET /api/v1/embeds.",
    inputShape: {},
    handler: async () => toToolText(await get("/api/v1/embeds")),
  },
  {
    name: "create_embed",
    title: "Crear un embed",
    description: "Crea un embed (ID + token de solo lectura) de UNA o VARIAS hojas de una app para incrustarlas en otra pagina web con <iframe src='{base}/embed/{token}'> o el SDK /js/embed-sdk.js. Con varias hojas el tablero muestra pestañas (en el orden de sheetIds) y conserva los filtros al cambiar. Solo muestra datos si la app esta en produccion (set_app_stage); de sus hojas se ven las publicadas (set_sheet_visibility). {name, appId, sheetIds: [..] (o sheetId), allowedOrigins? (vacio = cualquier sitio), expiresInDays? (0/omitir = nunca), options? {theme: light|dark, hideTitle, hideSelections, hideTabs}}. Max 20 hojas. POST /api/v1/embeds.",
    inputShape: {
      name: id("Nombre del embed."), appId: id("Id de la app."),
      sheetIds: z.array(z.string()).min(1).max(20).optional().describe("Hojas del embed, en el orden de las pestañas."),
      sheetId: z.string().optional().describe("Una sola hoja (equivale a sheetIds: [sheetId])."),
      allowedOrigins: z.array(z.string()).optional().describe("Sitios que pueden incrustarlo, ej. https://portal.miempresa.com."),
      expiresInDays: z.number().int().min(0).optional().describe("Dias hasta que vence el token (0 = nunca)."),
      options: free("{theme?, hideTitle?, hideSelections?, hideTabs?}").optional(),
    },
    handler: async (a) => toToolText(await post("/api/v1/embeds", {
      name: a.name, app_id: a.appId,
      ...(a.sheetIds ? { sheet_ids: a.sheetIds } : { sheet_id: a.sheetId }),
      ...(a.allowedOrigins ? { allowed_origins: a.allowedOrigins } : {}),
      ...(a.expiresInDays !== undefined ? { expires_in_days: a.expiresInDays } : {}),
      ...(a.options ? { options: a.options } : {}),
    })),
  },
  {
    name: "update_embed",
    title: "Editar, activar o desactivar un embed",
    description: "{name?, enabled? (false = revoca sin borrar), sheetIds? (reemplaza las hojas; orden = pestañas), allowedOrigins?, expiresInDays? (0 = quitar vencimiento), options? {theme, hideTitle, hideSelections, hideTabs}}. El token no cambia. PUT /api/v1/embeds/{embedId}.",
    inputShape: {
      embedId: id("Id del embed."), name: z.string().optional().describe("Nombre."), enabled: z.boolean().optional().describe("Activo o revocado."),
      sheetIds: z.array(z.string()).min(1).max(20).optional().describe("Hojas del embed (reemplaza), en orden de pestañas."),
      allowedOrigins: z.array(z.string()).optional().describe("Sitios permitidos (reemplaza)."), expiresInDays: z.number().int().min(0).optional().describe("Dias hasta vencer; 0 = nunca."),
      options: free("{theme?, hideTitle?, hideSelections?}").optional(),
    },
    handler: async (a) => toToolText(await put(`/api/v1/embeds/${E(a.embedId)}`, {
      ...pick(a, ["name", "enabled", "options"]),
      ...(a.sheetIds ? { sheet_ids: a.sheetIds } : {}),
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
    description: "Sin itemId crea; con itemId actualiza. {kind: dimension|measure, name, expression, description?, format?}. La expresion va en SQL (lenguaje por defecto; la sintaxis anterior con [corchetes] tambien se acepta). Campos sin comillas (cedula) o entre comillas dobles si tienen espacios/tildes (\"ESTADO CONTRATO\"); no distingue mayusculas ni tildes y elige la tabla que contiene todos los campos. Medida: SUM(ventas), COUNT(cedula), COUNT(*), COUNT(DISTINCT cedula), AVG/MIN/MAX, condiciones con FILTER: COUNT(*) FILTER (WHERE \"ESTADO CONTRATO\" = 'Inactivo'), SUM(valor) FILTER (WHERE sucursal IN ('CALI','NEIVA')), compuestas: ROUND(100.0 * COUNT(*) FILTER (WHERE …) / COUNT(cedula), 2); todos los campos en una misma tabla; /0 da 0. Dimension: un campo (sucursal) o CALCULADA por fila: CASE WHEN \"EDAD EN AÑOS\" >= 40 THEN 'Mayor de 40' ELSE 'Menor de 40' END, CLASS(antiguedad, 12), YEAR(fecha), empresa || ' - ' || cargo; funciones CASE, COALESCE, CAST(x AS INTEGER|DOUBLE|VARCHAR|DATE), ROUND, FLOOR, CEIL, ABS, UPPER, LOWER, TRIM, LENGTH, SUBSTRING, LEFT, RIGHT, REPLACE, YEAR, MONTH, DAY, EXTRACT, IN, BETWEEN, LIKE 'AB%', IS [NOT] NULL, ||. El 'name' de una calculada es el campo por el que se agrupa (no puede coincidir con un campo existente). 'format' (presentacion, no cambia la definicion ni crea version): {type: number|integer|percent|currency|unit|date|text, decimals 0-4, scale: K|M|B|auto, prefix, suffix (p. ej. ' kg', ' L', ' °C'), currency: COP|USD|EUR, date: 'dd/mm/aaaa'|'d mmm aaaa'|'mmm aaaa'|'aaaa-mm'|'aaaa', case: upper|lower|title, thousands:false}; null = automatico. Con itemId y solo 'format' cambia unicamente el formato. En create_sheet usa el elemento con {source:'master', masterId}. POST|PUT /api/v1/apps/{appId}/master-items.",
    inputShape: {
      ...appId, itemId: z.string().optional().describe("Id para actualizar."),
      kind: z.enum(["dimension", "measure"]).optional(), name: z.string().optional(), expression: z.string().optional(), description: z.string().optional(),
      format: z.record(z.string(), z.any()).nullable().optional().describe("Formato de presentacion (moneda, millones, kg, %, fecha…); null = automatico."),
    },
    handler: async (a) => {
      const body = pick(a, ["kind", "name", "expression", "description", "format"]);
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
    description: "Valida una expresion SQL (o de la sintaxis anterior) contra los campos de la app. Medida: SUM(ventas) o compuesta (100.0 * COUNT(*) FILTER (WHERE x IS NULL) / COUNT(cedula), COUNT(DISTINCT cedula), SUM(CASE WHEN … END)): devuelve {table, field, agg, value (total con todos los datos), language:'sql', native (traduccion interna)} y, si es compuesta, {composite:true, formula, parts, fields}. Dimension: campo o calculada (CASE WHEN, CLASS, YEAR, ||…): devuelve {table, field, expr, calculated:true, distinct, sample}. Los errores dicen el campo que no existe y sugieren el parecido. POST /api/v1/apps/{appId}/expressions/parse.",
    inputShape: { ...appId, expression: id("Expresion."), kind: z.enum(["dimension", "measure"]).optional().describe("default measure"), name: z.string().optional().describe("Nombre de la dimension calculada.") },
    handler: async (a) => toToolText(await post(`${A(a.appId)}/expressions/parse`, { kind: String(a.kind ?? "measure"), expression: String(a.expression), ...(a.name ? { name: String(a.name) } : {}) })),
  },
  {
    name: "translate_expression",
    title: "Traducir expresion SQL ⇄ sintaxis anterior",
    description: "Convierte una medida/dimension entre SQL y la sintaxis anterior estilo Qlik (Sum([x]), If(…), &). to='sql' (default) devuelve SQL legible con los nombres reales de los campos (p. ej. Sum(If([ESTADO CONTRATO]='Inactivo',1,0)) → COUNT(*) FILTER (WHERE \"ESTADO CONTRATO\" = 'Inactivo')); to='native' devuelve el formato interno que evalua el motor. El resultado numerico es el mismo. Devuelve {expression, to, from}. POST /api/v1/apps/{appId}/expressions/translate.",
    inputShape: { ...appId, expression: id("Expresion a convertir."), to: z.enum(["sql", "native"]).optional().describe("default sql") },
    handler: async (a) => toToolText(await post(`${A(a.appId)}/expressions/translate`, { expression: String(a.expression), to: String(a.to ?? "sql") })),
  },
  {
    name: "suggest_expression",
    title: "Ayuda de IA para una medida o dimension",
    description: "Describe en espanol lo que necesitas (maximo 500 caracteres, p. ej. «porcentaje de inactivos sobre el total de conductores») y la IA (Bedrock) escribe la expresion SQL con los campos reales de la app; se valida en el motor y, si falla, se corrige una vez. Solo ve el catalogo de campos (nombre, tabla, tipo y algunos valores de texto), no filas. Requiere ai:use. Devuelve {ok, expression, explanation, table, value? (medida: total con todos los datos), sample? (dimension), attempts} o {ok:false, message}. No guarda nada: usa save_master_item para guardarla. POST /api/v1/apps/{appId}/expressions/assist con {kind, prompt, current?}.",
    inputShape: {
      ...appId, prompt: z.string().min(1).max(500).describe("Que necesitas, en lenguaje natural (max. 500)."),
      kind: z.enum(["measure", "dimension"]).optional().describe("default measure"), current: z.string().optional().describe("Expresion actual de la que partir."),
    },
    handler: async (a) => toToolText(await post(`${A(a.appId)}/expressions/assist`, { kind: String(a.kind ?? "measure"), prompt: String(a.prompt), ...(a.current ? { current: String(a.current) } : {}) })),
  },
  {
    name: "convert_script",
    title: "Convertir script de carga SQL ⇄ sintaxis anterior",
    description: "Convierte un script de carga (sin guardarlo) a SQL (to='sql', default) o a la sintaxis anterior estilo Qlik (to='qlik'). Sin 'text' convierte el script actual de la app. El script SQL tiene por tabla: CREATE TABLE nombre AS SELECT [DISTINCT] col, CAST(col AS INTEGER) AS col2, CASE WHEN … END AS col3 FROM ( consulta de la conexion ) AS origen | read_file('lib://conexion/archivo') WHERE condicion; antes de las tablas de una conexion USE CONNECTION 'nombre'; secciones con -- #pestaña Nombre; una columna comentada con -- no se carga. Devuelve {text, language}. Para aplicarlo usa set_script y luego run_script. POST /api/v1/apps/{appId}/script/convert con {text?, to}.",
    inputShape: { ...appId, text: z.string().optional().describe("Script a convertir (default: el actual)."), to: z.enum(["sql", "qlik"]).optional().describe("default sql") },
    handler: async (a) => toToolText(await post(`${A(a.appId)}/script/convert`, { to: String(a.to ?? "sql"), ...(a.text ? { text: String(a.text) } : {}) })),
  },
  {
    name: "certify_master_item",
    title: "Certificar metrica (elemento maestro)",
    description: "Marca (certified=true, default) o desmarca (false) un elemento maestro como METRICA CERTIFICADA: la definicion oficial de la empresa, con quien y cuando la certifico y una nota opcional. Se distingue con ✓ en la UI, la IA la usa tal cual y solo quien tiene apps:publish puede modificarla o borrarla. Requiere apps:publish. Devuelve el elemento con {certified, certified_by, certified_at, certified_note, version}. POST /api/v1/apps/{appId}/master-items/{itemId}/certify con {certified, note?}.",
    inputShape: { ...appId, itemId: id("Id del elemento maestro."), certified: z.boolean().optional().describe("true = certificar (default), false = quitar la certificacion."), note: z.string().optional().describe("Nota: que valida esta definicion.") },
    handler: async (a) => toToolText(await post(`${A(a.appId)}/master-items/${E(a.itemId)}/certify`, { certified: a.certified !== false, ...(a.note ? { note: String(a.note) } : {}) })),
  },
  {
    name: "list_master_item_versions",
    title: "Historial de un elemento maestro",
    description: "Versiones de la definicion de un elemento maestro (la mas reciente primero): [{version, name, expression, description, message, author_name, created_at, is_current}]. Cada cambio de nombre/expresion/descripcion crea una version. GET /api/v1/apps/{appId}/master-items/{itemId}/versions.",
    inputShape: { ...appId, itemId: id("Id del elemento maestro.") },
    handler: async (a) => toToolText(await get(`${A(a.appId)}/master-items/${E(a.itemId)}/versions`)),
  },
  {
    name: "restore_master_item_version",
    title: "Restaurar version de un elemento maestro",
    description: "Restaura una version anterior de la definicion: se valida de nuevo y queda como una version NUEVA (el historial no se reescribe). Si el elemento esta certificado requiere apps:publish. Devuelve el elemento actualizado. POST /api/v1/apps/{appId}/master-items/{itemId}/versions/{version}/restore.",
    inputShape: { ...appId, itemId: id("Id del elemento maestro."), version: z.number().int().min(1).describe("Version a restaurar.") },
    handler: async (a) => toToolText(await post(`${A(a.appId)}/master-items/${E(a.itemId)}/versions/${E(a.version)}/restore`)),
  },

  /* ===================== Preguntale a tus datos / De archivo a tablero ===================== */
  {
    name: "ask_data",
    title: "Preguntale a tus datos",
    description: "Responde una pregunta en espanol sobre los datos de una app ('% de inactivos por sucursal', 'top 5 sucursales por cantidad de servicios', 'cuantos conductores hay en 2025', 'evolucion de ventas por periodo'). Interprete determinista (sin IA): reconoce metricas certificadas y maestras, campos (nombre, nombre visible y sinonimos de las Notas para agente), valores como filtros, agregaciones (cuantos, total, promedio, maximo, minimo, distintos, %), agrupacion ('por', 'segun', 'evolucion') y top N. Devuelve {ok, answer (frase), chart kpi|bar|line, result {value | labels, values, groups, total}, how {measure {label, expression, source, certified}, dimension, filters, order, top, table, rows, steps[]}, query (QuerySpec exacto), sheetObject (objeto para create_sheet)} o {ok:false, message, suggestions}. POST /api/v1/apps/{appId}/ask con {question}.",
    inputShape: { ...appId, question: id("Pregunta en lenguaje natural (max 400).") },
    handler: async (a) => toToolText(await post(`${A(a.appId)}/ask`, { question: String(a.question) })),
  },
  {
    name: "ask_suggestions",
    title: "Preguntas sugeridas",
    description: "Preguntas de ejemplo construidas con el modelo real de la app (metricas certificadas, categorias, medidas, tiempo) y verificadas con el interprete de ask_data. GET /api/v1/apps/{appId}/ask/suggestions.",
    inputShape: appId,
    handler: async (a) => toToolText(await get(`${A(a.appId)}/ask/suggestions`)),
  },
  {
    name: "auto_dashboard",
    title: "De archivo a tablero (tablero automatico)",
    description: "Genera y guarda una hoja a partir de los datos de una tabla: KPIs (metricas certificadas, registros, distintos del identificador, totales/promedios), barras por la mejor categoria, torta, evolucion en el tiempo, tabla de detalle y panel de filtros, en la rejilla de 24x12. Flujo 'archivo a tablero': create_app -> upload_table -> auto_dashboard. Devuelve 201 {sheet, summary {table, rows, columns, dimensions, measures, time, id, objects}, questions (sugeridas)}. POST /api/v1/apps/{appId}/auto-dashboard con {table?, title?}.",
    inputShape: { ...appId, table: z.string().optional().describe("Tabla base (default: la de mas filas)."), title: z.string().optional().describe("Titulo de la hoja.") },
    handler: async (a) => toToolText(await post(`${A(a.appId)}/auto-dashboard`, pick(a, ["table", "title"]))),
  },

  /* ===================== Agentes de IA propios ===================== */
  {
    name: "agent_catalog",
    title: "Catalogo de agentes",
    description: "Plantillas de agente (analyst, sentinel, narrator, strategist, modeler, custom), herramientas de solo lectura (preguntar, que_cambio, registros, simular, salud, medidas, conocimiento) con su formato, estilos (concise|executive|detailed) y el motor (Bedrock interno). GET /api/v1/agents/catalog.",
    inputShape: {},
    handler: async () => toToolText(await get("/api/v1/agents/catalog")),
  },
  {
    name: "list_agents",
    title: "Agentes",
    description: "Agentes visibles: los propios (borrador o publicados) y los publicados de otros cuya app puedes ver. [{id, name, description, template, app_id, app_name, tools, knowledge, memory, max_steps, style, guard_pii, starters, status draft|published, uses, last_used_at, editable}]. Requiere agents:use. GET /api/v1/agents.",
    inputShape: {},
    handler: async () => toToolText(await get("/api/v1/agents")),
  },
  {
    name: "get_agent",
    title: "Ver agente",
    description: "Un agente con su configuracion completa (incluye layout de nodos del estudio). GET /api/v1/agents/{id}.",
    inputShape: { agentId: id("Id del agente.") },
    handler: async (a) => toToolText(await get(`/api/v1/agents/${E(a.agentId)}`)),
  },
  {
    name: "save_agent",
    title: "Crear/editar agente",
    description: "Sin agentId crea (template analyst|sentinel|narrator|strategist|modeler|custom; nace en borrador con las herramientas de la plantilla); con agentId actualiza solo lo enviado. Campos: name, description, icon, color, instructions (max 4000), app_id (la app que consulta), tools [ids de agent_catalog], knowledge (usar la base de conocimiento de quien conversa), memory 0-20 turnos, max_steps 1-8, style concise|executive|detailed, guard_pii (oculta correos/telefonos/documentos), starters [preguntas sugeridas], status draft|published (publicado = lo usa quien vea su app). Requiere agents:build; solo el dueño o un admin edita. POST /api/v1/agents | PUT /api/v1/agents/{id}.",
    inputShape: {
      agentId: z.string().optional(), template: z.string().optional(), name: z.string().optional(), description: z.string().optional(),
      icon: z.string().optional(), color: z.string().optional(), instructions: z.string().optional(), app_id: z.string().optional(),
      tools: z.array(z.string()).optional(), knowledge: z.boolean().optional(), memory: z.number().int().min(0).max(20).optional(),
      max_steps: z.number().int().min(1).max(8).optional(), style: z.enum(["concise", "executive", "detailed"]).optional(),
      guard_pii: z.boolean().optional(), starters: z.array(z.string()).optional(), status: z.enum(["draft", "published"]).optional(),
    },
    handler: async (a) => {
      const body = pick(a, ["template", "name", "description", "icon", "color", "instructions", "app_id", "tools", "knowledge", "memory", "max_steps", "style", "guard_pii", "starters", "status"]);
      return toToolText(a.agentId ? await put(`/api/v1/agents/${E(a.agentId)}`, body) : await post("/api/v1/agents", body));
    },
  },
  {
    name: "delete_agent",
    title: "Borrar agente",
    description: "ACCION DESTRUCTIVA. Borra el agente y todas sus conversaciones. Solo el dueño o un admin. Requiere agents:build. DELETE /api/v1/agents/{id}.",
    inputShape: { agentId: id("Id del agente.") },
    handler: async (a) => toToolText(await del(`/api/v1/agents/${E(a.agentId)}`)),
  },
  {
    name: "agent_chat",
    title: "Conversar con un agente",
    description: "Envia un mensaje al agente. Razona, usa sus herramientas de solo lectura sobre su app (con los permisos de quien llama) y, si tiene conocimiento activo, cita la base personal como [K1]. Con conversation_id continua la misma conversacion (memoria). Devuelve {ok, answer, steps:[{tool, label, input, ok, result, ms}], knowledge:[{id,title,kind}], conversation_id, duration_ms} o {ok:false, error}. Requiere agents:use. POST /api/v1/agents/{id}/chat con {message, conversation_id?}.",
    inputShape: { agentId: id("Id del agente."), message: id("Mensaje (max 2000)."), conversation_id: z.string().optional() },
    handler: async (a) => toToolText(await post(`/api/v1/agents/${E(a.agentId)}/chat`, { message: String(a.message), ...(a.conversation_id ? { conversation_id: String(a.conversation_id) } : {}) })),
  },
  {
    name: "list_agent_conversations",
    title: "Conversaciones con un agente",
    description: "Conversaciones propias con el agente (sin conversationId) o una completa con sus mensajes y la traza de herramientas (con conversationId). GET /api/v1/agents/{id}/conversations[/{cid}].",
    inputShape: { agentId: id("Id del agente."), conversationId: z.string().optional() },
    handler: async (a) => toToolText(await get(`/api/v1/agents/${E(a.agentId)}/conversations${a.conversationId ? `/${E(a.conversationId)}` : ""}`)),
  },

  /* ===================== Base de conocimiento personal ===================== */
  {
    name: "knowledge_settings",
    title: "Base de conocimiento: ajustes",
    description: "Sin argumentos lee; con enabled/sources/retention_days los cambia. La base esta APAGADA por defecto y es personal: solo guarda cuando quien la usa la activa. sources: {ask, ai, insight, report, agent, sheet, master, notebook, note: bool}; retention_days 0 (siempre) a 3650. Devuelve {enabled, sources, retention_days, enabled_at, source_catalog, stats {docs, entities, edges, by_kind, last_at}}. Requiere knowledge:use. GET|PUT /api/v1/knowledge/settings.",
    inputShape: { enabled: z.boolean().optional(), sources: z.record(z.string(), z.boolean()).optional(), retention_days: z.number().int().min(0).max(3650).optional() },
    handler: async (a) => {
      const body = pick(a, ["enabled", "sources", "retention_days"]);
      return toToolText(Object.keys(body).length ? await put("/api/v1/knowledge/settings", body) : await get("/api/v1/knowledge/settings"));
    },
  },
  {
    name: "knowledge_search",
    title: "Buscar en la base de conocimiento",
    description: "Busqueda por relevancia (BM25 con normalizacion del español y refuerzo por entidad) en lo que la persona pregunto, analizo, informo o converso. Devuelve {query, total, results:[{id, kind, app_id, app_name, title, text, snippet, score, entities, created_at}], entities:[{key,label,type,docs}]}. GET /api/v1/knowledge/search?q=&app_id=&kind=&limit=.",
    inputShape: { q: id("Que buscar (max 300)."), app_id: z.string().optional(), kind: z.string().optional(), limit: z.number().int().min(1).max(100).optional() },
    handler: async (a) => {
      const qs = [`q=${E(a.q)}`, a.app_id ? `app_id=${E(a.app_id)}` : "", a.kind ? `kind=${E(a.kind)}` : "", `limit=${a.limit ?? 20}`].filter(Boolean).join("&");
      return toToolText(await get(`/api/v1/knowledge/search?${qs}`));
    },
  },
  {
    name: "knowledge_docs",
    title: "Documentos de la base de conocimiento",
    description: "Documentos recientes (sin docId) o uno (con docId). kind: ask|ai|insight|report|agent|sheet|master|notebook|note. GET /api/v1/knowledge/docs[?kind=&app_id=&limit=&offset=] | /docs/{id}.",
    inputShape: { docId: z.string().optional(), kind: z.string().optional(), app_id: z.string().optional(), limit: z.number().int().min(1).max(200).optional() },
    handler: async (a) => {
      if (a.docId) return toToolText(await get(`/api/v1/knowledge/docs/${E(a.docId)}`));
      const qs = [a.kind ? `kind=${E(a.kind)}` : "", a.app_id ? `app_id=${E(a.app_id)}` : "", `limit=${a.limit ?? 50}`].filter(Boolean).join("&");
      return toToolText(await get(`/api/v1/knowledge/docs?${qs}`));
    },
  },
  {
    name: "knowledge_graph",
    title: "Grafo de conocimiento",
    description: "Red de entidades (app, measure, dimension, field, value, agent, concept) con su peso (documentos) y aristas (aparecieron juntas, con peso). Con entity devuelve el detalle de una entidad: documentos y vecinos. Con docs=true añade los documentos como nodos. GET /api/v1/knowledge/graph?app_id=&kind=&limit=&docs= | /entities/{key}.",
    inputShape: { entity: z.string().optional().describe("Clave de entidad (p. ej. v:andina)."), app_id: z.string().optional(), kind: z.string().optional(),
      limit: z.number().int().min(10).max(600).optional(), docs: z.boolean().optional() },
    handler: async (a) => {
      if (a.entity) return toToolText(await get(`/api/v1/knowledge/entities/${E(a.entity)}`));
      const qs = [a.app_id ? `app_id=${E(a.app_id)}` : "", a.kind ? `kind=${E(a.kind)}` : "", `limit=${a.limit ?? 200}`, `docs=${a.docs === true}`].filter(Boolean).join("&");
      return toToolText(await get(`/api/v1/knowledge/graph?${qs}`));
    },
  },
  {
    name: "knowledge_add_note",
    title: "Nota en la base de conocimiento",
    description: "Guarda una nota manual (acuerdos, contexto del negocio) que la busqueda y los agentes usaran. 409 si la base esta apagada. POST /api/v1/knowledge/notes con {title, text, app_id?, entities?: [{label, type}]}.",
    inputShape: { title: id("Titulo."), text: z.string().optional(), app_id: z.string().optional(),
      entities: z.array(z.object({ label: z.string(), type: z.string().optional() })).optional() },
    handler: async (a) => toToolText(await post("/api/v1/knowledge/notes", pick(a, ["title", "text", "app_id", "entities"]))),
  },
  {
    name: "knowledge_delete",
    title: "Borrar de la base de conocimiento",
    description: "ACCION DESTRUCTIVA. Con docId borra un documento; con all=true vacia toda la base de quien llama (documentos, entidades y aristas). DELETE /api/v1/knowledge/docs[/{id}].",
    inputShape: { docId: z.string().optional(), all: z.boolean().optional() },
    handler: async (a) => {
      if (a.docId) return toToolText(await del(`/api/v1/knowledge/docs/${E(a.docId)}`));
      if (a.all === true) return toToolText(await del("/api/v1/knowledge/docs"));
      throw new Error("Indica docId o all=true.");
    },
  },

  /* ===================== Informes: historia de datos ===================== */
  {
    name: "data_story",
    title: "Historia de datos (informe por diapositivas)",
    description: "Arma la misma 'Historia de datos' de Informes → Historia y presentacion: una secuencia de diapositivas con conclusion en el titular, datos del grafico, viñetas, '¿Como leerlo?' y notas del presentador. Usa las medidas maestras (la principal se elige por significado: ventas/ingresos primero) y el motor de consultas. Diapositivas: cover, kpis (max 4, con variacion ultimo vs anterior periodo), trend (line), pareto (cuantos explican el 80 %), mix (doughnut), perf (tasa por dimension), risk (tasa de riesgo), findings (resumen + recomendaciones; con useAI redacta el resumen con Bedrock), annex (tabla). Solo lectura: no guarda nada. El PDF y el modo presentacion se generan en el navegador (vista Informes). Devuelve {appName, title, period, measure, summarySource ia|reglas, slides:[{id, type, kicker, title, sub, chart? {kind, labels, series, ref?, cum?, highlight?}, items?, bullets?, how?, notes, cards?, recs?, head?, rows?}], measures:[{id,name}], dims, facts}. Usa GET /api/v1/apps/{appId}, GET /fields, GET /master-items, POST /expressions/parse, POST /query y (useAI) POST /api/v1/ai/analizar.",
    inputShape: {
      ...appId,
      title: z.string().optional().describe("Titulo de la portada (default: '<medida>: lo que dicen los datos')."),
      mainMeasureId: z.string().optional().describe("Id de la medida maestra principal (default: automatica)."),
      mainDim: z.string().optional().describe("Campo de la dimension principal (default: automatica)."),
      useAI: z.boolean().optional().describe("Resumen redactado por la IA (default false: resumen por reglas)."),
    },
    handler: async (a) => toToolText(await buildStory(String(a.appId), {
      title: a.title ? String(a.title) : undefined, mainMeasureId: a.mainMeasureId ? String(a.mainMeasureId) : undefined,
      mainDim: a.mainDim ? String(a.mainDim) : undefined, useAI: a.useAI === true,
    })),
  },

  /* ===================== Automatizar: carga programada, alertas, salud ===================== */
  {
    name: "get_schedule",
    title: "Carga programada (leer)",
    description: "Programacion de la carga de una app y su historial reciente: {schedule: {frequency, interval_minutes, time_of_day, weekday, notify, enabled, description, next_run_at, last_run_at, last_status ok|warn|fail, last_message, owner_name} | null, runs: [...]}. GET /api/v1/apps/{appId}/schedule.",
    inputShape: appId,
    handler: async (a) => toToolText(await get(`${A(a.appId)}/schedule`)),
  },
  {
    name: "set_schedule",
    title: "Programar la carga de datos",
    description: "Crea o reemplaza la carga programada (una por app). Corre el mismo 'Cargar datos' del editor con los permisos de quien la guarda. frequency: interval (interval_minutes 5-10080) | hourly | daily (time_of_day HH:MM) | weekly (weekday 1=lunes..7 y time_of_day). notify: fail (default) | always | never: avisos en la campana del dueno. Requiere data:import. PUT /api/v1/apps/{appId}/schedule.",
    inputShape: {
      ...appId,
      frequency: z.enum(["interval", "hourly", "daily", "weekly"]),
      interval_minutes: z.number().int().optional(), time_of_day: z.string().optional().describe("HH:MM 24 h."),
      weekday: z.number().int().min(1).max(7).optional(), notify: z.enum(["fail", "always", "never"]).optional(), enabled: z.boolean().optional(),
    },
    handler: async (a) => toToolText(await put(`${A(a.appId)}/schedule`, pick(a, ["frequency", "interval_minutes", "time_of_day", "weekday", "notify", "enabled"]))),
  },
  {
    name: "delete_schedule",
    title: "Quitar la carga programada",
    description: "ACCION DESTRUCTIVA: elimina la programacion (los datos no se tocan). DELETE /api/v1/apps/{appId}/schedule.",
    inputShape: appId,
    handler: async (a) => toToolText(await del(`${A(a.appId)}/schedule`)),
  },
  {
    name: "run_reload_now",
    title: "Ejecutar la carga ahora",
    description: "Recarga los datos ahora (como 'Ejecutar ahora'): queda en el historial, actualiza la salud y revisa las alertas 'al recargar'. Devuelve {ok, status ok|warn|fail, message, log, tables, alerts_checked}. POST /api/v1/apps/{appId}/schedule/run.",
    inputShape: appId,
    handler: async (a) => toToolText(await post(`${A(a.appId)}/schedule/run`)),
  },
  {
    name: "list_reload_runs",
    title: "Historial de cargas",
    description: "Cargas recientes (manuales, programadas y 'ejecutar ahora'): [{trigger manual|schedule|now, status, message, duration_ms, started_at, user_name}]. GET /api/v1/apps/{appId}/reload-runs?limit=.",
    inputShape: { ...appId, limit: z.number().int().min(1).max(60).optional() },
    handler: async (a) => toToolText(await get(`${A(a.appId)}/reload-runs?limit=${E(a.limit ?? 20)}`)),
  },
  {
    name: "list_alerts",
    title: "Alertas de una app",
    description: "Alertas de datos: [{id, name, expression | master_id, op, threshold, condition, selections, check_mode reload|interval, interval_minutes, enabled, state ok|triggered|error|unknown, last_value, last_message, last_checked_at, last_triggered_at, owner_name}]. GET /api/v1/apps/{appId}/alerts.",
    inputShape: appId,
    handler: async (a) => toToolText(await get(`${A(a.appId)}/alerts`)),
  },
  {
    name: "save_alert",
    title: "Crear/editar alerta",
    description: "Sin alertId crea; con alertId actualiza (solo su dueno o quien publica). La medida es una fx simple o compuesta (expression, p. ej. \"Count([FECHA RETIRO]) / Count([CEDULA]) * 100\") o una medida maestra (master_id). op: > >= < <= = != o change (cambio en % respecto a la revision anterior; threshold en %). selections {campo:[valores]} filtra. check_mode: reload (al recargar, default) | interval (cada interval_minutes >= 5). Se valida en el motor y se revisa al guardar; al dispararse o resolverse avisa en la campana de su dueno. POST|PUT /api/v1/apps/{appId}/alerts[/{alertId}].",
    inputShape: {
      ...appId, alertId: z.string().optional(), name: id("Nombre de la alerta."),
      expression: z.string().optional(), master_id: z.string().optional(),
      op: z.enum([">", ">=", "<", "<=", "=", "!=", "change"]), threshold: z.number(),
      selections: z.record(z.string(), z.array(z.any())).optional(),
      check_mode: z.enum(["reload", "interval"]).optional(), interval_minutes: z.number().int().optional(), enabled: z.boolean().optional(),
      action_id: z.string().optional().describe("Lista de accion a ejecutar (y enviar a su webhook) cuando la alerta se dispare."),
    },
    handler: async (a) => {
      const body = pick(a, ["name", "expression", "master_id", "op", "threshold", "selections", "check_mode", "interval_minutes", "enabled", "action_id"]);
      return toToolText(a.alertId ? await put(`${A(a.appId)}/alerts/${E(a.alertId)}`, body) : await post(`${A(a.appId)}/alerts`, body));
    },
  },
  {
    name: "check_alert",
    title: "Revisar una alerta ahora",
    description: "Calcula la medida de la alerta y la compara con su condicion (avisa en la campana si cambia de estado). Devuelve la alerta con state y last_value. POST /api/v1/apps/{appId}/alerts/{alertId}/check.",
    inputShape: { ...appId, alertId: id("Id de la alerta.") },
    handler: async (a) => toToolText(await post(`${A(a.appId)}/alerts/${E(a.alertId)}/check`)),
  },
  {
    name: "delete_alert",
    title: "Borrar alerta",
    description: "ACCION DESTRUCTIVA: borra una alerta (solo su dueno o quien publica). DELETE /api/v1/apps/{appId}/alerts/{alertId}.",
    inputShape: { ...appId, alertId: id("Id de la alerta.") },
    handler: async (a) => toToolText(await del(`${A(a.appId)}/alerts/${E(a.alertId)}`)),
  },
  {
    name: "get_data_health",
    title: "Salud de datos",
    description: "Revisa la calidad de los datos de una app: {score 0-100, status buena|regular|mala, tables [{table, rows, previous_rows, rows_change_pct, last_load, newest_date, duplicate_rows}], issues [{severity critical|warning|info, table, column, message, fix}], counts}. Detecta tablas vacias o que perdieron filas, columnas vacias o constantes, duplicados, numeros mezclados con texto, datos viejos y cargas programadas fallidas o atrasadas. GET /api/v1/apps/{appId}/health.",
    inputShape: appId,
    handler: async (a) => toToolText(await get(`${A(a.appId)}/health`)),
  },

  /* ===================== Que cambio y por que · registros · que pasaria si ===================== */
  {
    name: "explain_change",
    title: "Que cambio y por que",
    description: "Compara una medida (expression fx simple/compuesta o master_id) entre dos periodos de un campo de tiempo (automatico: el periodo mas fino; current/previous por defecto el ultimo y el anterior) y descompone el cambio por las dimensiones candidatas (o las de 'dimensions'). En medidas aditivas (Sum/Count) cada segmento trae share = % del cambio; en no aditivas (%, promedios) los segmentos se ordenan por cambio ponderado por su volumen (weight). Devuelve {measure, time_field, periods, current, previous, current_value, previous_value, delta, delta_pct, drivers:[{dimension, display, items:[{value, previous, current, delta, share|weight}]}], story (relato en espanol), trend? [{period, value}]}. Con drivers:false omite el desglose; con trend:true agrega la serie de los ultimos 12 periodos. POST /api/v1/apps/{appId}/insights/explain.",
    inputShape: {
      ...appId, expression: z.string().optional(), master_id: z.string().optional(), label: z.string().optional(),
      time_field: z.string().optional(), current: z.string().optional(), previous: z.string().optional(),
      selections: z.record(z.string(), z.array(z.any())).optional(), dimensions: z.array(z.string()).optional(), top: z.number().int().min(1).max(10).optional(),
      drivers: z.boolean().optional().describe("false = sin desglose por dimensiones (mas rapido)."),
      trend: z.boolean().optional().describe("true = agrega trend [{period, value}] con hasta 12 periodos hasta el actual."),
    },
    handler: async (a) => toToolText(await post(`${A(a.appId)}/insights/explain`, pick(a, ["expression", "master_id", "label", "time_field", "current", "previous", "selections", "dimensions", "top", "drivers", "trend"]))),
  },
  {
    name: "find_rows",
    title: "Registros detras de una cifra",
    description: "Del dato a la accion: los registros concretos de una tabla que cumplen filtros (selections {campo:[valores]}) y una condicion por fila opcional (where, p. ej. \"[probabilidad_retiro] > 0.6 AND [horizonte_meses] <= 3\"), con columnas (fields), orden (sort, desc) y limit (max 10000). Si no se indica table, se elige la que tiene los campos usados. Devuelve {table, columns, rows, total, truncated, table_rows}. POST /api/v1/apps/{appId}/insights/rows (CSV: /insights/rows.csv).",
    inputShape: {
      ...appId, table: z.string().optional(), selections: z.record(z.string(), z.array(z.any())).optional(), where: z.string().optional(),
      fields: z.array(z.string()).optional(), sort: z.string().optional(), desc: z.boolean().optional(), limit: z.number().int().min(1).max(10000).optional(),
    },
    handler: async (a) => toToolText(await post(`${A(a.appId)}/insights/rows`, pick(a, ["table", "selections", "where", "fields", "sort", "desc", "limit"]))),
  },
  {
    name: "simulate_whatif",
    title: "Que pasaria si (simulacion)",
    description: "Aplica cambios hipoteticos a una COPIA de los datos y recalcula medidas antes/despues (no modifica nada). changes: [{field, op: set|multiply|add, value, share? (% de filas elegibles, 1-100, reparto determinista), selections? {campo:[valores]}, where? (condicion por fila)}]. Ej.: retener el 20% de los inactivos de GALAPA = {field:'ESTADO CONTRATO', op:'set', value:'Activo', share:20, selections:{'ESTADO CONTRATO':['Inactivo'], SUCURSAL:['GALAPA']}}. measures: [{expression | master_id, label?}]; dimension opcional para ver el efecto por segmento. Devuelve {changes (con rows_changed y texto), results:[{label, before, after, delta, delta_pct, by?}], story}. POST /api/v1/apps/{appId}/insights/whatif.",
    inputShape: {
      ...appId,
      measures: z.array(z.object({ expression: z.string().optional(), master_id: z.string().optional(), label: z.string().optional() })).min(1),
      changes: z.array(z.object({
        field: z.string(), op: z.enum(["set", "multiply", "add"]), value: z.union([z.string(), z.number()]),
        share: z.number().min(1).max(100).optional(), selections: z.record(z.string(), z.array(z.any())).optional(), where: z.string().optional(),
      })).min(1),
      dimension: z.string().optional(), selections: z.record(z.string(), z.array(z.any())).optional(),
    },
    handler: async (a) => toToolText(await post(`${A(a.appId)}/insights/whatif`, pick(a, ["measures", "changes", "dimension", "selections"]))),
  },

  /* ===================== Del dato a la accion: listas · agente de guardia ===================== */
  {
    name: "list_action_lists",
    title: "Listas de accion",
    description: "Listas guardadas de la app: [{id, name, table_name, selections, where_expr, fields, sort_field, has_webhook, webhook_url (enmascarada), last_count, last_run_at, last_status, last_message}]. GET /api/v1/apps/{appId}/actions.",
    inputShape: appId,
    handler: async (a) => toToolText(await get(`${A(a.appId)}/actions`)),
  },
  {
    name: "save_action_list",
    title: "Crear/editar lista de accion",
    description: "Sin actionId crea; con actionId actualiza. {name, table?, selections?, where?, fields?, sort?, desc?, webhook_url? (http/https: Teams, Power Automate, Zapier, n8n, un API propio; recibe JSON {source, app, list, reason, count, columns, rows, text}), description?}. Se valida contra los datos. Una alerta puede ejecutarla al dispararse (save_alert con action_id). Requiere charts:edit. POST|PUT /api/v1/apps/{appId}/actions[/{actionId}].",
    inputShape: {
      ...appId, actionId: z.string().optional(), name: id("Nombre de la lista."), description: z.string().optional(),
      table: z.string().optional(), selections: z.record(z.string(), z.array(z.any())).optional(), where: z.string().optional(),
      fields: z.array(z.string()).optional(), sort: z.string().optional(), desc: z.boolean().optional(), webhook_url: z.string().optional(),
    },
    handler: async (a) => {
      const body = pick(a, ["name", "description", "table", "selections", "where", "fields", "sort", "desc", "webhook_url"]);
      return toToolText(a.actionId ? await put(`${A(a.appId)}/actions/${E(a.actionId)}`, body) : await post(`${A(a.appId)}/actions`, body));
    },
  },
  {
    name: "run_action_list",
    title: "Ejecutar lista de accion",
    description: "Ejecuta la lista: cuenta los registros y devuelve una muestra; con send=true la envia tambien a su webhook (ENVIA DATOS FUERA de PROTHEO). Devuelve {count, sent, status ok|fail|no_webhook, message, columns, rows}. POST /api/v1/apps/{appId}/actions/{actionId}/run.",
    inputShape: { ...appId, actionId: id("Id de la lista."), send: z.boolean().optional() },
    handler: async (a) => toToolText(await post(`${A(a.appId)}/actions/${E(a.actionId)}/run`, { send: a.send === true })),
  },
  {
    name: "delete_action_list",
    title: "Borrar lista de accion",
    description: "ACCION DESTRUCTIVA: borra la lista (las alertas que la usaban quedan sin lista). DELETE /api/v1/apps/{appId}/actions/{actionId}.",
    inputShape: { ...appId, actionId: id("Id de la lista.") },
    handler: async (a) => toToolText(await del(`${A(a.appId)}/actions/${E(a.actionId)}`)),
  },
  {
    name: "get_watchdog",
    title: "Agente de guardia (leer)",
    description: "Configuracion y ultima revision del agente de guardia: {watchdog: {enabled, threshold_pct, measures (ids de maestras; vacio = certificadas, si no maestras, si no registros y totales), last_run_at, last_summary {measures, findings, headline, health_score}} | null}. GET /api/v1/apps/{appId}/watchdog.",
    inputShape: appId,
    handler: async (a) => toToolText(await get(`${A(a.appId)}/watchdog`)),
  },
  {
    name: "set_watchdog",
    title: "Activar/configurar agente de guardia",
    description: "Activa el agente de guardia: tras cada carga y al menos a diario compara el ultimo periodo con el anterior en las metricas vigiladas; si alguna cambia mas que threshold_pct (en metricas que son %, en puntos) o la salud de datos tiene problemas criticos, avisa en la campana del dueno con el relato del porque. Requiere charts:edit. PUT /api/v1/apps/{appId}/watchdog con {threshold_pct?, measures?, enabled?}.",
    inputShape: { ...appId, threshold_pct: z.number().positive().optional(), measures: z.array(z.string()).optional(), enabled: z.boolean().optional() },
    handler: async (a) => toToolText(await put(`${A(a.appId)}/watchdog`, pick(a, ["threshold_pct", "measures", "enabled"]))),
  },
  {
    name: "run_watchdog",
    title: "Revisar ahora (agente de guardia)",
    description: "Ejecuta la revision del agente ahora y devuelve el resumen {measures:[{label, previous, current, previous_value, current_value, change, unit, flag, story}], findings, headline, health_score, health_critical}; si hay hallazgos avisa en la campana. POST /api/v1/apps/{appId}/watchdog/run.",
    inputShape: appId,
    handler: async (a) => toToolText(await post(`${A(a.appId)}/watchdog/run`)),
  },

  /* ======================= Automatizaciones (flujos por nodos) ======================= */
  {
    name: "list_flow_nodes",
    title: "Catalogo de nodos de automatizacion",
    description: "Catalogo para construir automatizaciones: {categories:[{id,label,color}], nodes:[{type, category, label, description, icon, input (false = disparador), outputs (puertos; logic.if: true/false), params:[{key,label,type (text|textarea|number|bool|select|app|table|field|measure|json|kv|credential:<kind>),default,required,options,show_if}]}], credentials:[{kind,label,help,fields:[{key,label,secret}]}], template_help}. Tipos (23): trigger.manual|schedule|webhook|reload|alert, data.reload|query|rows|ask|explain|health|whatif, ai.agent (role analyst|writer|classifier|hr|custom; consulta la app con herramientas), logic.if|filter|set|aggregate|wait, action.email|whatsapp|chat|http|notify. Plantillas {{ }}: $json, $items, $node[\"Nombre\"].json, $trigger, $now, $today; filtros number, percent, upper, lower, json, count, join, list:campo, table, default, round. GET /api/v1/flows/catalog.",
    inputShape: {},
    handler: async () => toToolText(await get("/api/v1/flows/catalog")),
  },
  {
    name: "list_flow_templates",
    title: "Plantillas de automatizacion",
    description: "Galeria de plantillas [{id, name, description, node_types, graph}]. El graph trae marcadores {{app}}, {{smtp}}, {{email}}, {{phone}}, {{whatsapp}}, {{webhook}}, {{measure}}, {{measure_label}} que hay que reemplazar (ids de app/credencial, correo, telefono, expresion fx) antes de save_flow. GET /api/v1/flows/templates.",
    inputShape: {},
    handler: async () => toToolText(await get("/api/v1/flows/templates")),
  },
  {
    name: "list_flows",
    title: "Listar automatizaciones",
    description: "Automatizaciones del usuario (el admin ve todas): [{id, name, description, enabled, trigger, node_types, nodes_count, last_run_at, last_status, next_run_at, owner_name}]. GET /api/v1/flows.",
    inputShape: {},
    handler: async () => toToolText(await get("/api/v1/flows")),
  },
  {
    name: "get_flow",
    title: "Leer automatizacion",
    description: "Automatizacion completa: {id, name, description, enabled, graph {nodes:[{id,type,name,x,y,params,disabled?}], edges:[{from,port,to}]}, problems (pendientes: sin disparador, parametros obligatorios vacios…), webhook_path, next_run_at, last_*}. GET /api/v1/flows/{id}.",
    inputShape: { flowId: id("Id de la automatizacion.") },
    handler: async (a) => toToolText(await get(`/api/v1/flows/${E(a.flowId)}`)),
  },
  {
    name: "save_flow",
    title: "Crear o actualizar automatizacion",
    description: "Crea (sin flowId; POST /api/v1/flows, 201) o reemplaza (con flowId; PUT /api/v1/flows/{id}) una automatizacion. graph = {nodes:[{id, type (ver list_flow_nodes), name (unico; lo usa $node[\"Nombre\"]), x, y, params, disabled?}], edges:[{from, port ('out' o 'true'/'false' en logic.if), to}]}. Cada nodo acepta params.on_error='continue' para seguir si falla. Un disparador no puede recibir conexiones. Devuelve la automatizacion con problems y webhook_path. Si estaba activa y quedan pendientes, se pausa. Requiere charts:edit.",
    inputShape: {
      flowId: z.string().optional().describe("Id para actualizar; omitir para crear."),
      name: z.string().optional().describe("Nombre (obligatorio al crear)."),
      description: z.string().optional(),
      graph: free("Grafo {nodes, edges}.").optional(),
    },
    handler: async (a) => {
      const body = pick(a, ["name", "description", "graph"]);
      return toToolText(a.flowId ? await put(`/api/v1/flows/${E(a.flowId)}`, body) : await post("/api/v1/flows", body));
    },
  },
  {
    name: "delete_flow",
    title: "Eliminar automatizacion",
    description: "ACCION DESTRUCTIVA: elimina la automatizacion y todo su historial de ejecuciones. 204. DELETE /api/v1/flows/{id}.",
    inputShape: { flowId: id("Id de la automatizacion.") },
    handler: async (a) => toToolText(await del(`/api/v1/flows/${E(a.flowId)}`)),
  },
  {
    name: "set_flow_enabled",
    title: "Activar / pausar automatizacion",
    description: "Activa (corre sola segun su disparador: programado, al recargar, alerta o webhook) o pausa. Falla con 400 si tiene pendientes. Devuelve la automatizacion con next_run_at. POST /api/v1/flows/{id}/enabled con {enabled}.",
    inputShape: { flowId: id("Id de la automatizacion."), enabled: z.boolean() },
    handler: async (a) => toToolText(await post(`/api/v1/flows/${E(a.flowId)}/enabled`, { enabled: a.enabled })),
  },
  {
    name: "run_flow",
    title: "Ejecutar automatizacion ahora",
    description: "Ejecuta la automatizacion ya (aunque este pausada) y espera el resultado: {run_id, status (ok|error), error, duration_ms, steps:[{node_id, name, type, status (ok|warning|error|skipped), ms, input_count, output_count {puerto:n}, output (muestra), error, note}], output (registros del ultimo nodo)}. ENVIA de verdad correos/WhatsApp/mensajes si el flujo los tiene. 'data' llega como $trigger. POST /api/v1/flows/{id}/run con {data?}.",
    inputShape: { flowId: id("Id de la automatizacion."), data: free("Datos de arranque ($trigger).").optional() },
    handler: async (a) => toToolText(await post(`/api/v1/flows/${E(a.flowId)}/run`, a.data ? { data: a.data } : {})),
  },
  {
    name: "list_flow_runs",
    title: "Historial de ejecuciones",
    description: "Ultimas ejecuciones: [{id, flow_id, trigger (manual|schedule|webhook|reload|alert), status, error, duration_ms, started_at}]. GET /api/v1/flows/{id}/runs?limit=.",
    inputShape: { flowId: id("Id de la automatizacion."), limit: z.number().int().positive().max(200).optional() },
    handler: async (a) => toToolText(await get(`/api/v1/flows/${E(a.flowId)}/runs${a.limit ? `?limit=${a.limit}` : ""}`)),
  },
  {
    name: "get_flow_run",
    title: "Detalle de una ejecucion",
    description: "Ejecucion con el detalle por nodo (steps con salida de muestra y errores). GET /api/v1/flows/{id}/runs/{runId}.",
    inputShape: { flowId: id("Id de la automatizacion."), runId: id("Id de la ejecucion.") },
    handler: async (a) => toToolText(await get(`/api/v1/flows/${E(a.flowId)}/runs/${E(a.runId)}`)),
  },
  {
    name: "rotate_flow_webhook",
    title: "Regenerar URL del webhook",
    description: "Genera una URL nueva para el disparador webhook; la anterior deja de funcionar (404). Devuelve la automatizacion con webhook_path. La URL publica (POST JSON o GET con parametros) es http://<host>/api/v1/hooks/flows/{token} y responde {ok, run_id, data}. POST /api/v1/flows/{id}/webhook/rotate.",
    inputShape: { flowId: id("Id de la automatizacion.") },
    handler: async (a) => toToolText(await post(`/api/v1/flows/${E(a.flowId)}/webhook/rotate`)),
  },
  {
    name: "list_flow_credentials",
    title: "Credenciales de automatizacion",
    description: "Credenciales propias (SMTP, WhatsApp Meta/Twilio, webhook de Teams/Slack, cabecera HTTP): [{id, kind, name, config}] con los secretos ocultos como '••••••'. GET /api/v1/flows/credentials.",
    inputShape: {},
    handler: async () => toToolText(await get("/api/v1/flows/credentials")),
  },
  {
    name: "save_flow_credential",
    title: "Crear o editar credencial",
    description: "Crea (sin credentialId; POST /api/v1/flows/credentials con {kind, name, config}) o edita (PUT /api/v1/flows/credentials/{id} con {name, config}). kind: smtp {host, port, security (starttls|ssl|none), user, password, from} | whatsapp_meta {phone_number_id, token, api_base?} | whatsapp_twilio {account_sid, auth_token, from} | webhook {url} | http {header, value}. Al editar, un secreto vacio o '••••••' conserva el guardado. Devuelve la credencial con secretos ocultos.",
    inputShape: {
      credentialId: z.string().optional().describe("Id para editar; omitir para crear."),
      kind: z.enum(["smtp", "whatsapp_meta", "whatsapp_twilio", "webhook", "http"]).optional().describe("Tipo (obligatorio al crear)."),
      name: id("Nombre visible."),
      config: free("Campos del tipo (ver list_flow_nodes -> credentials)."),
    },
    handler: async (a) => toToolText(a.credentialId
      ? await put(`/api/v1/flows/credentials/${E(a.credentialId)}`, pick(a, ["name", "config"]))
      : await post("/api/v1/flows/credentials", pick(a, ["kind", "name", "config"]))),
  },
  {
    name: "delete_flow_credential",
    title: "Borrar credencial",
    description: "ACCION DESTRUCTIVA: borra la credencial; los nodos que la usan dejan de enviar. 204. DELETE /api/v1/flows/credentials/{id}.",
    inputShape: { credentialId: id("Id de la credencial.") },
    handler: async (a) => toToolText(await del(`/api/v1/flows/credentials/${E(a.credentialId)}`)),
  },
  {
    name: "test_flow_credential",
    title: "Probar credencial",
    description: "SMTP: se conecta y se autentica de verdad; los demas tipos validan que esten completos. {ok, message}. POST /api/v1/flows/credentials/{id}/test.",
    inputShape: { credentialId: id("Id de la credencial.") },
    handler: async (a) => toToolText(await post(`/api/v1/flows/credentials/${E(a.credentialId)}/test`)),
  },

  /* ============================ Comentarios ============================ */
  {
    name: "list_comments",
    title: "Comentarios de una hoja / objeto",
    description: "Comentarios del equipo sobre los objetos de las hojas: [{id, sheet_id, object_id, point, selections, text, author_name, resolved, created_at}] (mas antiguos primero). Filtros opcionales sheetId y objectId. GET /api/v1/apps/{appId}/comments?sheetId=&objectId=.",
    inputShape: { ...appId, sheetId: z.string().optional().describe("Solo los de esta hoja."), objectId: z.string().optional().describe("Solo los de este objeto.") },
    handler: async (a) => {
      const q = new URLSearchParams();
      if (a.sheetId) q.set("sheetId", String(a.sheetId));
      if (a.objectId) q.set("objectId", String(a.objectId));
      return toToolText(await get(`${A(a.appId)}/comments${q.toString() ? `?${q}` : ""}`));
    },
  },
  {
    name: "add_comment",
    title: "Comentar un objeto de una hoja",
    description: "Agrega un comentario a un objeto (grafico, KPI, tabla…) de una hoja. 'point' ancla el comentario a un punto legible (p. ej. 'EMPRESA = Vigia') y 'selections' guarda la seleccion {campo:[valores]} para volver a ese punto desde la UI. Requiere dashboard:view. Devuelve 201 con el comentario. POST /api/v1/apps/{appId}/comments con {sheetId, objectId, text, point?, selections?}.",
    inputShape: {
      ...appId, sheetId: id("Id de la hoja."), objectId: id("Id del objeto de la hoja (get_sheet -> objects[].id)."), text: id("Texto del comentario (max 2000)."),
      point: z.string().optional().describe("Punto al que se refiere, legible."), selections: z.record(z.string(), z.array(z.any())).optional().describe("Seleccion {campo: [valores]} del punto."),
    },
    handler: async (a) => toToolText(await post(`${A(a.appId)}/comments`, pick(a, ["sheetId", "objectId", "text", "point", "selections"]))),
  },
  {
    name: "resolve_comment",
    title: "Resolver / reabrir comentario",
    description: "Marca un comentario como resuelto (resolved=true, default) o lo reabre (false). PUT /api/v1/apps/{appId}/comments/{commentId} con {resolved}.",
    inputShape: { ...appId, commentId: id("Id del comentario."), resolved: z.boolean().optional() },
    handler: async (a) => toToolText(await put(`${A(a.appId)}/comments/${E(a.commentId)}`, { resolved: a.resolved !== false })),
  },
  {
    name: "delete_comment",
    title: "Borrar comentario",
    description: "ACCION DESTRUCTIVA: borra un comentario. Solo su autor o quien tiene apps:publish. DELETE /api/v1/apps/{appId}/comments/{commentId}.",
    inputShape: { ...appId, commentId: id("Id del comentario.") },
    handler: async (a) => toToolText(await del(`${A(a.appId)}/comments/${E(a.commentId)}`)),
  },

  /* ============================ Cuadernos de analisis ============================ */
  {
    name: "list_notebooks",
    title: "Listar cuadernos de analisis",
    description:
      "Cuadernos de analisis de la app (sin celdas): [{id, name, description, cell_count, kinds:{sql:n,...}, owner_id, owner_name, created_at, updated_at}], " +
      "del mas reciente al mas antiguo. GET /api/v1/apps/{appId}/notebooks.",
    inputShape: appId,
    handler: async (a) => toToolText(await get(`${A(a.appId)}/notebooks`)),
  },
  {
    name: "get_notebook",
    title: "Leer un cuaderno",
    description:
      "Cuaderno con sus celdas: {id, name, description, cells:[{id, kind: sql|profile|pareto|correlation|outliers|note, title, sql?, text?, params?, view?}], owner_id, ...}. " +
      "Los resultados no se guardan: ejecuta cada celda con run_notebook_cell. GET /api/v1/apps/{appId}/notebooks/{id}.",
    inputShape: { ...appId, notebookId: id("Id del cuaderno.") },
    handler: async (a) => toToolText(await get(`${A(a.appId)}/notebooks/${E(a.notebookId)}`)),
  },
  {
    name: "notebook_schema",
    title: "Tablas y columnas para el cuaderno",
    description:
      "Tablas de la app con sus filas y columnas para escribir consultas: [{table, rows, columns:[{name, type: number|text|date, display?}]}]. " +
      "GET /api/v1/apps/{appId}/notebooks/schema.",
    inputShape: appId,
    handler: async (a) => toToolText(await get(`${A(a.appId)}/notebooks/schema`)),
  },
  {
    name: "save_notebook",
    title: "Crear o actualizar un cuaderno",
    description:
      "Sin notebookId crea el cuaderno (POST /api/v1/apps/{appId}/notebooks; sin cells arranca con una consulta de la tabla principal). " +
      "Con notebookId lo actualiza (PUT /api/v1/apps/{appId}/notebooks/{id}): solo cambia lo que envies; cells REEMPLAZA la lista completa. " +
      "Celda: {id?, kind: sql|profile|pareto|correlation|outliers|note, title?, sql? (kind sql), text? (kind note, markdown), " +
      "params? {table, field (profile/outliers), dimension+measure+where (pareto; en la UI magg: count|sum|avg|distinct + mfield), fields[] (correlation), k (outliers, 1.5 por defecto)}, view? {chart: auto|table|bar|line|pie|kpi|scatter}, " +
      "builder? (kind sql en modo visual: {table, dims[campo], metrics[{agg: count|sum|avg|min|max|median|distinct, field}], filters[{field, op: eq|ne|gt|gte|lt|lte|contains|starts|in|null|notnull, value}], order{by, dir: asc|desc}, limit, manual?}; " +
      "la UI regenera el SQL desde builder, asi que envia tambien el sql equivalente; manual:true = la celda se edita como SQL)}. " +
      "Maximo 80 celdas. Requiere charts:edit; actualizar solo su dueno o un administrador. Devuelve el cuaderno con celdas.",
    inputShape: {
      ...appId,
      notebookId: z.string().optional().describe("Id del cuaderno a actualizar; omitir para crear uno nuevo."),
      name: z.string().max(120).optional().describe("Nombre (hasta 120 caracteres)."),
      description: z.string().max(300).nullable().optional().describe("Descripcion; null la borra."),
      cells: z.array(z.record(z.string(), z.any())).max(80).optional().describe("Lista completa de celdas (reemplaza la actual)."),
    },
    handler: async (a) => {
      const body = pick(a, ["name", "description", "cells"]);
      return toToolText(a.notebookId
        ? await put(`${A(a.appId)}/notebooks/${E(a.notebookId)}`, body)
        : await post(`${A(a.appId)}/notebooks`, body));
    },
  },
  {
    name: "delete_notebook",
    title: "Borrar cuaderno",
    description: "ACCION DESTRUCTIVA: elimina el cuaderno y todas sus celdas. Solo su dueno o un administrador. DELETE /api/v1/apps/{appId}/notebooks/{id}.",
    inputShape: { ...appId, notebookId: id("Id del cuaderno.") },
    handler: async (a) => toToolText(await del(`${A(a.appId)}/notebooks/${E(a.notebookId)}`)),
  },
  {
    name: "run_notebook_cell",
    title: "Ejecutar SQL o un analisis del cuaderno",
    description:
      "Ejecuta una celda en el motor (solo lectura, no guarda nada). POST /api/v1/apps/{appId}/notebooks/run {cell:{kind, sql, params}}. " +
      "kind=sql: SELECT [DISTINCT] ... FROM tabla [WHERE] [GROUP BY] [HAVING] [ORDER BY] [LIMIT n] sobre UNA tabla (sin JOIN ni WITH); " +
      "agregaciones SUM/AVG/COUNT/COUNT(DISTINCT)/MIN/MAX/MEDIAN/STDDEV/PERCENTILE(campo, p) con FILTER (WHERE ...), CASE, LIKE, IN, BETWEEN; " +
      "LIMIT 1000 por defecto, maximo 10000. Devuelve {columns, types, rows, row_count, total_rows, truncated, chart, summary, ms}. " +
      "kind=profile {table, field}: vacios, distintos, percentiles, asimetria, histograma o valores frecuentes. " +
      "kind=pareto {table, dimension, measure (SQL, p. ej. SUM(ventas)), where?}: % acumulado y clases A/B/C (A hasta 80 %, B hasta 95 %). " +
      "kind=correlation {table, fields?[]}: matriz de Pearson y parejas ordenadas por fuerza. " +
      "kind=outliers {table, field, k?}: atipicos de Tukey (IQR) con z-score y registros. " +
      "Alternativa: notebookId + cellId ejecuta una celda guardada.",
    inputShape: {
      ...appId,
      kind: z.enum(["sql", "profile", "pareto", "correlation", "outliers"]).optional().describe("Tipo de celda (sql por defecto)."),
      sql: z.string().max(20000).optional().describe("Consulta (kind sql)."),
      params: free("Parametros del analisis: table, field, dimension, measure, where, fields, k.").optional(),
      notebookId: z.string().optional().describe("Ejecutar una celda guardada de este cuaderno (con cellId)."),
      cellId: z.string().optional().describe("Id de la celda guardada a ejecutar."),
    },
    handler: async (a) => {
      let cell: Record<string, unknown> = { kind: a.kind ?? "sql", sql: a.sql, params: a.params };
      if (a.notebookId && a.cellId) {
        const nb = (await get(`${A(a.appId)}/notebooks/${E(a.notebookId)}`)) as { cells?: Array<Record<string, unknown>> };
        const c = nb?.cells?.find((x) => x.id === a.cellId);
        if (!c) throw new Error(`La celda ${String(a.cellId)} no existe en el cuaderno ${String(a.notebookId)}.`);
        cell = { kind: c.kind, sql: c.sql, params: c.params };
      }
      return toToolText(await post(`${A(a.appId)}/notebooks/run`, { cell }));
    },
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
      "Lo que muestra la campana del usuario del MCP. Todos ven sus eventos de automatizacion (kind alert | alert_ok | reload | " +
      "reload_fail | health, ids 'evt:...'); el administrador ve ademas la actividad de la plataforma: nuevas apps, datos cargados, hojas, " +
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
      "Roles (admin, editor, viewer y personalizados r-…, con custom/customized) con sus permisos detallados, el catálogo de permisos " +
      "({id, label, module, action ver|crear|editar|eliminar|publicar|ejecutar|exportar|administrar, risk bajo|medio|alto, description}), los módulos, " +
      "las equivalencias de los permisos antiguos (legacy: {id, anchor, covers}) y las etapas de una app (personal → desarrollo → produccion). GET /api/v1/auth/catalog.",
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
      "{email, name?, password (8+), role: admin|editor|viewer|r-… (personalizado), active?, grant?: [permisos extra], deny?: [permisos quitados]}. " +
      "Dar un rol distinto de viewer o excepciones requiere roles:manage; solo un administrador asigna admin. Queda en la auditoria. " +
      "POST /api/v1/users. Permisos válidos: ver get_security_catalog.",
    inputShape: {
      email: id("Correo (único)."),
      name: z.string().optional().describe("Nombre visible."),
      password: z.string().min(8).describe("Contraseña inicial (mínimo 8 caracteres)."),
      role: z.string().min(1).describe("Rol base: admin | editor | viewer | id de un rol personalizado (r-…)."),
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
      "Nunca deja la plataforma sin un administrador activo. Cambiar rol o grant/deny (permisos detallados; los antiguos se expanden) requiere roles:manage; " +
      "solo un administrador asigna admin. Cada cambio queda en la auditoria. PUT /api/v1/users/{id}.",
    inputShape: {
      userId: id("Id del usuario."),
      email: z.string().optional(), name: z.string().optional(),
      role: z.string().optional().describe("admin | editor | viewer | r-…"), active: z.boolean().optional(),
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
      "Contenido del centro de ayuda de PROTHEO (botón «?»): primeros pasos, manual técnico, preguntas frecuentes y " +
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

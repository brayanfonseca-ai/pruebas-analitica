/**
 * Esquemas de input (zod) de las tools de lectura (contexto) del MCP.
 *
 * Se exportan como "raw shapes" (objetos de ZodType) porque el SDK MCP
 * (server.tool / registerTool) recibe la forma del input como un record de
 * esquemas zod, no como un ZodObject ya cerrado.
 */

import { z } from "zod";

/** Identificador de aplicacion DataSense. */
export const appIdShape = {
  appId: z.string().min(1).describe("Identificador de la aplicacion (appId)."),
};

/** appId + tableId (para leer una tabla concreta). */
export const tableIdShape = {
  appId: z.string().min(1).describe("Identificador de la aplicacion (appId)."),
  tableId: z.string().min(1).describe("Identificador de la tabla (tableId)."),
};

/** appId + nombre de campo (para obtener los valores distintos de un campo). */
export const fieldValuesShape = {
  appId: z.string().min(1).describe("Identificador de la aplicacion (appId)."),
  field: z
    .string()
    .min(1)
    .describe("Nombre del campo del que se quieren obtener los valores."),
};

// ----------------------------------------------------------------------------
// Esquemas de input (zod) de las tools de ACCION (ejecucion) — FEAT-002.
// ----------------------------------------------------------------------------

/** Aggregaciones soportadas por el motor de query (default sum). */
export const aggEnum = z
  .enum(["sum", "count", "avg", "min", "max"])
  .describe("Agregacion: sum|count|avg|min|max (default sum).");

/** create_app {name}. */
export const createAppShape = {
  name: z
    .string()
    .min(1)
    .describe("Nombre de la nueva aplicacion (no vacio)."),
};

/** Referencia a dimension dentro de un QuerySpec. */
const dimensionSchema = z
  .object({
    table: z.string().min(1).describe("Tabla de la dimension."),
    field: z.string().min(1).describe("Campo de la dimension."),
  })
  .describe("Dimension de agrupacion: {table, field}. Omitir para KPI escalar.");

/** Referencia a una medida dentro de un QuerySpec. */
const measureSchema = z.object({
  table: z.string().min(1).describe("Tabla de la medida."),
  field: z.string().min(1).describe("Campo de la medida."),
  agg: aggEnum.optional(),
  label: z.string().optional().describe("Etiqueta opcional de la medida."),
});

/**
 * run_query {appId, dimension?, measures, chart_type?, selections?}.
 * Sin dimension -> KPI escalar en QueryResult.value; con dimension -> labels+series.
 */
export const runQueryShape = {
  appId: z.string().min(1).describe("Identificador de la aplicacion (appId)."),
  dimension: dimensionSchema.optional(),
  measures: z
    .array(measureSchema)
    .min(1)
    .describe("Medidas a calcular (al menos una)."),
  chart_type: z
    .string()
    .optional()
    .describe("Tipo de grafico sugerido (kpi|bar|pie|line|table)."),
  selections: z
    .record(z.string(), z.array(z.any()))
    .optional()
    .describe("Selecciones/filtros por campo: { <field>: [valores] }."),
};

/** set_script {appId, text}. */
export const setScriptShape = {
  appId: z.string().min(1).describe("Identificador de la aplicacion (appId)."),
  text: z.string().describe("Texto completo del script de carga."),
};

/** Objeto de hoja (dashboard) para create_sheet/update_sheet. */
const sheetObjectSchema = z
  .object({
    type: z
      .string()
      .min(1)
      .describe(
        "Tipo de objeto. Datos: kpi|bar|line|pie|table|filterpane|combo|scatter|pivot|gauge|histogram|boxplot|treemap(block)|waterfall|funnel|sankey|map|text… (ver list_chart_types). Machine Learning: ml-clustermap|ml-elbow|ml-silhouette|ml-segments|ml-profile|ml-sizes|ml-actualpred|ml-importance|ml-coefs|ml-roc|ml-confusion|ml-leaderboard|ml-forecast|ml-corr|ml-pca|ml-anomaly|ml-rules|ml-metrics|ml-insights (requieren props.ml={experimentId,runId}; mas facil: add_ml_chart).",
      ),
    title: z.string().optional().describe("Titulo del objeto."),
    dimension: z.string().optional().describe("Campo de dimension."),
    measure: z
      .object({
        field: z.string().describe("Campo de la medida."),
        agg: aggEnum.optional(),
      })
      .optional()
      .describe("Medida: {field, agg}."),
    x: z.number().optional().describe("Columna inicial (rejilla de 24 col)."),
    y: z.number().optional().describe("Fila inicial."),
    w: z.number().optional().describe("Ancho en columnas (rejilla de 24)."),
    h: z.number().optional().describe("Alto en filas."),
  })
  .passthrough();

/** create_sheet {appId, title?, description?, objects?, props?}. */
export const createSheetShape = {
  appId: z.string().min(1).describe("Identificador de la aplicacion (appId)."),
  title: z.string().optional().describe("Titulo de la hoja/dashboard."),
  description: z.string().optional().describe("Descripcion de la hoja."),
  objects: z
    .array(sheetObjectSchema)
    .optional()
    .describe(
      "Objetos del dashboard (kpi|bar|pie|line|table|filterpane) con x,y,w,h en rejilla de 24 columnas.",
    ),
  props: z
    .record(z.string(), z.any())
    .optional()
    .describe("Propiedades libres de la hoja."),
};

/** update_sheet {appId, sheetId, title?, description?, objects?, props?}. */
export const updateSheetShape = {
  appId: z.string().min(1).describe("Identificador de la aplicacion (appId)."),
  sheetId: z.string().min(1).describe("Identificador de la hoja (sheetId)."),
  title: z.string().optional().describe("Titulo de la hoja/dashboard."),
  description: z.string().optional().describe("Descripcion de la hoja."),
  objects: z
    .array(sheetObjectSchema)
    .optional()
    .describe(
      "Objetos del dashboard (kpi|bar|pie|line|table|filterpane) con x,y,w,h en rejilla de 24 columnas.",
    ),
  props: z
    .record(z.string(), z.any())
    .optional()
    .describe("Propiedades libres de la hoja."),
};

/** create_connection {appId, name, connector, space?, config}. */
export const createConnectionShape = {
  appId: z.string().min(1).describe("Identificador de la aplicacion (appId)."),
  name: z.string().min(1).describe("Nombre de la conexion."),
  connector: z
    .string()
    .min(1)
    .describe("Tipo de conector (ej. aws, postgres, csv)."),
  space: z.string().optional().describe("Espacio opcional de la conexion."),
  config: z
    .record(z.string(), z.any())
    .describe("Configuracion/credenciales del conector."),
};

/** test_connection {appId, connector, config}. */
export const testConnectionShape = {
  appId: z.string().min(1).describe("Identificador de la aplicacion (appId)."),
  connector: z.string().min(1).describe("Tipo de conector a probar."),
  config: z
    .record(z.string(), z.any())
    .describe("Configuracion/credenciales del conector a probar."),
};

/** ai_modelar / ai_disenar: payload libre (Map). */
export const aiFreeShape = {
  payload: z
    .record(z.string(), z.any())
    .optional()
    .describe("Payload libre para el agente de IA (perfil de datos, modelo, etc.)."),
};

/** ai_analizar {pregunta, contexto?}. */
export const aiAnalizarShape = {
  pregunta: z.string().min(1).describe("Pregunta para el agente de IA."),
  contexto: z
    .record(z.string(), z.any())
    .optional()
    .describe("Contexto opcional para la pregunta."),
};

/** appId para delete_app / run_script. */
export { appIdShape as deleteAppShape };

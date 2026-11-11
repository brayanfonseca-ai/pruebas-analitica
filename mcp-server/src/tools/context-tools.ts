/**
 * Tools de CONTEXTO (solo lectura) del MCP de DataSense.
 *
 * Cada tool llama al http-client contra el backend REST /api/v1 y devuelve el
 * JSON de respuesta como contenido de texto para el agente. Rutas EXACTAS
 * segun .kiro/qa/mcp-plan.md.
 */

import { get, post, toToolText } from "../http-client.js";
import { appIdShape, tableIdShape, fieldValuesShape } from "./schemas.js";

/**
 * Forma de una tool de contexto lista para registrar en el Server MCP.
 * - inputShape: record de esquemas zod (la "raw shape" que espera el SDK).
 * - handler: recibe los argumentos validados y devuelve el payload de texto.
 */
export interface ContextTool {
  name: string;
  title: string;
  description: string;
  inputShape: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<string>;
}

export const contextTools: ContextTool[] = [
  {
    name: "list_apps",
    title: "Listar aplicaciones",
    description:
      "Lista las aplicaciones que el usuario del MCP puede ver. Devuelve AppOut[] = [{id, name, created_at, stage (personal|desarrollo|produccion), " +
      "owner_id, owner_name, sheets, published}]. GET /api/v1/apps.",
    inputShape: {},
    handler: async () => toToolText(await get("/api/v1/apps")),
  },
  {
    name: "get_app",
    title: "Detalle de aplicacion",
    description:
      "Obtiene el detalle de una aplicacion por su appId. Devuelve AppOut {id, name, created_at, stage, owner_id, owner_name, sheets, published}. GET /api/v1/apps/{appId}.",
    inputShape: appIdShape,
    handler: async (args) =>
      toToolText(await get(`/api/v1/apps/${encodeURIComponent(String(args.appId))}`)),
  },
  {
    name: "list_tables",
    title: "Listar tablas",
    description:
      "Lista las tablas de una aplicacion. Devuelve TableOut[] (cada uno con preview capado a 50 filas). GET /api/v1/apps/{appId}/tables.",
    inputShape: appIdShape,
    handler: async (args) =>
      toToolText(
        await get(`/api/v1/apps/${encodeURIComponent(String(args.appId))}/tables`),
      ),
  },
  {
    name: "read_table",
    title: "Leer tabla",
    description:
      "Lee una tabla concreta: devuelve TableOut con 'columns' (perfil), 'rows' (total real de filas) y 'preview'. ADVERTENCIA: 'preview' esta CAPADO a 50 filas; no es el dataset completo. 'rows' es el total. Para calculos o agregaciones sobre TODO el dataset, usa la tool run_query (no el preview). GET /api/v1/apps/{appId}/tables/{tableId}.",
    inputShape: tableIdShape,
    handler: async (args) =>
      toToolText(
        await get(
          `/api/v1/apps/${encodeURIComponent(String(args.appId))}/tables/${encodeURIComponent(String(args.tableId))}`,
        ),
      ),
  },
  {
    name: "get_fields",
    title: "Obtener campos",
    description:
      "Obtiene los campos (dimensiones y medidas) de una aplicacion. Devuelve {dimensions:[{table,field,type}], measures:[...]}. GET /api/v1/apps/{appId}/fields.",
    inputShape: appIdShape,
    handler: async (args) =>
      toToolText(
        await get(`/api/v1/apps/${encodeURIComponent(String(args.appId))}/fields`),
      ),
  },
  {
    name: "get_field_values",
    title: "Valores de un campo",
    description:
      "Obtiene los valores distintos de un campo. Devuelve {field, values:[{value,state}]}. POST /api/v1/apps/{appId}/fields/values con {field}.",
    inputShape: fieldValuesShape,
    handler: async (args) =>
      toToolText(
        await post(
          `/api/v1/apps/${encodeURIComponent(String(args.appId))}/fields/values`,
          { field: String(args.field) },
        ),
      ),
  },
  {
    name: "get_model",
    title: "Modelo de datos",
    description:
      "Obtiene el modelo de datos (grafo de nodos/enlaces/avisos) de una aplicacion. GET /api/v1/apps/{appId}/model.",
    inputShape: appIdShape,
    handler: async (args) =>
      toToolText(
        await get(`/api/v1/apps/${encodeURIComponent(String(args.appId))}/model`),
      ),
  },
  {
    name: "get_script",
    title: "Leer script de carga",
    description:
      "Lee el script de carga de una aplicacion. Devuelve {app_id, text, is_custom}. GET /api/v1/apps/{appId}/script.",
    inputShape: appIdShape,
    handler: async (args) =>
      toToolText(
        await get(`/api/v1/apps/${encodeURIComponent(String(args.appId))}/script`),
      ),
  },
  {
    name: "list_sheets",
    title: "Listar hojas",
    description:
      "Lista las hojas (dashboards) de una aplicacion. Devuelve SheetOut[]. GET /api/v1/apps/{appId}/sheets.",
    inputShape: appIdShape,
    handler: async (args) =>
      toToolText(
        await get(`/api/v1/apps/${encodeURIComponent(String(args.appId))}/sheets`),
      ),
  },
  {
    name: "list_connections",
    title: "Listar conexiones",
    description:
      "Lista las conexiones de datos de una aplicacion. Devuelve Map[]. GET /api/v1/apps/{appId}/connections.",
    inputShape: appIdShape,
    handler: async (args) =>
      toToolText(
        await get(
          `/api/v1/apps/${encodeURIComponent(String(args.appId))}/connections`,
        ),
      ),
  },
  {
    name: "ai_health",
    title: "Salud del agente IA",
    description:
      "Comprueba el estado del agente de IA del backend. Devuelve {ok, agent, model, region}. GET /api/v1/ai/health.",
    inputShape: {},
    handler: async () => toToolText(await get("/api/v1/ai/health")),
  },
];

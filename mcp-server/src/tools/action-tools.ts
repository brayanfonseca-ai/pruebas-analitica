/**
 * Tools de ACCION (ejecucion) del MCP de DataSense.
 *
 * Dan al agente la capacidad de EJECUTAR acciones reales en el aplicativo:
 * crear/borrar apps, correr queries/agregaciones, gestionar el script de carga,
 * crear/actualizar hojas y dashboards, crear/probar conexiones e invocar la IA.
 *
 * Cada tool llama al http-client contra el backend REST /api/v1 y devuelve el
 * JSON de respuesta como contenido de texto para el agente. Rutas EXACTAS
 * segun .kiro/qa/mcp-plan.md. NO modifica el backend Java.
 */

import { post, put, del, toToolText } from "../http-client.js";
import type { ContextTool } from "./context-tools.js";
import {
  createAppShape,
  deleteAppShape,
  runQueryShape,
  setScriptShape,
  createSheetShape,
  updateSheetShape,
  createConnectionShape,
  testConnectionShape,
  aiFreeShape,
  aiAnalizarShape,
} from "./schemas.js";

/** Codifica el appId para usarlo en la ruta. */
function appPath(appId: unknown): string {
  return `/api/v1/apps/${encodeURIComponent(String(appId))}`;
}

/**
 * Las tools de accion comparten la misma forma que las de contexto
 * (name/title/description/inputShape/handler), por lo que se registran con el
 * mismo bucle en tools.ts.
 */
export const actionTools: ContextTool[] = [
  {
    name: "create_app",
    title: "Crear aplicacion",
    description:
      "Crea una nueva aplicacion DataSense. Devuelve 201 AppOut {id, name, created_at}. POST /api/v1/apps con {name}.",
    inputShape: createAppShape,
    handler: async (args) =>
      toToolText(await post("/api/v1/apps", { name: String(args.name) })),
  },
  {
    name: "delete_app",
    title: "Borrar aplicacion",
    description:
      "ACCION DESTRUCTIVA: elimina permanentemente una aplicacion y todo su contenido (tablas, hojas, conexiones). No se puede deshacer. Devuelve 204 No Content. DELETE /api/v1/apps/{appId}.",
    inputShape: deleteAppShape,
    handler: async (args) => toToolText(await del(appPath(args.appId))),
  },
  {
    name: "run_query",
    title: "Ejecutar query / agregacion",
    description:
      "Ejecuta una query de agregacion sobre TODO el dataset (en el motor, sin traer filas). Sin 'dimension' -> KPI escalar en QueryResult.value; con 'dimension' -> labels + series. Medidas con agg in sum|count|avg|min|max (default sum). POST /api/v1/apps/{appId}/query con QuerySpec.",
    inputShape: runQueryShape,
    handler: async (args) => {
      const spec: Record<string, unknown> = { measures: args.measures };
      if (args.dimension !== undefined) spec.dimension = args.dimension;
      if (args.chart_type !== undefined) spec.chart_type = args.chart_type;
      if (args.selections !== undefined) spec.selections = args.selections;
      return toToolText(await post(`${appPath(args.appId)}/query`, spec));
    },
  },
  {
    name: "set_script",
    title: "Guardar script de carga",
    description:
      "Guarda (reemplaza) el script de carga de una aplicacion. Devuelve {app_id, text, is_custom:true}. PUT /api/v1/apps/{appId}/script con {text}.",
    inputShape: setScriptShape,
    handler: async (args) =>
      toToolText(
        await put(`${appPath(args.appId)}/script`, { text: String(args.text) }),
      ),
  },
  {
    name: "run_script",
    title: "Correr script (recargar modelo)",
    description:
      "Ejecuta el script de carga y RECARGA el modelo de datos de la aplicacion. Devuelve {ok, log:[string], tables:[{table,rows,fields}]}. POST /api/v1/apps/{appId}/script/run.",
    inputShape: deleteAppShape,
    handler: async (args) =>
      toToolText(await post(`${appPath(args.appId)}/script/run`)),
  },
  {
    name: "create_sheet",
    title: "Crear hoja / dashboard",
    description:
      "Crea una hoja (dashboard) con objetos de visualizacion. 'objects' admite tipo kpi|bar|pie|line|table|filterpane con dimension/measure{field,agg} y x,y,w,h en una rejilla de 24 columnas (sin solapes). Devuelve 201 SheetOut. POST /api/v1/apps/{appId}/sheets con {title,description,objects,props}.",
    inputShape: createSheetShape,
    handler: async (args) => {
      const body: Record<string, unknown> = {};
      if (args.title !== undefined) body.title = args.title;
      if (args.description !== undefined) body.description = args.description;
      if (args.objects !== undefined) body.objects = args.objects;
      if (args.props !== undefined) body.props = args.props;
      return toToolText(await post(`${appPath(args.appId)}/sheets`, body));
    },
  },
  {
    name: "update_sheet",
    title: "Actualizar hoja / dashboard",
    description:
      "Actualiza una hoja existente (titulo, descripcion, objetos y/o props). Devuelve SheetOut. PUT /api/v1/apps/{appId}/sheets/{sheetId}.",
    inputShape: updateSheetShape,
    handler: async (args) => {
      const body: Record<string, unknown> = {};
      if (args.title !== undefined) body.title = args.title;
      if (args.description !== undefined) body.description = args.description;
      if (args.objects !== undefined) body.objects = args.objects;
      if (args.props !== undefined) body.props = args.props;
      return toToolText(
        await put(
          `${appPath(args.appId)}/sheets/${encodeURIComponent(String(args.sheetId))}`,
          body,
        ),
      );
    },
  },
  {
    name: "create_connection",
    title: "Crear conexion de datos",
    description:
      "Crea una conexion de datos (s3, athena, postgres, mysql, mariadb, sqlserver, oracle, redshift, webfile, rest, etc.). Las conexiones son del USUARIO que las crea (la cuenta con la que entra el MCP): privadas hasta que se comparten con share_connection, y reutilizables en todos sus proyectos. Los conectores sin ejecutor real (vista previa) guardan la config pero al probar/cargar devuelven un aviso honesto. Devuelve 201 con la conexion. POST /api/v1/connections con {name, connector, space?, config}. Requiere connections:manage.",
    inputShape: createConnectionShape,
    handler: async (args) => {
      const body: Record<string, unknown> = {
        name: args.name,
        connector: args.connector,
        config: args.config,
      };
      if (args.space !== undefined) body.space = args.space;
      return toToolText(await post("/api/v1/connections", body));
    },
  },
  {
    name: "test_connection",
    title: "Probar conexion de datos",
    description:
      "Prueba una conexion de datos sin crearla. Devuelve {ok:boolean, message:string}. POST /api/v1/connections/test con {connector, config}.",
    inputShape: testConnectionShape,
    handler: async (args) =>
      toToolText(
        await post("/api/v1/connections/test", {
          connector: args.connector,
          config: args.config,
        }),
      ),
  },
  {
    name: "ai_modelar",
    title: "IA: modelar datos",
    description:
      "Invoca al agente de IA para proponer un modelado de datos. Payload libre (perfil de datos). Devuelve {ok, message, agent, action?}. POST /api/v1/ai/modelar.",
    inputShape: aiFreeShape,
    handler: async (args) =>
      toToolText(await post("/api/v1/ai/modelar", args.payload ?? {})),
  },
  {
    name: "ai_analizar",
    title: "IA: analizar",
    description:
      "Invoca al agente de IA para responder una pregunta sobre los datos. Requiere 'pregunta'; 'contexto' opcional. Devuelve {ok, message, agent}. POST /api/v1/ai/analizar con {pregunta, contexto?}.",
    inputShape: aiAnalizarShape,
    handler: async (args) => {
      const body: Record<string, unknown> = { pregunta: String(args.pregunta) };
      if (args.contexto !== undefined) body.contexto = args.contexto;
      return toToolText(await post("/api/v1/ai/analizar", body));
    },
  },
  {
    name: "ai_disenar",
    title: "IA: disenar dashboard",
    description:
      "Invoca al agente de IA para proponer el diseno de un dashboard. Payload libre (modelo/campos). Devuelve {ok, message, agent, action?}. POST /api/v1/ai/disenar.",
    inputShape: aiFreeShape,
    handler: async (args) =>
      toToolText(await post("/api/v1/ai/disenar", args.payload ?? {})),
  },
];

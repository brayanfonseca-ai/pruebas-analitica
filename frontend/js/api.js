// api.js — envoltura fina sobre el backend FEAT-002 en /api/v1 (mismo origen,
// sin CORS). Solo transporte: no hay lógica de negocio aquí. El motor Python es
// la única fuente de verdad del modelo y de las agregaciones.
//
// Los errores del backend llegan como JSON {detail, code}; aquí los parseamos y
// lanzamos un Error con un mensaje legible (y adjuntamos .code).

const BASE = "/api/v1";

async function request(path, { method = "GET", body, isForm = false } = {}) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    if (isForm) {
      opts.body = body; // FormData: el navegador fija el Content-Type (boundary).
    } else {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
  }

  let res;
  try {
    res = await fetch(`${BASE}${path}`, opts);
  } catch (netErr) {
    throw new Error("No se pudo contactar con el servidor. ¿Está el backend en marcha?");
  }

  if (res.status === 204) return null;

  let data = null;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    data = await res.json().catch(() => null);
  }

  if (!res.ok) {
    const detail = (data && (data.detail || data.message)) || `Error ${res.status}`;
    const err = new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
    err.code = data && data.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

/* ----------------------- Apps ----------------------- */
export const listApps = () => request("/apps");
export const createApp = (name) => request("/apps", { method: "POST", body: { name } });
export const getApp = (appId) => request(`/apps/${encodeURIComponent(appId)}`);
export const deleteApp = (appId) => request(`/apps/${encodeURIComponent(appId)}`, { method: "DELETE" });

/* ----------------------- Tablas (datos) ----------------------- */
export function uploadTable(appId, file) {
  const fd = new FormData();
  fd.append("file", file, file.name);
  return request(`/apps/${encodeURIComponent(appId)}/tables`, { method: "POST", body: fd, isForm: true });
}
export const listTables = (appId) => request(`/apps/${encodeURIComponent(appId)}/tables`);
export const getTable = (appId, tableId) =>
  request(`/apps/${encodeURIComponent(appId)}/tables/${encodeURIComponent(tableId)}`);
export const deleteTable = (appId, tableId) =>
  request(`/apps/${encodeURIComponent(appId)}/tables/${encodeURIComponent(tableId)}`, { method: "DELETE" });

/* ----------------------- Preparación visual de campos (field overrides) ----------------------- */
// Capa por tabla para renombrar/forzar tipo/ocultar columnas sin escribir script.
// GET devuelve [{source_field, rename, forced_type, hidden}]; PUT recibe el mismo
// array (upsert) y devuelve la lista resultante.
export const getFieldOverrides = (appId, tableId) =>
  request(`/apps/${encodeURIComponent(appId)}/tables/${encodeURIComponent(tableId)}/field-overrides`);
export const putFieldOverrides = (appId, tableId, overrides) =>
  request(`/apps/${encodeURIComponent(appId)}/tables/${encodeURIComponent(tableId)}/field-overrides`, {
    method: "PUT", body: overrides,
  });

/* ----------------------- Asociaciones ----------------------- */
export const recommendAssociations = (appId) =>
  request(`/apps/${encodeURIComponent(appId)}/associations/recommend`);
export const listAssociations = (appId) =>
  request(`/apps/${encodeURIComponent(appId)}/associations`);
// Crea una asociación personalizada (is_custom=true).
export const createAssociation = (appId, assoc) =>
  request(`/apps/${encodeURIComponent(appId)}/associations`, { method: "POST", body: assoc });
// Acepta/persiste una asociación recomendada (is_custom=false).
export const acceptAssociation = (appId, assoc) =>
  request(`/apps/${encodeURIComponent(appId)}/associations`, { method: "PUT", body: assoc });
export const deleteAssociation = (appId, assocId) =>
  request(`/apps/${encodeURIComponent(appId)}/associations/${encodeURIComponent(assocId)}`, { method: "DELETE" });

/* ----------------------- Modelo ----------------------- */
export const getModel = (appId) => request(`/apps/${encodeURIComponent(appId)}/model`);

/* ----------------------- Script (Editor de carga) ----------------------- */
export const getScript = (appId) => request(`/apps/${encodeURIComponent(appId)}/script`);
export const putScript = (appId, text) =>
  request(`/apps/${encodeURIComponent(appId)}/script`, { method: "PUT", body: { text } });
export const runScript = (appId) =>
  request(`/apps/${encodeURIComponent(appId)}/script/run`, { method: "POST" });

/* ----------------------- Query (Analizar) ----------------------- */
export const getFields = (appId) => request(`/apps/${encodeURIComponent(appId)}/fields`);
export const query = (appId, spec) =>
  request(`/apps/${encodeURIComponent(appId)}/query`, { method: "POST", body: spec });

/* ----------------------- Valores de campo (panel de filtrado) ----------------------- */
// Devuelve {field, values:[{value, state}]} con state = selected|possible|alternative|excluded.
export const getFieldValues = (appId, field, selections = {}, limit = 1000) =>
  request(`/apps/${encodeURIComponent(appId)}/fields/values`, {
    method: "POST", body: { field, selections, limit },
  });

/* ----------------------- Expresiones (fx) ----------------------- */
// Valida una expresión en el motor y devuelve {table, field, agg?}.
export const parseExpression = (appId, kind, expression) =>
  request(`/apps/${encodeURIComponent(appId)}/expressions/parse`, {
    method: "POST", body: { kind, expression },
  });

/* ----------------------- Elementos maestros ----------------------- */
export const listMasterItems = (appId) =>
  request(`/apps/${encodeURIComponent(appId)}/master-items`);
export const createMasterItem = (appId, item) =>
  request(`/apps/${encodeURIComponent(appId)}/master-items`, { method: "POST", body: item });
export const updateMasterItem = (appId, itemId, item) =>
  request(`/apps/${encodeURIComponent(appId)}/master-items/${encodeURIComponent(itemId)}`, {
    method: "PUT", body: item,
  });
export const deleteMasterItem = (appId, itemId) =>
  request(`/apps/${encodeURIComponent(appId)}/master-items/${encodeURIComponent(itemId)}`, {
    method: "DELETE",
  });

/* ----------------------- Hojas ----------------------- */
export const listSheets = (appId) => request(`/apps/${encodeURIComponent(appId)}/sheets`);
export const createSheet = (appId, sheet) =>
  request(`/apps/${encodeURIComponent(appId)}/sheets`, { method: "POST", body: sheet });
export const updateSheet = (appId, sheetId, sheet) =>
  request(`/apps/${encodeURIComponent(appId)}/sheets/${encodeURIComponent(sheetId)}`, {
    method: "PUT", body: sheet,
  });
export const deleteSheet = (appId, sheetId) =>
  request(`/apps/${encodeURIComponent(appId)}/sheets/${encodeURIComponent(sheetId)}`, {
    method: "DELETE",
  });
export const setSheetVisibility = (appId, sheetId, visibility) =>
  request(`/apps/${encodeURIComponent(appId)}/sheets/${encodeURIComponent(sheetId)}/visibility`, {
    method: "PUT", body: { visibility },
  });

/* ----------------------- Colecciones ----------------------- */
export const listCollections = () => request("/collections");
export const createCollection = (collection) =>
  request("/collections", { method: "POST", body: collection });
export const deleteCollection = (id) =>
  request(`/collections/${encodeURIComponent(id)}`, { method: "DELETE" });

/* ----------------------- Asistente de IA (estrellita) ----------------------- */
// Transporte puro hacia /api/v1/ai/* (FEAT-001). El backend serializa el body y
// responde SIEMPRE 200 con {ok, message, agent}; nunca lanza 5xx. El frontend
// NUNCA ve credenciales AWS: todo pasa por el backend.
export const aiModelar = (appId, payload = {}) =>
  request("/ai/modelar", { method: "POST", body: { appId, ...payload } });
export const aiAnalizar = (appId, payload = {}) =>
  request("/ai/analizar", { method: "POST", body: { appId, ...payload } });
export const aiDisenar = (appId, payload = {}) =>
  request("/ai/disenar", { method: "POST", body: { appId, ...payload } });

/* ----------------------- Conexiones de datos ----------------------- */
export const listConnections = (appId) =>
  request(`/apps/${encodeURIComponent(appId)}/connections`);
export const createConnection = (appId, conn) =>
  request(`/apps/${encodeURIComponent(appId)}/connections`, { method: "POST", body: conn });
export const testConnection = (appId, conn) =>
  request(`/apps/${encodeURIComponent(appId)}/connections/test`, { method: "POST", body: conn });
export const deleteConnection = (appId, connId) =>
  request(`/apps/${encodeURIComponent(appId)}/connections/${encodeURIComponent(connId)}`, { method: "DELETE" });
// Carga REAL desde una conexión existente: materializa una tabla del modelo
// (mismo camino que subir un archivo). params opcional {tableName,table,query,key,object,limit}.
// Responde {ok, message, table:{id,name,rows,fields}} o {ok:false, message:<error real>}.
export const loadConnection = (appId, connId, params = {}) =>
  request(`/apps/${encodeURIComponent(appId)}/connections/${encodeURIComponent(connId)}/load`, { method: "POST", body: params });

/* ---- Conexiones realizadas (todas las apps): stack con permisos ---- */
// [{id, name, connector, space, app_id, app_name, config(enmascarada), created_at}]
export const listAllConnections = () => request("/connections");
// Explora objetos: { ok, level, items:[{name, type, schema?, columns?}] }. params {database?, prefix?}
export const browseConnection = (connId, params = {}) =>
  request(`/connections/${encodeURIComponent(connId)}/browse`, { method: "POST", body: params });
// Vista previa SIN materializar: { ok, columns, rows, total, script, message }
export const previewConnection = (connId, params = {}) =>
  request(`/connections/${encodeURIComponent(connId)}/preview`, { method: "POST", body: params });

/* ----------------------- Modelo lógico (Business Logic) ----------------------- */
const LM = (appId) => `/apps/${encodeURIComponent(appId)}/logical-model`;
export const getLogicalModel = (appId) => request(LM(appId));
export const putLogicalModel = (appId, doc) => request(LM(appId), { method: "PUT", body: doc });
export const resetLogicalModel = (appId) => request(`${LM(appId)}/reset`, { method: "POST", body: {} });
export const enableLogicalModel = (appId) => request(`${LM(appId)}/enable`, { method: "POST", body: {} });
export const disableLogicalModel = (appId) => request(`${LM(appId)}/disable`, { method: "POST", body: {} });
export const addHierarchy = (appId, h) => request(`${LM(appId)}/hierarchies`, { method: "POST", body: h });
export const deleteHierarchy = (appId, id) => request(`${LM(appId)}/hierarchies/${encodeURIComponent(id)}`, { method: "DELETE" });
export const addLmGroup = (appId, g) => request(`${LM(appId)}/groups`, { method: "POST", body: g });
export const deleteLmGroup = (appId, id) => request(`${LM(appId)}/groups/${encodeURIComponent(id)}`, { method: "DELETE" });
export const addCalendarPeriod = (appId, p) => request(`${LM(appId)}/calendar-periods`, { method: "POST", body: p });
export const deleteCalendarPeriod = (appId, id) => request(`${LM(appId)}/calendar-periods/${encodeURIComponent(id)}`, { method: "DELETE" });

/* ----------------------- Laboratorio de ML ----------------------- */
// Tablas con sus campos agrupados por rol (numéricos / categóricos / fechas).
export const getMlDatasets = (appId) => request(`/apps/${encodeURIComponent(appId)}/ml/datasets`);
// Ejecuta un algoritmo: { table, algorithm, params } -> resultado con métricas y datos de gráficos.
export const runMl = (appId, payload) =>
  request(`/apps/${encodeURIComponent(appId)}/ml/run`, { method: "POST", body: payload });

/* ----------------------- Experimentos de ML (proceso independiente) ----------------------- */
export const listExperiments = () => request("/ml/experiments");
export const createExperiment = (body) => request("/ml/experiments", { method: "POST", body });
export const getExperiment = (id) => request(`/ml/experiments/${encodeURIComponent(id)}`);
export const updateExperiment = (id, body) => request(`/ml/experiments/${encodeURIComponent(id)}`, { method: "PUT", body });
export const deleteExperiment = (id) => request(`/ml/experiments/${encodeURIComponent(id)}`, { method: "DELETE" });
// { algorithm, params, label?, save? } -> resultado (+ runId si se guardó)
export const trainExperiment = (id, body) => request(`/ml/experiments/${encodeURIComponent(id)}/runs`, { method: "POST", body });
export const getExperimentRun = (id, runId) => request(`/ml/experiments/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}`);
export const deleteExperimentRun = (id, runId) => request(`/ml/experiments/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}`, { method: "DELETE" });
// "Asociar a": { appId?, sheetTitle? } -> { ok, appId, table:{id,name,rows,fields}, key, sheet:{id,title,objects}, message }
export const associateExperimentRun = (id, runId, body = {}) =>
  request(`/ml/experiments/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}/associate`, { method: "POST", body });

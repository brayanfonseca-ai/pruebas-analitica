// connections.js — creación y gestión de CONEXIONES DE DATOS estilo Qlik.
//
// Flujo (como en Qlik): "Crear conexión" → lista de conectores agrupada y
// buscable → formulario dinámico del conector elegido → "Probar conexión" →
// "Crear". Las conexiones creadas quedan listadas y se pueden eliminar.
//
// Los campos de Amazon Athena replican la documentación oficial de Qlik
// (AWS Region, Data source/catálogo, Database, Workgroup, credenciales IAM,
// ubicación de salida S3, etc.). Otros conectores (S3, Redshift, Postgres,
// MySQL, SQL Server, ODBC, REST) tienen sus campos típicos.

import * as api from "./api.js";
import { svg } from "./hub-nav.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------------------------------------------------------------------------
   Catálogo de conectores (agrupado como en Qlik) + definición de sus campos.
   type: text | password | number | select | checkbox
   --------------------------------------------------------------------------- */
const F = (name, label, opts = {}) => ({ name, label, type: opts.type || "text", required: !!opts.required,
  placeholder: opts.placeholder || "", options: opts.options || null, value: opts.value, help: opts.help });

const AWS_AUTH = [
  F("authType", "Autenticación", { type: "select", options: [["default","Credenciales por defecto"],["iam","Credenciales IAM"]], value: "default" }),
  F("accessKeyId", "Access Key ID", { placeholder: "AKIA…", help: "Requerido con credenciales IAM" }),
  F("secretKey", "Secret Key", { type: "password", help: "Requerido con credenciales IAM" }),
  F("sessionToken", "Session Token", { type: "password" }),
];
const OAUTH = [ F("authType", "Autenticación", { type: "select", options: [["oauth","OAuth 2.0"],["token","Token de acceso"]], value: "oauth" }),
  F("accessToken", "Token de acceso", { type: "password" }) ];

export const CONNECTORS = {
  "Almacenamiento en la nube": [
    { id: "s3", name: "Amazon S3", icon: "s3", fields: [
      F("bucket", "Bucket", { required: true, placeholder: "mi-bucket" }),
      F("awsRegion", "Región AWS", { required: true, type: "select", options: AWS_REGIONS() }),
      F("prefix", "Prefijo / carpeta", { placeholder: "datos/ventas/" }), ...AWS_AUTH,
    ]},
    { id: "onedrive", name: "Microsoft OneDrive", icon: "cloud", fields: [
      F("driveId", "Drive / Usuario", { placeholder: "me/drive o drive-id" }),
      F("folder", "Carpeta", { placeholder: "/Documentos/Datos" }), ...OAUTH,
    ]},
    { id: "sharepoint", name: "Microsoft SharePoint", icon: "cloud", fields: [
      F("siteUrl", "URL del sitio", { required: true, placeholder: "https://org.sharepoint.com/sites/datos" }),
      F("library", "Biblioteca de documentos", { placeholder: "Documentos compartidos" }), ...OAUTH,
    ]},
    { id: "gdrive", name: "Google Drive", icon: "cloud", fields: [
      F("folderId", "ID de carpeta", { placeholder: "1AbC…" }), ...OAUTH,
    ]},
    { id: "gcs", name: "Google Cloud Storage", icon: "cloud", fields: [
      F("bucket", "Bucket", { required: true }), F("serviceAccount", "Service Account (JSON)", { type: "password" }),
    ]},
    { id: "azureblob", name: "Azure Blob Storage", icon: "azure", fields: [
      F("account", "Cuenta de almacenamiento", { required: true }),
      F("container", "Contenedor", { required: true }), F("sasToken", "SAS Token", { type: "password" }),
    ]},
    { id: "dropbox", name: "Dropbox", icon: "cloud", fields: [ F("folder", "Carpeta"), ...OAUTH ]},
  ],
  "Bases de datos": [
    { id: "athena", name: "Amazon Athena", icon: "athena", fields: [
      F("awsRegion", "Región AWS", { required: true, type: "select", options: AWS_REGIONS() }),
      F("dataSource", "Data source (catálogo)", { required: true, placeholder: "AwsDataCatalog", value: "AwsDataCatalog" }),
      F("database", "Base de datos (schema)", { required: true, placeholder: "default" }),
      F("workgroup", "Workgroup", { required: true, placeholder: "primary", value: "primary" }),
      ...AWS_AUTH,
      F("s3Output", "Ubicación de salida S3", { placeholder: "s3://mi-bucket/athena-results/", help: "Necesaria si el workgroup no define salida" }),
      F("encryption", "Cifrado de salida", { type: "select", options: [["NOT_SET","Sin cifrado"],["SSE_S3","SSE-S3"],["SSE_KMS","SSE-KMS"],["CSE_KMS","CSE-KMS"]], value: "NOT_SET" }),
      F("queryTimeout", "Tiempo de espera (s)", { type: "number", value: 150 }),
    ]},
    { id: "redshift", name: "Amazon Redshift", icon: "redshift", fields: DB_FIELDS(5439) },
    { id: "rds", name: "Amazon RDS", icon: "db", fields: DB_FIELDS(5432) },
    { id: "dynamodb", name: "Amazon DynamoDB", icon: "db", fields: [
      F("awsRegion", "Región AWS", { required: true, type: "select", options: AWS_REGIONS() }),
      F("table", "Tabla"), ...AWS_AUTH ]},
    { id: "postgres", name: "PostgreSQL", icon: "db", fields: DB_FIELDS(5432) },
    { id: "mysql", name: "MySQL", icon: "db", fields: DB_FIELDS(3306) },
    { id: "sqlserver", name: "Microsoft SQL Server", icon: "db", fields: DB_FIELDS(1433) },
    { id: "mariadb", name: "MariaDB", icon: "db", fields: DB_FIELDS(3306) },
    { id: "oracle", name: "Oracle", icon: "db", fields: DB_FIELDS(1521) },
    { id: "snowflake", name: "Snowflake", icon: "db", fields: [
      F("account", "Cuenta", { required: true, placeholder: "org-account" }),
      F("warehouse", "Warehouse", { required: true }), F("database", "Base de datos", { required: true }),
      F("schema", "Schema", { value: "PUBLIC" }), F("username", "Usuario"), F("password", "Contraseña", { type: "password" }) ]},
    { id: "bigquery", name: "Google BigQuery", icon: "db", fields: [
      F("project", "Proyecto GCP", { required: true }), F("dataset", "Dataset", { required: true }),
      F("serviceAccount", "Service Account (JSON)", { type: "password" }) ]},
    { id: "databricks", name: "Databricks", icon: "db", fields: [
      F("host", "Host", { required: true, placeholder: "adb-….azuredatabricks.net" }),
      F("httpPath", "HTTP Path", { required: true }), F("token", "Token", { type: "password", required: true }) ]},
    { id: "mongodb", name: "MongoDB", icon: "db", fields: [
      F("uri", "URI de conexión", { required: true, placeholder: "mongodb+srv://…" }), F("database", "Base de datos", { required: true }) ]},
    { id: "odbc", name: "ODBC (Direct Access)", icon: "odbc", fields: [
      F("dsn", "DSN", { required: true, placeholder: "MiOrigenODBC" }),
      F("username", "Usuario"), F("password", "Contraseña", { type: "password" }) ]},
  ],
  "APIs y web": [
    { id: "rest", name: "REST", icon: "rest", fields: [
      F("url", "URL", { required: true, placeholder: "https://api.ejemplo.com/datos" }),
      F("method", "Método", { type: "select", options: [["GET","GET"],["POST","POST"]], value: "GET" }),
      F("authHeader", "Cabecera de autorización", { placeholder: "Bearer …", type: "password" }) ]},
    { id: "graphql", name: "GraphQL", icon: "rest", fields: [
      F("url", "Endpoint", { required: true }), F("authHeader", "Autorización", { type: "password" }) ]},
    { id: "odata", name: "OData", icon: "rest", fields: [ F("url", "Service root URL", { required: true }) ]},
    { id: "webfile", name: "Archivo web (URL)", icon: "rest", fields: [
      F("url", "URL del archivo", { required: true, placeholder: "https://…/datos.csv" }) ]},
  ],
  "IA y analítica (AWS)": [
    { id: "bedrock", name: "Amazon Bedrock", icon: "ai", fields: [
      F("awsRegion", "Región AWS", { required: true, type: "select", options: AWS_REGIONS() }),
      F("model", "Modelo", { required: true, placeholder: "anthropic.claude-3-5-sonnet", help: "ID de modelo de Bedrock" }),
      F("mode", "API", { type: "select", options: [["converse","Converse API"],["invoke","InvokeModel"]], value: "converse" }),
      ...AWS_AUTH ]},
    { id: "sagemaker", name: "Amazon SageMaker", icon: "ai", fields: [
      F("endpoint", "Endpoint", { required: true }),
      F("awsRegion", "Región AWS", { required: true, type: "select", options: AWS_REGIONS() }), ...AWS_AUTH ]},
    { id: "comprehend", name: "Amazon Comprehend", icon: "ai", fields: [
      F("awsRegion", "Región AWS", { required: true, type: "select", options: AWS_REGIONS() }), ...AWS_AUTH ]},
    { id: "openai", name: "OpenAI", icon: "ai", fields: [
      F("apiKey", "API Key", { type: "password", required: true }), F("model", "Modelo", { value: "gpt-4o" }) ]},
    { id: "azureopenai", name: "Azure OpenAI", icon: "ai", fields: [
      F("endpoint", "Endpoint", { required: true }), F("apiKey", "API Key", { type: "password", required: true }),
      F("deployment", "Deployment") ]},
  ],
  "Agentes y herramientas (MCP)": [
    { id: "mcp-stdio", name: "Servidor MCP (stdio)", icon: "mcp", fields: [
      F("command", "Comando", { required: true, placeholder: "npx" }),
      F("args", "Argumentos", { placeholder: "-y @modelcontextprotocol/server-filesystem /ruta" }),
      F("env", "Variables de entorno", { placeholder: "KEY=valor; KEY2=valor2" }),
      F("help", "", { help: "MCP = Model Context Protocol. Expone herramientas/recursos de datos a agentes de IA." }) ]},
    { id: "mcp-http", name: "Servidor MCP (HTTP/SSE)", icon: "mcp", fields: [
      F("url", "URL del servidor", { required: true, placeholder: "https://mi-mcp.ejemplo.com/sse" }),
      F("authHeader", "Autorización", { type: "password", placeholder: "Bearer …" }) ]},
  ],
};

function DB_FIELDS(defaultPort) {
  return [
    F("host", "Host", { required: true, placeholder: "db.ejemplo.com" }),
    F("port", "Puerto", { required: true, type: "number", value: defaultPort }),
    F("database", "Base de datos", { required: true }),
    F("username", "Usuario"),
    F("password", "Contraseña", { type: "password" }),
    F("ssl", "Usar SSL", { type: "checkbox", value: true }),
  ];
}
function AWS_REGIONS() {
  return ["us-east-1","us-east-2","us-west-1","us-west-2","eu-west-1","eu-central-1","sa-east-1","ap-south-1"]
    .map((r) => [r, r]);
}

export function allConnectors() {
  const out = [];
  Object.entries(CONNECTORS).forEach(([group, items]) => items.forEach((c) => out.push({ ...c, group })));
  return out;
}
export const connectorById = (id) => allConnectors().find((c) => c.id === id) || null;

/* ---------------------------------------------------------------------------
   Proveedores: así se organiza el catálogo en la pantalla Conexiones y en el asistente.
   «ready» = conectores con ejecutor REAL en el servidor (probar, explorar y cargar datos).
   El resto guarda la configuración, pero al probar/cargar responde con un aviso honesto
   («Vista previa»): no finge conectarse.
   --------------------------------------------------------------------------- */
export const READY = new Set(["s3", "athena", "postgres", "mysql", "mariadb", "sqlserver", "oracle", "redshift", "webfile", "rest"]);
export const isReady = (id) => READY.has(id);

export const PROVIDERS = [
  { id: "aws", label: "Amazon Web Services", hint: "Almacenamiento, bases de datos e IA de AWS", color: "#ff9900",
    items: ["s3", "athena", "redshift", "rds", "dynamodb", "bedrock", "sagemaker", "comprehend"] },
  { id: "microsoft", label: "Microsoft", hint: "SQL Server, OneDrive, SharePoint, Azure", color: "#0078d4",
    items: ["sqlserver", "onedrive", "sharepoint", "azureblob", "azureopenai"] },
  { id: "google", label: "Google", hint: "Drive, Cloud Storage y BigQuery", color: "#4285f4",
    items: ["gdrive", "gcs", "bigquery"] },
  { id: "db", label: "Bases de datos", hint: "PostgreSQL, MySQL, Oracle y más", color: "#2f6fed",
    items: ["postgres", "mysql", "mariadb", "oracle", "snowflake", "databricks", "mongodb", "odbc"] },
  { id: "web", label: "APIs y archivos web", hint: "REST, GraphQL, OData, URL y Dropbox", color: "#7a3ff2",
    items: ["rest", "graphql", "odata", "webfile", "dropbox"] },
  { id: "ai", label: "IA y agentes (MCP)", hint: "OpenAI y servidores MCP para agentes", color: "#d4651b",
    items: ["openai", "mcp-stdio", "mcp-http"] },
];

/** Glifo (nombre de icono de hub-nav) por conector. */
const GLYPH = {
  s3: "bucket", gcs: "bucket", azureblob: "bucket", athena: "analyze", redshift: "database", rds: "database", dynamodb: "database",
  bedrock: "predict", sagemaker: "predict", comprehend: "predict", openai: "predict", azureopenai: "predict",
  sqlserver: "database", postgres: "database", mysql: "database", mariadb: "database", oracle: "database",
  snowflake: "database", databricks: "database", mongodb: "database", odbc: "database", bigquery: "database",
  onedrive: "cloud", sharepoint: "cloud", gdrive: "cloud", dropbox: "cloud",
  rest: "api", graphql: "api", odata: "api", webfile: "link", "mcp-stdio": "plug", "mcp-http": "plug",
};
export const providerOf = (connectorId) => PROVIDERS.find((p) => p.items.includes(connectorId)) || null;

/** Icono cuadrado de color con el glifo del conector (se tiñe con el color del proveedor). */
export function connectorTile(connectorId, size = "") {
  const p = providerOf(connectorId);
  const color = p ? p.color : "#64748b";
  return `<span class="cn-tile ${size}" style="--cn-c:${color}">${svg(GLYPH[connectorId] || "plug")}</span>`;
}

/* ---------------------------------------------------------------------------
   Diálogo. `host` debe exponer openModal(title, bodyHTML, footHTML) -> modalEl,
   closeModal(), y toast(msg, kind). Devuelve el elemento del modal.

   · appId = null  → conexión del USUARIO (API /connections): es la forma normal.
   · appId = "..." → atajo del editor de carga (API /apps/{id}/connections): la conexión se crea
     igualmente a nombre del usuario; la app solo decide dónde se muestra.
   · opts.connection → modo EDICIÓN (PUT /connections/{id}); los secretos enmascarados se conservan.
   · opts.connector  → salta la lista y abre directamente el formulario de ese conector.
   --------------------------------------------------------------------------- */
export function openConnectionWizard(appId, host, onCreated, opts = {}) {
  const editing = opts.connection || null;
  let current = editing ? connectorById(editing.connector) : (opts.connector ? connectorById(opts.connector) : null);
  let space = (editing && editing.space) || host.space || "DEV_MODELOS_IA";

  const testFn = (body) => (appId ? api.testConnection(appId, body) : api.testConnectionGlobal(body));
  const createFn = (body) => (appId ? api.createConnection(appId, body) : api.createConnectionGlobal(body));

  function renderPick(filter = "") {
    const q = filter.trim().toLowerCase();
    const sections = PROVIDERS.map((p) => {
      const vis = p.items.map(connectorById).filter((c) => c && (!q || c.name.toLowerCase().includes(q) || p.label.toLowerCase().includes(q)));
      if (!vis.length) return "";
      return `<section class="cn-prov" style="--cn-c:${p.color}">
        <header class="cn-prov-h"><span class="cn-prov-dot"></span><strong>${esc(p.label)}</strong><small>${esc(p.hint)}</small></header>
        <div class="cn-tiles">${vis.map((c) => `
          <button type="button" class="cn-pick" data-conn="${c.id}">
            ${connectorTile(c.id)}
            <span class="cn-pick-t"><b>${esc(c.name)}</b>
              <i class="cn-badge ${isReady(c.id) ? "ready" : "soon"}">${isReady(c.id) ? "Disponible" : "Vista previa"}</i></span>
          </button>`).join("")}</div>
      </section>`;
    }).join("");
    const body = `
      <label class="ed-field"><span>Espacio</span><input id="cnSpace" value="${esc(space)}" /></label>
      <input class="ed-ad-search" id="cnSearch" placeholder="Buscar fuentes de datos" value="${esc(filter)}" />
      <div class="cn-provs">${sections || `<p class="ed-muted">Sin resultados.</p>`}</div>`;
    const m = host.openModal("Crear conexión de datos", body, `<button class="ho-btn" data-close>Cancelar</button>`);
    const search = m.querySelector("#cnSearch");
    search.addEventListener("input", () => { space = m.querySelector("#cnSpace").value; renderPick(search.value); setTimeout(() => m.querySelector("#cnSearch")?.focus(), 0); });
    m.querySelectorAll("[data-conn]").forEach((b) => b.addEventListener("click", () => {
      space = m.querySelector("#cnSpace").value;
      current = connectorById(b.dataset.conn);
      renderForm();
    }));
  }

  function fieldHtml(f, saved) {
    const id = "cn_" + f.name;
    const req = f.required ? '<span class="cn-req">*</span>' : "";
    const has = saved && saved[f.name] !== undefined && saved[f.name] !== null;
    const val = has ? saved[f.name] : f.value;
    if (f.type === "select") {
      return `<label class="ed-field"><span>${esc(f.label)}${req}</span>
        <select id="${id}" data-field="${f.name}">${f.options.map(([v, l]) => `<option value="${esc(v)}" ${String(val) === String(v) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
        ${f.help ? `<small class="cn-help">${esc(f.help)}</small>` : ""}</label>`;
    }
    if (f.type === "checkbox") {
      return `<label class="cn-check"><input type="checkbox" id="${id}" data-field="${f.name}" ${val === true || val === "true" ? "checked" : ""}/> ${esc(f.label)}</label>`;
    }
    return `<label class="ed-field"><span>${esc(f.label)}${req}</span>
      <input id="${id}" data-field="${f.name}" type="${f.type}" placeholder="${esc(f.placeholder)}" value="${val !== undefined && val !== null ? esc(val) : ""}" />
      ${f.help ? `<small class="cn-help">${esc(f.help)}</small>` : ""}</label>`;
  }

  function collect(m) {
    const config = {};
    m.querySelectorAll("[data-field]").forEach((el) => {
      config[el.dataset.field] = el.type === "checkbox" ? el.checked : el.value;
    });
    return config;
  }

  function renderForm() {
    const saved = editing ? editing.config || {} : null;
    const notReady = !isReady(current.id);
    const body = `
      ${editing ? "" : `<button class="cn-back" id="cnBack">‹ Elegir otro conector</button>`}
      <div class="cn-form-head">${connectorTile(current.id, "lg")}<div><strong>${esc(current.name)}</strong>
        <small>${esc(providerOf(current.id)?.label || "")}</small></div>
        <i class="cn-badge ${notReady ? "soon" : "ready"}">${notReady ? "Vista previa" : "Disponible"}</i></div>
      ${notReady ? `<p class="cn-note">Este conector guarda su configuración, pero todavía no se conecta de verdad: al probar o cargar datos verás un aviso en lugar de un resultado falso.</p>` : ""}
      <label class="ed-field"><span>Nombre de la conexión <span class="cn-req">*</span></span>
        <input id="cnName" value="${esc(editing ? editing.name : `${current.name} - ${space}`)}" /></label>
      <div class="cn-fields">${current.fields.map((f) => fieldHtml(f, saved)).join("")}</div>
      ${editing ? `<p class="cn-help">Los secretos guardados se muestran enmascarados: déjalos como están para conservarlos.</p>` : ""}
      <p class="cn-status" id="cnStatus"></p>`;
    const foot = `<button class="ho-btn" data-close>Cancelar</button>
      <button class="ho-btn" id="cnTest">Probar conexión</button>
      <button class="ho-btn primary" id="cnCreate">${editing ? "Guardar cambios" : "Crear"}</button>`;
    const m = host.openModal((editing ? "Editar conexión · " : "Crear conexión · ") + current.name, body, foot);
    const back = m.querySelector("#cnBack");
    if (back) back.addEventListener("click", () => renderPick());

    const statusEl = m.querySelector("#cnStatus");
    const setStatus = (msg, ok) => { statusEl.textContent = msg; statusEl.className = "cn-status " + (ok ? "ok" : "err"); };

    m.querySelector("#cnTest").addEventListener("click", async () => {
      setStatus("Probando…", true);
      try {
        // r.message refleja el resultado REAL de /test (ok real o error real de AWS/JDBC).
        const r = await testFn({ connector: current.id, config: collect(m) });
        let msg = r.message || (r.ok ? "Conexión correcta." : "No se pudo conectar.");
        if (r.details && typeof r.details === "object") {
          const extra = Object.entries(r.details)
            .filter(([, v]) => v !== null && v !== undefined && v !== "")
            .map(([k, v]) => `${k}: ${v}`).join(" · ");
          if (extra) msg += "  (" + extra + ")";
        }
        setStatus(msg, r.ok);
      } catch (e) { setStatus("Error: " + e.message, false); }
    });

    m.querySelector("#cnCreate").addEventListener("click", async () => {
      const name = m.querySelector("#cnName").value.trim();
      if (!name) { setStatus("El nombre es obligatorio.", false); return; }
      try {
        let saved2;
        if (editing) {
          saved2 = await api.updateConnection(editing.id, { name, space, config: collect(m) });
          host.toast(`Conexión "${saved2.name}" actualizada.`);
        } else {
          saved2 = await createFn({ name, connector: current.id, space, config: collect(m) });
          host.toast(`Conexión "${saved2.name}" creada.`);
        }
        host.closeModal();
        onCreated && onCreated(saved2);
      } catch (e) { setStatus("Error: " + e.message, false); }
    });
  }

  if (current) renderForm(); else renderPick();
}

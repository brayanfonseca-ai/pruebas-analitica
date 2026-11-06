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

function allConnectors() {
  const out = [];
  Object.entries(CONNECTORS).forEach(([group, items]) => items.forEach((c) => out.push({ ...c, group })));
  return out;
}

/* ---------------------------------------------------------------------------
   Diálogo. `host` debe exponer openModal(title, bodyHTML, footHTML) -> modalEl,
   closeModal(), y toast(msg, kind). Devuelve el elemento del modal.
   --------------------------------------------------------------------------- */
export function openConnectionWizard(appId, host, onCreated) {
  let step = "pick";          // pick | form
  let current = null;         // conector elegido
  let space = host.space || "DEV_MODELOS_IA";

  function renderPick(filter = "") {
    const q = filter.trim().toLowerCase();
    const groups = Object.entries(CONNECTORS).map(([group, items]) => {
      const vis = items.filter((c) => !q || c.name.toLowerCase().includes(q));
      if (!vis.length) return "";
      return `<div class="cn-col"><div class="cn-col-title">${esc(group)}</div>
        ${vis.map((c) => `<button class="cn-opt" data-conn="${c.id}"><span class="cn-ic cn-ic-${c.icon}"></span>${esc(c.name)}</button>`).join("")}</div>`;
    }).join("");
    const body = `
      <label class="ed-field"><span>Espacio</span><input id="cnSpace" value="${esc(space)}" /></label>
      <div class="ed-ad-sub">Conectores de datos</div>
      <input class="ed-ad-search" id="cnSearch" placeholder="Buscar fuentes de datos" value="${esc(filter)}" />
      <div class="cn-grid">${groups || `<p class="ed-muted">Sin resultados.</p>`}</div>`;
    const m = host.openModal("Crear conexión de datos", body, `<button class="ho-btn" data-close>Cancelar</button>`);
    const search = m.querySelector("#cnSearch");
    search.addEventListener("input", () => { space = m.querySelector("#cnSpace").value; renderPick(search.value); setTimeout(()=>m.querySelector("#cnSearch")?.focus(),0); });
    m.querySelectorAll("[data-conn]").forEach((b) => b.addEventListener("click", () => {
      space = m.querySelector("#cnSpace").value;
      current = allConnectors().find((c) => c.id === b.dataset.conn);
      step = "form"; renderForm();
    }));
  }

  function fieldHtml(f) {
    const id = "cn_" + f.name;
    const req = f.required ? '<span class="cn-req">*</span>' : "";
    if (f.type === "select") {
      return `<label class="ed-field"><span>${esc(f.label)}${req}</span>
        <select id="${id}" data-field="${f.name}">${f.options.map(([v,l]) => `<option value="${esc(v)}" ${String(f.value)===String(v)?"selected":""}>${esc(l)}</option>`).join("")}</select>
        ${f.help?`<small class="cn-help">${esc(f.help)}</small>`:""}</label>`;
    }
    if (f.type === "checkbox") {
      return `<label class="cn-check"><input type="checkbox" id="${id}" data-field="${f.name}" ${f.value?"checked":""}/> ${esc(f.label)}</label>`;
    }
    return `<label class="ed-field"><span>${esc(f.label)}${req}</span>
      <input id="${id}" data-field="${f.name}" type="${f.type}" placeholder="${esc(f.placeholder)}" value="${f.value!==undefined?esc(f.value):""}" />
      ${f.help?`<small class="cn-help">${esc(f.help)}</small>`:""}</label>`;
  }

  function collect(m) {
    const config = {};
    m.querySelectorAll("[data-field]").forEach((el) => {
      config[el.dataset.field] = el.type === "checkbox" ? el.checked : el.value;
    });
    return config;
  }

  function renderForm() {
    const body = `
      <button class="cn-back" id="cnBack">‹ Elegir otro conector</button>
      <div class="cn-form-head"><span class="cn-ic cn-ic-${current.icon}"></span><strong>${esc(current.name)}</strong></div>
      <label class="ed-field"><span>Nombre de la conexión <span class="cn-req">*</span></span>
        <input id="cnName" value="${esc(current.name)} - ${esc(space)}" /></label>
      <div class="cn-fields">${current.fields.map(fieldHtml).join("")}</div>
      <p class="cn-status" id="cnStatus"></p>`;
    const foot = `<button class="ho-btn" data-close>Cancelar</button>
      <button class="ho-btn" id="cnTest">Probar conexión</button>
      <button class="ho-btn primary" id="cnCreate">Crear</button>`;
    const m = host.openModal("Crear conexión · " + current.name, body, foot);
    m.querySelector("#cnBack").addEventListener("click", () => { step = "pick"; renderPick(); });

    const statusEl = m.querySelector("#cnStatus");
    const setStatus = (msg, ok) => { statusEl.textContent = msg; statusEl.className = "cn-status " + (ok ? "ok" : "err"); };

    m.querySelector("#cnTest").addEventListener("click", async () => {
      setStatus("Probando…", true);
      try {
        // r.message refleja el resultado REAL de /test (ok real o error real de AWS/JDBC),
        // NO una validación de campos cuando hubo intento de conexión (FEAT-001).
        const r = await api.testConnection(appId, { connector: current.id, config: collect(m) });
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
        const created = await api.createConnection(appId, { name, connector: current.id, space, config: collect(m) });
        host.closeModal();
        host.toast(`Conexión "${created.name}" creada.`);
        onCreated && onCreated(created);
      } catch (e) { setStatus("Error: " + e.message, false); }
    });
  }

  renderPick();
}

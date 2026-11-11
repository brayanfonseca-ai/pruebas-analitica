/**
 * Wrapper HTTP sobre el fetch GLOBAL de Node (>= 18). No usa node-fetch.
 *
 * Centraliza las llamadas al backend DataSense contra getBaseUrl() + path,
 * con cabeceras JSON y manejo uniforme de errores HTTP.
 */

import { getBaseUrl } from "./config.js";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json",
};

/**
 * Construye la URL absoluta a partir del path relativo (ej: "/api/v1/apps").
 */
function buildUrl(path: string): string {
  const base = getBaseUrl();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

/**
 * Lee la respuesta: parsea JSON si hay cuerpo, tolera respuestas vacias (204).
 * Si !res.ok, lanza Error con el status y el cuerpo de texto.
 */
async function handleResponse(res: Response): Promise<unknown> {
  const text = await res.text();

  if (!res.ok) {
    throw new Error(
      `HTTP ${res.status} ${res.statusText} en ${res.url}: ${text || "(sin cuerpo)"}`,
    );
  }

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    // El backend devolvio algo que no es JSON; lo entregamos como texto.
    return text;
  }
}

/**
 * Ejecuta fetch y, si falla a nivel de red (sin respuesta HTTP), lanza un Error
 * con un mensaje que incluye la URL y la causa subyacente (ej. ECONNREFUSED),
 * para que el agente pueda diagnosticar un backend caido o inalcanzable en vez
 * de recibir solo "fetch failed".
 */
async function doFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    const cause = (err as { cause?: unknown })?.cause;
    const detail = cause ? ` (causa: ${String(cause)})` : "";
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`No se pudo conectar con el backend en ${url}: ${message}${detail}`);
  }
}

/* ------------------------------------------------------------------------
 * Autenticación. El backend exige sesión (Bearer) en toda /api/v1/**. El MCP inicia sesión con las
 * credenciales de DATASENSE_USER / DATASENSE_PASSWORD (por defecto la cuenta administradora de
 * demostración) y reutiliza el token; si caduca (401) vuelve a iniciar sesión una sola vez.
 * Con un usuario sin permisos, el servidor responde 403 con el motivo (el MCP lo respeta).
 * ---------------------------------------------------------------------- */
let cachedToken: string | null = null;

async function login(): Promise<string> {
  const email = process.env.DATASENSE_USER ?? "admin@datasense.io";
  const password = process.env.DATASENSE_PASSWORD ?? "admin123";
  const res = await doFetch(buildUrl("/api/v1/auth/login"), {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ email, password }),
  });
  const data = (await handleResponse(res)) as { token?: string };
  if (!data?.token) throw new Error("El backend no devolvió un token de sesión.");
  cachedToken = data.token;
  return data.token;
}

/** Ejecuta la petición con el token de sesión; reintenta una vez si la sesión venció. */
async function send(path: string, init: RequestInit): Promise<unknown> {
  const run = async (): Promise<Response> => {
    const token = cachedToken ?? (await login());
    return doFetch(buildUrl(path), { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` } });
  };
  let res = await run();
  if (res.status === 401) {
    cachedToken = null;
    res = await run();
  }
  return handleResponse(res);
}

export async function get(path: string): Promise<unknown> {
  return send(path, { method: "GET", headers: JSON_HEADERS });
}

export async function post(path: string, body?: unknown): Promise<unknown> {
  return send(path, {
    method: "POST",
    headers: JSON_HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function put(path: string, body?: unknown): Promise<unknown> {
  return send(path, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/**
 * POST multipart/form-data (subida de archivos). fetch fija el boundary.
 */
export async function postForm(path: string, form: FormData): Promise<unknown> {
  return send(path, { method: "POST", headers: { Accept: "application/json" }, body: form });
}

/**
 * DELETE tolera 204 No Content (sin cuerpo).
 */
export async function del(path: string): Promise<unknown> {
  return send(path, { method: "DELETE", headers: JSON_HEADERS });
}

/**
 * Helper que serializa cualquier contenido a texto JSON legible para usarlo
 * como payload de texto de una tool MCP.
 */
export function toToolText(data: unknown): string {
  if (data === null || data === undefined) {
    return "null";
  }
  if (typeof data === "string") {
    return data;
  }
  return JSON.stringify(data, null, 2);
}

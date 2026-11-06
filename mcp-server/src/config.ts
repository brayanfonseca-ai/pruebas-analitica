/**
 * Configuracion del servidor MCP de DataSense.
 *
 * La URL base del backend REST es configurable por la variable de entorno
 * DATASENSE_BASE_URL. Si no esta definida, se usa http://localhost:8080.
 */

const DEFAULT_BASE_URL = "http://localhost:8080";

/**
 * Devuelve la URL base del backend DataSense, normalizada sin barra final.
 */
export function getBaseUrl(): string {
  const raw = process.env.DATASENSE_BASE_URL?.trim();
  const base = raw && raw.length > 0 ? raw : DEFAULT_BASE_URL;
  return base.replace(/\/+$/, "");
}

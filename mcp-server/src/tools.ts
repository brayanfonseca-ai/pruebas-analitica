/**
 * Registro del catalogo de tools en el Server MCP.
 *
 * Por ahora registra solo las tools de CONTEXTO (lectura). FEAT-002 anadira las
 * tools de accion: para ello basta con registrarlas en el punto de extension
 * marcado mas abajo (ej. importar action-tools y recorrerlas igual que aqui).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { contextTools } from "./tools/context-tools.js";
import type { ContextTool } from "./tools/context-tools.js";
import { actionTools } from "./tools/action-tools.js";

/**
 * Registra una tool (contexto o accion) en el Server MCP envolviendo su handler
 * con el manejo uniforme de errores.
 */
function registerTool(server: McpServer, tool: ContextTool): void {
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputShape as never,
    },
    (async (args: Record<string, unknown>) => {
      try {
        const text = await tool.handler(args ?? {});
        return {
          content: [{ type: "text" as const, text }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    }) as never,
  );
}

/**
 * Registra todas las tools del MCP en el servidor.
 */
export function registerTools(server: McpServer): void {
  // --- Tools de contexto (lectura) ---
  for (const tool of contextTools) {
    registerTool(server, tool);
  }

  // --- Tools de accion (ejecucion) — FEAT-002 ---
  for (const tool of actionTools) {
    registerTool(server, tool);
  }
}

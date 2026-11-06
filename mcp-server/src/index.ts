/**
 * Entrypoint del servidor MCP de DataSense.
 *
 * Instancia el Server del SDK MCP, registra las tools y lo conecta por STDIO.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";

async function main(): Promise<void> {
  const server = new McpServer({
    name: "datasense-mcp-server",
    version: "0.1.0",
  });

  registerTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Cierre limpio ante senales de terminacion.
  const shutdown = async () => {
    try {
      await server.close();
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Error fatal al arrancar el servidor MCP de DataSense:", err);
  process.exit(1);
});

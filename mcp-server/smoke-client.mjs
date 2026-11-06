/**
 * Cliente MCP efimero para SMOKE STDIO.
 * Lanza dist/src/index.js por STDIO, lista las tools (tools/list) e invoca
 * list_apps contra el backend vivo en http://localhost:8080.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverEntry = resolve(__dirname, "dist/src/index.js");

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverEntry],
  env: { ...process.env, DATASENSE_BASE_URL: "http://localhost:8080" },
  stderr: "pipe",
});

transport.stderr?.on("data", (d) => {
  console.log("SERVER_STDERR: " + String(d).trimEnd());
});

const client = new Client({ name: "smoke-client", version: "0.0.1" });

try {
  await client.connect(transport);
  console.log("CONNECTED: initialize OK");

  const toolsResp = await client.listTools();
  const names = toolsResp.tools.map((t) => t.name).sort();
  console.log("TOOLS_COUNT=" + names.length);
  console.log("TOOLS=" + names.join(","));
  console.log("HAS_list_apps=" + names.includes("list_apps"));

  const health = await client.callTool({ name: "ai_health", arguments: {} });
  const healthText = (health.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
  console.log("AI_HEALTH_ISERROR=" + Boolean(health.isError));
  console.log("AI_HEALTH_RESULT=" + healthText);

  const result = await client.callTool({ name: "list_apps", arguments: {} });
  const text = (result.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
  console.log("LIST_APPS_ISERROR=" + Boolean(result.isError));
  console.log("LIST_APPS_RESULT_BEGIN");
  console.log(text);
  console.log("LIST_APPS_RESULT_END");

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  if (Array.isArray(parsed)) {
    console.log("APPS_COUNT=" + parsed.length);
    console.log("APP_IDS=" + parsed.map((a) => a.id).join(","));
    console.log("APP_NAMES=" + parsed.map((a) => a.name).join(" | "));
  }

  await client.close();
  console.log("SMOKE_OK");
  process.exit(0);
} catch (err) {
  console.error("SMOKE_FAIL: " + (err && err.stack ? err.stack : String(err)));
  try {
    await client.close();
  } catch {}
  process.exit(1);
}

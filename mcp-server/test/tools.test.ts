/**
 * Tests de las tools del MCP con fetch GLOBAL mockeado.
 *
 * Se verifica que:
 *  - Una tool de contexto (list_apps) llama al endpoint correcto (GET /apps).
 *  - Tools de accion (run_query, create_sheet) llaman al endpoint correcto con
 *    el body correcto.
 *  - La validacion zod rechaza inputs invalidos (agg fuera de rango, measures
 *    vacio en run_query).
 *
 * Los handlers usan el http-client, que usa globalThis.fetch: basta mockear
 * fetch. No se toca el backend.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { contextTools } from "../src/tools/context-tools.js";
import { actionTools } from "../src/tools/action-tools.js";
import type { ContextTool } from "../src/tools/context-tools.js";
import { runQueryShape, createSheetShape } from "../src/tools/schemas.js";

/** Estructura de una llamada capturada por el fetch mockeado. */
interface CapturedCall {
  url: string;
  method: string;
  body: string | undefined;
}

const realFetch = globalThis.fetch;

/** Instala un fetch mockeado que captura llamadas y devuelve un cuerpo JSON. */
function installFetch(bodyObj: unknown, status = 200): CapturedCall[] {
  const calls: CapturedCall[] = [];
  globalThis.fetch = (async (input: unknown, init?: Record<string, unknown>) => {
    calls.push({
      url: String(input),
      method: String(init?.method),
      body: init?.body as string | undefined,
    });
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: "",
      url: String(input),
      text: async () => JSON.stringify(bodyObj),
    } as Response;
  }) as typeof fetch;
  return calls;
}

function restoreFetch(): void {
  globalThis.fetch = realFetch;
}

/** Busca una tool por nombre en el catalogo combinado. */
function findTool(name: string): ContextTool {
  const all: ContextTool[] = [...contextTools, ...actionTools];
  const tool = all.find((t) => t.name === name);
  assert.ok(tool, `tool ${name} no encontrada`);
  return tool as ContextTool;
}

test("list_apps: GET /api/v1/apps sin cuerpo", async () => {
  const calls = installFetch([{ id: "73f59275", name: "Mi aplicacion" }]);
  try {
    const tool = findTool("list_apps");
    const text = await tool.handler({});
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://localhost:8080/api/v1/apps");
    assert.equal(calls[0].method, "GET");
    assert.match(text, /Mi aplicacion/);
  } finally {
    restoreFetch();
  }
});

test("run_query: POST /apps/{appId}/query con QuerySpec (dimension+measures)", async () => {
  const calls = installFetch({ labels: ["A"], series: [] });
  try {
    const tool = findTool("run_query");
    await tool.handler({
      appId: "app1",
      dimension: { table: "ventas", field: "region" },
      measures: [{ table: "ventas", field: "importe", agg: "sum" }],
      chart_type: "bar",
    });
    assert.equal(calls[0].url, "http://localhost:8080/api/v1/apps/app1/query");
    assert.equal(calls[0].method, "POST");
    const body = JSON.parse(calls[0].body as string);
    assert.deepEqual(body.dimension, { table: "ventas", field: "region" });
    assert.deepEqual(body.measures, [
      { table: "ventas", field: "importe", agg: "sum" },
    ]);
    assert.equal(body.chart_type, "bar");
  } finally {
    restoreFetch();
  }
});

test("run_query: sin dimension no incluye 'dimension' en el body", async () => {
  const calls = installFetch({ value: 42 });
  try {
    const tool = findTool("run_query");
    await tool.handler({
      appId: "app1",
      measures: [{ table: "ventas", field: "importe" }],
    });
    const body = JSON.parse(calls[0].body as string);
    assert.equal("dimension" in body, false);
    assert.ok(Array.isArray(body.measures));
  } finally {
    restoreFetch();
  }
});

test("create_sheet: POST /apps/{appId}/sheets con title/objects", async () => {
  const calls = installFetch({ id: "sheet1" }, 201);
  try {
    const tool = findTool("create_sheet");
    await tool.handler({
      appId: "app1",
      title: "Dashboard",
      objects: [
        { type: "kpi", title: "Total", measure: { field: "importe", agg: "sum" } },
      ],
    });
    assert.equal(calls[0].url, "http://localhost:8080/api/v1/apps/app1/sheets");
    assert.equal(calls[0].method, "POST");
    const body = JSON.parse(calls[0].body as string);
    assert.equal(body.title, "Dashboard");
    assert.equal(body.objects[0].type, "kpi");
  } finally {
    restoreFetch();
  }
});

test("validacion zod: agg fuera de sum|count|avg|min|max es rechazado", () => {
  const schema = z.object(runQueryShape);
  const result = schema.safeParse({
    appId: "app1",
    measures: [{ table: "ventas", field: "importe", agg: "median" }],
  });
  assert.equal(result.success, false);
});

test("validacion zod: measures vacio en run_query es rechazado", () => {
  const schema = z.object(runQueryShape);
  const result = schema.safeParse({ appId: "app1", measures: [] });
  assert.equal(result.success, false);
});

test("validacion zod: run_query valido es aceptado", () => {
  const schema = z.object(runQueryShape);
  const result = schema.safeParse({
    appId: "app1",
    measures: [{ table: "ventas", field: "importe", agg: "avg" }],
  });
  assert.equal(result.success, true);
});

test("validacion zod: create_sheet con objeto de tipo invalido es rechazado", () => {
  const schema = z.object(createSheetShape);
  const result = schema.safeParse({
    appId: "app1",
    objects: [{ type: "radar" }],
  });
  assert.equal(result.success, false);
});

/**
 * Tests del wrapper HTTP (http-client.ts) con fetch GLOBAL mockeado.
 *
 * Se verifica que get/post/put/del construyen la URL getBaseUrl()+path, el
 * metodo y las cabeceras correctas, que una respuesta !ok lanza Error con el
 * status, y que del() tolera un 204 sin cuerpo.
 *
 * No se toca el backend: se reemplaza globalThis.fetch por un stub.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { get, post, put, del } from "../src/http-client.js";
/** fetch original para restaurarlo tras cada test. */
const realFetch = globalThis.fetch;
/**
 * Instala un fetch mockeado que captura la llamada y devuelve la respuesta
 * indicada. Devuelve el array donde se acumulan las llamadas capturadas.
 */
function installFetch(response) {
    const calls = [];
    const status = response.status ?? 200;
    const ok = response.ok ?? (status >= 200 && status < 300);
    globalThis.fetch = (async (input, init) => {
        const headers = (init?.headers ?? {});
        calls.push({
            url: String(input),
            method: String(init?.method),
            headers,
            body: init?.body,
        });
        return {
            ok,
            status,
            statusText: response.statusText ?? "",
            url: String(input),
            text: async () => response.body ?? "",
        };
    });
    return calls;
}
/** Restaura el fetch original. */
function restoreFetch() {
    globalThis.fetch = realFetch;
}
test("get(): construye URL base+path, metodo GET y cabeceras JSON", async () => {
    const calls = installFetch({ body: JSON.stringify([{ id: "a1" }]) });
    try {
        const data = await get("/api/v1/apps");
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, "http://localhost:8080/api/v1/apps");
        assert.equal(calls[0].method, "GET");
        assert.equal(calls[0].headers["Content-Type"], "application/json");
        assert.equal(calls[0].headers["Accept"], "application/json");
        assert.equal(calls[0].body, undefined);
        assert.deepEqual(data, [{ id: "a1" }]);
    }
    finally {
        restoreFetch();
    }
});
test("get(): normaliza path sin barra inicial", async () => {
    const calls = installFetch({ body: "{}" });
    try {
        await get("api/v1/ai/health");
        assert.equal(calls[0].url, "http://localhost:8080/api/v1/ai/health");
    }
    finally {
        restoreFetch();
    }
});
test("post(): metodo POST y body serializado a JSON", async () => {
    const calls = installFetch({ status: 201, body: JSON.stringify({ id: "new" }) });
    try {
        const data = await post("/api/v1/apps", { name: "Demo" });
        assert.equal(calls[0].method, "POST");
        assert.equal(calls[0].url, "http://localhost:8080/api/v1/apps");
        assert.equal(calls[0].body, JSON.stringify({ name: "Demo" }));
        assert.deepEqual(data, { id: "new" });
    }
    finally {
        restoreFetch();
    }
});
test("post(): sin body no serializa cuerpo", async () => {
    const calls = installFetch({ body: JSON.stringify({ ok: true }) });
    try {
        await post("/api/v1/apps/x/script/run");
        assert.equal(calls[0].method, "POST");
        assert.equal(calls[0].body, undefined);
    }
    finally {
        restoreFetch();
    }
});
test("put(): metodo PUT y body serializado a JSON", async () => {
    const calls = installFetch({ body: JSON.stringify({ text: "T" }) });
    try {
        await put("/api/v1/apps/x/script", { text: "T" });
        assert.equal(calls[0].method, "PUT");
        assert.equal(calls[0].url, "http://localhost:8080/api/v1/apps/x/script");
        assert.equal(calls[0].body, JSON.stringify({ text: "T" }));
    }
    finally {
        restoreFetch();
    }
});
test("del(): metodo DELETE y 204 sin cuerpo devuelve null", async () => {
    const calls = installFetch({ status: 204, body: "" });
    try {
        const data = await del("/api/v1/apps/x");
        assert.equal(calls[0].method, "DELETE");
        assert.equal(calls[0].url, "http://localhost:8080/api/v1/apps/x");
        assert.equal(data, null);
    }
    finally {
        restoreFetch();
    }
});
test("respuesta !ok lanza Error con el status HTTP", async () => {
    installFetch({ ok: false, status: 404, statusText: "Not Found", body: "no existe" });
    try {
        await assert.rejects(() => get("/api/v1/apps/missing"), (err) => {
            assert.match(err.message, /HTTP 404/);
            return true;
        });
    }
    finally {
        restoreFetch();
    }
});
test("getBaseUrl respeta DATASENSE_BASE_URL y quita barra final", async () => {
    const prev = process.env.DATASENSE_BASE_URL;
    process.env.DATASENSE_BASE_URL = "http://example.com:9000/";
    const calls = installFetch({ body: "{}" });
    try {
        await get("/api/v1/apps");
        assert.equal(calls[0].url, "http://example.com:9000/api/v1/apps");
    }
    finally {
        restoreFetch();
        if (prev === undefined)
            delete process.env.DATASENSE_BASE_URL;
        else
            process.env.DATASENSE_BASE_URL = prev;
    }
});

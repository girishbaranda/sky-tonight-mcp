/**
 * HTTP transport tests. Spins up the server on an OS-assigned free port,
 * drives it with built-in fetch, then closes it.
 *
 * Uses :memory: SQLite so the log tools don't touch disk.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

process.env.SKY_TONIGHT_DB = ":memory:";

const { startHttpServer } = await import("./http.js");

let server: Server;
let baseUrl: string;

before(async () => {
  server = await startHttpServer({ host: "127.0.0.1", port: 0 });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const initFrame = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "http-test", version: "0" },
  },
};

async function postMcp(body: unknown): Promise<{ status: number; json: any; text: string }> {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Streamable HTTP can return SSE-framed JSON: parse the data: line.
    const dataLine = text.split("\n").find((l) => l.startsWith("data: "));
    if (dataLine) json = JSON.parse(dataLine.slice(6));
  }
  if (json === null) {
    throw new Error(`postMcp: could not parse response body as JSON or SSE.\nstatus=${res.status}\nbody:\n${text}`);
  }
  return { status: res.status, json, text };
}

test("initialize round-trip returns serverInfo and protocolVersion", async () => {
  const { status, json } = await postMcp(initFrame);
  assert.equal(status, 200);
  assert.equal(json.jsonrpc, "2.0");
  assert.equal(json.id, 1);
  assert.equal(json.result.serverInfo.name, "sky-tonight");
  assert.ok(json.result.protocolVersion, "expected a protocolVersion");
});

test("tools/call moon_phase returns non-empty content", async () => {
  // Stateless mode: the SDK's validateSession() skips the init check when
  // sessionIdGenerator is undefined, so every POST is an independent
  // JSON-RPC call. No prior initialize needed.
  const { status, json } = await postMcp({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "moon_phase", arguments: {} },
  });
  assert.equal(status, 200);
  assert.equal(json.id, 2);
  assert.ok(Array.isArray(json.result.content), "expected content array");
  assert.ok(json.result.content.length > 0, "expected non-empty content");
  assert.equal(json.result.content[0].type, "text");
  assert.ok(json.result.content[0].text.length > 0);
});

test("GET /mcp returns 405 with Allow: POST", async () => {
  const res = await fetch(`${baseUrl}/mcp`, { method: "GET" });
  assert.equal(res.status, 405);
  assert.equal(res.headers.get("allow"), "POST");
});

test("POST to wrong path returns 404", async () => {
  const res = await fetch(`${baseUrl}/nope`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(initFrame),
  });
  assert.equal(res.status, 404);
});

test("two concurrent moon_phase calls both succeed (per-request server isolation)", async () => {
  const call = (id: number) =>
    postMcp({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name: "moon_phase", arguments: {} },
    });
  const [a, b] = await Promise.all([call(10), call(11)]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(a.json.id, 10);
  assert.equal(b.json.id, 11);
  assert.ok(a.json.result.content[0].text.length > 0);
  assert.ok(b.json.result.content[0].text.length > 0);
});

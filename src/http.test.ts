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

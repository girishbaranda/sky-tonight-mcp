/**
 * HTTP transport tests, v0.6.
 *
 * Every case constructs an in-process AuthConfig (HS256, ephemeral secret) and
 * passes it to startHttpServer — process.env.DEV_JWT_SECRET stays untouched.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { SignJWT } from "jose";

process.env.SKY_TONIGHT_DB = ":memory:";

const { startHttpServer } = await import("./http.js");
type AuthConfig = import("./lib/auth.js").AuthConfig;

const SECRET = "test-secret-do-not-use";
const secretBytes = new TextEncoder().encode(SECRET);

const authConfig: AuthConfig = {
  mode: "hs256",
  secret: secretBytes,
};

let server: Server;
let baseUrl: string;

before(async () => {
  server = await startHttpServer({ host: "127.0.0.1", port: 0, authConfig });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function mintToken(sub: string, opts: { expiresIn?: string; secret?: Uint8Array } = {}): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? "1h")
    .sign(opts.secret ?? secretBytes);
}

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

interface PostResult { status: number; json: any; text: string; headers: Headers }

async function postMcp(body: unknown, headers: Record<string, string> = {}): Promise<PostResult> {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    const dataLine = text.split("\n").find((l) => l.startsWith("data: "));
    if (dataLine) json = JSON.parse(dataLine.slice(6));
  }
  return { status: res.status, json, text, headers: res.headers };
}

test("PRM: GET /.well-known/oauth-protected-resource returns the PRM doc, no auth", async () => {
  const res = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/json");
  const doc = await res.json();
  assert.ok(typeof doc.resource === "string" && doc.resource.includes("/mcp"));
  assert.ok(Array.isArray(doc.authorization_servers) && doc.authorization_servers.length === 1);
  assert.deepEqual(doc.bearer_methods_supported, ["header"]);
  assert.ok(Array.isArray(doc.scopes_supported));
});

test("missing Authorization header → 401 with WWW-Authenticate carrying resource_metadata", async () => {
  const { status, headers } = await postMcp(initFrame);
  assert.equal(status, 401);
  const www = headers.get("www-authenticate");
  assert.ok(www, "expected WWW-Authenticate header");
  assert.ok(www!.includes("Bearer"));
  assert.ok(www!.includes('resource_metadata="'));
  assert.ok(www!.includes("/.well-known/oauth-protected-resource"));
});

test("garbage Bearer → 401 with error=invalid_token", async () => {
  const { status, headers } = await postMcp(initFrame, { authorization: "Bearer not.a.jwt" });
  assert.equal(status, 401);
  assert.match(headers.get("www-authenticate")!, /error="invalid_token"/);
});

test("expired token → 401 with error_description=expired", async () => {
  const past = new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("alice")
    .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 60);
  const token = await past.sign(secretBytes);
  const { status, headers } = await postMcp(initFrame, { authorization: `Bearer ${token}` });
  assert.equal(status, 401);
  assert.match(headers.get("www-authenticate")!, /error_description="expired"/);
});

test("wrong-secret token → 401 with error_description=invalid signature", async () => {
  const wrongSecret = new TextEncoder().encode("a-different-secret");
  const token = await mintToken("alice", { secret: wrongSecret });
  const { status, headers } = await postMcp(initFrame, { authorization: `Bearer ${token}` });
  assert.equal(status, 401);
  assert.match(headers.get("www-authenticate")!, /error_description="invalid signature"/);
});

test("malformed Authorization header → 401 with error=invalid_request", async () => {
  const { status, headers } = await postMcp(initFrame, { authorization: "Basic abc==" });
  assert.equal(status, 401);
  assert.match(headers.get("www-authenticate")!, /error="invalid_request"/);
});

test("valid token + initialize → 200 with serverInfo", async () => {
  const token = await mintToken("alice");
  const { status, json } = await postMcp(initFrame, { authorization: `Bearer ${token}` });
  assert.equal(status, 200);
  assert.equal(json.result.serverInfo.name, "sky-tonight");
});

test("valid token + tools/call moon_phase → 200 with non-empty content", async () => {
  const token = await mintToken("alice");
  const { status, json } = await postMcp(
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "moon_phase", arguments: {} } },
    { authorization: `Bearer ${token}` },
  );
  assert.equal(status, 200);
  assert.ok(Array.isArray(json.result.content) && json.result.content.length > 0);
});

test("per-user log isolation: alice's row is invisible to bob", async () => {
  const aliceTok = await mintToken("user-alice-iso");
  const bobTok = await mintToken("user-bob-iso");

  // Alice logs.
  const log = await postMcp(
    {
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: {
        name: "log_observation",
        arguments: { target: "Vega-iso-test", latitude: 0, longitude: 0 },
      },
    },
    { authorization: `Bearer ${aliceTok}` },
  );
  assert.equal(log.status, 200);
  assert.equal(log.json.result.isError, undefined);

  // Bob recalls — sees nothing.
  const bobRecall = await postMcp(
    {
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: { name: "recall_log", arguments: { target: "Vega-iso-test" } },
    },
    { authorization: `Bearer ${bobTok}` },
  );
  assert.equal(bobRecall.status, 200);
  assert.match(bobRecall.json.result.content[0].text, /No observations match/);

  // Alice recalls — sees her row.
  const aliceRecall = await postMcp(
    {
      jsonrpc: "2.0",
      id: 12,
      method: "tools/call",
      params: { name: "recall_log", arguments: { target: "Vega-iso-test" } },
    },
    { authorization: `Bearer ${aliceTok}` },
  );
  assert.equal(aliceRecall.status, 200);
  assert.match(aliceRecall.json.result.content[0].text, /Vega-iso-test/);
});

test("CORS preflight: OPTIONS /mcp → 204 with Access-Control-* headers", async () => {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: "OPTIONS",
    headers: {
      origin: "https://example.com",
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type,authorization",
    },
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), "https://example.com");
  const allowed = res.headers.get("access-control-allow-headers")!;
  assert.match(allowed, /content-type/i);
  assert.match(allowed, /authorization/i);
});

test("POST /mcp response carries CORS headers when Origin sent", async () => {
  const token = await mintToken("alice");
  const res = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      origin: "https://app.example.com",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "moon_phase", arguments: {} } }),
  });
  assert.equal(res.headers.get("access-control-allow-origin"), "https://app.example.com");
});

test("GET /mcp returns 405 with Allow: POST (no auth needed)", async () => {
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
  const token = await mintToken("alice");
  const call = (id: number) =>
    postMcp(
      {
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name: "moon_phase", arguments: {} },
      },
      { authorization: `Bearer ${token}` },
    );
  const [a, b] = await Promise.all([call(20), call(21)]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(a.json.id, 20);
  assert.equal(b.json.id, 21);
});

#!/usr/bin/env node
/**
 * Sky Tonight — Streamable HTTP entry point (v0.6).
 *
 * Stateless mode: every POST is handled independently with a fresh McpServer
 * and a fresh transport. No Mcp-Session-Id, no SSE GET endpoint.
 *
 * v0.6 adds:
 *   - GET /.well-known/oauth-protected-resource → PRM document (no auth).
 *   - OPTIONS /mcp → CORS preflight (no auth).
 *   - POST /mcp gated on a valid Bearer token; 401 + WWW-Authenticate otherwise.
 *   - runWithUser(jwt.sub, ...) wraps the handler so log_observation /
 *     recall_log can read currentUserId().
 */
import http from "node:http";
import { fileURLToPath } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./lib/mcp-server.js";
import { runWithUser } from "./lib/user-context.js";
import { requiredScope, type McpRequest } from "./lib/scope-map.js";
import {
  loadAuthConfig,
  verifyBearer,
  AuthError,
  type AuthConfig,
  type AuthContext,
} from "./lib/auth.js";

const PRM_PATH = "/.well-known/oauth-protected-resource";

interface StartOptions {
  host: string;
  port: number;
  authConfig?: AuthConfig;
}

export function startHttpServer({ host, port, authConfig }: StartOptions): Promise<http.Server> {
  const cfg = authConfig ?? loadAuthConfig(process.env);

  const httpServer = http.createServer(async (req, res) => {
    try {
      // Tag every response with Vary: Origin (CORS hygiene).
      res.setHeader("Vary", "Origin");
      const origin = req.headers.origin;
      if (origin) res.setHeader("Access-Control-Allow-Origin", origin);

      // 1. PRM endpoint (unauthenticated).
      if (req.url === PRM_PATH && req.method === "GET") {
        const baseUrl = requestBaseUrl(req, host, port);
        const authServer =
          cfg.mode === "hs256"
            ? (process.env.DEV_PRM_ISSUER ?? "https://dev.local/oauth")
            : (cfg.issuer as string);
        const doc = {
          resource: `${baseUrl}/mcp`,
          authorization_servers: [authServer],
          bearer_methods_supported: ["header"],
          scopes_supported: ["sky-tonight:log:read", "sky-tonight:log:write"],
          resource_documentation: "https://github.com/girishbaranda/sky-tonight-mcp",
        };
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(doc));
        return;
      }

      // 2. CORS preflight on /mcp (unauthenticated).
      if (req.url === "/mcp" && req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
        res.setHeader(
          "Access-Control-Allow-Headers",
          "Content-Type, Authorization, MCP-Protocol-Version",
        );
        res.setHeader("Access-Control-Max-Age", "600");
        res.writeHead(204).end();
        return;
      }

      // 3. Routing — only /mcp via POST goes further.
      if (req.url !== "/mcp") {
        res.writeHead(404).end();
        return;
      }
      if (req.method !== "POST") {
        res.writeHead(405, { Allow: "POST" }).end();
        return;
      }

      // Apply CORS headers on the actual response.
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, MCP-Protocol-Version",
      );

      // 4. Bearer auth gate.
      const baseUrl = requestBaseUrl(req, host, port);
      const ctx = await authenticateRequest(req, cfg);
      if (ctx === "missing") {
        write401(res, baseUrl, { reason: "missing" });
        return;
      }
      if (ctx === "malformed") {
        write401(res, baseUrl, { reason: "malformed" });
        return;
      }
      if ("error" in ctx) {
        write401(res, baseUrl, { reason: "invalid_token", description: ctx.error });
        return;
      }

      // 5. Buffer the request body so we can inspect it for scope checks AND
      //    feed it to the SDK transport (which would otherwise re-read req).
      const bodyBuf = await readBody(req);
      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(bodyBuf.toString("utf8"));
      } catch {
        parsedBody = null;
      }

      // 6. Scope check.
      const scopeReq = extractMcpRequest(parsedBody);
      const required = scopeReq ? requiredScope(scopeReq) : null;
      if (required && !ctx.scopes.includes(required)) {
        write403InsufficientScope(res, baseUrl, required);
        return;
      }

      // 7. Authenticated + scoped: dispatch to the McpServer under runWithUser.
      const server = createMcpServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        server.close().catch((err) => console.error("[http] cleanup error:", err));
      });
      console.error(`[http] POST /mcp sub=${ctx.userId} scope-ok=${required ?? "n/a"}`);

      await runWithUser(
        ctx.userId,
        async () => {
          await server.connect(transport);
          // Pass parsedBody as the third arg so the SDK doesn't re-read req.
          await transport.handleRequest(req, res, parsedBody);
        },
        ctx.scopes,
      );
    } catch (err) {
      console.error("[http] handler error:", err);
      if (!res.headersSent) res.writeHead(500).end();
    }
  });
  return new Promise((resolve) => httpServer.listen(port, host, () => resolve(httpServer)));
}

type AuthOutcome =
  | "missing"     // no Authorization header
  | "malformed"   // header present but not "Bearer <token>"
  | { error: string }
  | AuthContext;

async function authenticateRequest(
  req: http.IncomingMessage,
  cfg: AuthConfig,
): Promise<AuthOutcome> {
  const header = req.headers.authorization;
  if (!header) return "missing";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return "malformed";
  try {
    const ctx = await verifyBearer(match[1]!, cfg);
    return ctx;
  } catch (err) {
    if (err instanceof AuthError) {
      console.error(`[http] POST /mcp 401 (${err.description})`);
      return { error: err.description };
    }
    console.error(`[http] POST /mcp 401 (unexpected: ${(err as Error).message})`);
    return { error: "invalid token" };
  }
}

function write401(
  res: http.ServerResponse,
  baseUrl: string,
  opts: { reason: "missing" | "malformed" | "invalid_token"; description?: string },
): void {
  const prm = `${baseUrl}${PRM_PATH}`;
  const parts: string[] = [`Bearer realm="sky-tonight"`];
  if (opts.reason === "malformed") {
    parts.push(`error="invalid_request"`);
  } else if (opts.reason === "invalid_token") {
    parts.push(`error="invalid_token"`);
    if (opts.description) parts.push(`error_description="${opts.description}"`);
  }
  parts.push(`resource_metadata="${prm}"`);
  res.setHeader("WWW-Authenticate", parts.join(", "));
  res.writeHead(401).end();
  if (opts.reason === "missing") {
    console.error("[http] POST /mcp 401 (no Authorization header)");
  } else if (opts.reason === "malformed") {
    console.error("[http] POST /mcp 401 (malformed Authorization header)");
  }
}

function requestBaseUrl(req: http.IncomingMessage, bindHost: string, bindPort: number): string {
  const protoHeader = req.headers["x-forwarded-proto"];
  const proto = (Array.isArray(protoHeader) ? protoHeader[0] : protoHeader)?.split(",")[0]?.trim() ?? "http";
  const host = req.headers.host ?? `${bindHost}:${bindPort}`;
  return `${proto}://${host}`;
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks);
}

function extractMcpRequest(body: unknown): McpRequest | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { method?: unknown; params?: unknown };
  if (typeof b.method !== "string") return null;
  const req: McpRequest = { method: b.method };
  if (b.method === "tools/call" && b.params && typeof b.params === "object") {
    const name = (b.params as { name?: unknown }).name;
    if (typeof name === "string") req.toolName = name;
  }
  return req;
}

function write403InsufficientScope(
  res: http.ServerResponse,
  baseUrl: string,
  scope: string,
): void {
  const prm = `${baseUrl}${PRM_PATH}`;
  const ww = `Bearer realm="sky-tonight", error="insufficient_scope", scope="${scope}", resource_metadata="${prm}"`;
  res.setHeader("WWW-Authenticate", ww);
  res.setHeader("content-type", "application/json");
  const errBody = JSON.stringify({
    jsonrpc: "2.0",
    id: null,
    error: {
      code: -32001,
      message: "insufficient_scope",
      data: { required_scope: scope },
    },
  });
  res.writeHead(403).end(errBody);
  console.error(`[http] POST /mcp 403 (insufficient_scope: needs ${scope})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const host = process.env.HOST ?? "127.0.0.1";
  const port = Number(process.env.PORT ?? 3000);
  let server: http.Server;
  try {
    server = await startHttpServer({ host, port });
  } catch (err) {
    console.error(`[http] startup error: ${(err as Error).message}`);
    process.exit(1);
  }
  console.error(`sky-tonight http on http://${host}:${port}/mcp`);
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => server.close(() => process.exit(0)));
  }
}

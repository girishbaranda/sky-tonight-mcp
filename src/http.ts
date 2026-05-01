#!/usr/bin/env node
/**
 * Sky Tonight — Streamable HTTP entry point (v0.5).
 *
 * Stateless mode: every POST is handled independently with a fresh McpServer
 * and a fresh transport. No Mcp-Session-Id, no SSE GET endpoint, no per-session
 * state. Matches the way our tools actually behave (every call is independent).
 *
 * Two exports:
 *   - startHttpServer({ host, port }): used by tests and the smoke script.
 *     Returns the running http.Server so the caller can close() it.
 *   - When run directly (`node dist/http.js` / `tsx src/http.ts`), reads
 *     HOST/PORT from env and binds 127.0.0.1:3000 by default.
 *
 * Security: v0.5 ships NO auth. Default bind is 127.0.0.1. To expose remotely,
 * set HOST=0.0.0.0 and put it behind a tunnel or reverse proxy until v0.6 (OAuth).
 */
import http from "node:http";
import { fileURLToPath } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./lib/mcp-server.js";

export function startHttpServer({
  host,
  port,
}: {
  host: string;
  port: number;
}): Promise<http.Server> {
  const httpServer = http.createServer(async (req, res) => {
    if (req.url !== "/mcp") {
      res.writeHead(404).end();
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405, { Allow: "POST" }).end();
      return;
    }
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => {
      server.close().catch((err) => console.error("[http] cleanup error:", err));
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (err) {
      console.error("[http] handler error:", err);
      if (!res.headersSent) res.writeHead(500).end();
    }
  });
  return new Promise((resolve) => httpServer.listen(port, host, () => resolve(httpServer)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const host = process.env.HOST ?? "127.0.0.1";
  const port = Number(process.env.PORT ?? 3000);
  const server = await startHttpServer({ host, port });
  console.error(`sky-tonight http on http://${host}:${port}/mcp`);
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => server.close(() => process.exit(0)));
  }
}

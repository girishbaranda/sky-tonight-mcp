#!/usr/bin/env node
/**
 * Sky Tonight — stdio entry point.
 *
 * The MCP host (Claude Code, Claude Desktop, etc.) spawns this process and
 * speaks JSON-RPC 2.0 over stdin/stdout. For the HTTP transport, see src/http.ts.
 *
 * Both files share src/lib/mcp-server.ts — the same eleven register*() calls
 * back the same tools, resources, and prompts behind either transport.
 *
 * Stdio has no auth: the trust boundary is the OS user that spawned us. All
 * log rows written via stdio are scoped to a constant "local" user, so they
 * coexist with HTTP rows (scoped to jwt.sub) in the same SQLite file.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./lib/mcp-server.js";
import { setProcessUser } from "./lib/user-context.js";

// Stdio is single-user for the process lifetime. stdin data events fire outside
// any async chain in Node ESM modules, so runWithUser() cannot propagate to them.
// setProcessUser pins the identity for the entire process.
setProcessUser("local");
const server = createMcpServer();
const transport = new StdioServerTransport();
await server.connect(transport);

// Note: we deliberately log nothing to stdout — that channel is reserved for
// JSON-RPC frames. Use console.error if you need to log; stderr is safe.

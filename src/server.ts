#!/usr/bin/env node
/**
 * Sky Tonight — stdio entry point.
 *
 * The MCP host (Claude Code, Claude Desktop, etc.) spawns this process and
 * speaks JSON-RPC 2.0 over stdin/stdout. For the HTTP transport, see src/http.ts.
 *
 * Both files share src/lib/mcp-server.ts — the same eleven register*() calls
 * back the same tools, resources, and prompts behind either transport.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./lib/mcp-server.js";

const server = createMcpServer();
const transport = new StdioServerTransport();
await server.connect(transport);

// Note: we deliberately log nothing to stdout — that channel is reserved for
// JSON-RPC frames. Use console.error if you need to log; stderr is safe.

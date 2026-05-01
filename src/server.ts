#!/usr/bin/env node
/**
 * Sky Tonight — an MCP server for personal astronomy.
 *
 * This is the entry point. It does three things:
 *   1. Constructs an McpServer with name+version (advertised to clients on connect).
 *   2. Registers each tool (we delegate to per-file `register*` functions for clarity).
 *   3. Connects the server to a stdio transport — meaning the MCP host (Claude Code,
 *      Claude Desktop, etc.) will spawn this process and talk to it over stdin/stdout
 *      using JSON-RPC 2.0 framed messages.
 *
 * To go remote later (week 3 in the README roadmap), swap StdioServerTransport for
 * StreamableHTTPServerTransport — everything else stays the same.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerObjectsVisible } from "./tools/objects-visible.js";
import { registerIssPasses } from "./tools/iss-passes.js";
import { registerMoonPhase } from "./tools/moon-phase.js";

const server = new McpServer({
  name: "sky-tonight",
  version: "0.1.0",
});

registerObjectsVisible(server);
registerIssPasses(server);
registerMoonPhase(server);

const transport = new StdioServerTransport();
await server.connect(transport);

// Note: we deliberately log nothing to stdout — that channel is reserved for
// JSON-RPC frames. Use console.error if you need to log; stderr is safe.

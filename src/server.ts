#!/usr/bin/env node
/**
 * Sky Tonight — an MCP server for personal astronomy.
 *
 * This is the entry point. It does three things:
 *   1. Constructs an McpServer with name+version (advertised to clients on connect).
 *   2. Registers each tool, resource, and prompt (we delegate to per-file `register*`
 *      functions for clarity).
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
import { registerDeepSkyVisible } from "./tools/deep-sky-visible.js";
import { registerLogObservation } from "./tools/log-observation.js";
import { registerRecallLog } from "./tools/recall-log.js";

import { registerMessierResources } from "./resources/messier.js";
import { registerConstellationResources } from "./resources/constellations.js";

import { registerPlanTonightSession } from "./prompts/plan-tonight-session.js";
import { registerIdentifyObject } from "./prompts/identify-object.js";
import { registerTourConstellation } from "./prompts/tour-constellation.js";

const server = new McpServer({
  name: "sky-tonight",
  version: "0.4.0",
});

// Tools
registerObjectsVisible(server);
registerIssPasses(server);
registerMoonPhase(server);
registerDeepSkyVisible(server);
registerLogObservation(server);
registerRecallLog(server);

// Resources
registerMessierResources(server);
registerConstellationResources(server);

// Prompts
registerPlanTonightSession(server);
registerIdentifyObject(server);
registerTourConstellation(server);

const transport = new StdioServerTransport();
await server.connect(transport);

// Note: we deliberately log nothing to stdout — that channel is reserved for
// JSON-RPC frames. Use console.error if you need to log; stderr is safe.

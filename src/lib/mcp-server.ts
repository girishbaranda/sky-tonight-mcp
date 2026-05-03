/**
 * Builds an McpServer with every tool, resource, and prompt registered.
 * The transport is the caller's choice — stdio (src/server.ts) or HTTP (src/http.ts).
 *
 * Why a factory and not a singleton: in stateless HTTP mode each request gets
 * its own server instance, so concurrent requests can't see each other's state.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerObjectsVisible } from "../tools/objects-visible.js";
import { registerIssPasses } from "../tools/iss-passes.js";
import { registerMoonPhase } from "../tools/moon-phase.js";
import { registerDeepSkyVisible } from "../tools/deep-sky-visible.js";
import { registerLogObservation } from "../tools/log-observation.js";
import { registerRecallLog } from "../tools/recall-log.js";

import { registerMessierResources } from "../resources/messier.js";
import { registerConstellationResources } from "../resources/constellations.js";

import { registerPlanTonightSession } from "../prompts/plan-tonight-session.js";
import { registerIdentifyObject } from "../prompts/identify-object.js";
import { registerTourConstellation } from "../prompts/tour-constellation.js";

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "sky-tonight",
    version: "0.6.0",
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

  return server;
}

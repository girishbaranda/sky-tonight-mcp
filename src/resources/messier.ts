/**
 * MCP Resources for the Messier catalog.
 *
 * Two resources are registered:
 *   1. sky://catalog/messier  — fixed URI; returns a compact JSON index of all 110 objects.
 *      Each entry includes a `uri` field pointing to the per-object resource so the LLM
 *      can drill in.
 *   2. sky://messier/{id}  — URI template; returns the full JSON record for one object.
 *      Case-insensitive (m31 and M31 both resolve).
 *
 * No list callback is provided for the template — the LLM navigates via the index
 * resource above. This keeps resources/list small (~2 entries instead of ~200).
 */
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadMessier, findMessier } from "../lib/catalog.js";

export function registerMessierResources(server: McpServer): void {
  // Index resource: compact list with drill-in URIs.
  server.registerResource(
    "messier-catalog",
    "sky://catalog/messier",
    {
      title: "Messier Catalog Index",
      description:
        "Compact index of all 110 Messier deep-sky objects (galaxies, nebulae, clusters). " +
        "Each entry includes id, name, type, magnitude, constellation, and a uri field " +
        "pointing to the per-object resource. Use this to discover what's in the catalog, " +
        "then read sky://messier/{id} for full details.",
      mimeType: "application/json",
    },
    async (uri) => {
      const index = loadMessier().map((o) => ({
        id: o.id,
        name: o.name,
        type: o.type,
        magnitude: o.magnitude,
        constellation: o.constellation,
        uri: `sky://messier/${o.id}`,
      }));
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(index, null, 2),
          },
        ],
      };
    },
  );

  // Per-object resource: full record by id.
  server.registerResource(
    "messier-object",
    new ResourceTemplate("sky://messier/{id}", { list: undefined }),
    {
      title: "Messier Object",
      description:
        "Full record for a single Messier object by id (e.g. sky://messier/M31). " +
        "Returns name, type, constellation, J2000 RA/Dec, magnitude, size, best viewing " +
        "months, and a prose description. Case-insensitive.",
      mimeType: "application/json",
    },
    async (uri, { id }) => {
      const idStr = Array.isArray(id) ? id[0] : id;
      const obj = findMessier(idStr);
      if (!obj) {
        throw new Error(`Unknown Messier object: ${idStr}`);
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(obj, null, 2),
          },
        ],
      };
    },
  );
}

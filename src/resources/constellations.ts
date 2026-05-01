/**
 * MCP Resources for the IAU constellation catalog.
 *
 * Mirrors src/resources/messier.ts: one fixed-URI index resource and one URI-templated
 * per-constellation resource. Constellations are sky regions (no point-source coords),
 * so there is no visibility tool for them — the best_months field on each entry is
 * the visibility hint.
 */
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConstellations, findConstellation } from "../lib/catalog.js";

export function registerConstellationResources(server: McpServer): void {
  server.registerResource(
    "constellation-catalog",
    "sky://catalog/constellations",
    {
      title: "IAU Constellation Catalog Index",
      description:
        "Compact index of all 88 IAU constellations. Each entry includes name, " +
        "abbreviation, hemisphere, brightest star, and a uri field pointing to the " +
        "per-constellation resource. Use this to discover what's in the catalog, then " +
        "read sky://constellation/{abbr} for full details (mythology, notable objects, etc).",
      mimeType: "application/json",
    },
    async (uri) => {
      const index = loadConstellations().map((c) => ({
        name: c.name,
        abbreviation: c.abbreviation,
        hemisphere: c.hemisphere,
        brightest_star: c.brightest_star.name,
        uri: `sky://constellation/${c.abbreviation}`,
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

  server.registerResource(
    "constellation-detail",
    new ResourceTemplate("sky://constellation/{abbr}", { list: undefined }),
    {
      title: "Constellation Detail",
      description:
        "Full record for one constellation by IAU 3-letter abbreviation " +
        "(e.g. sky://constellation/Ori). Returns name, latin genitive, hemisphere, " +
        "best viewing months, brightest star, notable deep-sky objects, and " +
        "mythological story. Case-insensitive.",
      mimeType: "application/json",
    },
    async (uri, { abbr }) => {
      const abbrStr = Array.isArray(abbr) ? abbr[0] : abbr;
      const c = findConstellation(abbrStr);
      if (!c) {
        throw new Error(`Unknown constellation abbreviation: ${abbrStr}`);
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(c, null, 2),
          },
        ],
      };
    },
  );
}

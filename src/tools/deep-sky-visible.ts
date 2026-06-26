/**
 * Tool: deep_sky_visible_tonight
 *
 * For deep-sky observers (telescope or binoculars). Filters the bundled Messier
 * catalog by magnitude and (optionally) object type, then computes which entries
 * rise above a minimum altitude during the night window.
 *
 * Distinct from objects_visible_tonight (which covers bright bodies — Moon and
 * planets) because the parameter set differs: deep-sky observing cares about
 * magnitude limits and type filters; bright-body observing doesn't.
 *
 * The catalog is loaded directly from src/data/messier.json via lib/catalog.ts.
 * It is NOT routed through the MCP resource layer — that's a client-facing
 * interface; the server using its own data files is a separate concern.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createRequire } from "node:module";
import type * as AstronomyNS from "astronomy-engine";

// See src/lib/astronomy.ts: createRequire pins astronomy-engine's CJS build so
// the import works under both tsx and compiled Node ESM (dual-package hazard).
const Astronomy = createRequire(import.meta.url)("astronomy-engine") as typeof AstronomyNS;
import {
  loadMessier,
  filterMessierByType,
  type MessierObject,
} from "../lib/catalog.js";
import {
  findNightWindow,
  azimuthToCompass,
  type ObserverInput,
} from "../lib/astronomy.js";

interface DeepSkyResult {
  object: MessierObject;
  peak_altitude_deg: number;
  peak_azimuth_deg: number;
  peak_time: Date;
}

/** Convert J2000 RA/Dec to topocentric alt/az for a given observer + moment. */
function altAzFromRaDec(
  ra_deg: number,
  dec_deg: number,
  date: Date,
  observer: ObserverInput,
): { altitude_deg: number; azimuth_deg: number } {
  const obs = new Astronomy.Observer(
    observer.latitude,
    observer.longitude,
    observer.elevation_m ?? 0,
  );
  // RA in astronomy-engine's Horizon is given in hours (RA_deg / 15).
  const ra_hours = ra_deg / 15;
  const horizon = Astronomy.Horizon(date, obs, ra_hours, dec_deg, "normal");
  return { altitude_deg: horizon.altitude, azimuth_deg: horizon.azimuth };
}

export function registerDeepSkyVisible(server: McpServer): void {
  server.registerTool(
    "deep_sky_visible_tonight",
    {
      title: "Deep-sky objects visible tonight",
      description:
        "Returns Messier deep-sky objects (galaxies, nebulae, clusters) visible from a " +
        "location during the night. Filters by magnitude limit and optional type " +
        "(galaxy/nebula/cluster). For each object that gets above the minimum altitude, " +
        "returns peak altitude, time, compass direction, and magnitude. " +
        "Use when the user asks 'what galaxies/nebulae/Messier objects can I see tonight', " +
        "'is M31 visible', etc.",
      inputSchema: {
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        date: z
          .string()
          .optional()
          .describe(
            "ISO date for the evening (e.g. '2026-05-01'). Night window = sunset that " +
              "evening through sunrise the next morning. Defaults to today.",
          ),
        min_altitude_deg: z
          .number()
          .min(0)
          .max(90)
          .default(30)
          .describe(
            "Minimum peak altitude. 30° is a reasonable default for deep-sky — they " +
              "need height to escape light pollution and atmospheric extinction.",
          ),
        max_magnitude: z
          .number()
          .default(9)
          .describe(
            "Faint cutoff. 6 ≈ naked eye, 9 = small telescope (default), 12 = serious scope.",
          ),
        type_filter: z
          .enum(["galaxy", "nebula", "cluster"])
          .optional()
          .describe(
            "Restrict to one category. galaxy=spiral+elliptical+galaxy; " +
              "nebula=nebula+planetary_nebula+supernova_remnant; " +
              "cluster=open+globular. When omitted, all types are returned, " +
              "including atypical Messier entries (M40 double star, M73 asterism).",
          ),
      },
    },
    async ({ latitude, longitude, date, min_altitude_deg, max_magnitude, type_filter }) => {
      const observer: ObserverInput = { latitude, longitude };
      const anchor = date ? new Date(date + "T12:00:00Z") : new Date();

      const window = findNightWindow(anchor, observer);
      if (!window) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Could not compute a night window for that location/date. Likely a polar day or polar night.",
            },
          ],
        };
      }
      const { sunset, sunrise } = window;
      const nightHours = (sunrise.getTime() - sunset.getTime()) / 3.6e6;

      // Filter the catalog by magnitude and (optional) type.
      let candidates = loadMessier().filter((o) => o.magnitude <= max_magnitude);
      if (type_filter) {
        candidates = filterMessierByType(candidates, type_filter);
      }

      // Sample alt/az every 15 minutes through the night, take the peak.
      const stepMs = 15 * 60 * 1000;
      const results: DeepSkyResult[] = [];
      for (const obj of candidates) {
        let peakAlt = -90;
        let peakAz = 0;
        let peakTime: Date | null = null;
        for (let t = sunset.getTime(); t <= sunrise.getTime(); t += stepMs) {
          const moment = new Date(t);
          const { altitude_deg, azimuth_deg } = altAzFromRaDec(
            obj.ra_deg,
            obj.dec_deg,
            moment,
            observer,
          );
          if (altitude_deg > peakAlt) {
            peakAlt = altitude_deg;
            peakAz = azimuth_deg;
            peakTime = moment;
          }
        }
        if (peakAlt >= min_altitude_deg && peakTime) {
          results.push({
            object: obj,
            peak_altitude_deg: peakAlt,
            peak_azimuth_deg: peakAz,
            peak_time: peakTime,
          });
        }
      }

      results.sort((a, b) => b.peak_altitude_deg - a.peak_altitude_deg);
      const top = results.slice(0, 20);

      const lines: string[] = [];
      lines.push(
        `Night window (UTC): ${sunset.toISOString()} → ${sunrise.toISOString()} (${round1(nightHours)} hours of darkness)`,
      );
      lines.push("");
      if (top.length === 0) {
        lines.push("No deep-sky objects matched your filters tonight.");
      } else {
        lines.push(
          `Visible deep-sky objects (${top.length} of ${results.length} matched, ranked by peak altitude):`,
        );
        for (const r of top) {
          lines.push(
            `  ${r.object.id} (${r.object.name}): peaks ${round1(r.peak_altitude_deg)}° in ${azimuthToCompass(r.peak_azimuth_deg)} at ${r.peak_time.toISOString()}, mag ${r.object.magnitude} [${r.object.type} in ${r.object.constellation}]`,
          );
        }
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    },
  );
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

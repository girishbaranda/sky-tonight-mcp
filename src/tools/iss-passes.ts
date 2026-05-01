/**
 * Tool: iss_passes
 *
 * Finds upcoming visible passes of the ISS from an observer location.
 * Uses live TLE from celestrak (cached for 6h).
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { findISSPasses } from "../lib/satellites.js";
import { azimuthToCompass } from "../lib/astronomy.js";

export function registerIssPasses(server: McpServer): void {
  server.registerTool(
    "iss_passes",
    {
      title: "ISS visible passes",
      description:
        "Finds upcoming passes of the International Space Station from a location. " +
        "Returns start/peak/end times (UTC), peak altitude in degrees, and rise/set/peak compass directions. " +
        "Higher peak altitude and longer duration = better pass. ISS itself is naked-eye visible (mag ~-3) when sunlit and the sky is dark. " +
        "Use when the user asks 'when does the ISS pass over', 'space station tonight', etc.",
      inputSchema: {
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        hours_ahead: z
          .number()
          .min(1)
          .max(168)
          .default(48)
          .describe("How many hours into the future to scan (max 7 days)"),
        min_peak_altitude_deg: z
          .number()
          .min(0)
          .max(90)
          .default(10)
          .describe("Skip low passes; 10° = treetop-clearing, 30° = good pass, 60°+ = excellent"),
      },
    },
    async ({ latitude, longitude, hours_ahead, min_peak_altitude_deg }) => {
      let passes;
      try {
        passes = await findISSPasses(
          latitude,
          longitude,
          new Date(),
          hours_ahead,
          min_peak_altitude_deg,
        );
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Failed to compute ISS passes: ${(err as Error).message}`,
            },
          ],
        };
      }

      if (passes.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No ISS passes above ${min_peak_altitude_deg}° in the next ${hours_ahead} hours from (${latitude}, ${longitude}).`,
            },
          ],
        };
      }

      const lines = [
        `Found ${passes.length} ISS pass${passes.length === 1 ? "" : "es"} in the next ${hours_ahead} hours from (${latitude}, ${longitude}):`,
      ];
      for (const p of passes) {
        const dur = Math.round(p.duration_seconds);
        lines.push(
          `  ${p.start.toISOString()} → ${p.end.toISOString()}: peak ${Math.round(p.peak_altitude_deg)}° in ${azimuthToCompass(p.peak_azimuth_deg)} at ${p.peak.toISOString()} (${dur}s, rises ${azimuthToCompass(p.start_azimuth_deg)} → sets ${azimuthToCompass(p.end_azimuth_deg)})`,
        );
      }
      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    },
  );
}

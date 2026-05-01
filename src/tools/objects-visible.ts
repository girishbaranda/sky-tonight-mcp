/**
 * Tool: objects_visible_tonight
 *
 * Computes which major bodies (planets, Moon) are above a chosen altitude
 * during astronomical night for a given observer + date. Returns each body's
 * peak altitude, time of peak, compass direction, and apparent magnitude.
 *
 * This is a pure-compute tool: no network, deterministic, fast.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  VISIBLE_BODIES,
  azimuthToCompass,
  computePosition,
  findNightWindow,
} from "../lib/astronomy.js";

export function registerObjectsVisible(server: McpServer): void {
  server.registerTool(
    "objects_visible_tonight",
    {
      title: "What's visible tonight",
      description:
        "Returns major celestial bodies (Moon, planets) visible from a location during the night. " +
        "For each body that gets above the minimum altitude, includes peak altitude, time of peak (UTC), " +
        "compass direction at peak, and apparent magnitude. " +
        "Use this when the user asks 'what can I see tonight', 'is Saturn up', 'what planets are visible', etc.",
      inputSchema: {
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        date: z
          .string()
          .optional()
          .describe(
            "ISO date for the evening (e.g. '2026-05-01'). The 'night' window is sunset that evening through sunrise the next morning. Defaults to today.",
          ),
        min_altitude_deg: z
          .number()
          .min(0)
          .max(90)
          .default(15)
          .describe("Skip bodies whose peak altitude is below this. 15° is a reasonable default for naked-eye observing."),
      },
    },
    async ({ latitude, longitude, date, min_altitude_deg }) => {
      const observer = { latitude, longitude };
      // Anchor at noon UTC of the requested date so SearchRiseSet finds the
      // *next* sunset, not one already in the past.
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

      const stepMs = 15 * 60 * 1000; // sample every 15 min
      const visible: Array<{
        body: string;
        peak_altitude_deg: number;
        peak_azimuth_deg: number;
        peak_direction: string;
        peak_time_utc: string;
        magnitude: number | null;
        illumination_percent: number | null;
      }> = [];

      for (const body of VISIBLE_BODIES) {
        let peakAlt = -90;
        let peakAz = 0;
        let peakTime: Date | null = null;

        for (let t = sunset.getTime(); t <= sunrise.getTime(); t += stepMs) {
          const pos = computePosition(body, new Date(t), observer);
          if (pos.altitude_deg > peakAlt) {
            peakAlt = pos.altitude_deg;
            peakAz = pos.azimuth_deg;
            peakTime = new Date(t);
          }
        }

        if (peakAlt >= min_altitude_deg && peakTime) {
          const peakInfo = computePosition(body, peakTime, observer);
          visible.push({
            body: peakInfo.body,
            peak_altitude_deg: round1(peakAlt),
            peak_azimuth_deg: round1(peakAz),
            peak_direction: azimuthToCompass(peakAz),
            peak_time_utc: peakTime.toISOString(),
            magnitude: peakInfo.magnitude == null ? null : round2(peakInfo.magnitude),
            illumination_percent:
              peakInfo.illumination_percent == null
                ? null
                : Math.round(peakInfo.illumination_percent),
          });
        }
      }

      visible.sort((a, b) => b.peak_altitude_deg - a.peak_altitude_deg);

      const lines: string[] = [];
      lines.push(
        `Night window (UTC): ${sunset.toISOString()} → ${sunrise.toISOString()} (${round1(nightHours)} hours of darkness)`,
      );
      lines.push("");
      if (visible.length === 0) {
        lines.push(`No major bodies above ${min_altitude_deg}° tonight.`);
      } else {
        lines.push(`Visible (${visible.length} objects, ranked by peak altitude):`);
        for (const o of visible) {
          const mag = o.magnitude != null ? `, mag ${o.magnitude}` : "";
          const ill =
            o.body === "Moon" && o.illumination_percent != null
              ? `, ${o.illumination_percent}% illuminated`
              : "";
          lines.push(
            `  ${o.body}: peaks ${o.peak_altitude_deg}° in ${o.peak_direction} at ${o.peak_time_utc}${mag}${ill}`,
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
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Tool: moon_phase
 *
 * Current Moon phase, illumination, and dates of the next major phase events.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import Astronomy from "astronomy-engine";

function phaseName(angle: number): string {
  const a = ((angle % 360) + 360) % 360;
  if (a < 22.5 || a >= 337.5) return "New Moon";
  if (a < 67.5) return "Waxing Crescent";
  if (a < 112.5) return "First Quarter";
  if (a < 157.5) return "Waxing Gibbous";
  if (a < 202.5) return "Full Moon";
  if (a < 247.5) return "Waning Gibbous";
  if (a < 292.5) return "Last Quarter";
  return "Waning Crescent";
}

export function registerMoonPhase(server: McpServer): void {
  server.registerTool(
    "moon_phase",
    {
      title: "Moon phase",
      description:
        "Current Moon phase (e.g. Waxing Gibbous), illumination percentage, apparent magnitude, and dates of the next New / First Quarter / Full / Last Quarter events. " +
        "Useful for stargazing planning — a bright Moon washes out faint deep-sky objects.",
      inputSchema: {
        date: z.string().optional().describe("ISO date (defaults to now)"),
      },
    },
    async ({ date }) => {
      const d = date ? new Date(date) : new Date();

      const phaseAngle = Astronomy.MoonPhase(d);
      const ill = Astronomy.Illumination(Astronomy.Body.Moon, d);

      const events = [
        { name: "New Moon", angle: 0 },
        { name: "First Quarter", angle: 90 },
        { name: "Full Moon", angle: 180 },
        { name: "Last Quarter", angle: 270 },
      ];
      const upcoming: Array<{ event: string; date: string }> = [];
      for (const e of events) {
        const found = Astronomy.SearchMoonPhase(e.angle, d, 40);
        if (found) upcoming.push({ event: e.name, date: found.date.toISOString() });
      }
      upcoming.sort((a, b) => a.date.localeCompare(b.date));

      const lines = [
        `Date: ${d.toISOString()}`,
        `Phase: ${phaseName(phaseAngle)} (phase angle ${phaseAngle.toFixed(1)}°)`,
        `Illumination: ${(ill.phase_fraction * 100).toFixed(1)}%`,
        `Apparent magnitude: ${ill.mag.toFixed(2)}`,
        "",
        "Upcoming major phases:",
        ...upcoming.map((u) => `  ${u.event}: ${u.date}`),
      ];
      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    },
  );
}

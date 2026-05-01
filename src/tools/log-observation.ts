/**
 * Tool: log_observation
 *
 * Records an observation in the user's persistent log. First stateful tool —
 * see ../lib/observation-log.ts for the storage layer.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { logObservation } from "../lib/observation-log.js";

export function registerLogObservation(server: McpServer): void {
  server.registerTool(
    "log_observation",
    {
      title: "Log an observation",
      description:
        "Records an observation in the user's persistent log: what was observed (target), where (latitude/longitude), and optionally when, plus notes, seeing/transparency on a 1–5 scale, and equipment used. " +
        "Use when the user says they saw something and wants it remembered — e.g. 'log Jupiter, 8 inch dob, seeing 4', 'I just saw the ISS pass'.",
      inputSchema: {
        target: z
          .string()
          .min(1)
          .describe("What was observed: 'M31', 'Jupiter', or free-text like 'bright dot low SW'"),
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        timestamp: z
          .string()
          .optional()
          .describe("ISO timestamp of the observation (e.g. '2026-05-01T20:30:00Z'); defaults to now"),
        notes: z.string().optional(),
        seeing: z
          .number()
          .int()
          .min(1)
          .max(5)
          .optional()
          .describe("Atmospheric steadiness, 1 (poor) to 5 (excellent)"),
        transparency: z
          .number()
          .int()
          .min(1)
          .max(5)
          .optional()
          .describe("Sky clarity, 1 (poor) to 5 (excellent)"),
        equipment: z
          .string()
          .optional()
          .describe("E.g. 'naked eye', '10x50 binoculars', '8\" Dob'"),
      },
    },
    async ({ target, latitude, longitude, timestamp, notes, seeing, transparency, equipment }) => {
      try {
        const row = logObservation({
          target,
          latitude,
          longitude,
          observedAt: timestamp ? new Date(timestamp) : undefined,
          notes,
          seeing,
          transparency,
          equipment,
        });
        const extras: string[] = [];
        if (row.seeing != null) extras.push(`seeing ${row.seeing}`);
        if (row.transparency != null) extras.push(`transparency ${row.transparency}`);
        if (row.equipment) extras.push(row.equipment);
        const tail = extras.length ? ` (${extras.join(", ")})` : "";
        return {
          content: [
            {
              type: "text",
              text: `Logged observation #${row.id}: ${row.target} at ${row.latitude}, ${row.longitude} on ${row.observedAt}${tail}`,
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to log observation: ${(err as Error).message}` }],
        };
      }
    },
  );
}

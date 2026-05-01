/**
 * Tool: recall_log
 *
 * Searches the user's persistent observation log. Read side of the v0.4
 * stateful pair — see ./log-observation.ts and ../lib/observation-log.ts.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { recallObservations, type RecallFilters } from "../lib/observation-log.js";

export function registerRecallLog(server: McpServer): void {
  server.registerTool(
    "recall_log",
    {
      title: "Recall logged observations",
      description:
        "Searches the user's persistent observation log. Filters: target (case-insensitive substring), date range (since/until), minimum seeing rating. " +
        "Returns matching observations newest-first, capped at 100. " +
        "Use when the user asks 'what have I seen', 'have I logged Jupiter', 'show observations from last month', etc.",
      inputSchema: {
        target: z
          .string()
          .optional()
          .describe("Substring match, case-insensitive. Omit to see all."),
        since: z
          .string()
          .optional()
          .describe("ISO date — inclusive lower bound on observation time"),
        until: z
          .string()
          .optional()
          .describe("ISO date — inclusive upper bound on observation time"),
        min_seeing: z
          .number()
          .int()
          .min(1)
          .max(5)
          .optional()
          .describe("Only observations with seeing >= this (excludes unrated)"),
        limit: z.number().int().min(1).max(100).default(20),
      },
    },
    async ({ target, since, until, min_seeing, limit }) => {
      const filters: RecallFilters = {
        target,
        since: since ? new Date(since) : undefined,
        until: until ? new Date(until) : undefined,
        minSeeing: min_seeing,
        limit,
      };

      let rows;
      try {
        rows = recallObservations(filters);
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to recall observations: ${(err as Error).message}` }],
        };
      }

      const filterParts: string[] = [];
      if (target) filterParts.push(`target~"${target}"`);
      if (since) filterParts.push(`since=${since}`);
      if (until) filterParts.push(`until=${until}`);
      if (min_seeing != null) filterParts.push(`min_seeing=${min_seeing}`);
      filterParts.push(`limit=${limit}`);
      const filterSummary = `Filters: ${filterParts.join(", ")}`;

      if (rows.length === 0) {
        return {
          content: [{ type: "text", text: `No observations match those filters.\n${filterSummary}` }],
        };
      }

      const lines: string[] = [
        `${rows.length} observation${rows.length === 1 ? "" : "s"} (newest first):`,
      ];
      for (const r of rows) {
        const extras: string[] = [];
        if (r.seeing != null) extras.push(`seeing ${r.seeing}`);
        if (r.transparency != null) extras.push(`transparency ${r.transparency}`);
        if (r.equipment) extras.push(r.equipment);
        if (r.notes) extras.push(`"${r.notes}"`);
        const tail = extras.length ? ` — ${extras.join(", ")}` : "";
        lines.push(
          `  #${r.id}: ${r.target} at ${r.latitude}, ${r.longitude} on ${r.observedAt}${tail}`,
        );
      }
      lines.push("", filterSummary);
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );
}

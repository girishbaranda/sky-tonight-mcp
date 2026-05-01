/**
 * Prompt: identify_object
 *
 * Open-ended "what was that?" workflow. Single free-text argument; the body
 * instructs the LLM to extract observable clues from the description, then
 * rule out fast-moving / blinking / streak phenomena before matching against
 * the visibility tools.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface IdentifyObjectArgs {
  description: string;
}

export function buildIdentifyObjectBody(args: IdentifyObjectArgs): string {
  return `The user is trying to identify something they saw in the sky. Their description:

> ${args.description}

**Step 1 — Location & time.** All tools require lat/lon. Ask if you don't know the user's location. Extract the observation time from the description if mentioned (e.g. "around 9pm tonight"). If absent, ask.

**Step 2 — Extract observable clues.** From the description, identify any of: compass direction (N/NE/E/...), altitude (low/mid/high or degrees), color, brightness ("very bright", "dim"), motion (twinkling, moving, flashing), shape (point, fuzzy, elongated). State the clues you found in one short paragraph.

**Step 3 — Rule out fast-moving objects first.**
- If the user reported steady motion across the sky over seconds-to-minutes → call \`iss_passes\` for the observation time. The ISS is the most likely candidate for a slow, bright, non-blinking moving point.
- If the user reported blinking lights → almost certainly an aircraft. Say so plainly and stop.
- If the user reported a brief streak (sub-second) → meteor. Say so plainly and stop.

**Step 4 — Match against tonight's sky.** Call \`objects_visible_tonight\` with \`min_altitude_deg: 5\` to get all planets + Moon visible at the observation time. Compare magnitude and direction against the user's description. The Moon and Venus are by far the most common "what was that bright thing" candidates.

**Step 5 — Deep-sky check (only if relevant).** If the user described something fuzzy / non-pointlike, call \`deep_sky_visible_tonight\` to see what's up. Most naked-eye fuzzy reports are M31 (Andromeda), M42 (Orion Nebula), M45 (Pleiades), or the Milky Way — match by direction.

**Step 6 — Conclusion.** Lead with the single most likely match and your confidence ("Almost certainly Venus", "Probably Jupiter, possibly Saturn"). Cite the matching evidence (magnitude, direction, altitude). If the description is too sparse, ask one targeted follow-up question (the single most discriminating one — usually direction or whether it was moving) rather than guessing.

**Don't:** speculate about UFOs, satellites other than the ISS (we don't have TLE data for them), or things not derivable from the tools above.

If nothing in the visible-tools' output matches, tell the user honestly that you can't match it from the available data, and suggest what additional detail would help.`;
}

export function registerIdentifyObject(server: McpServer): void {
  server.registerPrompt(
    "identify_object",
    {
      title: "Identify a sky object",
      description:
        "Help the user identify something they saw in the sky from a free-text description, by ruling out aircraft/meteors and matching against tonight's planets, Moon, and deep-sky objects.",
      argsSchema: {
        description: z
          .string()
          .describe(
            "Free-text description of what the user saw — include direction, time, brightness, color, and any motion if known.",
          ),
      },
    },
    ({ description }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: buildIdentifyObjectBody({ description }),
          },
        },
      ],
    }),
  );
}

/**
 * Prompt: plan_tonight_session
 *
 * Curated observing plan that composes the four v0.1/v0.2 tools (moon_phase,
 * objects_visible_tonight, deep_sky_visible_tonight, iss_passes) into a
 * skill-level-tuned workflow.
 *
 * The body is built by a pure function (buildPlanTonightSessionBody) so we
 * can unit-test argument substitution and the validation branch directly,
 * without standing up an MCP server.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const ALLOWED_LEVELS = ["beginner", "intermediate", "advanced"] as const;

export interface PlanTonightSessionArgs {
  duration_min: string;
  skill_level: string;
}

export function buildPlanTonightSessionBody(args: PlanTonightSessionArgs): string {
  const isValidLevel = (ALLOWED_LEVELS as readonly string[]).includes(args.skill_level);
  const validationLine = isValidLevel
    ? ""
    : `NOTE: skill_level must be one of: ${ALLOWED_LEVELS.join(", ")}. The user provided: "${args.skill_level}". Ask the user to clarify or proceed assuming intermediate.\n\n`;
  const article = /^[aeiou]/i.test(args.skill_level) ? "an" : "a";

  return `${validationLine}You are helping plan a ${args.duration_min}-minute backyard observing session for ${article} ${args.skill_level} observer.

**Step 1 — Location.** If you don't already know the user's latitude/longitude, ask before doing anything else. All tools below require it.

**Step 2 — Conditions.** Call \`moon_phase\` to get illumination. A bright Moon (>50% illumination) washes out faint deep-sky targets — note this in the plan.

**Step 3 — Easy wins (always include).** Call \`objects_visible_tonight\` to list planets and the Moon visible during astronomical night, ranked by altitude. Pick the top 2–3 for the plan.

**Step 4 — Deep sky.** Call \`deep_sky_visible_tonight\` with these parameters tuned to skill level (note: \`type_filter\` accepts a single value — one of \`galaxy\`, \`nebula\`, or \`cluster\` — not an array):
- \`beginner\`: \`max_magnitude: 6\`, optionally \`type_filter: "cluster"\` (open and globular clusters are visually rewarding for unaided/binocular observers); pick 2 targets max. If you want a brighter nebula too, run a second call with \`type_filter: "nebula"\`.
- \`intermediate\`: \`max_magnitude: 8\`, no type filter; pick 3–4 targets.
- \`advanced\`: \`max_magnitude: 10\`, no type filter; pick 4–6 targets including any galaxies.

**Step 5 — ISS bonus.** Call \`iss_passes\` for the next 24 hours (\`hours_ahead: 24\`). If a pass starts within the session window, slot it in.

**Step 6 — Build the plan.** Allocate ~${args.duration_min}/N minutes per target. Order by best-time-to-observe (highest altitude). For each target output: name, what it is, where to look (compass + altitude), why it's worth seeing.

**Style by skill level:**
- \`beginner\`: visual analogies ("looks like a fuzzy patch of stars"), no jargon, recommend naked-eye / binoculars.
- \`intermediate\`: include magnitudes, brief structural detail, suggest scope size.
- \`advanced\`: include RA/Dec, transit times, structural notes (e.g. "edge-on spiral, dust lane visible at >150x").

If the Moon is up and bright, suggest a Moon-friendly section first (lunar features, double stars, bright planets) before dimmer targets later in the session.

If no astronomical night occurs at this latitude/date (polar summer), fall back to civil-twilight planets and the Moon.`;
}

export function registerPlanTonightSession(server: McpServer): void {
  server.registerPrompt(
    "plan_tonight_session",
    {
      title: "Plan tonight's observing session",
      description:
        "Build a curated observing plan combining moon phase, planets, deep-sky picks, and ISS passes for a session of N minutes at the user's skill level.",
      argsSchema: {
        duration_min: z
          .string()
          .describe('Minutes available for observing (e.g. "60", "120").'),
        skill_level: z
          .string()
          .describe("One of: beginner, intermediate, advanced."),
      },
    },
    ({ duration_min, skill_level }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: buildPlanTonightSessionBody({ duration_min, skill_level }),
          },
        },
      ],
    }),
  );
}

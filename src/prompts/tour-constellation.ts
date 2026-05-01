/**
 * Prompt: tour_constellation
 *
 * Visibility-aware walk through one constellation, composing the v0.2
 * constellation + Messier resources with the deep_sky_visible_tonight tool.
 *
 * Important: the constellation resource record only contains:
 *   name, latin_genitive, abbreviation, hemisphere, best_months,
 *   brightest_star (single {name, magnitude}), notable_objects (string list),
 *   story.
 * It does NOT contain RA/Dec for stars or sky-region bounds. The body text
 * spells this out so the LLM doesn't hallucinate missing fields.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface TourConstellationArgs {
  name: string;
}

export function buildTourConstellationBody(args: TourConstellationArgs): string {
  return `The user wants a tour of the constellation: **${args.name}**.

**Step 1 — Resolve the constellation.** Read \`sky://catalog/constellations\` to find the matching entry by name or IAU abbreviation. If no match, tell the user and suggest the closest names from the index. Once matched, read \`sky://constellation/{abbr}\` for the full record. The record contains: \`name\`, \`latin_genitive\`, \`abbreviation\`, \`hemisphere\` (northern/southern/equatorial), \`best_months\`, \`brightest_star\` (a single \`{name, magnitude}\` object — NOT a list), \`notable_objects\` (string list, often referencing Messier IDs), and \`story\`. There are no RA/Dec fields on this record — for individual star positions, rely on your general astronomy knowledge.

**Step 2 — Location.** Ask for lat/lon if you don't already know it.

**Step 3 — Visibility check.** Call \`objects_visible_tonight\` to confirm astronomical night exists tonight at the user's location. Then determine if the constellation is currently up by calling \`deep_sky_visible_tonight\` and looking at the bracketed \`[type in Constellation]\` suffix on each result line — if any line ends in this constellation's name, it's at least partially up. Combine with \`hemisphere\` from the resource and the user's latitude as a sanity check (e.g. Crux is unreachable from above ~25°N).

**Step 4a — If visible tonight:**
1. Name the constellation's brightest star using \`brightest_star.name\` from the resource. Mention 2–4 other principal stars from your general knowledge (e.g. for Orion: Rigel, Betelgeuse, Bellatrix, the Belt). Describe their positions qualitatively relative to each other ("Belt is the line of three; Betelgeuse marks the upper-left shoulder") rather than giving alt/az — we don't have a star-position tool. If \`objects_visible_tonight\` reports a planet near the constellation, use it as a compass anchor.
2. Take the \`notable_objects\` list from the resource as a starting point, then read \`sky://catalog/messier\` and filter the index to objects whose \`constellation\` field matches this constellation's name. Call \`deep_sky_visible_tonight\` and intersect — keep only the objects from the constellation that the tool reports as up tonight at observable altitude.
3. Build the tour: brightest star first → asterism / shape → 1-3 deep-sky highlights, in the order a user would naturally pan across the sky.

**Step 4b — If NOT visible tonight:**
1. Say so plainly: "Cygnus isn't visible from your location tonight."
2. From the resource's \`best_months\`, tell the user when it returns to the evening sky.
3. Optionally call \`objects_visible_tonight\` and offer 2-3 alternatives that ARE up tonight in the same general direction.
4. Still summarize what the constellation contains (brightest stars, notable Messier objects) so the user learns about it — just frame it as preview rather than tour.

**Style:** plain language by default. Include star names (Betelgeuse, Rigel) and Messier IDs (M42, M43). Skip RA/Dec unless the user asks for it. Mention mythology briefly if the resource record includes it.

**Edge cases:**
- Constellation name typo / not found → suggest closest matches from the index resource.
- Latitude makes constellation never visible (e.g. Crux from northern Europe) → say so and explain the latitude limit.`;
}

export function registerTourConstellation(server: McpServer): void {
  server.registerPrompt(
    "tour_constellation",
    {
      title: "Tour a constellation",
      description:
        "Take the user on a visibility-aware tour of one constellation tonight, naming its brightest star and any deep-sky objects it contains that are up at observable altitude.",
      argsSchema: {
        name: z
          .string()
          .describe(
            'Constellation name or IAU 3-letter abbreviation (e.g. "Orion", "Ori"). Case-insensitive.',
          ),
      },
    },
    ({ name }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: buildTourConstellationBody({ name }),
          },
        },
      ],
    }),
  );
}

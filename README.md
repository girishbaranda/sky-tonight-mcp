# Sky Tonight

A Model Context Protocol (MCP) server for personal astronomy. Ask any MCP-compatible host (Claude Code, Claude Desktop, Cursor) "what's visible from my backyard tonight" or "when does the ISS pass over Gandhinagar" and get real, computed answers.

This repo is also a learning project. The code is intentionally small (~500 lines) and structured so reading it is the fastest path to understanding MCP end-to-end.

## What this server can do

Four tools, all powered by real ephemeris math (no hand-waving, no LLM guessing):

| Tool | Returns |
|---|---|
| `objects_visible_tonight` | Planets and Moon visible during astronomical night, ranked by peak altitude, with magnitude and compass direction |
| `deep_sky_visible_tonight` | Messier objects (galaxies, nebulae, clusters) visible tonight from your location, filtered by magnitude and type, ranked by peak altitude |
| `iss_passes` | Upcoming ISS passes from your location with start/peak/end times and rise/set directions |
| `moon_phase` | Current phase, illumination %, magnitude, and dates of next New/First Quarter/Full/Last Quarter |

Two MCP **Resources** are also exposed (read-only catalog data the LLM can browse):

| Resource | Returns |
|---|---|
| `sky://catalog/messier` | Compact index of all 110 Messier deep-sky objects (galaxies, nebulae, clusters) |
| `sky://catalog/constellations` | Compact index of all 88 IAU constellations |
| `sky://messier/{id}` | Full record for one Messier object — `sky://messier/M31` for Andromeda |
| `sky://constellation/{abbr}` | Full record for one constellation — `sky://constellation/Ori` for Orion |

Three MCP **Prompts** are also exposed (slash-invocable templates that compose the tools and resources into curated workflows):

| Prompt | Arguments | Returns |
|---|---|---|
| `plan_tonight_session` | `duration_min`, `skill_level` (beginner/intermediate/advanced) | A skill-tuned observing plan combining moon phase, planets, deep-sky picks, and ISS passes |
| `identify_object` | `description` (free text) | An open-ended workflow that rules out aircraft/meteors and matches the description against tonight's sky |
| `tour_constellation` | `name` (constellation name or IAU 3-letter abbr.) | A visibility-aware walk through the constellation's brightest star and Messier highlights up tonight |

## Quickstart

```bash
git clone git@github.com:girishbaranda/sky-tonight-mcp.git sky-tonight
cd sky-tonight
npm install
npm run typecheck     # should be clean
npx tsx scripts/smoke-test.ts   # verifies astronomy + ISS lib work
```

Wire it into Claude Code:

```bash
claude mcp add sky-tonight -- npx tsx /absolute/path/to/sky-tonight/src/server.ts
```

Restart Claude Code, run `/mcp` — you should see `sky-tonight` listed with four tools and three prompts. Now ask:

> "I'm at 23.2156, 72.6369 — what's visible tonight above 20 degrees?"
> "When's the next ISS pass over Gandhinagar in the next 3 days?"
> "What's the moon phase tonight?"

Or invoke a prompt template directly:

```
/sky-tonight:plan_tonight_session duration_min=120 skill_level=intermediate
/sky-tonight:identify_object description="bright dot low in the southwest at 9pm"
/sky-tonight:tour_constellation name=Orion
```

## Reading this codebase as an MCP tutorial

Read the files in this order — each layer adds one concept.

### 1. `src/server.ts` — the entry point (~45 lines)

This file shows the entire shape of an MCP server in 4 statements:

```ts
const server = new McpServer({ name, version });   // (1) advertise identity
registerObjectsVisible(server);                    // (2) attach capabilities (tools)
registerIssPasses(server);
registerMoonPhase(server);
registerDeepSkyVisible(server);
registerMessierResources(server);                  //     ... and resources
registerConstellationResources(server);
registerPlanTonightSession(server);                //     ... and prompts
registerIdentifyObject(server);
registerTourConstellation(server);
const transport = new StdioServerTransport();      // (3) pick transport
await server.connect(transport);                   // (4) start the protocol loop
```

That's the whole MCP server lifecycle. The `McpServer` is your high-level handle; transports are pluggable (stdio for local subprocess, streamable HTTP for remote — same `server` object, different transport).

**Key idea: stdio.** When you run the server via `npx tsx src/server.ts`, the MCP host (Claude Code) spawns this process and treats its stdin/stdout as the communication channel. Every line is a JSON-RPC 2.0 frame. Don't `console.log` — that pollutes the protocol. Use `console.error` for diagnostics; stderr is safe.

### 2. `src/tools/moon-phase.ts` — your first tool (~70 lines)

Read this one second because it's the simplest. The pattern is:

```ts
server.registerTool(
  "moon_phase",                  // (a) tool name — what the LLM will call
  {
    title: "...",                // (b) human-friendly title
    description: "...",          // (c) THIS is what the LLM reads to decide whether to call you
    inputSchema: { ... },        // (d) Zod schema — auto-converted to JSON Schema for the LLM
  },
  async ({ date }) => {          // (e) handler — args are typed from the schema
    return {
      content: [{ type: "text", text: "..." }],   // (f) return shape
    };
  }
);
```

The `description` is the most important field you write. It's the only thing the LLM sees when deciding whether to call your tool. Bad descriptions = the model never invokes your tool, or invokes it for the wrong things. Good descriptions are concrete and include trigger phrases ("Use when the user asks ...").

The Zod schema is converted to JSON Schema automatically and shipped to the host as part of `tools/list`. The model uses that schema to construct valid arguments.

### 3. `src/tools/objects-visible.ts` — a richer tool (~140 lines)

Same structure, more interesting handler. Notice:

- **Input validation is free.** Zod's `.min(-90).max(90)` is enforced before your handler runs. If the LLM hallucinates a bad value, the SDK rejects it with a structured error before you see it.
- **Default values come from the schema.** `min_altitude_deg` defaults to 15, but the model can override.
- **Errors are structured.** Setting `isError: true` in the response tells the host this was a tool-level failure, separate from a transport error.
- **Output is text-formatted for the LLM.** We return a multi-line plain string because the LLM is the consumer. (The newer MCP spec also supports `structuredContent` for programmatic consumers — not needed for this project.)

### 4. `src/tools/iss-passes.ts` + `src/lib/satellites.ts` — a tool that does I/O

This one fetches live TLE data from celestrak. Two production lessons baked in:

- **Cache aggressively.** TLEs are valid for days; we cache for 6 hours so we don't hammer celestrak.
- **Wrap external I/O in try/catch.** Network failures should become structured `isError: true` responses, not protocol-level crashes.

### 4.5 `src/resources/messier.ts` — your first MCP Resource

Resources are the second MCP primitive. Unlike Tools (which the LLM *calls* to do work), Resources are **read-only context** the LLM can *browse and read* — like files on a filesystem. The host fetches them, the LLM treats them as reference material.

There are two flavors of Resource registration in this codebase:

```ts
// 1. Fixed-URI resource — one URI, one document
server.registerResource(
  "messier-catalog",
  "sky://catalog/messier",     // fixed URI
  { title, description, mimeType: "application/json" },
  async (uri) => ({ contents: [{ uri: uri.href, mimeType, text }] })
);

// 2. URI-templated resource — one template, many documents
server.registerResource(
  "messier-object",
  new ResourceTemplate("sky://messier/{id}", { list: undefined }),
  { title, description, mimeType: "application/json" },
  async (uri, { id }) => ({ contents: [{ uri: uri.href, mimeType, text }] })
);
```

The `{ list: undefined }` on the template means we don't enumerate all 110 per-object resources in `resources/list` — the LLM browses via the index resource instead. This is the **hybrid pattern**: a small, browsable index that points to richer per-object documents.

Try it manually:

```bash
(
  printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"manual","version":"0"}}}'
  printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  printf '%s\n' '{"jsonrpc":"2.0","id":2,"method":"resources/list"}'
  printf '%s\n' '{"jsonrpc":"2.0","id":3,"method":"resources/read","params":{"uri":"sky://messier/M31"}}'
  sleep 1
) | npx tsx src/server.ts
```

You'll see three replies: the `initialize` handshake, the `resources/list` result (two fixed-URI entries), and the full M31 record.

**Tools vs. Resources — when to use which?** Tools = computation/actions (the LLM asks you to *do* something). Resources = data/context (the LLM asks you for *information*). `deep_sky_visible_tonight` is a tool because it computes; `sky://messier/M31` is a resource because it's a static fact.

### 4.7 `src/prompts/plan-tonight-session.ts` — your first MCP Prompt

Prompts are the third MCP primitive. Unlike Tools (which the LLM *calls*) or Resources (which the LLM *reads*), Prompts are **templated user messages** the *user* invokes — usually as a slash command like `/sky-tonight:plan_tonight_session`. The MCP host substitutes the user's arguments into the template and injects the resulting message into the conversation. The LLM then follows the templated instructions, calling whichever tools and resources the prompt directs it toward.

The pattern:

```ts
server.registerPrompt(
  "plan_tonight_session",                // (a) prompt name — what the user types after the colon
  {
    title: "...",                        // (b) human-friendly title (slash-command picker)
    description: "...",                  // (c) what the host shows next to the title
    argsSchema: {                        // (d) raw Zod shape (record of schemas) — args are always strings at the wire
      duration_min: z.string(),
      skill_level: z.string(),
    },
  },
  ({ duration_min, skill_level }) => ({  // (e) handler — returns messages to inject
    messages: [
      {
        role: "user",
        content: { type: "text", text: `...templated body referencing tools by name...` },
      },
    ],
  })
);
```

Two things worth noticing:

- **Pure body builder.** Each prompt file exports `build*Body(args)` separately from `register*(server)`. The builder is a pure function — easy to unit-test argument substitution without spinning up a server. The registrant is a thin wrapper.
- **Prompt args are strings at the wire.** MCP prompt arguments don't have a numeric or enum type at the protocol level. We accept everything as `z.string()` and either let the LLM consume the substituted text directly (e.g. "120-minute" in the body) or have the body itself spell out validation rules ("skill_level must be one of...").

Try it manually:

```bash
(
  printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"manual","version":"0"}}}'
  printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  printf '%s\n' '{"jsonrpc":"2.0","id":2,"method":"prompts/list"}'
  printf '%s\n' '{"jsonrpc":"2.0","id":3,"method":"prompts/get","params":{"name":"plan_tonight_session","arguments":{"duration_min":"120","skill_level":"intermediate"}}}'
  sleep 1
) | npx tsx src/server.ts
```

You'll see three replies: the initialize handshake, the `prompts/list` result (three prompts with their argument schemas), and the `prompts/get` result — a `messages` array with the substituted body.

**Tools vs. Resources vs. Prompts — when to use which?** Tools = computation. Resources = data. Prompts = workflows. A Prompt is the only one of the three that the *user* invokes directly; the other two are invoked by the LLM in service of whatever conversation the user is having.

### 5. The wire protocol — see it for yourself

Run this in one terminal to manually drive the server with raw JSON-RPC:

```bash
(
  printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"manual","version":"0"}}}'
  printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  printf '%s\n' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
  printf '%s\n' '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"moon_phase","arguments":{}}}'
  sleep 1
) | npx tsx src/server.ts
```

You'll see three JSON responses: the `initialize` reply (capability negotiation), the `tools/list` reply (your four tools with their schemas), and the `tools/call` reply (the moon phase). That's the entire protocol you'll ever interact with at the wire level.

## Architecture diagram

```
                ┌─────────────────────┐
                │  Host (Claude Code) │
                │  - decides when to  │
                │    call which tool  │
                │  - reads resources  │
                └──────────┬──────────┘
                           │ spawns subprocess
                           │ stdin/stdout = JSON-RPC 2.0
                           ▼
   ┌─────────────────────────────────────────────────────┐
   │  Sky Tonight MCP Server (this repo)                 │
   │                                                     │
   │   server.ts ──► McpServer + stdio transport         │
   │                                                     │
   │   tools/                                            │
   │   ├── objects-visible.ts ──┐                        │
   │   ├── iss-passes.ts ───────┤                        │
   │   ├── moon-phase.ts ───────┼──► registerTool()      │
   │   └── deep-sky-visible.ts ─┘                        │
   │                                                     │
   │   resources/                                        │
   │   ├── messier.ts ──────────┐                        │
   │   └── constellations.ts ───┴──► registerResource()  │
   │                                                     │
   │   prompts/                                          │
   │   ├── plan-tonight-session.ts ┐                     │
   │   ├── identify-object.ts ─────┼──► registerPrompt() │
   │   └── tour-constellation.ts ──┘                     │
   │                                                     │
   │   data/                                             │
   │   ├── messier.json (110 objects)                    │
   │   └── constellations.json (88 entries)              │
   │                                                     │
   │   lib/                                              │
   │   ├── astronomy.ts ──► astronomy-engine             │
   │   ├── satellites.ts ─► satellite.js + fetch         │
   │   └── catalog.ts ────► loads + filters JSON         │
   │                          │                          │
   └──────────────────────────┼──────────────────────────┘
                              ▼
                     celestrak.org (TLE data)
```

## Roadmap — how this becomes a real, remote MCP

**v0.1 ✅** stdio transport, three tools, no auth, single user.

**v0.2 ✅** Resources primitive — Messier (110 objects) and IAU constellation (88 entries) catalogs exposed as hybrid index + per-object resources. Companion `deep_sky_visible_tonight` tool ties the catalog into observer-relative visibility computation.

**v0.3 ✅** Prompts primitive — three prompt templates (`plan_tonight_session`, `identify_object`, `tour_constellation`) that compose the tools and resources into slash-invocable workflows. Third MCP primitive done.

**v0.4 — Persistent observation log.** Add `log_observation` and `recall_log` tools backed by SQLite. Now the server is *stateful* — meaningful for any real-world MCP.

**v0.5 — Streamable HTTP transport.** Move from stdio to HTTP so the server can run remotely (Cloudflare Workers, fly.io). Same tool code; one new transport. This unlocks multi-device use.

**v0.6 — OAuth 2.1.** Required for multi-user remote servers. Personal data (your observation log) gets per-user scoping; public catalogs stay public.

**v0.7 — Publish.** Submit to the public MCP registry. Real users.

Each step is 1–3 evenings of work and teaches a discrete MCP concept.

## Useful references

- MCP spec: https://modelcontextprotocol.io/specification/2025-11-25
- TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
- astronomy-engine: https://github.com/cosinekitty/astronomy
- satellite.js: https://github.com/shashwatak/satellite-js
- ISS TLE source: https://celestrak.org/NORAD/elements/

## License

MIT — do whatever you want.

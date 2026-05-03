# Sky Tonight

A Model Context Protocol (MCP) server for personal astronomy. Ask any MCP-compatible host (Claude Code, Claude Desktop, Cursor) "what's visible from my backyard tonight" or "when does the ISS pass over Gandhinagar" and get real, computed answers.

This repo is also a learning project, structured so reading it is the fastest path to understanding MCP end-to-end.

## What this server can do

Six tools — four pure-compute (real ephemeris math, no LLM guessing), two backed by a local SQLite log of your observations:

| Tool | Returns |
|---|---|
| `objects_visible_tonight` | Planets and Moon visible during astronomical night, ranked by peak altitude, with magnitude and compass direction |
| `deep_sky_visible_tonight` | Messier objects (galaxies, nebulae, clusters) visible tonight from your location, filtered by magnitude and type, ranked by peak altitude |
| `iss_passes` | Upcoming ISS passes from your location with start/peak/end times and rise/set directions |
| `moon_phase` | Current phase, illumination %, magnitude, and dates of next New/First Quarter/Full/Last Quarter |
| `log_observation` | Records an observation (target, lat/lon, optional time, notes, seeing/transparency 1–5, equipment) in a local SQLite log |
| `recall_log` | Searches the observation log by target substring, date range, and minimum seeing — newest first |

Four MCP **Resources** are also exposed — two fixed-URI catalogs and two URI-templated detail resources (read-only data the LLM can browse):

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

Restart Claude Code, run `/mcp` — you should see `sky-tonight` listed with six tools and three prompts. Now ask:

> "I'm at 23.2156, 72.6369 — what's visible tonight above 20 degrees?"
> "When's the next ISS pass over Gandhinagar in the next 3 days?"
> "What's the moon phase tonight?"

Or invoke a prompt template directly:

```
/sky-tonight:plan_tonight_session duration_min=120 skill_level=intermediate
/sky-tonight:identify_object description="bright dot low in the southwest at 9pm"
/sky-tonight:tour_constellation name=Orion
```

## Running over HTTP

v0.5 added a Streamable HTTP transport. Same eleven tools, same factory in `src/lib/mcp-server.ts`, different framing.

```bash
npm run dev:http               # tsx src/http.ts
# sky-tonight http on http://127.0.0.1:3000/mcp
```

Try it with curl:

```bash
curl -s -X POST http://127.0.0.1:3000/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

Config (env vars):

| Var | Default | Notes |
|---|---|---|
| `PORT` | `3000` | Server bind port. |
| `HOST` | `127.0.0.1` | Server bind host. Set `0.0.0.0` to expose externally (auth still required). |
| `SKY_TONIGHT_DB` | `~/.sky-tonight/observations.db` | Same as v0.4. |
| `DEV_JWT_SECRET` | — | Dev-only HS256 secret. **Never** use in production. Mutually exclusive with `OAUTH_JWKS_URL`. |
| `OAUTH_JWKS_URL` | — | URL to the authorization server's JWKS document. Production path. |
| `OAUTH_ISSUER` | — | Required when `OAUTH_JWKS_URL` is set. Must match the JWT's `iss` claim. |
| `OAUTH_AUDIENCE` | — | Required when `OAUTH_JWKS_URL` is set. Must match the JWT's `aud` claim. |

> **HTTP transport requires auth as of v0.6.** Set `DEV_JWT_SECRET` for local testing (mint tokens with `npm run mint-token`) or point at a real authorization server with `OAUTH_JWKS_URL` + `OAUTH_ISSUER` + `OAUTH_AUDIENCE`. See the **Authentication** section below.

## Authentication

v0.6 makes the HTTP transport an OAuth 2.1 **Resource Server**. It validates Bearer JWTs, advertises issuer metadata at `.well-known/oauth-protected-resource`, and partitions the observation log per user via the JWT's `sub` claim. Sky-tonight does *not* issue tokens — that's the Authorization Server's job. Use a real one in production; use the bundled HS256 minter for local development.

### Dev path (HS256)

```bash
export DEV_JWT_SECRET=$(openssl rand -hex 32)
npm run dev:http &
TOKEN=$(npm run mint-token --silent)
curl -s -X POST http://127.0.0.1:3000/mcp \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"moon_phase","arguments":{}}}'
```

`mint-token` accepts `--sub <id>` (defaults to `local-dev`) and `--exp <seconds>` (defaults to 86400) — note that npm requires a literal `--` separator to forward args, so `npm run mint-token -- --sub alice`. The dev minter refuses to run without `DEV_JWT_SECRET`; **do not** ship the secret outside your laptop.

Without auth, the server returns 401 + a `WWW-Authenticate` header pointing at the metadata endpoint:

```
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="sky-tonight", resource_metadata="http://127.0.0.1:3000/.well-known/oauth-protected-resource"
```

A client that understands the MCP authorization spec follows that pointer to discover the issuer and obtain a token.

### Production path (JWKS)

Point at any RFC-compliant authorization server (Auth0, Keycloak, Clerk, Okta, a self-hosted oauth2-proxy, …). Configure four env vars instead of `DEV_JWT_SECRET`:

```bash
export OAUTH_JWKS_URL=https://your-tenant.auth0.com/.well-known/jwks.json
export OAUTH_ISSUER=https://your-tenant.auth0.com/
export OAUTH_AUDIENCE=sky-tonight
npm run build
npm run start:http
```

**Behind a reverse proxy:** Ensure your proxy (Nginx, Caddy, Cloudflare, etc.) sets `X-Forwarded-Proto` and normalizes the `Host` header to your real public hostname. The server reflects whatever `Host` it receives back into the `WWW-Authenticate` header and the PRM `resource` field, so a misconfigured proxy (or a direct deployment with `HOST=0.0.0.0` and no proxy) lets a malicious client redirect MCP discovery to an attacker-controlled hostname. This is operator-level hygiene, not a code bug.

The server validates token signatures against the JWKS public keys, requires `iss` and `aud` to match, requires `exp` to be in the future, and uses `sub` as the user identifier for log scoping. No client registration step happens inside sky-tonight; clients register at the AS, get tokens, and present them.

`DEV_JWT_SECRET` and `OAUTH_JWKS_URL` are mutually exclusive — pick one. The HTTP server refuses to start with neither set.

### Per-user data scoping

`log_observation` and `recall_log` filter rows by `user_id`, which is sourced from `jwt.sub` on HTTP and the constant string `"local"` on stdio. Two HTTP users with different `sub` values cannot see each other's rows; a stdio user and an HTTP user with `sub="local"` would share rows (treat that as a footgun and don't issue tokens with `sub: "local"`). Public catalogs (Messier, constellations) and pure-compute tools (planets, ISS, moon, deep-sky) return identical data for every authenticated caller.

## Persistence

`log_observation` and `recall_log` are backed by a local SQLite database. By default it lives at `~/.sky-tonight/observations.db` — created on first write. Override the location with `SKY_TONIGHT_DB`:

```bash
SKY_TONIGHT_DB=/path/to/your.db claude mcp add sky-tonight -- npx tsx /absolute/path/to/sky-tonight/src/server.ts
```

The log is partitioned per-user via the JWT `sub` claim on HTTP and a constant `"local"` user on stdio (see Authentication above), but the storage backend is still a single SQLite file per machine. Remote storage (Postgres, etc.) is on the v0.7+ roadmap. Use `SKY_TONIGHT_DB=":memory:"` for an ephemeral, in-process database — useful for tests and the smoke script.

## Reading this codebase as an MCP tutorial

Read the files in this order — each layer adds one concept.

### 1. `src/server.ts` — the entry point (~20 lines)

This file shows the entire shape of an MCP server in 3 statements:

```ts
const server = createMcpServer();                  // (1) build the McpServer with all tools/resources/prompts
const transport = new StdioServerTransport();      // (2) pick transport
await server.connect(transport);                   // (3) start the protocol loop
```

That's the whole MCP server lifecycle. The `McpServer` is your high-level handle; transports are pluggable (stdio for local subprocess, streamable HTTP for remote — same `server` object, different transport). v0.5 added the HTTP transport in `src/http.ts`, which calls the same `createMcpServer()` factory; see §4.9 for that walk-through. The eleven `register*()` calls now live in `src/lib/mcp-server.ts`.

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

### 4.8 `src/lib/observation-log.ts` — your first stateful tool

Every prior tool was pure compute. This one is the first that *remembers*: `log_observation` writes a row, `recall_log` reads it back, and the rows survive across MCP sessions because they live in a SQLite file on disk.

The lib is the only file that imports `better-sqlite3` or contains SQL. Both tools call into it through a small typed surface — `logObservation(input)`, `recallObservations(filters)` — and never see a `Database` handle. That boundary is deliberate: when a future version (v0.7+) brings remote storage, the swap is "rewrite the lib internals, leave callers alone." The cost of an abstraction layer (a repository interface, an ORM) would not buy us anything we don't get from the boundary already.

Two design choices worth noting:

- **`id INTEGER PRIMARY KEY`, no `AUTOINCREMENT`** — gets rowid semantics in SQLite and translates mechanically to `BIGSERIAL` / `GENERATED ALWAYS AS IDENTITY` when the lib gets a Postgres backend.
- **`created_at` is computed in JS** (`new Date().toISOString()` passed as a parameter), not via a SQLite-only `DEFAULT (strftime(...))`. Schema stays portable.

The lesson: a stateful MCP tool is not architecturally different from a stateless one. The wire protocol is identical; the host doesn't know or care that one of these tools persists data. Statefulness is purely an implementation detail behind the tool's `description` contract.

### 4.9 `src/http.ts` — your first non-stdio transport

Up to this point everything ran over stdio: the host spawned the process, framed JSON-RPC over stdin/stdout, and that was the whole transport. v0.5 adds a second entry point — a Streamable HTTP server — without changing a single tool, resource, or prompt. The lesson: in MCP the transport is genuinely pluggable. Same `McpServer`, same `register*()` calls, different framing.

The refactor is one new file:

```ts
// src/lib/mcp-server.ts
export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "sky-tonight", version: "0.5.0" });
  registerObjectsVisible(server);
  // ...all eleven register*() calls...
  return server;
}
```

Both `src/server.ts` (stdio) and `src/http.ts` (HTTP) call this factory. The eleven registrations now live in exactly one place.

The HTTP entry is stateless. Three things to notice:

```ts
// src/http.ts (sketch)
const httpServer = http.createServer(async (req, res) => {
  if (req.url !== "/mcp") return res.writeHead(404).end();
  if (req.method !== "POST") return res.writeHead(405, { Allow: "POST" }).end();
  const server = createMcpServer();                                          // (1)
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,                                           // (2)
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);                                   // (3)
});
```

(1) **Fresh server + fresh transport per request.** Two concurrent `tools/call` invocations have isolated handler state. This is what stateless mode means in practice.

(2) **`sessionIdGenerator: undefined`.** That's the SDK's signal for "stateless: no `Mcp-Session-Id` header, no SSE GET endpoint." Our tools have no notifications, no progress updates, no streamed responses — there's nothing for a session to hold.

(3) **`handleRequest(req, res)` does everything.** It parses the JSON-RPC frame, dispatches to the McpServer, and writes the reply (either as JSON or SSE-framed JSON depending on the `Accept` header the client sent).

Try it:

```bash
npm run dev:http &
curl -s -X POST http://127.0.0.1:3000/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"moon_phase","arguments":{}}}'
```

The reply you get back is the same shape you'd get from the stdio server — because it *is* the same server. The transport changed; nothing else did.

What this version did NOT add: authentication, sessions, deploy recipes. §4.10 covers how v0.6 fills the auth gap with OAuth 2.1 and per-user data scoping; v0.7 will publish to the registry.

### 4.10 `src/lib/auth.ts` — your first protected MCP

Up to v0.5, every HTTP request was anonymous. v0.6 makes the server an OAuth 2.1 Resource Server: every `POST /mcp` requires a Bearer JWT. The lesson is the **split** — sky-tonight is a Resource Server (validates tokens, scopes data), not an Authorization Server (issues tokens). The two roles are separable, and most production deployments don't run their own AS.

Three pieces work together:

```ts
// src/lib/auth.ts
export function loadAuthConfig(env): AuthConfig;       // either HS256 or JWKS
export async function verifyBearer(token, cfg): AuthContext;
```

```ts
// src/lib/user-context.ts — AsyncLocalStorage
export function runWithUser<T>(userId, fn): T;
export function currentUserId(): string;
```

```ts
// src/http.ts — request flow
1. GET /.well-known/oauth-protected-resource  → PRM doc, no auth
2. OPTIONS /mcp                                → CORS preflight, no auth
3. POST /mcp                                   → require Bearer; 401 otherwise
4. on success: runWithUser(jwt.sub, () => transport.handleRequest(...))
```

The MCP authorization spec uses [RFC 9728 Protected Resource Metadata](https://datatracker.ietf.org/doc/html/rfc9728) for discovery: an unauthenticated client gets a 401 with `WWW-Authenticate: Bearer ..., resource_metadata="<url>"`, fetches that URL, and learns which Authorization Servers can issue tokens for this resource. Sky-tonight publishes that doc; it doesn't run an AS.

**Why `AsyncLocalStorage`?** Two tools (`log_observation`, `recall_log`) need the user identity. The other nine don't. Threading a `userId` argument through every `register*()` signature would touch every tool file for nothing. ALS lets only the tools that care read `currentUserId()`, and lets the transport set it once at the top of the handler. Stdio's setup is the constant `"local"`; HTTP's is `jwt.sub`. The lib layer is unaware of which transport is active.

**The schema migration.** v0.5's DB had no `user_id` column. v0.6 adds it via `ALTER TABLE ... ADD COLUMN user_id TEXT NOT NULL DEFAULT 'local'` so existing rows backfill cleanly to the local-stdio scope. New databases skip the DEFAULT — every insert must supply `userId`. This pattern (in-place additive migration, NOT NULL with a sensible backfill default) is what the v0.4 lesson promised: `src/lib/observation-log.ts` is the only place SQL lives, so adding a column is a one-place change. v0.7 will use the same trick to introduce a Postgres backend.

What v0.6 does NOT add: token issuance, scope enforcement, refresh tokens, audit logs, HTTPS termination, or any new MCP tools or resources. v0.7 publishes to the registry.

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

You'll see three JSON responses: the `initialize` reply (capability negotiation), the `tools/list` reply (your six tools with their schemas), and the `tools/call` reply (the moon phase). That's the entire protocol you'll ever interact with at the wire level.

## Architecture diagram

```
                ┌─────────────────────┐         ┌────────────────────┐
                │  Host (Claude Code) │         │  HTTP client (curl,│
                │  - decides when to  │         │  remote MCP host)  │
                │    call which tool  │         └─────────┬──────────┘
                │  - reads resources  │                   │ POST /mcp
                └──────────┬──────────┘                   │ JSON-RPC 2.0
                           │ spawns subprocess            │ over HTTP
                           │ stdin/stdout = JSON-RPC 2.0  │
                           ▼                              ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │  Sky Tonight MCP Server (this repo)                             │
   │                                                                 │
   │   server.ts (stdio) ──┐         ┌── http.ts (Streamable HTTP)   │
   │                       ▼         ▼                               │
   │             lib/mcp-server.ts → createMcpServer()               │
   │                       │                                         │
   │                       ▼                                         │
   │   tools/                                                        │
   │   ├── objects-visible.ts ──┐                                    │
   │   ├── iss-passes.ts ───────┤                                    │
   │   ├── moon-phase.ts ───────┤                                    │
   │   ├── deep-sky-visible.ts ─┼──► registerTool()                  │
   │   ├── log-observation.ts ──┤                                    │
   │   └── recall-log.ts ───────┘                                    │
   │                                                                 │
   │   resources/                                                    │
   │   ├── messier.ts ──────────┐                                    │
   │   └── constellations.ts ───┴──► registerResource()              │
   │                                                                 │
   │   prompts/                                                      │
   │   ├── plan-tonight-session.ts ┐                                 │
   │   ├── identify-object.ts ─────┼──► registerPrompt()             │
   │   └── tour-constellation.ts ──┘                                 │
   │                                                                 │
   │   data/                                                         │
   │   ├── messier.json (110 objects)                                │
   │   └── constellations.json (88 entries)                          │
   │                                                                 │
   │   lib/                                                          │
   │   ├── astronomy.ts ────────► astronomy-engine                   │
   │   ├── satellites.ts ──────► satellite.js + fetch                │
   │   ├── catalog.ts ─────────► loads + filters JSON                │
   │   ├── observation-log.ts ─► better-sqlite3 (per-user)           │
   │   ├── auth.ts ────────────► jose (HS256 / JWKS)                 │
   │   └── user-context.ts ────► node:async_hooks                    │
   │                          │              │                       │
   └──────────────────────────┼──────────────┼───────────────────────┘
                              ▼              ▼
                     celestrak.org    ~/.sky-tonight/
                       (TLE data)     observations.db
```

## Roadmap — how this becomes a real, remote MCP

**v0.1 ✅** stdio transport, three tools, no auth, single user.

**v0.2 ✅** Resources primitive — Messier (110 objects) and IAU constellation (88 entries) catalogs exposed as hybrid index + per-object resources. Companion `deep_sky_visible_tonight` tool ties the catalog into observer-relative visibility computation.

**v0.3 ✅** Prompts primitive — three prompt templates (`plan_tonight_session`, `identify_object`, `tour_constellation`) that compose the tools and resources into slash-invocable workflows. Third MCP primitive done.

**v0.4 ✅** Persistent observation log — `log_observation` and `recall_log` tools backed by a local SQLite database. The server is *stateful* now: rows survive across MCP sessions. The lib (`src/lib/observation-log.ts`) is the only place SQL lives, so the future Postgres swap is mechanical.

**v0.5 ✅** Streamable HTTP transport — `src/http.ts` adds a stateless `POST /mcp` entry behind the same `createMcpServer()` factory the stdio entry uses. No auth, no sessions; bind defaults to `127.0.0.1` because v0.6 owns auth. The server now runs as a long-lived process any MCP host (or curl) can talk to.

**v0.6 ✅** OAuth 2.1 Resource Server — HTTP transport now requires a Bearer JWT, advertises auth metadata at `.well-known/oauth-protected-resource`, and partitions the observation log per-user via `jwt.sub`. Two configuration paths: HS256 + dev-only token minter for local testing, or RS256 via JWKS for production behind any RFC-compliant authorization server. Stdio is unchanged; rows it writes are scoped to a constant `"local"` user.

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

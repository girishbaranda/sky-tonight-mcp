# Deploying Sky Tonight

This is the recipe for standing up a hosted, multi-user Sky Tonight instance — the
same path used for the public deployment at **`https://sky-tonight.fly.dev`**. Two
options:

- **[Deploy to Fly.io with Neon](#deploy-to-flyio-with-neon)** — the path we use.
- **[Deploy anywhere with Docker](#deploy-anywhere-with-docker)** — generic.

Both run the HTTP transport (`dist/http.js`), which requires OAuth (see
[Authentication](../README.md#authentication)). The stdio transport needs none of
this — for local single-user use, just `npx @girishbaranda/sky-tonight`.

## What you need

| Concern | Service we use | What it provides |
|---|---|---|
| Auth (Authorization Server) | [Logto Cloud](https://logto.io) | Issues JWTs, JWKS, Dynamic Client Registration |
| Storage | [Neon](https://neon.tech) | Managed Postgres (`DATABASE_URL`) |
| Host | [Fly.io](https://fly.io) | Runs the Docker image, terminates TLS |

Sky Tonight is only a **Resource Server** — it validates tokens and stores per-user
logs. It never issues tokens, so any RFC-compliant OAuth 2.1 AS (Auth0, Keycloak,
Clerk, …) works in place of Logto; any Postgres works in place of Neon; any
container host works in place of Fly.

## Deploy to Fly.io with Neon

### 1. Authorization Server (Logto)

1. Create a Logto Cloud tenant. Note its endpoint, e.g. `https://<tenant>.logto.app`.
2. **API resource** → create one with the **API identifier set to your public URL**
   (this becomes the JWT `aud`): `https://sky-tonight.fly.dev`.
3. On that resource, add two **permissions** (scopes):
   `sky-tonight:log:read` and `sky-tonight:log:write`.
4. **Sign-in experience** → enable email + password (and optionally social) so users
   can self-onboard.
5. **Application** → create a **Native** (public + PKCE) app for MCP clients. Enable
   Dynamic Client Registration on the tenant so clients can self-register.
6. Capture the three values the server needs from the tenant's OIDC discovery doc
   (`https://<tenant>.logto.app/oidc/.well-known/openid-configuration`):
   - `OAUTH_ISSUER` → `issuer` (e.g. `https://<tenant>.logto.app/oidc`)
   - `OAUTH_JWKS_URL` → `jwks_uri` (e.g. `https://<tenant>.logto.app/oidc/jwks`)
   - `OAUTH_AUDIENCE` → your API identifier (`https://sky-tonight.fly.dev`)

### 2. Postgres (Neon)

1. Create a Neon project; pick a region near your Fly region (we use `iad` ↔ AWS
   `us-east`).
2. Use the default database (or name it `sky_tonight`).
3. Copy the **pooled** connection string (host contains `-pooler`) — this is
   `DATABASE_URL`. It already includes `?sslmode=require`; `pg` honors it and Neon's
   cert is publicly trusted, so no extra SSL config is needed.

No manual schema step — the server runs its migrations (`migrations/*.sql`) against
the database on first boot.

### 3. Host (Fly)

The repo already ships [`fly.toml`](../fly.toml) and a multi-stage
[`Dockerfile`](../Dockerfile) (non-root, `node:22-slim`, scale-to-zero).

```bash
fly auth login
fly apps create sky-tonight            # claims https://sky-tonight.fly.dev

# Non-secret env (PUBLIC_URL + OAUTH_AUDIENCE) is in fly.toml [env].
# Set the rest as secrets — DATABASE_URL is the only truly sensitive one:
fly secrets set \
  OAUTH_ISSUER='https://<tenant>.logto.app/oidc' \
  OAUTH_JWKS_URL='https://<tenant>.logto.app/oidc/jwks' \
  DATABASE_URL='postgresql://USER:PASS@ep-xxxx-pooler.REGION.aws.neon.tech/sky_tonight?sslmode=require' \
  -a sky-tonight

fly deploy -a sky-tonight
```

If you use a custom domain instead of `*.fly.dev`, point `PUBLIC_URL`,
`OAUTH_AUDIENCE` (in `fly.toml`), and the Logto API identifier at that hostname, add
the Fly cert (`fly certs create your.domain`), and CNAME it to `<app>.fly.dev`.

### 4. Verify

```bash
# PRM doc — should report your resource + Logto issuer + the two scopes
curl -s https://sky-tonight.fly.dev/.well-known/oauth-protected-resource | jq

# No token → 401 with a WWW-Authenticate pointing at the PRM doc
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://sky-tonight.fly.dev/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'   # 401

# Confirm migrations created the tables on first boot
psql "$DATABASE_URL" -c '\dt'   # expect: _migrations, observations
```

A real MCP client (Claude Desktop, Cursor) added against
`https://sky-tonight.fly.dev/mcp` will discover Logto via the PRM doc, run the OAuth
+ PKCE flow, and prompt for the `sky-tonight:log:write` scope the first time it calls
`log_observation`.

## Deploy anywhere with Docker

The image is host-agnostic. Build and run it with the same env vars:

```bash
docker build -t sky-tonight .
docker run -p 3000:3000 \
  -e PORT=3000 -e HOST=0.0.0.0 \
  -e PUBLIC_URL='https://your.host' \
  -e OAUTH_ISSUER='https://<tenant>.logto.app/oidc' \
  -e OAUTH_JWKS_URL='https://<tenant>.logto.app/oidc/jwks' \
  -e OAUTH_AUDIENCE='https://your.host' \
  -e DATABASE_URL='postgresql://…?sslmode=require' \
  sky-tonight
```

Put it behind a TLS-terminating reverse proxy that sets `X-Forwarded-Proto: https`
and a correct `Host` header — the server reflects `Host` into the PRM `resource` and
`WWW-Authenticate`, so a wrong one breaks discovery (see the reverse-proxy note in
the README's [Production path](../README.md#production-path-jwks)).

Omit `DATABASE_URL` to fall back to SQLite (`SKY_TONIGHT_DB`, default
`~/.sky-tonight/observations.db`) — fine for a single-user self-host, but use
Postgres for anything multi-user.

## Operational notes

- **Migrations** run on boot, inside a transaction. A failure aborts startup (the
  healthcheck fails and the prior machine keeps serving) rather than leaving a
  half-migrated DB.
- **Scale-to-zero**: `fly.toml` sets `auto_stop_machines = "stop"` and
  `min_machines_running = 0`, so the machine sleeps when idle and cold-starts (~1–2s)
  on the next request. Keeps cost near zero for personal use.
- **Memory**: the VM is `shared-cpu-1x` / 256 MB. If you hit OOM, bump `memory_mb` in
  `fly.toml`.
- **Logs**: `fly logs -a sky-tonight`. A clean boot prints `sky-tonight http on
  http://0.0.0.0:3000/mcp` and the healthcheck flips to passing.

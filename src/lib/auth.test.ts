/**
 * Auth lib tests. The HS256 verification path is exercised here; the JWKS path
 * is shape-only (the function returns the right kind of config) because the
 * verification engine inside jose is upstream-tested.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { loadAuthConfig, verifyBearer, AuthError } from "./auth.js";

const SECRET = "test-secret-do-not-use-in-production";
const secretBytes = new TextEncoder().encode(SECRET);

async function mintHs256(claims: {
  sub?: string;
  exp?: number;       // seconds from epoch
  nbf?: number;       // seconds from epoch
  scope?: string;
  iss?: string;
  aud?: string;
}): Promise<string> {
  let jwt = new SignJWT({ scope: claims.scope }).setProtectedHeader({ alg: "HS256" });
  if (claims.sub != null) jwt = jwt.setSubject(claims.sub);
  jwt = jwt.setIssuedAt();
  if (claims.exp != null) jwt = jwt.setExpirationTime(claims.exp);
  else jwt = jwt.setExpirationTime("1h");
  if (claims.nbf != null) jwt = jwt.setNotBefore(claims.nbf);
  if (claims.iss) jwt = jwt.setIssuer(claims.iss);
  if (claims.aud) jwt = jwt.setAudience(claims.aud);
  return jwt.sign(secretBytes);
}

test("loadAuthConfig: throws when neither env var set", () => {
  assert.throws(() => loadAuthConfig({}), /DEV_JWT_SECRET.*OAUTH_JWKS_URL/);
});

test("loadAuthConfig: throws when both env vars set", () => {
  assert.throws(
    () => loadAuthConfig({ DEV_JWT_SECRET: "x", OAUTH_JWKS_URL: "https://example/.well-known/jwks.json" }),
    /mutually exclusive/,
  );
});

test("loadAuthConfig: throws in jwks mode when issuer/audience missing", () => {
  assert.throws(
    () => loadAuthConfig({ OAUTH_JWKS_URL: "https://example/.well-known/jwks.json" }),
    /OAUTH_ISSUER.*OAUTH_AUDIENCE/,
  );
});

test("loadAuthConfig: returns hs256 config when DEV_JWT_SECRET set", () => {
  const cfg = loadAuthConfig({ DEV_JWT_SECRET: SECRET });
  assert.equal(cfg.mode, "hs256");
  assert.ok(cfg.secret instanceof Uint8Array);
});

test("loadAuthConfig: returns jwks config when full jwks env set", () => {
  const cfg = loadAuthConfig({
    OAUTH_JWKS_URL: "https://example.com/.well-known/jwks.json",
    OAUTH_ISSUER: "https://example.com",
    OAUTH_AUDIENCE: "sky-tonight",
  });
  assert.equal(cfg.mode, "jwks");
  assert.equal(cfg.issuer, "https://example.com");
  assert.equal(cfg.audience, "sky-tonight");
  assert.ok(typeof cfg.jwksGetKey === "function");
});

test("verifyBearer: returns AuthContext for valid HS256 token", async () => {
  const cfg = loadAuthConfig({ DEV_JWT_SECRET: SECRET });
  const token = await mintHs256({ sub: "alice", scope: "sky-tonight:log:read sky-tonight:log:write" });
  const ctx = await verifyBearer(token, cfg);
  assert.equal(ctx.userId, "alice");
  assert.deepEqual(ctx.scopes, ["sky-tonight:log:read", "sky-tonight:log:write"]);
  assert.equal(ctx.rawClaims.sub, "alice");
});

test("verifyBearer: empty scope yields empty array", async () => {
  const cfg = loadAuthConfig({ DEV_JWT_SECRET: SECRET });
  const token = await mintHs256({ sub: "alice" });
  const ctx = await verifyBearer(token, cfg);
  assert.deepEqual(ctx.scopes, []);
});

test("verifyBearer: throws AuthError('expired') on expired token", async () => {
  const cfg = loadAuthConfig({ DEV_JWT_SECRET: SECRET });
  const past = Math.floor(Date.now() / 1000) - 60;
  const token = await mintHs256({ sub: "alice", exp: past });
  await assert.rejects(() => verifyBearer(token, cfg), (err: unknown) => {
    return err instanceof AuthError && err.description === "expired";
  });
});

test("verifyBearer: throws AuthError('invalid signature') on wrong-secret token", async () => {
  const cfg = loadAuthConfig({ DEV_JWT_SECRET: SECRET });
  const otherSecret = new TextEncoder().encode("different-secret");
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("alice")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(otherSecret);
  await assert.rejects(() => verifyBearer(token, cfg), (err: unknown) => {
    return err instanceof AuthError && err.description === "invalid signature";
  });
});

test("verifyBearer: throws AuthError('invalid token') on garbage", async () => {
  const cfg = loadAuthConfig({ DEV_JWT_SECRET: SECRET });
  await assert.rejects(() => verifyBearer("not.a.jwt", cfg), (err: unknown) => {
    return err instanceof AuthError;
  });
});

test("verifyBearer: throws AuthError('missing sub') when sub missing", async () => {
  const cfg = loadAuthConfig({ DEV_JWT_SECRET: SECRET });
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secretBytes);
  await assert.rejects(() => verifyBearer(token, cfg), (err: unknown) => {
    return err instanceof AuthError && err.description === "missing sub";
  });
});

test("verifyBearer: throws AuthError('missing sub') when sub is empty string", async () => {
  const cfg = loadAuthConfig({ DEV_JWT_SECRET: SECRET });
  const token = await mintHs256({ sub: "" });
  await assert.rejects(() => verifyBearer(token, cfg), (err: unknown) => {
    return err instanceof AuthError && err.description === "missing sub";
  });
});

test("verifyBearer: throws AuthError('not yet valid') on future-nbf token", async () => {
  const cfg = loadAuthConfig({ DEV_JWT_SECRET: SECRET });
  const future = Math.floor(Date.now() / 1000) + 3600;
  const token = await mintHs256({ sub: "alice", nbf: future });
  await assert.rejects(() => verifyBearer(token, cfg), (err: unknown) => {
    return err instanceof AuthError && err.description === "not yet valid";
  });
});

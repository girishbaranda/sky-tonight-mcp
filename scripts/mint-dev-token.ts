#!/usr/bin/env node
/**
 * Dev-only HS256 token minter. Refuses to run if DEV_JWT_SECRET is unset.
 *
 * NEVER use in production — anyone with the secret can forge tokens.
 *
 * Usage:
 *   DEV_JWT_SECRET=test npm run mint-token
 *   DEV_JWT_SECRET=test npm run mint-token -- --sub alice
 *   DEV_JWT_SECRET=test npm run mint-token -- --sub alice --exp 86400
 *
 * `exp` is seconds-from-now; default 86400 (24h). `sub` defaults to "local-dev".
 */
import { SignJWT } from "jose";

const secret = process.env.DEV_JWT_SECRET;
if (!secret) {
  console.error("DEV_JWT_SECRET is not set. Refusing to mint a token.");
  process.exit(1);
}

// Tiny CLI flag parsing — no minimist dep.
const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
  const k = process.argv[i]?.replace(/^--/, "");
  const v = process.argv[i + 1];
  if (k && v != null) args.set(k, v);
}
const sub = args.get("sub") ?? "local-dev";
const expSeconds = Number(args.get("exp") ?? 86400);
if (!Number.isFinite(expSeconds) || expSeconds <= 0) {
  console.error(`--exp must be a positive number of seconds (got ${args.get("exp")})`);
  process.exit(1);
}

const token = await new SignJWT({})
  .setProtectedHeader({ alg: "HS256" })
  .setSubject(sub)
  .setIssuedAt()
  .setExpirationTime(`${expSeconds}s`)
  .sign(new TextEncoder().encode(secret));

console.log(token);

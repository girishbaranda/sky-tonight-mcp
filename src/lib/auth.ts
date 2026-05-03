/**
 * OAuth 2.1 Resource Server bits. Single source of truth for JWT validation.
 *
 * Two modes:
 *   - hs256: symmetric secret, dev-only path. Anyone with the secret can forge.
 *   - jwks:  asymmetric, server fetches public keys from the configured AS.
 *            Production-shaped — points at any RFC-compliant authorization server.
 *
 * Exactly one of (DEV_JWT_SECRET) or (OAUTH_JWKS_URL + OAUTH_ISSUER + OAUTH_AUDIENCE)
 * must be set. Setting neither, or both, is a startup error.
 *
 * The actual JWT verification is delegated to jose. We layer on:
 *   - mutually-exclusive config validation
 *   - non-empty `sub` enforcement (jose doesn't check this for us)
 *   - error-code → human-readable description mapping for WWW-Authenticate
 */
import { jwtVerify, createRemoteJWKSet, type JWTPayload } from "jose";

export type AuthMode = "hs256" | "jwks";

export interface AuthConfig {
  mode: AuthMode;
  secret?: Uint8Array;                                       // hs256 only
  jwksGetKey?: ReturnType<typeof createRemoteJWKSet>;        // jwks only
  issuer?: string;                                           // jwks only
  audience?: string;                                         // jwks only
}

export interface AuthContext {
  userId: string;
  scopes: string[];
  rawClaims: Record<string, unknown>;
}

/** Per-request auth failure. Thrown by verifyBearer; consumed by http.ts. */
export class AuthError extends Error {
  constructor(public readonly description: string) {
    super(description);
    this.name = "AuthError";
  }
}

export function loadAuthConfig(env: Record<string, string | undefined>): AuthConfig {
  const hasDev = !!env.DEV_JWT_SECRET && env.DEV_JWT_SECRET.length > 0;
  const hasJwks = !!env.OAUTH_JWKS_URL && env.OAUTH_JWKS_URL.length > 0;

  if (hasDev && hasJwks) {
    throw new Error(
      "DEV_JWT_SECRET and OAUTH_JWKS_URL are mutually exclusive — pick one",
    );
  }
  if (!hasDev && !hasJwks) {
    throw new Error(
      "Auth config missing: set either DEV_JWT_SECRET (dev) or OAUTH_JWKS_URL+OAUTH_ISSUER+OAUTH_AUDIENCE (prod)",
    );
  }
  if (hasDev) {
    return {
      mode: "hs256",
      secret: new TextEncoder().encode(env.DEV_JWT_SECRET!),
    };
  }
  // jwks mode
  if (!env.OAUTH_ISSUER || !env.OAUTH_AUDIENCE) {
    throw new Error(
      "JWKS mode requires both OAUTH_ISSUER and OAUTH_AUDIENCE",
    );
  }
  return {
    mode: "jwks",
    jwksGetKey: createRemoteJWKSet(new URL(env.OAUTH_JWKS_URL!)),
    issuer: env.OAUTH_ISSUER,
    audience: env.OAUTH_AUDIENCE,
  };
}

export async function verifyBearer(token: string, cfg: AuthConfig): Promise<AuthContext> {
  let payload: JWTPayload;
  try {
    if (cfg.mode === "hs256") {
      ({ payload } = await jwtVerify(token, cfg.secret!));
    } else {
      ({ payload } = await jwtVerify(token, cfg.jwksGetKey!, {
        issuer: cfg.issuer,
        audience: cfg.audience,
      }));
    }
  } catch (err) {
    throw new AuthError(mapJoseError(err));
  }

  const sub = payload.sub;
  if (typeof sub !== "string" || sub.length === 0) {
    throw new AuthError("missing sub");
  }

  const scopeStr = typeof payload.scope === "string" ? payload.scope : "";
  const scopes = scopeStr.split(/\s+/).filter(Boolean);

  return {
    userId: sub,
    scopes,
    rawClaims: payload as Record<string, unknown>,
  };
}

/**
 * Map a jose error to a small, fixed set of user-facing descriptions.
 * Why: raw jose messages sometimes echo claim values, which we never want
 * leaking through WWW-Authenticate response headers to a (potentially
 * untrusted) client.
 */
function mapJoseError(err: unknown): string {
  if (!(err instanceof Error)) return "invalid token";
  const code = (err as { code?: string }).code;
  switch (code) {
    case "ERR_JWT_EXPIRED":
      return "expired";
    case "ERR_JWS_SIGNATURE_VERIFICATION_FAILED":
    case "ERR_JWS_INVALID":
    case "ERR_JWT_INVALID":
      return "invalid signature";
    case "ERR_JWKS_NO_MATCHING_KEY":
    case "ERR_JWKS_INVALID":
    case "ERR_JWKS_TIMEOUT":
    case "ERR_JOSE_NOT_SUPPORTED":
      return "invalid signature";
    case "ERR_JWT_CLAIM_VALIDATION_FAILED": {
      const claim = (err as { claim?: string }).claim;
      if (claim === "aud") return "invalid audience";
      if (claim === "iss") return "invalid issuer";
      if (claim === "nbf") return "not yet valid";
      if (claim === "sub") return "missing sub";
      return "invalid token";
    }
    default:
      return "invalid token";
  }
}

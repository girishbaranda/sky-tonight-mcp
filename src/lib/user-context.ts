/**
 * Per-request user context.
 *
 * Why AsyncLocalStorage and not a parameter on every register*() signature:
 * only two of the eleven tools (log_observation, recall_log) care about the
 * user. Threading a userId argument through every tool registration would
 * touch nine files for nothing. ALS lets the two tools that care read
 * currentUserId() inside their handlers; the eight that don't, ignore it.
 *
 * The transports establish the scope:
 *   - stdio: setProcessUser("local") at startup — single user for the whole
 *     process lifetime. stdin data events fire outside any async chain in ESM
 *     modules, so ALS.run() / ALS.enterWith() cannot propagate to them; a
 *     module-level fallback covers this case.
 *   - http:  runWithUser(jwt.sub, () => transport.handleRequest(req, res))
 *
 * Every async chain rooted in the handler body sees the right userId.
 */
import { AsyncLocalStorage } from "node:async_hooks";

interface Ctx {
  userId: string;
}

const storage = new AsyncLocalStorage<Ctx>();

/** Process-level fallback for single-user transports (stdio). */
let processUserId: string | undefined;

export function runWithUser<T>(userId: string, fn: () => T): T {
  return storage.run({ userId }, fn);
}

/**
 * Sets a process-level user identity for the stdio entry point.
 * Must be called once at startup, before server.connect(). All calls to
 * currentUserId() that find no ALS scope (i.e. stdin event callbacks in ESM
 * modules) fall back to this value.
 */
export function setProcessUser(userId: string): void {
  processUserId = userId;
}

export function currentUserId(): string {
  const ctx = storage.getStore();
  if (ctx) return ctx.userId;
  if (processUserId !== undefined) return processUserId;
  throw new Error("currentUserId() called outside runWithUser scope");
}

/** Test-only: clear the process-level user fallback. */
export function _resetProcessUserForTest(): void {
  processUserId = undefined;
}

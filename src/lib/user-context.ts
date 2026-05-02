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
 *   - stdio: runWithUser("local", () => server.connect(stdio))
 *   - http:  runWithUser(jwt.sub, () => transport.handleRequest(req, res))
 *
 * Every async chain rooted in the handler body sees the right userId.
 */
import { AsyncLocalStorage } from "node:async_hooks";

interface Ctx {
  userId: string;
}

const storage = new AsyncLocalStorage<Ctx>();

export function runWithUser<T>(userId: string, fn: () => T): T {
  return storage.run({ userId }, fn);
}

export function currentUserId(): string {
  const ctx = storage.getStore();
  if (!ctx) {
    throw new Error("currentUserId() called outside runWithUser scope");
  }
  return ctx.userId;
}

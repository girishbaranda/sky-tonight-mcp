import { test } from "node:test";
import assert from "node:assert/strict";
import { runWithUser, currentUserId } from "./user-context.js";

test("currentUserId throws when called outside a runWithUser scope", () => {
  assert.throws(() => currentUserId(), /outside runWithUser scope/);
});

test("runWithUser sets the userId for the synchronous call site", () => {
  const got = runWithUser("alice", () => currentUserId());
  assert.equal(got, "alice");
});

test("runWithUser propagates through async/await", async () => {
  const got = await runWithUser("bob", async () => {
    await new Promise((r) => setImmediate(r));
    return currentUserId();
  });
  assert.equal(got, "bob");
});

test("runWithUser scopes are concurrent-safe", async () => {
  const a = runWithUser("alice", async () => {
    await new Promise((r) => setTimeout(r, 5));
    return currentUserId();
  });
  const b = runWithUser("bob", async () => {
    await new Promise((r) => setTimeout(r, 1));
    return currentUserId();
  });
  const [resA, resB] = await Promise.all([a, b]);
  assert.equal(resA, "alice");
  assert.equal(resB, "bob");
});

test("runWithUser nests — inner overrides outer for inner code", () => {
  const result = runWithUser("outer", () => {
    const innerVal = runWithUser("inner", () => currentUserId());
    const outerAfter = currentUserId();
    return { innerVal, outerAfter };
  });
  assert.equal(result.innerVal, "inner");
  assert.equal(result.outerAfter, "outer");
});

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { runWithUser, currentUserId } from "./user-context.js";
import { _resetProcessUserForTest, setProcessUser } from "./user-context.js";

beforeEach(() => {
  _resetProcessUserForTest();
});

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

test("setProcessUser: currentUserId returns the process user when no ALS scope", () => {
  setProcessUser("stdio-user");
  assert.equal(currentUserId(), "stdio-user");
});

test("setProcessUser: ALS scope takes priority over process user", () => {
  setProcessUser("stdio-user");
  const got = runWithUser("alice", () => currentUserId());
  assert.equal(got, "alice");
});

test("setProcessUser: after exiting an ALS scope, process user is restored", () => {
  setProcessUser("stdio-user");
  runWithUser("alice", () => currentUserId()); // throwaway scope
  assert.equal(currentUserId(), "stdio-user");
});

test("setProcessUser: overwriting replaces the previous value", () => {
  setProcessUser("first");
  setProcessUser("second");
  assert.equal(currentUserId(), "second");
});

test("_resetProcessUserForTest restores the throw-on-no-scope behavior", () => {
  setProcessUser("temp");
  _resetProcessUserForTest();
  assert.throws(() => currentUserId(), /outside runWithUser scope/);
});

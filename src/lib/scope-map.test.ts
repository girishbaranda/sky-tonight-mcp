import { test } from "node:test";
import assert from "node:assert/strict";
import { requiredScope, type McpRequest } from "./scope-map.js";

test("recall_log → sky-tonight:log:read", () => {
  assert.equal(
    requiredScope({ method: "tools/call", toolName: "recall_log" }),
    "sky-tonight:log:read",
  );
});

test("log_observation → sky-tonight:log:write", () => {
  assert.equal(
    requiredScope({ method: "tools/call", toolName: "log_observation" }),
    "sky-tonight:log:write",
  );
});

test("non-log tools → null (any valid token passes)", () => {
  for (const t of [
    "whats_visible_tonight",
    "next_iss_pass",
    "moon_phase",
    "deep_sky_visible_tonight",
  ]) {
    assert.equal(requiredScope({ method: "tools/call", toolName: t }), null);
  }
});

test("non-tool methods → null", () => {
  for (const m of [
    "tools/list",
    "resources/list",
    "resources/read",
    "prompts/list",
    "prompts/get",
    "initialize",
    "ping",
    "notifications/initialized",
  ] as const) {
    assert.equal(requiredScope({ method: m }), null);
  }
});

test("tools/call without toolName → null (let SDK reject the malformed call)", () => {
  assert.equal(requiredScope({ method: "tools/call" }), null);
});

test("unknown tool name → null (let SDK reject as unknown)", () => {
  assert.equal(
    requiredScope({ method: "tools/call", toolName: "no_such_tool" }),
    null,
  );
});

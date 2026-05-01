import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIdentifyObjectBody } from "./identify-object.js";

test("buildIdentifyObjectBody embeds the description verbatim", () => {
  const description = "bright reddish dot low in the southeast around 9pm, not twinkling";
  const body = buildIdentifyObjectBody({ description });
  assert.ok(body.includes(description), "body must include the user's description");
});

test("buildIdentifyObjectBody references the three relevant tools", () => {
  const body = buildIdentifyObjectBody({ description: "anything" });
  for (const toolName of ["iss_passes", "objects_visible_tonight", "deep_sky_visible_tonight"]) {
    assert.ok(body.includes(toolName), `body should reference tool ${toolName}`);
  }
});

test("buildIdentifyObjectBody mentions ruling out aircraft and meteors before identifying", () => {
  const body = buildIdentifyObjectBody({ description: "anything" });
  assert.match(body, /blinking/i);
  assert.match(body, /meteor/i);
  assert.match(body, /aircraft/i);
});

test("buildIdentifyObjectBody handles description with special characters safely", () => {
  // The description is interpolated into a template literal; ensure no quoting/escaping bugs
  // by checking that backtick / backslash / dollar sequences pass through.
  const description = "bright `dot` with $weird \\stuff";
  const body = buildIdentifyObjectBody({ description });
  assert.ok(body.includes(description), "body must preserve special characters in description");
});

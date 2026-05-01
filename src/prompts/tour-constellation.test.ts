import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTourConstellationBody } from "./tour-constellation.js";

test("buildTourConstellationBody substitutes the constellation name", () => {
  const body = buildTourConstellationBody({ name: "Orion" });
  assert.ok(body.includes("Orion"), "body should mention the constellation name");
});

test("buildTourConstellationBody references both catalog resources and the per-constellation resource template", () => {
  const body = buildTourConstellationBody({ name: "Cygnus" });
  assert.ok(body.includes("sky://catalog/constellations"));
  assert.ok(body.includes("sky://constellation/{abbr}"));
  assert.ok(body.includes("sky://catalog/messier"));
});

test("buildTourConstellationBody references the deep-sky visibility tool", () => {
  const body = buildTourConstellationBody({ name: "Cygnus" });
  assert.ok(body.includes("deep_sky_visible_tonight"));
});

test("buildTourConstellationBody warns the LLM that the resource has no RA/Dec fields", () => {
  // Guards against the LLM hallucinating fields that don't exist on the constellation record.
  const body = buildTourConstellationBody({ name: "Cygnus" });
  assert.match(body, /no RA\/Dec fields/i);
});

test("buildTourConstellationBody describes the singular brightest_star shape, not a list", () => {
  // The resource has brightest_star (singular {name, magnitude}), NOT a list of brightest stars.
  const body = buildTourConstellationBody({ name: "Cygnus" });
  assert.match(body, /brightest_star\.name/);
  assert.match(body, /single .*\{name, magnitude\}.* — NOT a list/);
});

test("buildTourConstellationBody covers both visible-tonight and not-visible branches", () => {
  const body = buildTourConstellationBody({ name: "Crux" });
  assert.match(body, /If visible tonight/);
  assert.match(body, /If NOT visible tonight/);
  assert.match(body, /best_months/);
});

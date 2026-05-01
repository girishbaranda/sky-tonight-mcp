import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlanTonightSessionBody } from "./plan-tonight-session.js";

test("buildPlanTonightSessionBody substitutes duration_min and skill_level", () => {
  const body = buildPlanTonightSessionBody({ duration_min: "120", skill_level: "intermediate" });
  assert.match(body, /120-minute/);
  assert.match(body, /intermediate observer/);
});

test("buildPlanTonightSessionBody references all four expected tools by name", () => {
  const body = buildPlanTonightSessionBody({ duration_min: "60", skill_level: "beginner" });
  for (const toolName of ["moon_phase", "objects_visible_tonight", "deep_sky_visible_tonight", "iss_passes"]) {
    assert.ok(body.includes(toolName), `body should reference tool ${toolName}`);
  }
});

test("buildPlanTonightSessionBody mentions valid type_filter values for beginners", () => {
  const body = buildPlanTonightSessionBody({ duration_min: "90", skill_level: "beginner" });
  // Must use the actual enum values: galaxy / nebula / cluster — never invented ones like "open_cluster".
  assert.match(body, /type_filter: "cluster"/);
  assert.ok(!body.includes("open_cluster"), "must not reference open_cluster as a filter value");
});

test("buildPlanTonightSessionBody prepends a validation note for an invalid skill_level", () => {
  const body = buildPlanTonightSessionBody({ duration_min: "60", skill_level: "expert" });
  assert.match(body, /skill_level must be one of/);
  assert.match(body, /The user provided: "expert"/);
});

test("buildPlanTonightSessionBody does NOT prepend a validation note for valid skill_levels", () => {
  for (const level of ["beginner", "intermediate", "advanced"]) {
    const body = buildPlanTonightSessionBody({ duration_min: "60", skill_level: level });
    assert.ok(!body.startsWith("NOTE:"), `valid level "${level}" should not produce a NOTE prefix`);
  }
});

test("buildPlanTonightSessionBody picks the correct article (a/an) for the skill_level", () => {
  // Vowel-initial levels need "an", consonant-initial need "a".
  const beginner = buildPlanTonightSessionBody({ duration_min: "60", skill_level: "beginner" });
  assert.ok(beginner.includes("for a beginner observer"), "beginner should use 'a'");

  const intermediate = buildPlanTonightSessionBody({ duration_min: "60", skill_level: "intermediate" });
  assert.ok(intermediate.includes("for an intermediate observer"), "intermediate should use 'an'");

  const advanced = buildPlanTonightSessionBody({ duration_min: "60", skill_level: "advanced" });
  assert.ok(advanced.includes("for an advanced observer"), "advanced should use 'an'");
});

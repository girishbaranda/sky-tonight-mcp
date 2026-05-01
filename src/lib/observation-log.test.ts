import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { _resetForTest, _closeForTest, _getDbForTest } from "./observation-log.js";

beforeEach(() => {
  _resetForTest(":memory:");
});

test("schema bootstrap creates the observations table with expected columns", () => {
  const conn = _getDbForTest();
  const cols = conn
    .prepare("PRAGMA table_info(observations)")
    .all() as Array<{ name: string; type: string; notnull: number }>;
  const byName = Object.fromEntries(cols.map((c) => [c.name, c]));
  const expected = [
    "id",
    "observed_at",
    "latitude",
    "longitude",
    "target",
    "notes",
    "seeing",
    "transparency",
    "equipment",
    "created_at",
  ];
  for (const name of expected) {
    assert.ok(byName[name], `missing column: ${name}`);
  }
  // NOT NULL invariants from the spec:
  assert.equal(byName.observed_at.notnull, 1);
  assert.equal(byName.latitude.notnull, 1);
  assert.equal(byName.longitude.notnull, 1);
  assert.equal(byName.target.notnull, 1);
  assert.equal(byName.created_at.notnull, 1);
});

test("schema bootstrap creates expected indexes", () => {
  const conn = _getDbForTest();
  const indexes = conn
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='observations'")
    .all() as Array<{ name: string }>;
  const names = indexes.map((i) => i.name);
  assert.ok(names.includes("idx_obs_observed_at"), `missing idx_obs_observed_at: got ${JSON.stringify(names)}`);
  assert.ok(names.includes("idx_obs_target_lower"), `missing idx_obs_target_lower: got ${JSON.stringify(names)}`);
});

test("_closeForTest closes the connection cleanly", () => {
  _closeForTest();
  // Reopening should work and re-create the schema:
  _resetForTest(":memory:");
  const conn = _getDbForTest();
  assert.ok(conn);
});

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

import { logObservation } from "./observation-log.js";

test("logObservation returns a row with assigned id and createdAt", () => {
  const row = logObservation({
    target: "Jupiter",
    latitude: 23.21,
    longitude: 72.63,
  });
  assert.equal(typeof row.id, "number");
  assert.ok(row.id > 0);
  assert.equal(row.target, "Jupiter");
  assert.equal(row.latitude, 23.21);
  assert.equal(row.longitude, 72.63);
  assert.match(row.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.match(row.observedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test("logObservation defaults observedAt to now when omitted", () => {
  const before = Date.now();
  const row = logObservation({ target: "Saturn", latitude: 0, longitude: 0 });
  const after = Date.now();
  const obsTime = new Date(row.observedAt).getTime();
  assert.ok(obsTime >= before && obsTime <= after, `observedAt ${row.observedAt} not within [${before}, ${after}]`);
});

test("logObservation honors explicit observedAt", () => {
  const t = new Date("2026-01-15T20:00:00.000Z");
  const row = logObservation({ target: "Mars", latitude: 0, longitude: 0, observedAt: t });
  assert.equal(row.observedAt, "2026-01-15T20:00:00.000Z");
});

test("logObservation leaves optional fields NULL when omitted", () => {
  const row = logObservation({ target: "M31", latitude: 0, longitude: 0 });
  assert.equal(row.notes, null);
  assert.equal(row.seeing, null);
  assert.equal(row.transparency, null);
  assert.equal(row.equipment, null);
});

test("logObservation persists optional fields when supplied", () => {
  const row = logObservation({
    target: "M42",
    latitude: 0,
    longitude: 0,
    notes: "great detail in the trapezium",
    seeing: 4,
    transparency: 5,
    equipment: '8" Dob',
  });
  assert.equal(row.notes, "great detail in the trapezium");
  assert.equal(row.seeing, 4);
  assert.equal(row.transparency, 5);
  assert.equal(row.equipment, '8" Dob');
});

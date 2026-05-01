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

import { recallObservations } from "./observation-log.js";

test("recallObservations returns rows newest-first", () => {
  logObservation({ target: "A", latitude: 0, longitude: 0, observedAt: new Date("2026-01-01T00:00:00.000Z") });
  logObservation({ target: "C", latitude: 0, longitude: 0, observedAt: new Date("2026-03-01T00:00:00.000Z") });
  logObservation({ target: "B", latitude: 0, longitude: 0, observedAt: new Date("2026-02-01T00:00:00.000Z") });
  const rows = recallObservations({});
  assert.deepEqual(rows.map((r) => r.target), ["C", "B", "A"]);
});

test("recallObservations target filter is substring + case-insensitive", () => {
  logObservation({ target: "Jupiter", latitude: 0, longitude: 0 });
  logObservation({ target: "Saturn", latitude: 0, longitude: 0 });
  logObservation({ target: "jupiter at opposition", latitude: 0, longitude: 0 });
  const rows = recallObservations({ target: "JuP" });
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.target.toLowerCase().includes("jup")));
});

test("recallObservations since/until are inclusive on both ends", () => {
  logObservation({ target: "x", latitude: 0, longitude: 0, observedAt: new Date("2026-01-01T00:00:00.000Z") });
  logObservation({ target: "y", latitude: 0, longitude: 0, observedAt: new Date("2026-02-15T00:00:00.000Z") });
  logObservation({ target: "z", latitude: 0, longitude: 0, observedAt: new Date("2026-03-31T00:00:00.000Z") });
  // Outside the window:
  logObservation({ target: "w", latitude: 0, longitude: 0, observedAt: new Date("2025-12-31T23:59:59.999Z") });
  logObservation({ target: "v", latitude: 0, longitude: 0, observedAt: new Date("2026-04-01T00:00:00.001Z") });
  const rows = recallObservations({
    since: new Date("2026-01-01T00:00:00.000Z"),
    until: new Date("2026-03-31T00:00:00.000Z"),
  });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.target).sort(), ["x", "y", "z"]);
});

test("recallObservations minSeeing excludes NULL and below threshold", () => {
  logObservation({ target: "a", latitude: 0, longitude: 0 });               // seeing NULL
  logObservation({ target: "b", latitude: 0, longitude: 0, seeing: 2 });    // below
  logObservation({ target: "c", latitude: 0, longitude: 0, seeing: 4 });    // qualifies
  logObservation({ target: "d", latitude: 0, longitude: 0, seeing: 5 });    // qualifies
  const rows = recallObservations({ minSeeing: 4 });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.target).sort(), ["c", "d"]);
});

test("recallObservations limit defaults to 20", () => {
  for (let i = 0; i < 25; i++) {
    logObservation({ target: `t${i}`, latitude: 0, longitude: 0 });
  }
  const rows = recallObservations({});
  assert.equal(rows.length, 20);
});

test("recallObservations limit caps at 100", () => {
  for (let i = 0; i < 150; i++) {
    logObservation({ target: `t${i}`, latitude: 0, longitude: 0 });
  }
  const rows = recallObservations({ limit: 999 });
  assert.equal(rows.length, 100);
});

test("recallObservations rejects limit <= 0", () => {
  assert.throws(() => recallObservations({ limit: 0 }), /limit/);
  assert.throws(() => recallObservations({ limit: -1 }), /limit/);
});

test("recallObservations combines target + minSeeing", () => {
  logObservation({ target: "Jupiter", latitude: 0, longitude: 0, seeing: 3 });
  logObservation({ target: "Jupiter", latitude: 0, longitude: 0, seeing: 5 });
  logObservation({ target: "Saturn",  latitude: 0, longitude: 0, seeing: 5 });
  const rows = recallObservations({ target: "jup", minSeeing: 4 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].target, "Jupiter");
  assert.equal(rows[0].seeing, 5);
});

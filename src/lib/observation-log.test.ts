import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { _resetForTest, _closeForTest, _getDbForTest } from "./observation-log.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

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
    "user_id",
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
  assert.equal(byName.user_id.notnull, 1);
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
  assert.ok(names.includes("idx_obs_user_observed_at"), `missing idx_obs_user_observed_at: got ${JSON.stringify(names)}`);
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
    userId: "local",
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
  const row = logObservation({ userId: "local", target: "Saturn", latitude: 0, longitude: 0 });
  const after = Date.now();
  const obsTime = new Date(row.observedAt).getTime();
  assert.ok(obsTime >= before && obsTime <= after, `observedAt ${row.observedAt} not within [${before}, ${after}]`);
});

test("logObservation honors explicit observedAt", () => {
  const t = new Date("2026-01-15T20:00:00.000Z");
  const row = logObservation({ userId: "local", target: "Mars", latitude: 0, longitude: 0, observedAt: t });
  assert.equal(row.observedAt, "2026-01-15T20:00:00.000Z");
});

test("logObservation leaves optional fields NULL when omitted", () => {
  const row = logObservation({ userId: "local", target: "M31", latitude: 0, longitude: 0 });
  assert.equal(row.notes, null);
  assert.equal(row.seeing, null);
  assert.equal(row.transparency, null);
  assert.equal(row.equipment, null);
});

test("logObservation persists optional fields when supplied", () => {
  const row = logObservation({
    userId: "local",
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
  logObservation({ userId: "local", target: "A", latitude: 0, longitude: 0, observedAt: new Date("2026-01-01T00:00:00.000Z") });
  logObservation({ userId: "local", target: "C", latitude: 0, longitude: 0, observedAt: new Date("2026-03-01T00:00:00.000Z") });
  logObservation({ userId: "local", target: "B", latitude: 0, longitude: 0, observedAt: new Date("2026-02-01T00:00:00.000Z") });
  const rows = recallObservations({ userId: "local" });
  assert.deepEqual(rows.map((r) => r.target), ["C", "B", "A"]);
});

test("recallObservations target filter is substring + case-insensitive", () => {
  logObservation({ userId: "local", target: "Jupiter", latitude: 0, longitude: 0 });
  logObservation({ userId: "local", target: "Saturn", latitude: 0, longitude: 0 });
  logObservation({ userId: "local", target: "jupiter at opposition", latitude: 0, longitude: 0 });
  const rows = recallObservations({ userId: "local", target: "JuP" });
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.target.toLowerCase().includes("jup")));
});

test("recallObservations since/until are inclusive on both ends", () => {
  logObservation({ userId: "local", target: "x", latitude: 0, longitude: 0, observedAt: new Date("2026-01-01T00:00:00.000Z") });
  logObservation({ userId: "local", target: "y", latitude: 0, longitude: 0, observedAt: new Date("2026-02-15T00:00:00.000Z") });
  logObservation({ userId: "local", target: "z", latitude: 0, longitude: 0, observedAt: new Date("2026-03-31T00:00:00.000Z") });
  // Outside the window:
  logObservation({ userId: "local", target: "w", latitude: 0, longitude: 0, observedAt: new Date("2025-12-31T23:59:59.999Z") });
  logObservation({ userId: "local", target: "v", latitude: 0, longitude: 0, observedAt: new Date("2026-04-01T00:00:00.001Z") });
  const rows = recallObservations({
    userId: "local",
    since: new Date("2026-01-01T00:00:00.000Z"),
    until: new Date("2026-03-31T00:00:00.000Z"),
  });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.target).sort(), ["x", "y", "z"]);
});

test("recallObservations minSeeing excludes NULL and below threshold", () => {
  logObservation({ userId: "local", target: "a", latitude: 0, longitude: 0 });               // seeing NULL
  logObservation({ userId: "local", target: "b", latitude: 0, longitude: 0, seeing: 2 });    // below
  logObservation({ userId: "local", target: "c", latitude: 0, longitude: 0, seeing: 4 });    // qualifies
  logObservation({ userId: "local", target: "d", latitude: 0, longitude: 0, seeing: 5 });    // qualifies
  const rows = recallObservations({ userId: "local", minSeeing: 4 });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.target).sort(), ["c", "d"]);
});

test("recallObservations limit defaults to 20", () => {
  for (let i = 0; i < 25; i++) {
    logObservation({ userId: "local", target: `t${i}`, latitude: 0, longitude: 0 });
  }
  const rows = recallObservations({ userId: "local" });
  assert.equal(rows.length, 20);
});

test("recallObservations limit caps at 100", () => {
  for (let i = 0; i < 150; i++) {
    logObservation({ userId: "local", target: `t${i}`, latitude: 0, longitude: 0 });
  }
  const rows = recallObservations({ userId: "local", limit: 999 });
  assert.equal(rows.length, 100);
});

test("recallObservations rejects limit <= 0", () => {
  assert.throws(() => recallObservations({ userId: "local", limit: 0 }), /limit/);
  assert.throws(() => recallObservations({ userId: "local", limit: -1 }), /limit/);
});

test("recallObservations combines target + minSeeing", () => {
  logObservation({ userId: "local", target: "Jupiter", latitude: 0, longitude: 0, seeing: 3 });
  logObservation({ userId: "local", target: "Jupiter", latitude: 0, longitude: 0, seeing: 5 });
  logObservation({ userId: "local", target: "Saturn",  latitude: 0, longitude: 0, seeing: 5 });
  const rows = recallObservations({ userId: "local", target: "jup", minSeeing: 4 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].target, "Jupiter");
  assert.equal(rows[0].seeing, 5);
});

test("migration: opening a v0.5-shaped DB adds user_id column with default 'local'", () => {
  // 1. Create a temp DB in the v0.5 schema (no user_id column).
  const dir = mkdtempSync(join(tmpdir(), "sky-mig-"));
  const dbPath = join(dir, "obs.db");
  try {
    const conn = new Database(dbPath);
    conn.pragma("journal_mode = WAL");
    conn.exec(`
      CREATE TABLE observations (
        id           INTEGER PRIMARY KEY,
        observed_at  TEXT    NOT NULL,
        latitude     REAL    NOT NULL,
        longitude    REAL    NOT NULL,
        target       TEXT    NOT NULL,
        notes        TEXT,
        seeing       INTEGER,
        transparency INTEGER,
        equipment    TEXT,
        created_at   TEXT    NOT NULL
      );
      CREATE INDEX idx_obs_observed_at ON observations(observed_at);
      CREATE INDEX idx_obs_target_lower ON observations(LOWER(target));
    `);
    conn.prepare(
      `INSERT INTO observations (observed_at, latitude, longitude, target, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run("2026-04-01T20:00:00.000Z", 23.21, 72.63, "Saturn", "2026-04-01T20:00:00.000Z");
    conn.close();

    // 2. Re-open with the v0.6 lib code.
    _resetForTest(dbPath);

    // 3. Assert column was added.
    const conn2 = _getDbForTest();
    const cols = conn2
      .prepare("PRAGMA table_info(observations)")
      .all() as Array<{ name: string; notnull: number; dflt_value: string | null }>;
    const userIdCol = cols.find((c) => c.name === "user_id");
    assert.ok(userIdCol, "expected user_id column after migration");
    assert.equal(userIdCol!.notnull, 1);

    // 4. Assert legacy row recallable as user "local".
    const rows = recallObservations({ userId: "local", target: "Saturn" });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].target, "Saturn");
    assert.equal(rows[0].userId, "local");

    // 5. Assert the migrated DB doesn't surface that row to a different user.
    const empty = recallObservations({ userId: "alice", target: "Saturn" });
    assert.equal(empty.length, 0);

    _closeForTest();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("per-user isolation: alice and bob see only their own rows", () => {
  logObservation({ userId: "alice", target: "Jupiter", latitude: 0, longitude: 0 });
  logObservation({ userId: "alice", target: "Saturn", latitude: 0, longitude: 0 });
  logObservation({ userId: "bob",   target: "Mars", latitude: 0, longitude: 0 });

  const aliceRows = recallObservations({ userId: "alice" });
  const bobRows = recallObservations({ userId: "bob" });

  assert.deepEqual(aliceRows.map((r) => r.target).sort(), ["Jupiter", "Saturn"]);
  assert.deepEqual(bobRows.map((r) => r.target), ["Mars"]);
  assert.ok(aliceRows.every((r) => r.userId === "alice"));
  assert.ok(bobRows.every((r) => r.userId === "bob"));
});

test("logObservation returns userId on the row", () => {
  const row = logObservation({ userId: "alice", target: "M31", latitude: 0, longitude: 0 });
  assert.equal(row.userId, "alice");
});

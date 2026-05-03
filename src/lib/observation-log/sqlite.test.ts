import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { SqliteBackend } from "./sqlite.js";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let backend: SqliteBackend;

beforeEach(() => {
  backend = new SqliteBackend(":memory:");
});

afterEach(async () => {
  await backend.close();
});

test("schema bootstrap creates the observations table with expected columns", async () => {
  // Trigger migrationsReady before reading schema synchronously.
  await backend.query({ userId: "u" });
  const conn = backend._getConnForTest();
  const cols = conn
    .prepare("PRAGMA table_info(observations)")
    .all() as Array<{ name: string; notnull: number }>;
  const byName = Object.fromEntries(cols.map((c) => [c.name, c]));
  for (const name of [
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
  ]) {
    assert.ok(byName[name], `missing column: ${name}`);
  }
  assert.equal(byName.user_id.notnull, 1);
  assert.equal(byName.observed_at.notnull, 1);
});

test("schema bootstrap creates the user/observed_at composite index", async () => {
  await backend.query({ userId: "u" });
  const conn = backend._getConnForTest();
  const idx = conn
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='observations'")
    .all() as Array<{ name: string }>;
  assert.ok(idx.some((i) => i.name === "idx_obs_user_observed_at"));
});

test("ALTER from v0.5 schema (no user_id) backfills with 'local'", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sky-tonight-test-"));
  const dbPath = join(dir, "v0.5.db");

  // Hand-build a v0.5 schema (no user_id column)
  const seed = new Database(dbPath);
  seed.exec(`
    CREATE TABLE observations (
      id INTEGER PRIMARY KEY,
      observed_at TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      target TEXT NOT NULL,
      notes TEXT,
      seeing INTEGER,
      transparency INTEGER,
      equipment TEXT,
      created_at TEXT NOT NULL
    );
  `);
  seed
    .prepare(
      "INSERT INTO observations (observed_at, latitude, longitude, target, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run("2026-01-01T00:00:00.000Z", 23.0, 72.5, "Jupiter", "2026-01-01T00:00:00.000Z");
  seed.close();

  // Re-open via SqliteBackend and confirm the migration ran.
  const b = new SqliteBackend(dbPath);
  // Trigger migrationsReady to settle before inspecting schema.
  await b.query({ userId: "local" });
  const conn = b._getConnForTest();
  const cols = conn.prepare("PRAGMA table_info(observations)").all() as Array<{ name: string }>;
  assert.ok(cols.some((c) => c.name === "user_id"));
  const row = conn.prepare("SELECT user_id FROM observations WHERE target = ?").get("Jupiter") as { user_id: string };
  assert.equal(row.user_id, "local");

  await b.close();
  rmSync(dir, { recursive: true, force: true });
});

test("_migrations table records applied versions on a fresh DB", async () => {
  // beforeEach already constructed a fresh in-memory backend; let migrationsReady settle.
  // Trigger it by running a query (insert/query both await migrationsReady).
  await backend.query({ userId: "u" });
  const conn = backend._getConnForTest();
  const rows = conn
    .prepare("SELECT version FROM _migrations ORDER BY version ASC")
    .all() as Array<{ version: number }>;
  assert.deepEqual(
    rows.map((r) => r.version),
    [1, 2],
  );
});

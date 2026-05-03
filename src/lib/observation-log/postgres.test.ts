import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { newDb, type IMemoryDb } from "pg-mem";
import { PostgresBackend } from "./postgres.js";

let mem: IMemoryDb;
let backend: PostgresBackend;

beforeEach(async () => {
  mem = newDb({ autoCreateForeignKeyIndices: true });
  // pg-mem exposes a Pool-compatible adapter via mem.adapters.createPg().
  const pgAdapter = mem.adapters.createPg();
  backend = new PostgresBackend({ poolOverrideForTest: new pgAdapter.Pool() });
});

afterEach(async () => {
  await backend.close();
});

test("insert + query roundtrip", async () => {
  const row = await backend.insert({
    userId: "user-a",
    target: "Jupiter",
    latitude: 23.0,
    longitude: 72.5,
    seeing: 4,
  });
  assert.equal(row.userId, "user-a");
  assert.equal(row.target, "Jupiter");
  assert.equal(row.seeing, 4);
  assert.equal(typeof row.id, "number");
  assert.match(row.observedAt, /^\d{4}-\d{2}-\d{2}T/);

  const rows = await backend.query({ userId: "user-a" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].target, "Jupiter");
});

test("query filters by user_id (per-user isolation)", async () => {
  await backend.insert({ userId: "alice", target: "M31", latitude: 0, longitude: 0 });
  await backend.insert({ userId: "bob", target: "M42", latitude: 0, longitude: 0 });

  const aliceRows = await backend.query({ userId: "alice" });
  assert.equal(aliceRows.length, 1);
  assert.equal(aliceRows[0].target, "M31");

  const bobRows = await backend.query({ userId: "bob" });
  assert.equal(bobRows.length, 1);
  assert.equal(bobRows[0].target, "M42");
});

test("query target filter is case-insensitive substring", async () => {
  await backend.insert({ userId: "u", target: "Jupiter", latitude: 0, longitude: 0 });
  await backend.insert({ userId: "u", target: "Saturn", latitude: 0, longitude: 0 });
  const rows = await backend.query({ userId: "u", target: "JUP" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].target, "Jupiter");
});

test("query date range filter", async () => {
  await backend.insert({
    userId: "u",
    target: "T1",
    latitude: 0,
    longitude: 0,
    observedAt: new Date("2026-01-15T00:00:00Z"),
  });
  await backend.insert({
    userId: "u",
    target: "T2",
    latitude: 0,
    longitude: 0,
    observedAt: new Date("2026-03-15T00:00:00Z"),
  });
  const rows = await backend.query({
    userId: "u",
    since: new Date("2026-02-01T00:00:00Z"),
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].target, "T2");
});

test("query limit defaults to 20, caps at 100, rejects <= 0", async () => {
  for (let i = 0; i < 25; i++) {
    await backend.insert({
      userId: "u",
      target: `t${i}`,
      latitude: 0,
      longitude: 0,
    });
  }
  assert.equal((await backend.query({ userId: "u" })).length, 20);
  assert.equal((await backend.query({ userId: "u", limit: 100 })).length, 25);
  assert.equal((await backend.query({ userId: "u", limit: 1000 })).length, 25); // cap
  await assert.rejects(() => backend.query({ userId: "u", limit: 0 }));
  await assert.rejects(() => backend.query({ userId: "u", limit: -1 }));
});

test("migrations table is populated on first connect", async () => {
  // Direct SQL through pg-mem's pool.
  const pool = backend._getPoolForTest();
  // Need to settle migrationsReady first. Trigger via a query.
  await backend.query({ userId: "settle" });
  const r = await pool.query("SELECT version FROM _migrations ORDER BY version ASC");
  assert.deepEqual(
    r.rows.map((row: { version: number }) => row.version),
    [1, 2],
  );
});

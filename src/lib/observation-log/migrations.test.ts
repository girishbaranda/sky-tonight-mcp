import { test } from "node:test";
import assert from "node:assert/strict";
import { runMigrations, type MigrationAdapter } from "./migrations.js";

interface FakeState {
  applied: number[];
  ddlExecutions: { version: number; sql: string }[];
}

function makeFakeAdapter(
  engine: "sqlite" | "postgres" = "sqlite",
  initialSchema: { hasObservationsTable: boolean; hasUserIdColumn: boolean } = {
    hasObservationsTable: false,
    hasUserIdColumn: false,
  },
): { adapter: MigrationAdapter; state: FakeState } {
  const state: FakeState = { applied: [], ddlExecutions: [] };
  const adapter: MigrationAdapter = {
    engine,
    async ensureMigrationsTable() {},
    async getApplied() {
      return [...state.applied];
    },
    async applyMigration(version, sql) {
      state.ddlExecutions.push({ version, sql });
      state.applied.push(version);
    },
    async inspectExistingSchema() {
      return initialSchema;
    },
  };
  return { adapter, state };
}

test("runMigrations on empty DB applies every migration in order", async () => {
  const { adapter, state } = makeFakeAdapter();
  await runMigrations(adapter);
  assert.deepEqual(state.applied, [1, 2]);
  assert.equal(state.ddlExecutions.length, 2);
  assert.equal(state.ddlExecutions[0].version, 1);
  assert.equal(state.ddlExecutions[1].version, 2);
  assert.match(state.ddlExecutions[0].sql, /CREATE TABLE/i);
  assert.match(state.ddlExecutions[1].sql, /ADD COLUMN/i);
});

test("runMigrations is a no-op when all versions already applied", async () => {
  const { adapter, state } = makeFakeAdapter();
  state.applied.push(1, 2);
  await runMigrations(adapter);
  assert.equal(state.ddlExecutions.length, 0);
});

test("runMigrations skips already-applied versions and runs only the rest", async () => {
  const { adapter, state } = makeFakeAdapter();
  state.applied.push(1);
  await runMigrations(adapter);
  assert.deepEqual(state.applied, [1, 2]);
  assert.equal(state.ddlExecutions.length, 1);
  assert.equal(state.ddlExecutions[0].version, 2);
});

test("runMigrations against v0.6 SQLite (observations + user_id, no _migrations) stamps without re-running DDL", async () => {
  const { adapter, state } = makeFakeAdapter("sqlite", {
    hasObservationsTable: true,
    hasUserIdColumn: true,
  });
  await runMigrations(adapter);
  assert.deepEqual(state.applied, [1, 2]);
  // Stamping passes comment-only SQL — it gets recorded but is a no-op DDL.
  // Filter out comment-only entries to verify no real DDL ran.
  const realDdl = state.ddlExecutions.filter((e) => !e.sql.includes("stamped"));
  assert.equal(realDdl.length, 0);
});

test("runMigrations against pre-v0.6 SQLite (observations, no user_id) stamps version 1, runs version 2", async () => {
  const { adapter, state } = makeFakeAdapter("sqlite", {
    hasObservationsTable: true,
    hasUserIdColumn: false,
  });
  await runMigrations(adapter);
  assert.deepEqual(state.applied, [1, 2]);
  // Version 1 is stamped (comment); version 2 runs real DDL (ADD COLUMN).
  const realDdl = state.ddlExecutions.filter((e) => !e.sql.includes("stamped"));
  assert.equal(realDdl.length, 1);
  assert.equal(realDdl[0].version, 2);
  assert.match(realDdl[0].sql, /ADD COLUMN/i);
});

test("runMigrations on Postgres adapter loads .postgres.sql files", async () => {
  const { adapter, state } = makeFakeAdapter("postgres");
  await runMigrations(adapter);
  assert.equal(state.ddlExecutions.length, 2);
  // Postgres init contains BIGSERIAL (Postgres-specific syntax).
  assert.match(state.ddlExecutions[0].sql, /BIGSERIAL|GENERATED/i);
});

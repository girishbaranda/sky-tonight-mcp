/**
 * File-based migration runner.
 *
 * Reads numbered SQL files from migrations/ at the package root, applies any
 * unrecorded ones in order. Stamp-detects existing v0.6-shape SQLite databases
 * (observations table exists, may or may not have user_id) and records their
 * version in _migrations without re-running the DDL.
 *
 * Engine-agnostic and async: SqliteBackend (sync internally, wraps in
 * Promise.resolve) and PostgresBackend (native promises) both implement
 * MigrationAdapter. Migration files come in two flavors per version
 * (.sqlite.sql and .postgres.sql); the runner picks the one matching
 * the adapter's engine.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type Engine = "sqlite" | "postgres";

export interface MigrationAdapter {
  engine: Engine;
  /** Create the _migrations table if absent. Idempotent. */
  ensureMigrationsTable(): Promise<void>;
  /** All applied versions, ascending. */
  getApplied(): Promise<number[]>;
  /** Run a migration's DDL inside a transaction and record the version. */
  applyMigration(version: number, sql: string): Promise<void>;
  /**
   * Inspect the existing schema for stamp-detection. Called once before
   * deciding what to apply.
   */
  inspectExistingSchema(): Promise<{ hasObservationsTable: boolean; hasUserIdColumn: boolean }>;
}

/** All migration versions known to this build, in order. */
export const ALL_VERSIONS = [1, 2] as const;

function migrationsDir(): string {
  // From src/lib/observation-log/migrations.ts → ../../../migrations
  // From dist/lib/observation-log/migrations.js → same.
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "..", "migrations");
}

function loadMigration(version: number, engine: Engine): string {
  const padded = String(version).padStart(3, "0");
  const name = version === 1 ? "init" : version === 2 ? "add_user_id" : `v${version}`;
  const path = join(migrationsDir(), `${padded}_${name}.${engine}.sql`);
  return readFileSync(path, "utf8");
}

export async function runMigrations(adapter: MigrationAdapter): Promise<void> {
  await adapter.ensureMigrationsTable();
  let applied = await adapter.getApplied();

  // Stamp-detect: if _migrations is empty but the observations table already
  // exists, this is a pre-runner database. Stamp it instead of running DDL.
  if (applied.length === 0) {
    const schema = await adapter.inspectExistingSchema();
    if (schema.hasObservationsTable) {
      // Version 1 is always present if observations exists.
      await adapter.applyMigration(1, "/* stamped: pre-existing schema */");
      if (schema.hasUserIdColumn) {
        await adapter.applyMigration(2, "/* stamped: pre-existing user_id */");
      }
      applied = await adapter.getApplied();
    }
  }

  for (const v of ALL_VERSIONS) {
    if (applied.includes(v)) continue;
    const sql = loadMigration(v, adapter.engine);
    await adapter.applyMigration(v, sql);
  }
}

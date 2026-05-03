/**
 * Observation log — public surface and backend dispatcher.
 *
 * Backend selection at module-init: DATABASE_URL set → PostgresBackend (Task 10).
 * Otherwise SqliteBackend, with path from SKY_TONIGHT_DB or default.
 *
 * Tools (log_observation, recall_log) call logObservation()/recallObservations()
 * and never see SQL or driver objects.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { SqliteBackend } from "./observation-log/sqlite.js";
import { PostgresBackend } from "./observation-log/postgres.js";
import type { StorageBackend } from "./observation-log/backend.js";

let backend: StorageBackend | null = null;

function defaultDbPath(): string {
  return join(homedir(), ".sky-tonight", "observations.db");
}

function resolveSqlitePath(): string {
  const override = process.env.SKY_TONIGHT_DB;
  return override && override.length > 0 ? override : defaultDbPath();
}

function makeBackend(): StorageBackend {
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl && dbUrl.length > 0) {
    return new PostgresBackend({ connectionString: dbUrl });
  }
  return new SqliteBackend(resolveSqlitePath());
}

function getBackend(): StorageBackend {
  if (!backend) backend = makeBackend();
  return backend;
}

// --- Test-only helpers (underscore prefix). Not consumed by tools.

export async function _resetForTest(dbPath?: string): Promise<void> {
  if (backend) {
    await backend.close();
    backend = null;
  }
  backend = new SqliteBackend(dbPath ?? ":memory:");
}

export async function _closeForTest(): Promise<void> {
  if (backend) {
    await backend.close();
    backend = null;
  }
}

/** Test-only: reach into the SQLite backend for direct schema inspection. */
export function _getSqliteConnForTest(): import("better-sqlite3").Database {
  const b = getBackend();
  if (!(b instanceof SqliteBackend)) {
    throw new Error("_getSqliteConnForTest called on non-SQLite backend");
  }
  return b._getConnForTest();
}

// --- Public types

export interface ObservationInput {
  userId: string;
  target: string;
  latitude: number;
  longitude: number;
  observedAt?: Date;
  notes?: string;
  seeing?: number;       // 1..5
  transparency?: number; // 1..5
  equipment?: string;
}

export interface Observation {
  id: number;
  userId: string;
  target: string;
  latitude: number;
  longitude: number;
  observedAt: string;    // ISO 8601 UTC, ms precision
  notes: string | null;
  seeing: number | null;
  transparency: number | null;
  equipment: string | null;
  createdAt: string;     // ISO 8601 UTC, ms precision
}

export interface RecallFilters {
  userId: string;
  target?: string;       // substring, case-insensitive
  since?: Date;
  until?: Date;
  minSeeing?: number;    // 1..5
  limit?: number;        // default 20, capped at 100, must be >= 1
}

// --- Public API

export async function logObservation(input: ObservationInput): Promise<Observation> {
  return getBackend().insert(input);
}

export async function recallObservations(filters: RecallFilters): Promise<Observation[]> {
  return getBackend().query(filters);
}

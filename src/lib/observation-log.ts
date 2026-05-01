/**
 * Observation log — the only stateful part of the server.
 *
 * SQLite (via better-sqlite3) is the backing store. This file is the single
 * source of truth for all SQL; tools call `logObservation` and
 * `recallObservations` and never see the driver. That boundary is what makes
 * the future Postgres swap mechanical.
 *
 * Path: $SKY_TONIGHT_DB if set, otherwise ~/.sky-tonight/observations.db.
 * Pass ":memory:" via the env var (or _resetForTest) to use an in-process DB.
 */
import Database from "better-sqlite3";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

let db: Database.Database | null = null;

function defaultDbPath(): string {
  return join(homedir(), ".sky-tonight", "observations.db");
}

function resolveDbPath(): string {
  const override = process.env.SKY_TONIGHT_DB;
  return override && override.length > 0 ? override : defaultDbPath();
}

function openDb(path: string): Database.Database {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const conn = new Database(path);
  conn.pragma("journal_mode = WAL");
  conn.pragma("foreign_keys = ON");
  conn.exec(`
    CREATE TABLE IF NOT EXISTS observations (
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
    CREATE INDEX IF NOT EXISTS idx_obs_observed_at ON observations(observed_at);
    CREATE INDEX IF NOT EXISTS idx_obs_target_lower ON observations(LOWER(target));
  `);
  return conn;
}

function getDb(): Database.Database {
  if (!db) db = openDb(resolveDbPath());
  return db;
}

// --- Test-only helpers (underscore prefix). Not consumed by tools.

export function _resetForTest(dbPath?: string): void {
  if (db) {
    db.close();
    db = null;
  }
  db = openDb(dbPath ?? ":memory:");
}

export function _closeForTest(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function _getDbForTest(): Database.Database {
  return getDb();
}

// --- Public types

export interface ObservationInput {
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

interface Row {
  id: number;
  observed_at: string;
  latitude: number;
  longitude: number;
  target: string;
  notes: string | null;
  seeing: number | null;
  transparency: number | null;
  equipment: string | null;
  created_at: string;
}

function rowToObservation(r: Row): Observation {
  return {
    id: r.id,
    target: r.target,
    latitude: r.latitude,
    longitude: r.longitude,
    observedAt: r.observed_at,
    notes: r.notes,
    seeing: r.seeing,
    transparency: r.transparency,
    equipment: r.equipment,
    createdAt: r.created_at,
  };
}

// --- Public API

export function logObservation(input: ObservationInput): Observation {
  const conn = getDb();
  const observedAt = (input.observedAt ?? new Date()).toISOString();
  const createdAt = new Date().toISOString();
  const stmt = conn.prepare(`
    INSERT INTO observations
      (observed_at, latitude, longitude, target, notes, seeing, transparency, equipment, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `);
  const row = stmt.get(
    observedAt,
    input.latitude,
    input.longitude,
    input.target,
    input.notes ?? null,
    input.seeing ?? null,
    input.transparency ?? null,
    input.equipment ?? null,
    createdAt,
  ) as Row;
  return rowToObservation(row);
}

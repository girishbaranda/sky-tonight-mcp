/**
 * SQLite implementation of StorageBackend.
 *
 * Default backend when DATABASE_URL is unset. Path is resolved by the caller
 * (observation-log.ts) — this file just wraps a Database handle.
 */
import Database from "better-sqlite3";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import type { StorageBackend } from "./backend.js";
import type { Observation, ObservationInput, RecallFilters } from "../observation-log.js";
import { runMigrations, type MigrationAdapter } from "./migrations.js";

interface Row {
  id: number;
  user_id: string;
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
    userId: r.user_id,
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

export class SqliteBackend implements StorageBackend {
  private readonly conn: Database.Database;
  private migrationsReady: Promise<void>;

  constructor(path: string) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    const conn = new Database(path);
    conn.pragma("journal_mode = WAL");
    conn.pragma("foreign_keys = ON");
    this.conn = conn;
    this.migrationsReady = runMigrations(this.makeAdapter());
  }

  private makeAdapter(): MigrationAdapter {
    const conn = this.conn;
    return {
      engine: "sqlite",
      async ensureMigrationsTable() {
        conn.exec(`
          CREATE TABLE IF NOT EXISTS _migrations (
            version    INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
          )
        `);
      },
      async getApplied() {
        const rows = conn
          .prepare("SELECT version FROM _migrations ORDER BY version ASC")
          .all() as Array<{ version: number }>;
        return rows.map((r) => r.version);
      },
      async applyMigration(version, sql) {
        const tx = conn.transaction(() => {
          conn.exec(sql);
          conn.prepare("INSERT INTO _migrations (version) VALUES (?)").run(version);
        });
        tx();
      },
      async inspectExistingSchema() {
        const tableRow = conn
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='observations'",
          )
          .get();
        const hasObservationsTable = !!tableRow;
        let hasUserIdColumn = false;
        if (hasObservationsTable) {
          const cols = conn
            .prepare("PRAGMA table_info(observations)")
            .all() as Array<{ name: string }>;
          hasUserIdColumn = cols.some((c) => c.name === "user_id");
        }
        return { hasObservationsTable, hasUserIdColumn };
      },
    };
  }

  async insert(input: ObservationInput): Promise<Observation> {
    await this.migrationsReady;
    const observedAt = (input.observedAt ?? new Date()).toISOString();
    const createdAt = new Date().toISOString();
    const stmt = this.conn.prepare(`
      INSERT INTO observations
        (user_id, observed_at, latitude, longitude, target, notes, seeing, transparency, equipment, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `);
    const row = stmt.get(
      input.userId,
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

  async query(filters: RecallFilters): Promise<Observation[]> {
    await this.migrationsReady;
    let limit = filters.limit ?? 20;
    if (!Number.isFinite(limit) || limit <= 0) {
      throw new Error(`recallObservations: limit must be > 0 (got ${filters.limit})`);
    }
    if (limit > 100) limit = 100;

    const where: string[] = ["user_id = ?"];
    const params: (string | number)[] = [filters.userId];
    if (filters.target) {
      where.push("LOWER(target) LIKE LOWER(?)");
      params.push(`%${filters.target}%`);
    }
    if (filters.since) {
      where.push("observed_at >= ?");
      params.push(filters.since.toISOString());
    }
    if (filters.until) {
      where.push("observed_at <= ?");
      params.push(filters.until.toISOString());
    }
    if (filters.minSeeing != null) {
      where.push("seeing IS NOT NULL AND seeing >= ?");
      params.push(filters.minSeeing);
    }

    const whereSql = `WHERE ${where.join(" AND ")}`;
    const stmt = this.conn.prepare(
      `SELECT * FROM observations ${whereSql} ORDER BY observed_at DESC, id DESC LIMIT ?`,
    );
    const rows = stmt.all(...params, limit) as Row[];
    return rows.map(rowToObservation);
  }

  async close(): Promise<void> {
    this.conn.close();
  }

  /** Test-only: expose the underlying Database for direct schema queries. */
  _getConnForTest(): Database.Database {
    return this.conn;
  }
}

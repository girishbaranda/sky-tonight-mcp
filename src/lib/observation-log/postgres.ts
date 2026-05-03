/**
 * Postgres implementation of StorageBackend.
 *
 * Selected when DATABASE_URL is set. Uses node-postgres (pg) Pool for
 * connection management. Migrations run async on construction and each
 * insert/query awaits the migrationsReady promise.
 */
import { Pool, type Pool as PoolType } from "pg";
import { runMigrations, type MigrationAdapter } from "./migrations.js";
import type { StorageBackend } from "./backend.js";
import type { Observation, ObservationInput, RecallFilters } from "../observation-log.js";

interface Row {
  id: number | string;
  user_id: string;
  observed_at: string;
  latitude: number | string;
  longitude: number | string;
  target: string;
  notes: string | null;
  seeing: number | null;
  transparency: number | null;
  equipment: string | null;
  created_at: string;
}

function rowToObservation(r: Row): Observation {
  return {
    id: Number(r.id),
    userId: r.user_id,
    target: r.target,
    latitude: Number(r.latitude),
    longitude: Number(r.longitude),
    observedAt: r.observed_at,
    notes: r.notes,
    seeing: r.seeing,
    transparency: r.transparency,
    equipment: r.equipment,
    createdAt: r.created_at,
  };
}

interface ConstructorArgs {
  connectionString?: string;
  poolOverrideForTest?: PoolType;
}

export class PostgresBackend implements StorageBackend {
  private readonly pool: PoolType;
  private readonly migrationsReady: Promise<void>;

  constructor(args: ConstructorArgs) {
    this.pool = args.poolOverrideForTest ?? new Pool({ connectionString: args.connectionString });
    this.migrationsReady = runMigrations(this.makeAdapter());
  }

  private makeAdapter(): MigrationAdapter {
    const pool = this.pool;
    return {
      engine: "postgres",
      async ensureMigrationsTable() {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS _migrations (
            version    INTEGER PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);
      },
      async getApplied() {
        const r = await pool.query<{ version: number }>(
          "SELECT version FROM _migrations ORDER BY version ASC",
        );
        return r.rows.map((row) => Number(row.version));
      },
      async applyMigration(version, sql) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(sql);
          await client.query("INSERT INTO _migrations (version) VALUES ($1)", [version]);
          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }
      },
      async inspectExistingSchema() {
        const t = await pool.query(
          "SELECT 1 FROM information_schema.tables WHERE table_name = 'observations'",
        );
        const hasObservationsTable = (t.rowCount ?? 0) > 0;
        let hasUserIdColumn = false;
        if (hasObservationsTable) {
          const c = await pool.query(
            "SELECT 1 FROM information_schema.columns WHERE table_name = 'observations' AND column_name = 'user_id'",
          );
          hasUserIdColumn = (c.rowCount ?? 0) > 0;
        }
        return { hasObservationsTable, hasUserIdColumn };
      },
    };
  }

  async insert(input: ObservationInput): Promise<Observation> {
    await this.migrationsReady;
    const observedAt = (input.observedAt ?? new Date()).toISOString();
    const createdAt = new Date().toISOString();
    const r = await this.pool.query<Row>(
      `INSERT INTO observations
         (user_id, observed_at, latitude, longitude, target, notes, seeing, transparency, equipment, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
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
      ],
    );
    return rowToObservation(r.rows[0]!);
  }

  async query(filters: RecallFilters): Promise<Observation[]> {
    await this.migrationsReady;
    let limit = filters.limit ?? 20;
    if (!Number.isFinite(limit) || limit <= 0) {
      throw new Error(`recallObservations: limit must be > 0 (got ${filters.limit})`);
    }
    if (limit > 100) limit = 100;

    const where: string[] = ["user_id = $1"];
    const params: (string | number)[] = [filters.userId];
    let paramIdx = 2;

    if (filters.target) {
      where.push(`LOWER(target) LIKE LOWER($${paramIdx++})`);
      params.push(`%${filters.target}%`);
    }
    if (filters.since) {
      where.push(`observed_at >= $${paramIdx++}`);
      params.push(filters.since.toISOString());
    }
    if (filters.until) {
      where.push(`observed_at <= $${paramIdx++}`);
      params.push(filters.until.toISOString());
    }
    if (filters.minSeeing != null) {
      where.push(`seeing IS NOT NULL AND seeing >= $${paramIdx++}`);
      params.push(filters.minSeeing);
    }
    params.push(limit);

    const sql = `SELECT * FROM observations
                 WHERE ${where.join(" AND ")}
                 ORDER BY observed_at DESC, id DESC
                 LIMIT $${paramIdx}`;
    const r = await this.pool.query<Row>(sql, params);
    return r.rows.map(rowToObservation);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  /** Test-only: expose the underlying Pool for direct queries. */
  _getPoolForTest(): PoolType {
    return this.pool;
  }
}

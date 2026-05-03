/**
 * Storage abstraction for the observation log.
 *
 * Two implementations: SqliteBackend (default, ~/.sky-tonight/observations.db
 * or :memory:) and PostgresBackend (selected when DATABASE_URL is set).
 *
 * Intentionally narrow: insert / query / close. No transactions, no streaming,
 * no batch ops — the call sites don't need them and the abstraction stays small.
 */
import type { Observation, ObservationInput, RecallFilters } from "../observation-log.js";

export interface StorageBackend {
  insert(input: ObservationInput): Promise<Observation>;
  query(filters: RecallFilters): Promise<Observation[]>;
  close(): Promise<void>;
}

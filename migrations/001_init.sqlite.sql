-- 001_init: initial schema (pre-v0.6 shape)
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
CREATE INDEX IF NOT EXISTS idx_obs_target_lower ON observations(LOWER(target));

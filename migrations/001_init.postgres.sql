-- 001_init (postgres): initial schema, pre-user_id
CREATE TABLE IF NOT EXISTS observations (
  id           BIGSERIAL PRIMARY KEY,
  observed_at  TEXT      NOT NULL,
  latitude     DOUBLE PRECISION NOT NULL,
  longitude    DOUBLE PRECISION NOT NULL,
  target       TEXT      NOT NULL,
  notes        TEXT,
  seeing       INTEGER,
  transparency INTEGER,
  equipment    TEXT,
  created_at   TEXT      NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_obs_target_lower ON observations(LOWER(target));

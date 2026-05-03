-- 002_add_user_id: per-user partitioning (v0.6)
ALTER TABLE observations ADD COLUMN user_id TEXT NOT NULL DEFAULT 'local';
CREATE INDEX IF NOT EXISTS idx_obs_user_observed_at ON observations(user_id, observed_at);

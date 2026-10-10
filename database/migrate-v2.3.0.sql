-- Run once on the existing Neon database before deploying v2.3.0.
-- Adds encrypted short-lived shared cache; preserves all accounts and history.
CREATE TABLE IF NOT EXISTS mp_master_cache (
 scope char(64) PRIMARY KEY,
 payload text,
 expires_at timestamptz,
 lease_id uuid,
 lease_until timestamptz NOT NULL DEFAULT now()
);

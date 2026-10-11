-- Run once in Neon SQL Editor. Idempotent for a new v2.5.0 installation.
CREATE TABLE IF NOT EXISTS mp_users (
 id uuid PRIMARY KEY, username varchar(64) UNIQUE NOT NULL,
 full_name varchar(120) NOT NULL, password_hash text NOT NULL,
 active boolean NOT NULL DEFAULT true, auth_version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (username ~ '^[a-z0-9][a-z0-9._-]{2,63}$')
);
CREATE TABLE IF NOT EXISTS mp_sessions (
 token_hash char(64) PRIMARY KEY, role text NOT NULL CHECK(role IN ('admin','user')),
 user_id uuid REFERENCES mp_users(id), username varchar(64) NOT NULL, full_name varchar(120) NOT NULL,
 auth_version integer, config_stamp char(64) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 CHECK ((role='user' AND user_id IS NOT NULL) OR (role='admin' AND user_id IS NULL))
);
CREATE INDEX IF NOT EXISTS mp_sessions_user_idx ON mp_sessions(user_id);
CREATE TABLE IF NOT EXISTS mp_limits (
 key text PRIMARY KEY, window_start timestamptz NOT NULL, hits integer NOT NULL
);
CREATE TABLE IF NOT EXISTS mp_get_gate (
 actor_key text PRIMARY KEY, started_at timestamptz NOT NULL, busy_until timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS mp_audit (
 id uuid PRIMARY KEY, actor_key text NOT NULL, username varchar(64) NOT NULL,
 full_name varchar(120) NOT NULL, action text NOT NULL,
 status text NOT NULL CHECK(status IN ('pending','issued','failed','denied','ok')),
 target_id uuid, requested_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 expires_at timestamptz, error_code varchar(80)
);
CREATE INDEX IF NOT EXISTS mp_audit_actor_time_idx ON mp_audit(actor_key,requested_at DESC);
CREATE INDEX IF NOT EXISTS mp_audit_time_idx ON mp_audit(requested_at DESC);

-- Run once on the existing Neon database before deploying v2.3.0.
-- Adds encrypted short-lived shared cache; preserves all accounts and history.
CREATE TABLE IF NOT EXISTS mp_master_cache (
 scope char(64) PRIMARY KEY,
 payload text,
 expires_at timestamptz,
 lease_id uuid,
 lease_until timestamptz NOT NULL DEFAULT now()
);

-- v2.5.0: app-wide user session lifetime for subsequent logins.
-- Existing sessions retain their original absolute expiry; no accounts/history are deleted.
CREATE TABLE IF NOT EXISTS mp_app_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK (id=true),
 user_session_hours integer NOT NULL DEFAULT 8 CHECK (user_session_hours BETWEEN 1 AND 168),
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO mp_app_settings(id,user_session_hours) VALUES(true,8) ON CONFLICT(id) DO NOTHING;

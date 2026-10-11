-- v2.5.0: app-wide user session lifetime for subsequent logins.
-- Existing sessions retain their original absolute expiry; no accounts/history are deleted.
CREATE TABLE IF NOT EXISTS mp_app_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK (id=true),
 user_session_hours integer NOT NULL DEFAULT 8 CHECK (user_session_hours BETWEEN 1 AND 168),
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO mp_app_settings(id,user_session_hours) VALUES(true,8) ON CONFLICT(id) DO NOTHING;

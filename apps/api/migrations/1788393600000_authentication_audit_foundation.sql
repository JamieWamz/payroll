-- Up Migration

COMMENT ON SCHEMA app IS
  'Version-controlled ZamPayroll application objects with tenant, identity, authentication, and audit foundations.';

CREATE TABLE app.password_credentials (
  user_account_id uuid PRIMARY KEY,
  password_hash varchar(512) NOT NULL,
  failed_attempts smallint NOT NULL DEFAULT 0,
  locked_until timestamptz,
  password_changed_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT password_credentials_user_account_fk
    FOREIGN KEY (user_account_id)
    REFERENCES app.user_accounts (id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT password_credentials_hash_check CHECK (
    password_hash LIKE '$argon2id$v=19$%'
    AND char_length(password_hash) BETWEEN 32 AND 512
  ),
  CONSTRAINT password_credentials_failed_attempts_check CHECK (
    failed_attempts BETWEEN 0 AND 20
  ),
  CONSTRAINT password_credentials_lock_check CHECK (
    locked_until IS NULL OR locked_until >= updated_at
  ),
  CONSTRAINT password_credentials_version_check CHECK (version >= 1),
  CONSTRAINT password_credentials_timestamps_check CHECK (
    password_changed_at >= created_at
    AND updated_at >= created_at
  )
);

CREATE TABLE app.sessions (
  id uuid PRIMARY KEY,
  user_account_id uuid NOT NULL,
  token_digest char(64) NOT NULL,
  csrf_token_digest char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  idle_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT sessions_token_digest_unique UNIQUE (token_digest),
  CONSTRAINT sessions_user_account_fk FOREIGN KEY (user_account_id)
    REFERENCES app.user_accounts (id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT sessions_token_digest_check CHECK (
    token_digest ~ '^[0-9a-f]{64}$'
    AND csrf_token_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT sessions_expiry_check CHECK (
    last_seen_at >= created_at
    AND idle_expires_at > created_at
    AND absolute_expires_at >= idle_expires_at
    AND (revoked_at IS NULL OR revoked_at >= created_at)
  ),
  CONSTRAINT sessions_version_check CHECK (version >= 1)
);

CREATE INDEX sessions_user_active_idx
  ON app.sessions (user_account_id, absolute_expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX sessions_active_expiry_idx
  ON app.sessions (idle_expires_at, absolute_expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE app.audit_events (
  id uuid PRIMARY KEY,
  company_id uuid,
  actor_user_account_id uuid,
  event_type varchar(128) NOT NULL,
  outcome varchar(16) NOT NULL,
  target_type varchar(64),
  target_id uuid,
  request_id varchar(128) NOT NULL,
  source_ip_fingerprint char(64),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT audit_events_company_fk FOREIGN KEY (company_id)
    REFERENCES app.companies (id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT audit_events_actor_fk FOREIGN KEY (actor_user_account_id)
    REFERENCES app.user_accounts (id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT audit_events_type_check CHECK (
    event_type ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*([.][a-z][a-z0-9]*(-[a-z0-9]+)*)+$'
  ),
  CONSTRAINT audit_events_outcome_check CHECK (
    outcome IN ('denied', 'failed', 'succeeded')
  ),
  CONSTRAINT audit_events_target_check CHECK (
    (target_type IS NULL) = (target_id IS NULL)
    AND (
      target_type IS NULL
      OR target_type ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'
    )
  ),
  CONSTRAINT audit_events_request_id_check CHECK (
    request_id = btrim(request_id)
    AND char_length(request_id) BETWEEN 1 AND 128
    AND request_id !~ '[[:cntrl:]]'
  ),
  CONSTRAINT audit_events_source_ip_fingerprint_check CHECK (
    source_ip_fingerprint IS NULL
    OR source_ip_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT audit_events_metadata_check CHECK (
    jsonb_typeof(metadata) = 'object'
    AND octet_length(metadata::text) <= 8192
  )
);

CREATE INDEX audit_events_company_time_idx
  ON app.audit_events (company_id, occurred_at DESC, id);

CREATE INDEX audit_events_actor_time_idx
  ON app.audit_events (actor_user_account_id, occurred_at DESC, id)
  WHERE actor_user_account_id IS NOT NULL;

ALTER TABLE app.password_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.password_credentials FORCE ROW LEVEL SECURITY;
ALTER TABLE app.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE app.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.audit_events FORCE ROW LEVEL SECURITY;

CREATE POLICY password_credentials_migrator_all ON app.password_credentials
  FOR ALL
  TO zampayroll_migrator
  USING (true)
  WITH CHECK (true);

CREATE POLICY sessions_migrator_all ON app.sessions
  FOR ALL
  TO zampayroll_migrator
  USING (true)
  WITH CHECK (true);

CREATE POLICY audit_events_migrator_all ON app.audit_events
  FOR ALL
  TO zampayroll_migrator
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE
  app.password_credentials,
  app.sessions,
  app.audit_events
FROM zampayroll_app;

CREATE FUNCTION app.append_audit_event(
  event_id uuid,
  tenant_company_id uuid,
  actor_id uuid,
  event_name text,
  event_outcome text,
  target_name text,
  target_identifier uuid,
  correlation_id text,
  ip_fingerprint text,
  event_metadata jsonb
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $function$
BEGIN
  IF tenant_company_id IS NOT NULL
    AND tenant_company_id IS DISTINCT FROM app.current_company_id()
  THEN
    RAISE EXCEPTION 'Audit company scope does not match transaction context'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO app.audit_events (
    id,
    company_id,
    actor_user_account_id,
    event_type,
    outcome,
    target_type,
    target_id,
    request_id,
    source_ip_fingerprint,
    metadata
  )
  VALUES (
    event_id,
    tenant_company_id,
    actor_id,
    event_name,
    event_outcome,
    target_name,
    target_identifier,
    correlation_id,
    ip_fingerprint,
    event_metadata
  );
END
$function$;

REVOKE ALL ON FUNCTION app.append_audit_event(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  uuid,
  text,
  text,
  jsonb
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.append_audit_event(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  uuid,
  text,
  text,
  jsonb
) TO zampayroll_app;

-- Down Migration

REVOKE EXECUTE ON FUNCTION app.append_audit_event(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  uuid,
  text,
  text,
  jsonb
) FROM zampayroll_app;

DROP FUNCTION app.append_audit_event(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  uuid,
  text,
  text,
  jsonb
);

DROP TABLE app.audit_events;
DROP TABLE app.sessions;
DROP TABLE app.password_credentials;

COMMENT ON SCHEMA app IS
  'Version-controlled ZamPayroll application objects with tenant-isolated company and identity foundations.';

-- Up Migration

COMMENT ON SCHEMA app IS
  'Version-controlled ZamPayroll application objects with tenant, identity, authentication runtime, audit, workforce, compensation, statutory configuration, and payroll foundations.';

CREATE FUNCTION app.register_company_owner(
  new_user_account_id uuid,
  new_company_id uuid,
  new_membership_id uuid,
  new_role_id uuid,
  normalized_email text,
  normalized_display_name text,
  normalized_company_code text,
  normalized_company_name text,
  encoded_password_hash text,
  audit_event_id uuid,
  correlation_id text,
  ip_fingerprint text
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $function$
BEGIN
  INSERT INTO app.user_accounts (id, email, display_name)
  VALUES (new_user_account_id, normalized_email, normalized_display_name);

  INSERT INTO app.password_credentials (user_account_id, password_hash)
  VALUES (new_user_account_id, encoded_password_hash);

  INSERT INTO app.companies (id, code, name)
  VALUES (new_company_id, normalized_company_code, normalized_company_name);

  INSERT INTO app.company_memberships (
    id,
    company_id,
    user_account_id
  ) VALUES (new_membership_id, new_company_id, new_user_account_id);

  INSERT INTO app.roles (id, company_id, code, name)
  VALUES (new_role_id, new_company_id, 'owner', 'Owner');

  INSERT INTO app.membership_roles (
    company_id,
    membership_id,
    role_id,
    assigned_on
  ) VALUES (new_company_id, new_membership_id, new_role_id, CURRENT_DATE);

  INSERT INTO app.role_permissions (company_id, role_id, permission_key)
  SELECT new_company_id, new_role_id, permission.permission_key
  FROM unnest(ARRAY[
    'company.read',
    'company.update',
    'users.manage',
    'workforce.read',
    'workforce.write',
    'compensation.read',
    'compensation.write',
    'payroll.read',
    'payroll.calculate',
    'payroll.finalize',
    'reports.read',
    'statutory-config.read',
    'statutory-config.verify'
  ]) AS permission(permission_key);

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
  ) VALUES (
    audit_event_id,
    new_company_id,
    new_user_account_id,
    'authentication.registration',
    'succeeded',
    'company',
    new_company_id,
    correlation_id,
    ip_fingerprint,
    '{}'::jsonb
  );
END
$function$;

CREATE FUNCTION app.find_authentication_record(requested_email text)
RETURNS TABLE (
  user_account_id uuid,
  account_status varchar(16),
  email varchar(254),
  display_name varchar(120),
  password_hash varchar(512),
  failed_attempts smallint,
  locked_until timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $function$
  SELECT
    account.id,
    account.status,
    account.email,
    account.display_name,
    credential.password_hash,
    credential.failed_attempts,
    credential.locked_until
  FROM app.user_accounts AS account
  JOIN app.password_credentials AS credential
    ON credential.user_account_id = account.id
  WHERE account.email = lower(btrim(requested_email))
$function$;

CREATE FUNCTION app.record_authentication_failure(requested_user_id uuid)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $function$
  UPDATE app.password_credentials
  SET failed_attempts = LEAST(failed_attempts + 1, 20),
      locked_until = CASE
        WHEN failed_attempts + 1 >= 5
          THEN statement_timestamp() + INTERVAL '15 minutes'
        ELSE locked_until
      END,
      updated_at = statement_timestamp(),
      version = version + 1
  WHERE user_account_id = requested_user_id
$function$;

CREATE FUNCTION app.record_authentication_success(requested_user_id uuid)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $function$
  UPDATE app.password_credentials
  SET failed_attempts = 0,
      locked_until = NULL,
      updated_at = statement_timestamp(),
      version = version + 1
  WHERE user_account_id = requested_user_id
$function$;

CREATE FUNCTION app.create_authenticated_session(
  new_session_id uuid,
  requested_user_id uuid,
  new_token_digest text,
  new_csrf_token_digest text,
  requested_idle_expires_at timestamptz,
  requested_absolute_expires_at timestamptz,
  audit_event_id uuid,
  correlation_id text,
  ip_fingerprint text
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM app.user_accounts AS account
    WHERE account.id = requested_user_id
      AND account.status = 'active'
  ) THEN
    RAISE EXCEPTION 'session requires an active account'
      USING ERRCODE = '23514',
            CONSTRAINT = 'sessions_active_account';
  END IF;

  INSERT INTO app.sessions (
    id,
    user_account_id,
    token_digest,
    csrf_token_digest,
    idle_expires_at,
    absolute_expires_at
  ) VALUES (
    new_session_id,
    requested_user_id,
    new_token_digest,
    new_csrf_token_digest,
    requested_idle_expires_at,
    requested_absolute_expires_at
  );

  INSERT INTO app.audit_events (
    id,
    actor_user_account_id,
    event_type,
    outcome,
    target_type,
    target_id,
    request_id,
    source_ip_fingerprint,
    metadata
  ) VALUES (
    audit_event_id,
    requested_user_id,
    'authentication.login',
    'succeeded',
    'session',
    new_session_id,
    correlation_id,
    ip_fingerprint,
    '{}'::jsonb
  );
END
$function$;

CREATE FUNCTION app.resolve_authenticated_session(
  requested_token_digest text,
  idle_extension_seconds integer
)
RETURNS TABLE (
  session_id uuid,
  user_account_id uuid,
  email varchar(254),
  display_name varchar(120),
  csrf_token_digest char(64),
  idle_expires_at timestamptz,
  absolute_expires_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $function$
BEGIN
  IF idle_extension_seconds < 60 OR idle_extension_seconds > 86400 THEN
    RAISE EXCEPTION 'session idle extension is outside the supported range'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  UPDATE app.sessions AS session
  SET last_seen_at = statement_timestamp(),
      idle_expires_at = LEAST(
        session.absolute_expires_at,
        statement_timestamp()
          + pg_catalog.make_interval(secs => idle_extension_seconds)
      ),
      version = session.version + 1
  FROM app.user_accounts AS account
  WHERE session.token_digest = requested_token_digest
    AND session.user_account_id = account.id
    AND account.status = 'active'
    AND session.revoked_at IS NULL
    AND session.idle_expires_at > statement_timestamp()
    AND session.absolute_expires_at > statement_timestamp()
  RETURNING
    session.id,
    account.id,
    account.email,
    account.display_name,
    session.csrf_token_digest,
    session.idle_expires_at,
    session.absolute_expires_at;
END
$function$;

CREATE FUNCTION app.authentication_memberships(requested_user_id uuid)
RETURNS TABLE (
  company_id uuid,
  company_code varchar(64),
  company_name varchar(160),
  membership_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $function$
  SELECT company.id, company.code, company.name, membership.id
  FROM app.company_memberships AS membership
  JOIN app.companies AS company ON company.id = membership.company_id
  WHERE membership.user_account_id = requested_user_id
    AND membership.status = 'active'
    AND company.status = 'active'
  ORDER BY company.name, company.id
$function$;

CREATE FUNCTION app.revoke_authenticated_session(
  requested_token_digest text,
  audit_event_id uuid,
  correlation_id text,
  ip_fingerprint text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $function$
DECLARE
  revoked_session_id uuid;
  revoked_user_id uuid;
BEGIN
  UPDATE app.sessions AS session
  SET revoked_at = statement_timestamp(),
      version = session.version + 1
  WHERE session.token_digest = requested_token_digest
    AND session.revoked_at IS NULL
  RETURNING session.id, session.user_account_id
  INTO revoked_session_id, revoked_user_id;

  IF revoked_session_id IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO app.audit_events (
    id,
    actor_user_account_id,
    event_type,
    outcome,
    target_type,
    target_id,
    request_id,
    source_ip_fingerprint,
    metadata
  ) VALUES (
    audit_event_id,
    revoked_user_id,
    'authentication.logout',
    'succeeded',
    'session',
    revoked_session_id,
    correlation_id,
    ip_fingerprint,
    '{}'::jsonb
  );

  RETURN true;
END
$function$;

REVOKE ALL ON FUNCTION app.register_company_owner(
  uuid, uuid, uuid, uuid, text, text, text, text, text, uuid, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.find_authentication_record(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.record_authentication_failure(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.record_authentication_success(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.create_authenticated_session(
  uuid, uuid, text, text, timestamptz, timestamptz, uuid, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.resolve_authenticated_session(text, integer)
FROM PUBLIC;
REVOKE ALL ON FUNCTION app.authentication_memberships(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.revoke_authenticated_session(text, uuid, text, text)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.register_company_owner(
  uuid, uuid, uuid, uuid, text, text, text, text, text, uuid, text, text
) TO zampayroll_app;
GRANT EXECUTE ON FUNCTION app.find_authentication_record(text)
TO zampayroll_app;
GRANT EXECUTE ON FUNCTION app.record_authentication_failure(uuid)
TO zampayroll_app;
GRANT EXECUTE ON FUNCTION app.record_authentication_success(uuid)
TO zampayroll_app;
GRANT EXECUTE ON FUNCTION app.create_authenticated_session(
  uuid, uuid, text, text, timestamptz, timestamptz, uuid, text, text
) TO zampayroll_app;
GRANT EXECUTE ON FUNCTION app.resolve_authenticated_session(text, integer)
TO zampayroll_app;
GRANT EXECUTE ON FUNCTION app.authentication_memberships(uuid)
TO zampayroll_app;
GRANT EXECUTE ON FUNCTION app.revoke_authenticated_session(
  text, uuid, text, text
) TO zampayroll_app;

-- Down Migration

DROP FUNCTION app.revoke_authenticated_session(text, uuid, text, text);
DROP FUNCTION app.authentication_memberships(uuid);
DROP FUNCTION app.resolve_authenticated_session(text, integer);
DROP FUNCTION app.create_authenticated_session(
  uuid, uuid, text, text, timestamptz, timestamptz, uuid, text, text
);
DROP FUNCTION app.record_authentication_success(uuid);
DROP FUNCTION app.record_authentication_failure(uuid);
DROP FUNCTION app.find_authentication_record(text);
DROP FUNCTION app.register_company_owner(
  uuid, uuid, uuid, uuid, text, text, text, text, text, uuid, text, text
);

COMMENT ON SCHEMA app IS
  'Version-controlled ZamPayroll application objects with tenant, identity, authentication, audit, workforce, compensation, payroll-period, statutory-configuration, and payroll-run foundations.';

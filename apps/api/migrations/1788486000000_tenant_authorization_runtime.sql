-- Up Migration

COMMENT ON SCHEMA app IS
  'Version-controlled ZamPayroll application objects with authenticated tenant authorization, audit, workforce, compensation, statutory configuration, and payroll foundations.';

CREATE FUNCTION app.resolve_company_authorization(
  requested_token_digest text,
  requested_company_id uuid,
  idle_extension_seconds integer
)
RETURNS TABLE (
  session_id uuid,
  user_account_id uuid,
  membership_id uuid,
  csrf_token_digest char(64),
  permission_keys text[]
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $function$
BEGIN
  IF requested_company_id IS DISTINCT FROM app.current_company_id() THEN
    RAISE EXCEPTION 'Requested company does not match transaction context'
      USING ERRCODE = '42501';
  END IF;

  IF idle_extension_seconds < 60 OR idle_extension_seconds > 86400 THEN
    RAISE EXCEPTION 'session idle extension is outside the supported range'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH refreshed_session AS (
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
      session.user_account_id,
      session.csrf_token_digest
  )
  SELECT
    authenticated.id,
    authenticated.user_account_id,
    membership.id,
    authenticated.csrf_token_digest,
    COALESCE(
      array_agg(
        DISTINCT permission.permission_key::text
        ORDER BY permission.permission_key::text
      )
        FILTER (WHERE permission.permission_key IS NOT NULL),
      ARRAY[]::text[]
    )
  FROM refreshed_session AS authenticated
  LEFT JOIN app.company_memberships AS membership
    ON membership.company_id = requested_company_id
    AND membership.user_account_id = authenticated.user_account_id
    AND membership.status = 'active'
  LEFT JOIN app.companies AS company
    ON company.id = membership.company_id
    AND company.status = 'active'
  LEFT JOIN app.membership_roles AS assignment
    ON assignment.company_id = company.id
    AND assignment.membership_id = membership.id
    AND assignment.assigned_on <= CURRENT_DATE
  LEFT JOIN app.roles AS role
    ON role.company_id = assignment.company_id
    AND role.id = assignment.role_id
    AND role.status = 'active'
  LEFT JOIN app.role_permissions AS permission
    ON permission.company_id = role.company_id
    AND permission.role_id = role.id
  GROUP BY
    authenticated.id,
    authenticated.user_account_id,
    membership.id,
    authenticated.csrf_token_digest;
END
$function$;

REVOKE ALL ON FUNCTION app.resolve_company_authorization(text, uuid, integer)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.resolve_company_authorization(text, uuid, integer)
TO zampayroll_app;

-- Down Migration

DROP FUNCTION app.resolve_company_authorization(text, uuid, integer);

COMMENT ON SCHEMA app IS
  'Version-controlled ZamPayroll application objects with tenant, identity, authentication runtime, audit, workforce, compensation, statutory configuration, and payroll foundations.';

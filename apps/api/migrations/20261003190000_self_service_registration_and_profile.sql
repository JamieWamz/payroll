-- Up Migration

-- Workspace owners can now self-register. The function already creates the
-- complete tenant, owner role, permission set, credential, and audit record;
-- the invitation-only onboarding migration had revoked its runtime access.
GRANT EXECUTE ON FUNCTION app.register_company_owner(
  uuid, uuid, uuid, uuid, text, text, text, text, text, uuid, text, text
) TO zampayroll_app;

CREATE FUNCTION app.update_authenticated_profile(
  requested_token_digest text,
  normalized_display_name text,
  audit_event_id uuid,
  correlation_id text
)
RETURNS TABLE (
  user_account_id uuid,
  email varchar(254),
  display_name varchar(120)
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $function$
DECLARE
  updated_user_id uuid;
  updated_email varchar(254);
  updated_display_name varchar(120);
BEGIN
  UPDATE app.user_accounts AS account
  SET display_name = normalized_display_name,
      updated_at = statement_timestamp(),
      version = account.version + 1
  FROM app.sessions AS session
  WHERE session.token_digest = requested_token_digest
    AND session.user_account_id = account.id
    AND account.status = 'active'
    AND session.revoked_at IS NULL
    AND session.idle_expires_at > statement_timestamp()
    AND session.absolute_expires_at > statement_timestamp()
  RETURNING account.id, account.email, account.display_name
  INTO updated_user_id, updated_email, updated_display_name;

  IF updated_user_id IS NULL THEN
    RAISE EXCEPTION 'profile update requires an active session'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO app.audit_events (
    id,
    actor_user_account_id,
    event_type,
    outcome,
    target_type,
    target_id,
    request_id,
    metadata
  ) VALUES (
    audit_event_id,
    updated_user_id,
    'authentication.profile-updated',
    'succeeded',
    'user-account',
    updated_user_id,
    correlation_id,
    '{}'::jsonb
  );

  RETURN QUERY
  SELECT updated_user_id, updated_email, updated_display_name;
END
$function$;

REVOKE ALL ON FUNCTION app.update_authenticated_profile(text, text, uuid, text)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.update_authenticated_profile(text, text, uuid, text)
TO zampayroll_app;

-- Down Migration

REVOKE EXECUTE ON FUNCTION app.update_authenticated_profile(text, text, uuid, text)
FROM zampayroll_app;
DROP FUNCTION app.update_authenticated_profile(text, text, uuid, text);

REVOKE EXECUTE ON FUNCTION app.register_company_owner(
  uuid, uuid, uuid, uuid, text, text, text, text, text, uuid, text, text
) FROM zampayroll_app;

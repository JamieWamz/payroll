-- Up Migration

CREATE TABLE app.workspace_invitations (
  id uuid PRIMARY KEY,
  email varchar(254) NOT NULL CHECK (email = lower(btrim(email))),
  company_code varchar(64) NOT NULL,
  company_name varchar(160) NOT NULL,
  token_digest char(64) NOT NULL UNIQUE CHECK (token_digest ~ '^[0-9a-f]{64}$'),
  issued_by varchar(120) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  accepted_at timestamptz,
  accepted_company_id uuid REFERENCES app.companies(id) ON DELETE SET NULL,
  accepted_by_user_id uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
  CHECK ((status = 'accepted') = (accepted_at IS NOT NULL))
);
CREATE UNIQUE INDEX workspace_invitations_pending_code
  ON app.workspace_invitations(company_code) WHERE status = 'pending';
ALTER TABLE app.workspace_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.workspace_invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_invitations_operator ON app.workspace_invitations
  TO zampayroll_migrator USING (true) WITH CHECK (true);
REVOKE ALL ON app.workspace_invitations FROM PUBLIC, zampayroll_app;

CREATE TABLE app.workspace_invitation_events (
  id uuid PRIMARY KEY,
  invitation_id uuid NOT NULL REFERENCES app.workspace_invitations(id) ON DELETE CASCADE,
  action varchar(16) NOT NULL CHECK (action IN ('issued', 'revoked', 'accepted')),
  actor varchar(120) NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
ALTER TABLE app.workspace_invitation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.workspace_invitation_events FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_invitation_events_operator ON app.workspace_invitation_events
  TO zampayroll_migrator USING (true) WITH CHECK (true);
REVOKE ALL ON app.workspace_invitation_events FROM PUBLIC, zampayroll_app;

-- Company owners may invite staff, but only the deployment operator issues
-- invitations that create a new billable workspace. No public issuance API.
REVOKE EXECUTE ON FUNCTION app.register_company_owner(
  uuid,uuid,uuid,uuid,text,text,text,text,text,uuid,text,text
) FROM zampayroll_app;

CREATE FUNCTION app.inspect_workspace_invitation(requested_digest text)
RETURNS TABLE(email text, company_code text, company_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, app AS $function$
  SELECT i.email::text, i.company_code::text, i.company_name::text
  FROM app.workspace_invitations i
  WHERE i.token_digest = requested_digest AND i.status = 'pending'
    AND i.expires_at > statement_timestamp()
$function$;
REVOKE ALL ON FUNCTION app.inspect_workspace_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.inspect_workspace_invitation(text) TO zampayroll_app;

CREATE FUNCTION app.accept_workspace_invitation(
  requested_digest text, new_user_id uuid, new_company_id uuid,
  new_membership_id uuid, new_role_id uuid, normalized_display_name text,
  encoded_password_hash text, authenticated_digest text,
  audit_event_id uuid, correlation_id text
)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, app AS $function$
DECLARE invitation app.workspace_invitations; account_id uuid;
BEGIN
  SELECT * INTO invitation FROM app.workspace_invitations
    WHERE token_digest = requested_digest FOR UPDATE;
  IF NOT FOUND OR invitation.status <> 'pending' OR invitation.expires_at <= statement_timestamp() THEN
    RAISE EXCEPTION 'Invitation is unavailable' USING ERRCODE = '22023';
  END IF;
  SELECT id INTO account_id FROM app.user_accounts WHERE email = invitation.email;
  IF account_id IS NULL THEN
    IF encoded_password_hash IS NULL THEN
      RAISE EXCEPTION 'Account credentials are required' USING ERRCODE = '22023';
    END IF;
    PERFORM app.register_company_owner(new_user_id,new_company_id,new_membership_id,new_role_id,
      invitation.email,normalized_display_name,invitation.company_code,invitation.company_name,
      encoded_password_hash,audit_event_id,correlation_id,NULL);
  ELSE
    IF account_id <> new_user_id OR NOT EXISTS (
      SELECT 1 FROM app.sessions s JOIN app.user_accounts u ON u.id=s.user_account_id
      WHERE u.id=account_id AND u.status='active' AND s.token_digest=authenticated_digest
        AND s.revoked_at IS NULL AND s.idle_expires_at>statement_timestamp()
        AND s.absolute_expires_at>statement_timestamp()
    ) THEN
      RAISE EXCEPTION 'Authenticated account does not match invitation' USING ERRCODE='42501';
    END IF;
    INSERT INTO app.companies(id,code,name) VALUES(new_company_id,invitation.company_code,invitation.company_name);
    INSERT INTO app.company_memberships(id,company_id,user_account_id) VALUES(new_membership_id,new_company_id,account_id);
    INSERT INTO app.roles(id,company_id,code,name) VALUES(new_role_id,new_company_id,'owner','Owner');
    INSERT INTO app.membership_roles(company_id,membership_id,role_id,assigned_on)
      VALUES(new_company_id,new_membership_id,new_role_id,CURRENT_DATE);
    INSERT INTO app.role_permissions(company_id,role_id,permission_key)
      SELECT new_company_id,new_role_id,unnest(ARRAY[
        'company.read','company.update','users.manage','workforce.read','workforce.write',
        'compensation.read','compensation.write','payroll.read','payroll.calculate','payroll.finalize',
        'reports.read','statutory-config.read','statutory-config.verify'
      ]);
    INSERT INTO app.audit_events(id,company_id,actor_user_account_id,event_type,outcome,target_type,target_id,request_id,metadata)
      VALUES(audit_event_id,new_company_id,account_id,'authentication.registration','succeeded','company',new_company_id,correlation_id,'{}');
  END IF;
  UPDATE app.workspace_invitations SET status='accepted',accepted_at=statement_timestamp(),
    accepted_company_id=new_company_id,accepted_by_user_id=new_user_id WHERE id=invitation.id;
  INSERT INTO app.workspace_invitation_events(id,invitation_id,action,actor)
    VALUES(gen_random_uuid(),invitation.id,'accepted',new_user_id::text);
END
$function$;
REVOKE ALL ON FUNCTION app.accept_workspace_invitation(text,uuid,uuid,uuid,uuid,text,text,text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.accept_workspace_invitation(text,uuid,uuid,uuid,uuid,text,text,text,uuid,text) TO zampayroll_app;

-- Down Migration

DROP FUNCTION app.accept_workspace_invitation(text,uuid,uuid,uuid,uuid,text,text,text,uuid,text);
DROP FUNCTION app.inspect_workspace_invitation(text);
DROP TABLE app.workspace_invitation_events;
DROP TABLE app.workspace_invitations;
GRANT EXECUTE ON FUNCTION app.register_company_owner(uuid,uuid,uuid,uuid,text,text,text,text,text,uuid,text,text) TO zampayroll_app;

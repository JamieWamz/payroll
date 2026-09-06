-- Up Migration
CREATE TABLE app.company_invitations (
 id uuid PRIMARY KEY,
 company_id uuid NOT NULL REFERENCES app.companies(id),
 email varchar(254) NOT NULL CHECK(email=lower(btrim(email))),
 role_code varchar(32) NOT NULL CHECK(role_code IN ('payroll-operator','payroll-reviewer','report-reader')),
 token_digest char(64) NOT NULL UNIQUE CHECK(token_digest ~ '^[0-9a-f]{64}$'),
 status varchar(16) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','revoked')),
 invited_by_membership_id uuid NOT NULL,
 accepted_by_user_id uuid REFERENCES app.user_accounts(id),
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 FOREIGN KEY(company_id,invited_by_membership_id) REFERENCES app.company_memberships(company_id,id),
 CHECK(expires_at>created_at),
 CHECK((status='accepted' AND accepted_by_user_id IS NOT NULL) OR (status<>'accepted' AND accepted_by_user_id IS NULL))
);
ALTER TABLE app.company_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.company_invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY company_invitations_migrator ON app.company_invitations TO zampayroll_migrator USING(true) WITH CHECK(true);
CREATE POLICY company_invitations_tenant ON app.company_invitations TO zampayroll_app USING(company_id=app.current_company_id()) WITH CHECK(company_id=app.current_company_id());
GRANT SELECT, INSERT, UPDATE ON app.company_invitations TO zampayroll_app;
CREATE INDEX company_invitations_company ON app.company_invitations(company_id,created_at DESC);

CREATE FUNCTION app.list_company_team()
RETURNS TABLE(id uuid,display_name text,email text,status text,version bigint,role_codes text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,app AS $function$
 SELECT m.id,u.display_name::text,u.email::text,m.status::text,m.version,
 coalesce(array_agg(r.code::text ORDER BY r.code) FILTER(WHERE r.id IS NOT NULL),ARRAY[]::text[])
 FROM app.company_memberships m JOIN app.user_accounts u ON u.id=m.user_account_id
 LEFT JOIN app.membership_roles a ON a.company_id=m.company_id AND a.membership_id=m.id
 LEFT JOIN app.roles r ON r.company_id=a.company_id AND r.id=a.role_id
 WHERE m.company_id=app.current_company_id()
 GROUP BY m.id,u.id
$function$;
REVOKE ALL ON FUNCTION app.list_company_team() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_company_team() TO zampayroll_app;

CREATE FUNCTION app.inspect_company_invitation(requested_digest text)
RETURNS TABLE(company_id uuid,company_name text,email text,role_code text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,app AS $function$
 SELECT i.company_id,c.name::text,i.email::text,i.role_code::text FROM app.company_invitations i
 JOIN app.companies c ON c.id=i.company_id AND c.status='active'
 JOIN app.company_memberships m ON m.company_id=i.company_id AND m.id=i.invited_by_membership_id AND m.status='active'
 WHERE i.token_digest=requested_digest AND i.status='pending' AND i.expires_at>statement_timestamp()
 AND EXISTS(SELECT 1 FROM app.membership_roles a JOIN app.roles r ON r.company_id=a.company_id AND r.id=a.role_id AND r.status='active' JOIN app.role_permissions p ON p.company_id=r.company_id AND p.role_id=r.id WHERE a.company_id=m.company_id AND a.membership_id=m.id AND a.assigned_on<=CURRENT_DATE AND p.permission_key='users.manage')
$function$;
REVOKE ALL ON FUNCTION app.inspect_company_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.inspect_company_invitation(text) TO zampayroll_app;

CREATE FUNCTION app.accept_company_invitation(requested_digest text,new_user_id uuid,new_display_name text,new_password_hash text,authenticated_digest text,new_membership_id uuid,new_role_id uuid,audit_id uuid,correlation_id text)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,app AS $function$
DECLARE invitation app.company_invitations; destination uuid; account_id uuid; selected_role uuid; permissions text[];
BEGIN
 SELECT i.company_id INTO destination FROM app.inspect_company_invitation(requested_digest) i;
 IF destination IS NULL THEN RAISE EXCEPTION 'Invitation is invalid or expired' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(destination::text||':payroll',0));
 SELECT * INTO invitation FROM app.company_invitations WHERE token_digest=requested_digest FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM app.inspect_company_invitation(requested_digest)) THEN RAISE EXCEPTION 'Invitation is invalid or expired' USING ERRCODE='22023'; END IF;
 SELECT id INTO account_id FROM app.user_accounts WHERE email=invitation.email;
 IF account_id IS NULL THEN
  IF new_password_hash IS NULL THEN RAISE EXCEPTION 'Account credentials are required' USING ERRCODE='22023'; END IF;
  INSERT INTO app.user_accounts(id,email,display_name) VALUES(new_user_id,invitation.email,new_display_name);
  INSERT INTO app.password_credentials(user_account_id,password_hash) VALUES(new_user_id,new_password_hash);
  account_id:=new_user_id;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM app.sessions s JOIN app.user_accounts u ON u.id=s.user_account_id AND u.status='active' WHERE s.user_account_id=account_id AND s.token_digest=authenticated_digest AND s.revoked_at IS NULL AND s.idle_expires_at>statement_timestamp() AND s.absolute_expires_at>statement_timestamp()) THEN
   RAISE EXCEPTION 'Authenticated account does not match invitation' USING ERRCODE='42501';
  END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM app.company_memberships WHERE company_id=destination AND user_account_id=account_id) THEN RAISE EXCEPTION 'Account already has a company membership; manage its access from Team' USING ERRCODE='23505'; END IF;
 INSERT INTO app.roles(id,company_id,code,name) VALUES(new_role_id,destination,invitation.role_code,CASE invitation.role_code WHEN 'payroll-operator' THEN 'Payroll operator' WHEN 'payroll-reviewer' THEN 'Payroll reviewer' ELSE 'Report reader' END) ON CONFLICT(company_id,code) DO NOTHING;
 SELECT id INTO selected_role FROM app.roles WHERE company_id=destination AND code=invitation.role_code;
 permissions:=CASE invitation.role_code
 WHEN 'payroll-operator' THEN ARRAY['company.read','workforce.read','workforce.write','compensation.read','compensation.write','payroll.read','payroll.calculate','reports.read','statutory-config.read']
 WHEN 'payroll-reviewer' THEN ARRAY['company.read','workforce.read','compensation.read','payroll.read','payroll.finalize','reports.read','statutory-config.read']
 ELSE ARRAY['company.read','payroll.read','reports.read'] END;
 IF EXISTS(SELECT 1 FROM app.role_permissions WHERE company_id=destination AND role_id=selected_role AND NOT(permission_key=ANY(permissions))) THEN RAISE EXCEPTION 'Role conflicts with invitation permissions' USING ERRCODE='22023'; END IF;
 INSERT INTO app.role_permissions(company_id,role_id,permission_key) SELECT destination,selected_role,unnest(permissions) ON CONFLICT DO NOTHING;
 INSERT INTO app.company_memberships(id,company_id,user_account_id) VALUES(new_membership_id,destination,account_id);
 INSERT INTO app.membership_roles(company_id,membership_id,role_id,assigned_on) VALUES(destination,new_membership_id,selected_role,CURRENT_DATE);
 UPDATE app.company_invitations SET status='accepted',accepted_by_user_id=account_id,version=version+1,updated_at=statement_timestamp() WHERE id=invitation.id;
 INSERT INTO app.audit_events(id,company_id,actor_user_account_id,event_type,outcome,target_type,target_id,request_id,metadata) VALUES(audit_id,destination,account_id,'team.invitation-accepted','succeeded','membership',new_membership_id,correlation_id,jsonb_build_object('role',invitation.role_code));
 RETURN account_id;
END
$function$;
REVOKE ALL ON FUNCTION app.accept_company_invitation(text,uuid,text,text,text,uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.accept_company_invitation(text,uuid,text,text,text,uuid,uuid,uuid,text) TO zampayroll_app;

-- Down Migration
DROP FUNCTION app.accept_company_invitation(text,uuid,text,text,text,uuid,uuid,uuid,text);
DROP FUNCTION app.inspect_company_invitation(text);
DROP FUNCTION app.list_company_team();
DROP TABLE app.company_invitations;

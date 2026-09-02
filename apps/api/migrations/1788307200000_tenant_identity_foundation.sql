-- Up Migration

ALTER DEFAULT PRIVILEGES FOR ROLE zampayroll_migrator IN SCHEMA app
  REVOKE DELETE ON TABLES FROM zampayroll_app;

COMMENT ON SCHEMA app IS
  'Version-controlled ZamPayroll application objects with tenant-isolated company and identity foundations.';

CREATE FUNCTION app.current_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
  SELECT NULLIF(current_setting('app.current_company_id', true), '')::uuid
$function$;

REVOKE ALL ON FUNCTION app.current_company_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.current_company_id() TO zampayroll_app;

COMMENT ON FUNCTION app.current_company_id() IS
  'Returns the transaction-local company UUID used by tenant row-level security policies.';

CREATE TABLE app.companies (
  id uuid PRIMARY KEY,
  code varchar(64) NOT NULL,
  name varchar(160) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'active',
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT companies_code_unique UNIQUE (code),
  CONSTRAINT companies_code_check CHECK (
    code = lower(btrim(code))
    AND char_length(code) BETWEEN 1 AND 64
    AND code ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'
  ),
  CONSTRAINT companies_name_check CHECK (
    name = btrim(name)
    AND char_length(name) BETWEEN 1 AND 160
    AND name !~ '[[:cntrl:]]'
  ),
  CONSTRAINT companies_status_check CHECK (
    status IN ('active', 'archived', 'suspended')
  ),
  CONSTRAINT companies_version_check CHECK (version >= 1),
  CONSTRAINT companies_timestamps_check CHECK (updated_at >= created_at)
);

CREATE TABLE app.user_accounts (
  id uuid PRIMARY KEY,
  email varchar(254) NOT NULL,
  display_name varchar(120) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'active',
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT user_accounts_email_unique UNIQUE (email),
  CONSTRAINT user_accounts_email_check CHECK (
    email = lower(btrim(email))
    AND char_length(email) BETWEEN 3 AND 254
    AND char_length(split_part(email, '@', 1)) BETWEEN 1 AND 64
    AND email ~ $email$^[a-z0-9!#$%&'*+/=?^_`{|}~-]+([.][a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?([.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$$email$
  ),
  CONSTRAINT user_accounts_display_name_check CHECK (
    display_name = btrim(display_name)
    AND char_length(display_name) BETWEEN 1 AND 120
    AND display_name !~ '[[:cntrl:]]'
  ),
  CONSTRAINT user_accounts_status_check CHECK (
    status IN ('active', 'deactivated', 'suspended')
  ),
  CONSTRAINT user_accounts_version_check CHECK (version >= 1),
  CONSTRAINT user_accounts_timestamps_check CHECK (updated_at >= created_at)
);

CREATE TABLE app.roles (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  code varchar(64) NOT NULL,
  name varchar(80) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'active',
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT roles_company_id_id_unique UNIQUE (company_id, id),
  CONSTRAINT roles_company_code_unique UNIQUE (
    company_id,
    code
  ),
  CONSTRAINT roles_company_fk FOREIGN KEY (company_id)
    REFERENCES app.companies (id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT roles_code_check CHECK (
    code = lower(btrim(code))
    AND char_length(code) BETWEEN 1 AND 64
    AND code ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'
  ),
  CONSTRAINT roles_name_check CHECK (
    name = btrim(name)
    AND char_length(name) BETWEEN 1 AND 80
    AND name !~ '[[:cntrl:]]'
  ),
  CONSTRAINT roles_status_check CHECK (status IN ('active', 'inactive')),
  CONSTRAINT roles_version_check CHECK (version >= 1),
  CONSTRAINT roles_timestamps_check CHECK (updated_at >= created_at)
);

CREATE INDEX roles_company_status_idx
  ON app.roles (company_id, status);

CREATE TABLE app.company_memberships (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  user_account_id uuid NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'active',
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT company_memberships_company_id_id_unique UNIQUE (company_id, id),
  CONSTRAINT company_memberships_company_user_unique UNIQUE (
    company_id,
    user_account_id
  ),
  CONSTRAINT company_memberships_company_fk FOREIGN KEY (company_id)
    REFERENCES app.companies (id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT company_memberships_user_account_fk FOREIGN KEY (user_account_id)
    REFERENCES app.user_accounts (id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT company_memberships_status_check CHECK (
    status IN ('active', 'suspended', 'revoked')
  ),
  CONSTRAINT company_memberships_version_check CHECK (version >= 1),
  CONSTRAINT company_memberships_timestamps_check CHECK (
    updated_at >= created_at
  )
);

CREATE INDEX company_memberships_user_account_idx
  ON app.company_memberships (user_account_id, company_id);

CREATE INDEX company_memberships_company_status_idx
  ON app.company_memberships (company_id, status);

CREATE TABLE app.membership_roles (
  company_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  role_id uuid NOT NULL,
  assigned_on date NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT membership_roles_pk PRIMARY KEY (
    company_id,
    membership_id,
    role_id
  ),
  CONSTRAINT membership_roles_membership_fk FOREIGN KEY (
    company_id,
    membership_id
  )
    REFERENCES app.company_memberships (company_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT membership_roles_role_fk FOREIGN KEY (company_id, role_id)
    REFERENCES app.roles (company_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT membership_roles_assigned_on_check CHECK (
    assigned_on BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'
  ),
  CONSTRAINT membership_roles_version_check CHECK (version >= 1),
  CONSTRAINT membership_roles_timestamps_check CHECK (
    updated_at >= created_at
  )
);

CREATE INDEX membership_roles_role_idx
  ON app.membership_roles (company_id, role_id, membership_id);

CREATE TABLE app.role_permissions (
  company_id uuid NOT NULL,
  role_id uuid NOT NULL,
  permission_key varchar(128) NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT role_permissions_pk PRIMARY KEY (
    company_id,
    role_id,
    permission_key
  ),
  CONSTRAINT role_permissions_role_fk FOREIGN KEY (company_id, role_id)
    REFERENCES app.roles (company_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT role_permissions_key_check CHECK (
    permission_key = lower(btrim(permission_key))
    AND char_length(permission_key) BETWEEN 3 AND 128
    AND permission_key ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*([.][a-z][a-z0-9]*(-[a-z0-9]+)*)+$'
  ),
  CONSTRAINT role_permissions_version_check CHECK (version >= 1),
  CONSTRAINT role_permissions_timestamps_check CHECK (
    updated_at >= created_at
  )
);

CREATE INDEX role_permissions_permission_idx
  ON app.role_permissions (company_id, permission_key, role_id);

ALTER TABLE app.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.companies FORCE ROW LEVEL SECURITY;
ALTER TABLE app.user_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.user_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE app.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.roles FORCE ROW LEVEL SECURITY;
ALTER TABLE app.company_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.company_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE app.membership_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.membership_roles FORCE ROW LEVEL SECURITY;
ALTER TABLE app.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.role_permissions FORCE ROW LEVEL SECURITY;

CREATE POLICY companies_migrator_all ON app.companies
  FOR ALL
  TO zampayroll_migrator
  USING (true)
  WITH CHECK (true);

CREATE POLICY user_accounts_migrator_all ON app.user_accounts
  FOR ALL
  TO zampayroll_migrator
  USING (true)
  WITH CHECK (true);

CREATE POLICY roles_migrator_all ON app.roles
  FOR ALL
  TO zampayroll_migrator
  USING (true)
  WITH CHECK (true);

CREATE POLICY company_memberships_migrator_all ON app.company_memberships
  FOR ALL
  TO zampayroll_migrator
  USING (true)
  WITH CHECK (true);

CREATE POLICY membership_roles_migrator_all ON app.membership_roles
  FOR ALL
  TO zampayroll_migrator
  USING (true)
  WITH CHECK (true);

CREATE POLICY role_permissions_migrator_all ON app.role_permissions
  FOR ALL
  TO zampayroll_migrator
  USING (true)
  WITH CHECK (true);

CREATE POLICY companies_runtime_select ON app.companies
  FOR SELECT
  TO zampayroll_app
  USING (id = app.current_company_id());

CREATE POLICY companies_runtime_insert ON app.companies
  FOR INSERT
  TO zampayroll_app
  WITH CHECK (id = app.current_company_id());

CREATE POLICY companies_runtime_update ON app.companies
  FOR UPDATE
  TO zampayroll_app
  USING (id = app.current_company_id())
  WITH CHECK (id = app.current_company_id());

CREATE POLICY roles_runtime_select ON app.roles
  FOR SELECT
  TO zampayroll_app
  USING (company_id = app.current_company_id());

CREATE POLICY roles_runtime_insert ON app.roles
  FOR INSERT
  TO zampayroll_app
  WITH CHECK (company_id = app.current_company_id());

CREATE POLICY roles_runtime_update ON app.roles
  FOR UPDATE
  TO zampayroll_app
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

CREATE POLICY company_memberships_runtime_select ON app.company_memberships
  FOR SELECT
  TO zampayroll_app
  USING (company_id = app.current_company_id());

CREATE POLICY company_memberships_runtime_insert ON app.company_memberships
  FOR INSERT
  TO zampayroll_app
  WITH CHECK (company_id = app.current_company_id());

CREATE POLICY company_memberships_runtime_update ON app.company_memberships
  FOR UPDATE
  TO zampayroll_app
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

CREATE POLICY membership_roles_runtime_select ON app.membership_roles
  FOR SELECT
  TO zampayroll_app
  USING (company_id = app.current_company_id());

CREATE POLICY membership_roles_runtime_insert ON app.membership_roles
  FOR INSERT
  TO zampayroll_app
  WITH CHECK (company_id = app.current_company_id());

CREATE POLICY membership_roles_runtime_update ON app.membership_roles
  FOR UPDATE
  TO zampayroll_app
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

CREATE POLICY role_permissions_runtime_select ON app.role_permissions
  FOR SELECT
  TO zampayroll_app
  USING (company_id = app.current_company_id());

CREATE POLICY role_permissions_runtime_insert ON app.role_permissions
  FOR INSERT
  TO zampayroll_app
  WITH CHECK (company_id = app.current_company_id());

CREATE POLICY role_permissions_runtime_update ON app.role_permissions
  FOR UPDATE
  TO zampayroll_app
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

GRANT SELECT, INSERT, UPDATE ON TABLE
  app.companies,
  app.user_accounts,
  app.roles,
  app.company_memberships,
  app.membership_roles,
  app.role_permissions
TO zampayroll_app;

REVOKE DELETE ON TABLE
  app.companies,
  app.user_accounts,
  app.roles,
  app.company_memberships,
  app.membership_roles,
  app.role_permissions
FROM zampayroll_app;

-- Down Migration

DROP TABLE app.role_permissions;
DROP TABLE app.membership_roles;
DROP TABLE app.company_memberships;
DROP TABLE app.roles;
DROP TABLE app.user_accounts;
DROP TABLE app.companies;

REVOKE EXECUTE ON FUNCTION app.current_company_id() FROM zampayroll_app;
DROP FUNCTION app.current_company_id();

COMMENT ON SCHEMA app IS
  'Version-controlled ZamPayroll application objects. No payroll domain tables exist in Phase 1.';

ALTER DEFAULT PRIVILEGES FOR ROLE zampayroll_migrator IN SCHEMA app
  GRANT DELETE ON TABLES TO zampayroll_app;

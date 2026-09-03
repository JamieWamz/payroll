-- Up Migration

COMMENT ON SCHEMA app IS
  'Version-controlled ZamPayroll application objects with tenant, identity, authentication, audit, and workforce foundations.';

CREATE TABLE app.employees (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  employee_number varchar(64) NOT NULL,
  given_name varchar(80) NOT NULL,
  middle_name varchar(80),
  family_name varchar(80) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'active',
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT employees_company_id_id_unique UNIQUE (company_id, id),
  CONSTRAINT employees_company_number_unique UNIQUE (
    company_id,
    employee_number
  ),
  CONSTRAINT employees_company_fk FOREIGN KEY (company_id)
    REFERENCES app.companies (id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT employees_number_check CHECK (
    employee_number = upper(btrim(employee_number))
    AND char_length(employee_number) BETWEEN 1 AND 64
    AND employee_number ~ '^[A-Z0-9]+([./-][A-Z0-9]+)*$'
  ),
  CONSTRAINT employees_given_name_check CHECK (
    given_name = btrim(given_name)
    AND char_length(given_name) BETWEEN 1 AND 80
    AND given_name !~ '[[:cntrl:]]'
  ),
  CONSTRAINT employees_middle_name_check CHECK (
    middle_name IS NULL
    OR (
      middle_name = btrim(middle_name)
      AND char_length(middle_name) BETWEEN 1 AND 80
      AND middle_name !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT employees_family_name_check CHECK (
    family_name = btrim(family_name)
    AND char_length(family_name) BETWEEN 1 AND 80
    AND family_name !~ '[[:cntrl:]]'
  ),
  CONSTRAINT employees_status_check CHECK (
    status IN ('active', 'archived')
  ),
  CONSTRAINT employees_version_check CHECK (version >= 1),
  CONSTRAINT employees_timestamps_check CHECK (updated_at >= created_at)
);

CREATE INDEX employees_company_status_idx
  ON app.employees (company_id, status, family_name, given_name);

CREATE TABLE app.employments (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  position_title varchar(120) NOT NULL,
  starts_on date NOT NULL,
  ends_on date,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT employments_company_id_id_unique UNIQUE (company_id, id),
  CONSTRAINT employments_employee_fk FOREIGN KEY (company_id, employee_id)
    REFERENCES app.employees (company_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT employments_position_title_check CHECK (
    position_title = btrim(position_title)
    AND char_length(position_title) BETWEEN 1 AND 120
    AND position_title !~ '[[:cntrl:]]'
  ),
  CONSTRAINT employments_dates_check CHECK (
    starts_on BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'
    AND (
      ends_on IS NULL
      OR ends_on BETWEEN starts_on AND DATE '9999-12-31'
    )
  ),
  CONSTRAINT employments_version_check CHECK (version >= 1),
  CONSTRAINT employments_timestamps_check CHECK (updated_at >= created_at)
);

CREATE INDEX employments_company_employee_period_idx
  ON app.employments (company_id, employee_id, starts_on DESC, id);

CREATE UNIQUE INDEX employments_one_open_period_idx
  ON app.employments (company_id, employee_id)
  WHERE ends_on IS NULL;

ALTER TABLE app.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.employees FORCE ROW LEVEL SECURITY;
ALTER TABLE app.employments ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.employments FORCE ROW LEVEL SECURITY;

CREATE POLICY employees_migrator_all ON app.employees
  FOR ALL
  TO zampayroll_migrator
  USING (true)
  WITH CHECK (true);

CREATE POLICY employments_migrator_all ON app.employments
  FOR ALL
  TO zampayroll_migrator
  USING (true)
  WITH CHECK (true);

CREATE POLICY employees_runtime_select ON app.employees
  FOR SELECT
  TO zampayroll_app
  USING (company_id = app.current_company_id());

CREATE POLICY employees_runtime_insert ON app.employees
  FOR INSERT
  TO zampayroll_app
  WITH CHECK (company_id = app.current_company_id());

CREATE POLICY employees_runtime_update ON app.employees
  FOR UPDATE
  TO zampayroll_app
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

CREATE POLICY employments_runtime_select ON app.employments
  FOR SELECT
  TO zampayroll_app
  USING (company_id = app.current_company_id());

CREATE POLICY employments_runtime_insert ON app.employments
  FOR INSERT
  TO zampayroll_app
  WITH CHECK (company_id = app.current_company_id());

CREATE POLICY employments_runtime_update ON app.employments
  FOR UPDATE
  TO zampayroll_app
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

GRANT SELECT, INSERT, UPDATE ON TABLE
  app.employees,
  app.employments
TO zampayroll_app;

REVOKE DELETE ON TABLE
  app.employees,
  app.employments
FROM zampayroll_app;

-- Down Migration

DROP TABLE app.employments;
DROP TABLE app.employees;

COMMENT ON SCHEMA app IS
  'Version-controlled ZamPayroll application objects with tenant, identity, authentication, and audit foundations.';

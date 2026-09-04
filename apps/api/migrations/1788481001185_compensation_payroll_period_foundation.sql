-- Up Migration

COMMENT ON SCHEMA app IS
  'Version-controlled ZamPayroll application objects with tenant, identity, authentication, audit, workforce, compensation, and payroll-period foundations.';

CREATE TABLE app.salaries (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  employment_id uuid NOT NULL,
  basis varchar(16) NOT NULL DEFAULT 'monthly',
  amount_minor_units bigint NOT NULL,
  currency char(3) NOT NULL,
  currency_scale smallint NOT NULL,
  starts_on date NOT NULL,
  ends_on date,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT salaries_company_id_id_unique UNIQUE (company_id, id),
  CONSTRAINT salaries_employment_fk FOREIGN KEY (company_id, employment_id)
    REFERENCES app.employments (company_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT salaries_basis_check CHECK (basis = 'monthly'),
  CONSTRAINT salaries_amount_check CHECK (amount_minor_units > 0),
  CONSTRAINT salaries_currency_check CHECK (
    currency = 'ZMW'
    AND currency_scale = 2
  ),
  CONSTRAINT salaries_dates_check CHECK (
    starts_on BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'
    AND (
      ends_on IS NULL
      OR ends_on BETWEEN starts_on AND DATE '9999-12-31'
    )
  ),
  CONSTRAINT salaries_version_check CHECK (version >= 1),
  CONSTRAINT salaries_timestamps_check CHECK (updated_at >= created_at)
);

CREATE INDEX salaries_company_employment_period_idx
  ON app.salaries (company_id, employment_id, starts_on DESC, id);

CREATE UNIQUE INDEX salaries_one_open_period_idx
  ON app.salaries (company_id, employment_id)
  WHERE ends_on IS NULL;

CREATE TABLE app.compensation_components (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  employment_id uuid NOT NULL,
  code varchar(32) NOT NULL,
  name varchar(80) NOT NULL,
  kind varchar(16) NOT NULL,
  basis varchar(24) NOT NULL DEFAULT 'fixed_per_period',
  amount_minor_units bigint NOT NULL,
  currency char(3) NOT NULL,
  currency_scale smallint NOT NULL,
  starts_on date NOT NULL,
  ends_on date,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT compensation_components_company_id_id_unique UNIQUE (
    company_id,
    id
  ),
  CONSTRAINT compensation_components_employment_fk FOREIGN KEY (
    company_id,
    employment_id
  )
    REFERENCES app.employments (company_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT compensation_components_code_check CHECK (
    code = upper(btrim(code))
    AND char_length(code) BETWEEN 1 AND 32
    AND code ~ '^[A-Z0-9]+([_-][A-Z0-9]+)*$'
  ),
  CONSTRAINT compensation_components_name_check CHECK (
    name = btrim(name)
    AND char_length(name) BETWEEN 1 AND 80
    AND name !~ '[[:cntrl:]]'
  ),
  CONSTRAINT compensation_components_kind_check CHECK (
    kind IN ('allowance', 'deduction')
  ),
  CONSTRAINT compensation_components_basis_check CHECK (
    basis = 'fixed_per_period'
  ),
  CONSTRAINT compensation_components_amount_check CHECK (
    amount_minor_units > 0
  ),
  CONSTRAINT compensation_components_currency_check CHECK (
    currency = 'ZMW'
    AND currency_scale = 2
  ),
  CONSTRAINT compensation_components_dates_check CHECK (
    starts_on BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'
    AND (
      ends_on IS NULL
      OR ends_on BETWEEN starts_on AND DATE '9999-12-31'
    )
  ),
  CONSTRAINT compensation_components_version_check CHECK (version >= 1),
  CONSTRAINT compensation_components_timestamps_check CHECK (
    updated_at >= created_at
  )
);

CREATE INDEX compensation_components_employment_period_idx
  ON app.compensation_components (
    company_id,
    employment_id,
    kind,
    code,
    starts_on DESC,
    id
  );

CREATE UNIQUE INDEX compensation_components_one_open_period_idx
  ON app.compensation_components (company_id, employment_id, kind, code)
  WHERE ends_on IS NULL;

CREATE TABLE app.payroll_periods (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  code varchar(32) NOT NULL,
  kind varchar(16) NOT NULL DEFAULT 'regular',
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  payment_date date NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT payroll_periods_company_id_id_unique UNIQUE (company_id, id),
  CONSTRAINT payroll_periods_company_code_unique UNIQUE (company_id, code),
  CONSTRAINT payroll_periods_company_fk FOREIGN KEY (company_id)
    REFERENCES app.companies (id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT payroll_periods_code_check CHECK (
    code = upper(btrim(code))
    AND char_length(code) BETWEEN 1 AND 32
    AND code ~ '^[A-Z0-9]+([./_-][A-Z0-9]+)*$'
  ),
  CONSTRAINT payroll_periods_kind_check CHECK (
    kind IN ('regular', 'off_cycle')
  ),
  CONSTRAINT payroll_periods_dates_check CHECK (
    starts_on BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'
    AND ends_on BETWEEN starts_on AND DATE '9999-12-31'
    AND payment_date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'
  ),
  CONSTRAINT payroll_periods_version_check CHECK (version >= 1),
  CONSTRAINT payroll_periods_timestamps_check CHECK (
    updated_at >= created_at
  )
);

CREATE INDEX payroll_periods_company_payment_idx
  ON app.payroll_periods (company_id, payment_date DESC, id);

CREATE FUNCTION app.enforce_salary_period()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, app
AS $function$
DECLARE
  employment_starts_on date;
  employment_ends_on date;
  lock_key text;
BEGIN
  lock_key := NEW.company_id::text || ':' || NEW.employment_id::text
    || ':compensation';
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(lock_key, 0)
  );

  SELECT employment.starts_on, employment.ends_on
  INTO employment_starts_on, employment_ends_on
  FROM app.employments AS employment
  WHERE employment.company_id = NEW.company_id
    AND employment.id = NEW.employment_id;

  IF employment_starts_on IS NOT NULL
    AND (
      NEW.starts_on < employment_starts_on
      OR (
        employment_ends_on IS NOT NULL
        AND (NEW.ends_on IS NULL OR NEW.ends_on > employment_ends_on)
      )
    )
  THEN
    RAISE EXCEPTION 'salary period is outside its employment period'
      USING ERRCODE = '23514',
            CONSTRAINT = 'salaries_within_employment';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM app.salaries AS salary
    WHERE salary.company_id = NEW.company_id
      AND salary.employment_id = NEW.employment_id
      AND salary.id <> NEW.id
      AND pg_catalog.daterange(
        salary.starts_on,
        COALESCE(salary.ends_on, DATE 'infinity'),
        '[]'
      ) && pg_catalog.daterange(
        NEW.starts_on,
        COALESCE(NEW.ends_on, DATE 'infinity'),
        '[]'
      )
  ) THEN
    RAISE EXCEPTION 'salary periods for an employment cannot overlap'
      USING ERRCODE = '23P01',
            CONSTRAINT = 'salaries_no_overlap';
  END IF;

  RETURN NEW;
END
$function$;

CREATE TRIGGER salaries_enforce_period
BEFORE INSERT OR UPDATE OF company_id, employment_id, starts_on, ends_on
ON app.salaries
FOR EACH ROW
EXECUTE FUNCTION app.enforce_salary_period();

CREATE FUNCTION app.enforce_compensation_component_period()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, app
AS $function$
DECLARE
  employment_starts_on date;
  employment_ends_on date;
  lock_key text;
BEGIN
  lock_key := NEW.company_id::text || ':' || NEW.employment_id::text
    || ':compensation';
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(lock_key, 0)
  );

  SELECT employment.starts_on, employment.ends_on
  INTO employment_starts_on, employment_ends_on
  FROM app.employments AS employment
  WHERE employment.company_id = NEW.company_id
    AND employment.id = NEW.employment_id;

  IF employment_starts_on IS NOT NULL
    AND (
      NEW.starts_on < employment_starts_on
      OR (
        employment_ends_on IS NOT NULL
        AND (NEW.ends_on IS NULL OR NEW.ends_on > employment_ends_on)
      )
    )
  THEN
    RAISE EXCEPTION 'compensation period is outside its employment period'
      USING ERRCODE = '23514',
            CONSTRAINT = 'compensation_components_within_employment';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM app.compensation_components AS component
    WHERE component.company_id = NEW.company_id
      AND component.employment_id = NEW.employment_id
      AND component.kind = NEW.kind
      AND component.code = NEW.code
      AND component.id <> NEW.id
      AND pg_catalog.daterange(
        component.starts_on,
        COALESCE(component.ends_on, DATE 'infinity'),
        '[]'
      ) && pg_catalog.daterange(
        NEW.starts_on,
        COALESCE(NEW.ends_on, DATE 'infinity'),
        '[]'
      )
  ) THEN
    RAISE EXCEPTION 'matching compensation component periods cannot overlap'
      USING ERRCODE = '23P01',
            CONSTRAINT = 'compensation_components_no_overlap';
  END IF;

  RETURN NEW;
END
$function$;

CREATE TRIGGER compensation_components_enforce_period
BEFORE INSERT OR UPDATE OF
  company_id,
  employment_id,
  code,
  kind,
  starts_on,
  ends_on
ON app.compensation_components
FOR EACH ROW
EXECUTE FUNCTION app.enforce_compensation_component_period();

CREATE FUNCTION app.enforce_employment_compensation_period()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, app
AS $function$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      NEW.company_id::text || ':' || NEW.id::text || ':compensation',
      0
    )
  );

  IF EXISTS (
    SELECT 1
    FROM app.salaries AS salary
    WHERE salary.company_id = NEW.company_id
      AND salary.employment_id = NEW.id
      AND (
        salary.starts_on < NEW.starts_on
        OR (
          NEW.ends_on IS NOT NULL
          AND (salary.ends_on IS NULL OR salary.ends_on > NEW.ends_on)
        )
      )
  ) OR EXISTS (
    SELECT 1
    FROM app.compensation_components AS component
    WHERE component.company_id = NEW.company_id
      AND component.employment_id = NEW.id
      AND (
        component.starts_on < NEW.starts_on
        OR (
          NEW.ends_on IS NOT NULL
          AND (component.ends_on IS NULL OR component.ends_on > NEW.ends_on)
        )
      )
  ) THEN
    RAISE EXCEPTION 'employment period cannot exclude compensation history'
      USING ERRCODE = '23514',
            CONSTRAINT = 'employments_cover_compensation';
  END IF;

  RETURN NEW;
END
$function$;

CREATE TRIGGER employments_enforce_compensation_period
BEFORE UPDATE OF starts_on, ends_on
ON app.employments
FOR EACH ROW
EXECUTE FUNCTION app.enforce_employment_compensation_period();

CREATE FUNCTION app.enforce_regular_payroll_period()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, app
AS $function$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(NEW.company_id::text || ':payroll-period', 0)
  );

  IF NEW.kind = 'regular' AND EXISTS (
    SELECT 1
    FROM app.payroll_periods AS payroll_period
    WHERE payroll_period.company_id = NEW.company_id
      AND payroll_period.kind = 'regular'
      AND payroll_period.id <> NEW.id
      AND pg_catalog.daterange(
        payroll_period.starts_on,
        payroll_period.ends_on,
        '[]'
      ) && pg_catalog.daterange(NEW.starts_on, NEW.ends_on, '[]')
  ) THEN
    RAISE EXCEPTION 'regular payroll periods cannot overlap'
      USING ERRCODE = '23P01',
            CONSTRAINT = 'payroll_periods_regular_no_overlap';
  END IF;

  RETURN NEW;
END
$function$;

CREATE TRIGGER payroll_periods_enforce_regular_period
BEFORE INSERT OR UPDATE OF company_id, kind, starts_on, ends_on
ON app.payroll_periods
FOR EACH ROW
EXECUTE FUNCTION app.enforce_regular_payroll_period();

ALTER TABLE app.salaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.salaries FORCE ROW LEVEL SECURITY;
ALTER TABLE app.compensation_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.compensation_components FORCE ROW LEVEL SECURITY;
ALTER TABLE app.payroll_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.payroll_periods FORCE ROW LEVEL SECURITY;

CREATE POLICY salaries_migrator_all ON app.salaries
  FOR ALL
  TO zampayroll_migrator
  USING (true)
  WITH CHECK (true);

CREATE POLICY compensation_components_migrator_all
ON app.compensation_components
  FOR ALL
  TO zampayroll_migrator
  USING (true)
  WITH CHECK (true);

CREATE POLICY payroll_periods_migrator_all ON app.payroll_periods
  FOR ALL
  TO zampayroll_migrator
  USING (true)
  WITH CHECK (true);

CREATE POLICY salaries_runtime_select ON app.salaries
  FOR SELECT
  TO zampayroll_app
  USING (company_id = app.current_company_id());

CREATE POLICY salaries_runtime_insert ON app.salaries
  FOR INSERT
  TO zampayroll_app
  WITH CHECK (company_id = app.current_company_id());

CREATE POLICY salaries_runtime_update ON app.salaries
  FOR UPDATE
  TO zampayroll_app
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

CREATE POLICY compensation_components_runtime_select
ON app.compensation_components
  FOR SELECT
  TO zampayroll_app
  USING (company_id = app.current_company_id());

CREATE POLICY compensation_components_runtime_insert
ON app.compensation_components
  FOR INSERT
  TO zampayroll_app
  WITH CHECK (company_id = app.current_company_id());

CREATE POLICY compensation_components_runtime_update
ON app.compensation_components
  FOR UPDATE
  TO zampayroll_app
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

CREATE POLICY payroll_periods_runtime_select ON app.payroll_periods
  FOR SELECT
  TO zampayroll_app
  USING (company_id = app.current_company_id());

CREATE POLICY payroll_periods_runtime_insert ON app.payroll_periods
  FOR INSERT
  TO zampayroll_app
  WITH CHECK (company_id = app.current_company_id());

CREATE POLICY payroll_periods_runtime_update ON app.payroll_periods
  FOR UPDATE
  TO zampayroll_app
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

GRANT SELECT, INSERT, UPDATE ON TABLE
  app.salaries,
  app.compensation_components,
  app.payroll_periods
TO zampayroll_app;

REVOKE DELETE ON TABLE
  app.salaries,
  app.compensation_components,
  app.payroll_periods
FROM zampayroll_app;

-- Down Migration

DROP TABLE app.payroll_periods;
DROP TABLE app.compensation_components;
DROP TABLE app.salaries;
DROP TRIGGER IF EXISTS employments_enforce_compensation_period
ON app.employments;
DROP FUNCTION IF EXISTS app.enforce_employment_compensation_period();
DROP FUNCTION app.enforce_regular_payroll_period();
DROP FUNCTION app.enforce_compensation_component_period();
DROP FUNCTION app.enforce_salary_period();

COMMENT ON SCHEMA app IS
  'Version-controlled ZamPayroll application objects with tenant, identity, authentication, audit, and workforce foundations.';

-- Up Migration

COMMENT ON SCHEMA app IS
  'Version-controlled ZamPayroll application objects with tenant, identity, authentication, audit, workforce, compensation, payroll-period, statutory-configuration, and payroll-run foundations.';

-- Runtime has no DELETE privilege. The migration owner retains a deliberate
-- administrative cleanup path without weakening runtime evidence immutability.
DROP TRIGGER statutory_sources_enforce_lifecycle ON app.statutory_sources;
CREATE TRIGGER statutory_sources_enforce_lifecycle
BEFORE INSERT OR UPDATE
ON app.statutory_sources
FOR EACH ROW
EXECUTE FUNCTION app.enforce_statutory_source_lifecycle();

ALTER TABLE app.employments
  ADD CONSTRAINT employments_company_id_id_employee_unique UNIQUE (
    company_id,
    id,
    employee_id
  );

CREATE TABLE app.payroll_runs (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  payroll_period_id uuid NOT NULL,
  statutory_configuration_id uuid NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'draft',
  created_by_membership_id uuid NOT NULL,
  calculation_version varchar(64),
  rounding_policy varchar(64),
  calculated_by_membership_id uuid,
  calculated_at timestamptz,
  finalized_by_membership_id uuid,
  finalized_at timestamptz,
  row_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT payroll_runs_company_id_id_unique UNIQUE (company_id, id),
  CONSTRAINT payroll_runs_company_period_unique UNIQUE (
    company_id,
    payroll_period_id
  ),
  CONSTRAINT payroll_runs_company_fk FOREIGN KEY (company_id)
    REFERENCES app.companies (id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT payroll_runs_period_fk FOREIGN KEY (
    company_id,
    payroll_period_id
  )
    REFERENCES app.payroll_periods (company_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT payroll_runs_statutory_configuration_fk FOREIGN KEY (
    company_id,
    statutory_configuration_id
  )
    REFERENCES app.statutory_configurations (company_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT payroll_runs_creator_fk FOREIGN KEY (
    company_id,
    created_by_membership_id
  )
    REFERENCES app.company_memberships (company_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT payroll_runs_calculator_fk FOREIGN KEY (
    company_id,
    calculated_by_membership_id
  )
    REFERENCES app.company_memberships (company_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT payroll_runs_finalizer_fk FOREIGN KEY (
    company_id,
    finalized_by_membership_id
  )
    REFERENCES app.company_memberships (company_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT payroll_runs_status_check CHECK (
    status IN ('draft', 'calculated', 'finalized')
  ),
  CONSTRAINT payroll_runs_calculation_version_check CHECK (
    calculation_version IS NULL
    OR (
      calculation_version = upper(btrim(calculation_version))
      AND char_length(calculation_version) BETWEEN 1 AND 64
      AND calculation_version ~ '^[A-Z0-9]+([._-][A-Z0-9]+)*$'
    )
  ),
  CONSTRAINT payroll_runs_rounding_policy_check CHECK (
    rounding_policy IS NULL
    OR (
      rounding_policy = upper(btrim(rounding_policy))
      AND char_length(rounding_policy) BETWEEN 1 AND 64
      AND rounding_policy ~ '^[A-Z0-9]+([._-][A-Z0-9]+)*$'
    )
  ),
  CONSTRAINT payroll_runs_lifecycle_fields_check CHECK (
    (
      status = 'draft'
      AND calculation_version IS NULL
      AND rounding_policy IS NULL
      AND calculated_by_membership_id IS NULL
      AND calculated_at IS NULL
      AND finalized_by_membership_id IS NULL
      AND finalized_at IS NULL
    )
    OR (
      status = 'calculated'
      AND calculation_version IS NOT NULL
      AND rounding_policy IS NOT NULL
      AND calculated_by_membership_id IS NOT NULL
      AND calculated_at IS NOT NULL
      AND finalized_by_membership_id IS NULL
      AND finalized_at IS NULL
    )
    OR (
      status = 'finalized'
      AND calculation_version IS NOT NULL
      AND rounding_policy IS NOT NULL
      AND calculated_by_membership_id IS NOT NULL
      AND calculated_at IS NOT NULL
      AND finalized_by_membership_id IS NOT NULL
      AND finalized_at IS NOT NULL
    )
  ),
  CONSTRAINT payroll_runs_time_order_check CHECK (
    (calculated_at IS NULL OR calculated_at >= created_at)
    AND (finalized_at IS NULL OR finalized_at >= calculated_at)
    AND updated_at >= created_at
  ),
  CONSTRAINT payroll_runs_row_version_check CHECK (row_version >= 1)
);

CREATE INDEX payroll_runs_company_status_period_idx
  ON app.payroll_runs (company_id, status, payroll_period_id, id);

CREATE TABLE app.payroll_run_employees (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  payroll_run_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  employment_id uuid NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'selected',
  input_snapshot jsonb NOT NULL,
  result_snapshot jsonb,
  row_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT payroll_run_employees_company_id_id_unique UNIQUE (
    company_id,
    id
  ),
  CONSTRAINT payroll_run_employees_company_id_id_run_unique UNIQUE (
    company_id,
    id,
    payroll_run_id
  ),
  CONSTRAINT payroll_run_employees_run_employee_unique UNIQUE (
    company_id,
    payroll_run_id,
    employee_id
  ),
  CONSTRAINT payroll_run_employees_run_fk FOREIGN KEY (
    company_id,
    payroll_run_id
  )
    REFERENCES app.payroll_runs (company_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT payroll_run_employees_employee_fk FOREIGN KEY (
    company_id,
    employee_id
  )
    REFERENCES app.employees (company_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT payroll_run_employees_employment_fk FOREIGN KEY (
    company_id,
    employment_id,
    employee_id
  )
    REFERENCES app.employments (company_id, id, employee_id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT payroll_run_employees_status_check CHECK (
    status IN ('selected', 'calculated')
  ),
  CONSTRAINT payroll_run_employees_input_check CHECK (
    jsonb_typeof(input_snapshot) = 'object'
    AND octet_length(input_snapshot::text) <= 262144
  ),
  CONSTRAINT payroll_run_employees_result_check CHECK (
    (
      status = 'selected'
      AND result_snapshot IS NULL
    )
    OR (
      status = 'calculated'
      AND jsonb_typeof(result_snapshot) = 'object'
      AND octet_length(result_snapshot::text) <= 262144
    )
  ),
  CONSTRAINT payroll_run_employees_row_version_check CHECK (row_version >= 1),
  CONSTRAINT payroll_run_employees_timestamps_check CHECK (
    updated_at >= created_at
  )
);

CREATE INDEX payroll_run_employees_run_status_idx
  ON app.payroll_run_employees (
    company_id,
    payroll_run_id,
    status,
    employee_id
  );

CREATE TABLE app.payroll_run_components (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  payroll_run_employee_id uuid NOT NULL,
  payroll_run_id uuid NOT NULL,
  code varchar(64) NOT NULL,
  kind varchar(24) NOT NULL,
  amount_minor_units bigint NOT NULL,
  currency char(3) NOT NULL,
  currency_scale smallint NOT NULL,
  row_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT payroll_run_components_company_id_id_unique UNIQUE (
    company_id,
    id
  ),
  CONSTRAINT payroll_run_components_employee_fk FOREIGN KEY (
    company_id,
    payroll_run_employee_id,
    payroll_run_id
  )
    REFERENCES app.payroll_run_employees (company_id, id, payroll_run_id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT payroll_run_components_code_check CHECK (
    code = upper(btrim(code))
    AND char_length(code) BETWEEN 1 AND 64
    AND code ~ '^[A-Z0-9]+([._-][A-Z0-9]+)*$'
  ),
  CONSTRAINT payroll_run_components_kind_check CHECK (
    kind IN (
      'earning',
      'statutory_deduction',
      'other_deduction',
      'employer_contribution'
    )
  ),
  CONSTRAINT payroll_run_components_amount_check CHECK (
    amount_minor_units >= 0
  ),
  CONSTRAINT payroll_run_components_currency_check CHECK (
    currency = 'ZMW'
    AND currency_scale = 2
  ),
  CONSTRAINT payroll_run_components_row_version_check CHECK (row_version >= 1),
  CONSTRAINT payroll_run_components_timestamps_check CHECK (
    updated_at >= created_at
  )
);

CREATE INDEX payroll_run_components_employee_kind_idx
  ON app.payroll_run_components (
    company_id,
    payroll_run_employee_id,
    kind,
    code,
    id
  );

CREATE FUNCTION app.enforce_payroll_run_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, app
AS $function$
DECLARE
  configuration_effective_from date;
  configuration_effective_to date;
  configuration_status varchar(16);
  period_starts_on date;
  period_ends_on date;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      NEW.company_id::text || ':' || NEW.id::text || ':payroll-run',
      0
    )
  );

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'payroll run must be created as a draft'
        USING ERRCODE = '23514',
              CONSTRAINT = 'payroll_runs_create_draft';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM app.company_memberships AS membership
      WHERE membership.company_id = NEW.company_id
        AND membership.id = NEW.created_by_membership_id
        AND membership.status = 'active'
    ) THEN
      RAISE EXCEPTION 'payroll action requires an active company membership'
        USING ERRCODE = '23514',
              CONSTRAINT = 'payroll_runs_active_actor';
    END IF;

    SELECT payroll_period.starts_on, payroll_period.ends_on
    INTO period_starts_on, period_ends_on
    FROM app.payroll_periods AS payroll_period
    WHERE payroll_period.company_id = NEW.company_id
      AND payroll_period.id = NEW.payroll_period_id;

    SELECT
      configuration.status,
      configuration.effective_from,
      configuration.effective_to
    INTO
      configuration_status,
      configuration_effective_from,
      configuration_effective_to
    FROM app.statutory_configurations AS configuration
    WHERE configuration.company_id = NEW.company_id
      AND configuration.id = NEW.statutory_configuration_id;

    IF configuration_status IS NOT NULL AND (
      configuration_status <> 'verified'
      OR configuration_effective_from > period_starts_on
      OR COALESCE(configuration_effective_to, DATE 'infinity') < period_ends_on
    ) THEN
      RAISE EXCEPTION 'verified statutory configuration must cover payroll period'
        USING ERRCODE = '23514',
              CONSTRAINT = 'payroll_runs_verified_configuration';
    END IF;
  ELSE
    IF NEW.id <> OLD.id
      OR NEW.company_id <> OLD.company_id
      OR NEW.payroll_period_id <> OLD.payroll_period_id
      OR NEW.statutory_configuration_id <> OLD.statutory_configuration_id
      OR NEW.created_by_membership_id <> OLD.created_by_membership_id
      OR NEW.created_at <> OLD.created_at
    THEN
      RAISE EXCEPTION 'payroll run identity and pinned inputs are immutable'
        USING ERRCODE = '23514',
              CONSTRAINT = 'payroll_runs_pinned_inputs_immutable';
    END IF;

    IF OLD.status = 'finalized' THEN
      RAISE EXCEPTION 'finalized payroll run is immutable'
        USING ERRCODE = '23514',
              CONSTRAINT = 'payroll_runs_finalized_immutable';
    END IF;
    IF (
      OLD.status = 'draft'
      AND NEW.status NOT IN ('draft', 'calculated')
    ) OR (
      OLD.status = 'calculated'
      AND NEW.status NOT IN ('draft', 'calculated', 'finalized')
    )
    THEN
      RAISE EXCEPTION 'payroll run status transition is invalid'
        USING ERRCODE = '23514',
              CONSTRAINT = 'payroll_runs_status_transition';
    END IF;

    IF NEW.status = 'draft' AND EXISTS (
      SELECT 1
      FROM app.payroll_run_employees AS run_employee
      WHERE run_employee.company_id = NEW.company_id
        AND run_employee.payroll_run_id = NEW.id
        AND run_employee.status <> 'selected'
    ) THEN
      RAISE EXCEPTION 'draft payroll run cannot retain calculated employees'
        USING ERRCODE = '23514',
              CONSTRAINT = 'payroll_runs_draft_employee_state';
    END IF;

    IF NEW.status IN ('calculated', 'finalized') THEN
      IF NOT EXISTS (
        SELECT 1
        FROM app.payroll_run_employees AS run_employee
        WHERE run_employee.company_id = NEW.company_id
          AND run_employee.payroll_run_id = NEW.id
      ) OR EXISTS (
        SELECT 1
        FROM app.payroll_run_employees AS run_employee
        WHERE run_employee.company_id = NEW.company_id
          AND run_employee.payroll_run_id = NEW.id
          AND run_employee.status <> 'calculated'
      ) THEN
        RAISE EXCEPTION 'every selected employee must be calculated'
          USING ERRCODE = '23514',
                CONSTRAINT = 'payroll_runs_calculation_complete';
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM app.company_memberships AS membership
        WHERE membership.company_id = NEW.company_id
          AND membership.id = NEW.calculated_by_membership_id
          AND membership.status = 'active'
      ) THEN
        RAISE EXCEPTION 'payroll action requires an active company membership'
          USING ERRCODE = '23514',
                CONSTRAINT = 'payroll_runs_active_actor';
      END IF;
    END IF;

    IF NEW.status = 'finalized' THEN
      IF NOT EXISTS (
        SELECT 1
        FROM app.company_memberships AS membership
        WHERE membership.company_id = NEW.company_id
          AND membership.id = NEW.finalized_by_membership_id
          AND membership.status = 'active'
      ) THEN
        RAISE EXCEPTION 'payroll action requires an active company membership'
          USING ERRCODE = '23514',
                CONSTRAINT = 'payroll_runs_active_actor';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END
$function$;

CREATE TRIGGER payroll_runs_enforce_lifecycle
BEFORE INSERT OR UPDATE
ON app.payroll_runs
FOR EACH ROW
EXECUTE FUNCTION app.enforce_payroll_run_lifecycle();

CREATE FUNCTION app.enforce_payroll_run_employee_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, app
AS $function$
DECLARE
  run_status varchar(16);
BEGIN
  SELECT payroll_run.status
  INTO run_status
  FROM app.payroll_runs AS payroll_run
  WHERE payroll_run.company_id = COALESCE(NEW.company_id, OLD.company_id)
    AND payroll_run.id = COALESCE(NEW.payroll_run_id, OLD.payroll_run_id);

  IF run_status = 'finalized' THEN
    RAISE EXCEPTION 'finalized payroll employee snapshot is immutable'
      USING ERRCODE = '23514',
            CONSTRAINT = 'payroll_run_employees_finalized_immutable';
  END IF;
  IF TG_OP = 'INSERT' AND run_status IS NOT NULL AND run_status <> 'draft' THEN
    RAISE EXCEPTION 'employees may only be selected on a draft payroll run'
      USING ERRCODE = '23514',
            CONSTRAINT = 'payroll_run_employees_draft_only';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.id <> OLD.id
    OR NEW.company_id <> OLD.company_id
    OR NEW.payroll_run_id <> OLD.payroll_run_id
    OR NEW.employee_id <> OLD.employee_id
    OR NEW.employment_id <> OLD.employment_id
    OR NEW.created_at <> OLD.created_at
  ) THEN
    RAISE EXCEPTION 'payroll employee identity is immutable'
      USING ERRCODE = '23514',
            CONSTRAINT = 'payroll_run_employees_identity_immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status = 'selected' AND EXISTS (
    SELECT 1
    FROM app.payroll_run_components AS component
    WHERE component.company_id = NEW.company_id
      AND component.payroll_run_employee_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'calculation components must be cleared before reopening'
      USING ERRCODE = '23514',
            CONSTRAINT = 'payroll_run_employees_components_cleared';
  END IF;

  RETURN COALESCE(NEW, OLD);
END
$function$;

CREATE TRIGGER payroll_run_employees_enforce_lifecycle
BEFORE INSERT OR UPDATE
ON app.payroll_run_employees
FOR EACH ROW
EXECUTE FUNCTION app.enforce_payroll_run_employee_lifecycle();

CREATE FUNCTION app.enforce_payroll_run_component_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, app
AS $function$
DECLARE
  employee_status varchar(16);
  run_status varchar(16);
BEGIN
  SELECT payroll_run.status, run_employee.status
  INTO run_status, employee_status
  FROM app.payroll_runs AS payroll_run
  JOIN app.payroll_run_employees AS run_employee
    ON run_employee.company_id = payroll_run.company_id
    AND run_employee.payroll_run_id = payroll_run.id
  WHERE payroll_run.company_id = COALESCE(NEW.company_id, OLD.company_id)
    AND payroll_run.id = COALESCE(NEW.payroll_run_id, OLD.payroll_run_id)
    AND run_employee.id = COALESCE(
      NEW.payroll_run_employee_id,
      OLD.payroll_run_employee_id
    );

  IF run_status = 'finalized' THEN
    RAISE EXCEPTION 'finalized payroll component is immutable'
      USING ERRCODE = '23514',
            CONSTRAINT = 'payroll_run_components_finalized_immutable';
  END IF;
  IF employee_status IS NOT NULL AND employee_status <> 'calculated' THEN
    RAISE EXCEPTION 'components require a calculated employee result'
      USING ERRCODE = '23514',
            CONSTRAINT = 'payroll_run_components_calculated_employee';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.id <> OLD.id
    OR NEW.company_id <> OLD.company_id
    OR NEW.payroll_run_employee_id <> OLD.payroll_run_employee_id
    OR NEW.payroll_run_id <> OLD.payroll_run_id
    OR NEW.created_at <> OLD.created_at
  ) THEN
    RAISE EXCEPTION 'payroll component identity is immutable'
      USING ERRCODE = '23514',
            CONSTRAINT = 'payroll_run_components_identity_immutable';
  END IF;

  RETURN COALESCE(NEW, OLD);
END
$function$;

CREATE TRIGGER payroll_run_components_enforce_lifecycle
BEFORE INSERT OR UPDATE
ON app.payroll_run_components
FOR EACH ROW
EXECUTE FUNCTION app.enforce_payroll_run_component_lifecycle();

ALTER TABLE app.payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.payroll_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE app.payroll_run_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.payroll_run_employees FORCE ROW LEVEL SECURITY;
ALTER TABLE app.payroll_run_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.payroll_run_components FORCE ROW LEVEL SECURITY;

CREATE POLICY payroll_runs_migrator_all ON app.payroll_runs
  FOR ALL TO zampayroll_migrator USING (true) WITH CHECK (true);
CREATE POLICY payroll_run_employees_migrator_all ON app.payroll_run_employees
  FOR ALL TO zampayroll_migrator USING (true) WITH CHECK (true);
CREATE POLICY payroll_run_components_migrator_all ON app.payroll_run_components
  FOR ALL TO zampayroll_migrator USING (true) WITH CHECK (true);

CREATE POLICY payroll_runs_runtime_select ON app.payroll_runs
  FOR SELECT TO zampayroll_app
  USING (company_id = app.current_company_id());
CREATE POLICY payroll_runs_runtime_insert ON app.payroll_runs
  FOR INSERT TO zampayroll_app
  WITH CHECK (company_id = app.current_company_id());
CREATE POLICY payroll_runs_runtime_update ON app.payroll_runs
  FOR UPDATE TO zampayroll_app
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

CREATE POLICY payroll_run_employees_runtime_select ON app.payroll_run_employees
  FOR SELECT TO zampayroll_app
  USING (company_id = app.current_company_id());
CREATE POLICY payroll_run_employees_runtime_insert ON app.payroll_run_employees
  FOR INSERT TO zampayroll_app
  WITH CHECK (company_id = app.current_company_id());
CREATE POLICY payroll_run_employees_runtime_update ON app.payroll_run_employees
  FOR UPDATE TO zampayroll_app
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

CREATE POLICY payroll_run_components_runtime_select ON app.payroll_run_components
  FOR SELECT TO zampayroll_app
  USING (company_id = app.current_company_id());
CREATE POLICY payroll_run_components_runtime_insert ON app.payroll_run_components
  FOR INSERT TO zampayroll_app
  WITH CHECK (company_id = app.current_company_id());
CREATE POLICY payroll_run_components_runtime_update ON app.payroll_run_components
  FOR UPDATE TO zampayroll_app
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

GRANT SELECT, INSERT, UPDATE ON TABLE
  app.payroll_runs,
  app.payroll_run_employees,
  app.payroll_run_components
TO zampayroll_app;

REVOKE DELETE ON TABLE
  app.payroll_runs,
  app.payroll_run_employees,
  app.payroll_run_components
FROM zampayroll_app;

-- Down Migration

DROP TABLE app.payroll_run_components;
DROP TABLE app.payroll_run_employees;
DROP TABLE app.payroll_runs;
DROP FUNCTION app.enforce_payroll_run_component_lifecycle();
DROP FUNCTION app.enforce_payroll_run_employee_lifecycle();
DROP FUNCTION app.enforce_payroll_run_lifecycle();
ALTER TABLE app.employments
  DROP CONSTRAINT employments_company_id_id_employee_unique;
DROP TRIGGER statutory_sources_enforce_lifecycle ON app.statutory_sources;
CREATE TRIGGER statutory_sources_enforce_lifecycle
BEFORE INSERT OR UPDATE OR DELETE
ON app.statutory_sources
FOR EACH ROW
EXECUTE FUNCTION app.enforce_statutory_source_lifecycle();

COMMENT ON SCHEMA app IS
  'Version-controlled ZamPayroll application objects with tenant, identity, authentication, audit, workforce, compensation, payroll-period, and statutory-configuration foundations.';

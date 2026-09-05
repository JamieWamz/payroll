-- Up Migration

COMMENT ON SCHEMA app IS
  'Version-controlled ZamPayroll objects including tenant-scoped, effective-dated gratuity policies.';

ALTER TABLE app.statutory_sources
  DROP CONSTRAINT statutory_sources_authority_check,
  ADD CONSTRAINT statutory_sources_authority_check CHECK (
    authority IN ('zra', 'napsa', 'nhima', 'labour')
  );

CREATE TABLE app.gratuity_policies (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  name varchar(80) NOT NULL,
  policy_reference varchar(240) NOT NULL,
  rate_basis_points integer NOT NULL,
  starts_on date NOT NULL,
  ends_on date,
  row_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT gratuity_policies_company_id_id_unique UNIQUE (company_id, id),
  CONSTRAINT gratuity_policies_company_fk FOREIGN KEY (company_id)
    REFERENCES app.companies (id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT gratuity_policies_name_check CHECK (
    name = btrim(name)
    AND char_length(name) BETWEEN 1 AND 80
    AND name !~ '[[:cntrl:]]'
  ),
  CONSTRAINT gratuity_policies_reference_check CHECK (
    policy_reference = btrim(policy_reference)
    AND char_length(policy_reference) BETWEEN 1 AND 240
    AND policy_reference !~ '[[:cntrl:]]'
  ),
  CONSTRAINT gratuity_policies_rate_check CHECK (
    rate_basis_points BETWEEN 1 AND 10000
  ),
  CONSTRAINT gratuity_policies_dates_check CHECK (
    starts_on BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'
    AND (
      ends_on IS NULL
      OR ends_on BETWEEN starts_on AND DATE '9999-12-31'
    )
  ),
  CONSTRAINT gratuity_policies_row_version_check CHECK (row_version >= 1),
  CONSTRAINT gratuity_policies_timestamps_check CHECK (updated_at >= created_at)
);

CREATE INDEX gratuity_policies_company_period_idx
  ON app.gratuity_policies (company_id, starts_on DESC, id);

CREATE UNIQUE INDEX gratuity_policies_one_open_period_idx
  ON app.gratuity_policies (company_id)
  WHERE ends_on IS NULL;

CREATE FUNCTION app.enforce_gratuity_policy_period()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, app
AS $function$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      NEW.company_id::text || ':gratuity-policy',
      0
    )
  );

  IF EXISTS (
    SELECT 1
    FROM app.gratuity_policies AS policy
    WHERE policy.company_id = NEW.company_id
      AND policy.id <> NEW.id
      AND pg_catalog.daterange(
        policy.starts_on,
        COALESCE(policy.ends_on, DATE 'infinity'),
        '[]'
      ) && pg_catalog.daterange(
        NEW.starts_on,
        COALESCE(NEW.ends_on, DATE 'infinity'),
        '[]'
      )
  ) THEN
    RAISE EXCEPTION 'gratuity policy periods cannot overlap'
      USING ERRCODE = '23P01',
            CONSTRAINT = 'gratuity_policies_no_overlap';
  END IF;

  RETURN NEW;
END
$function$;

CREATE TRIGGER gratuity_policies_enforce_period
BEFORE INSERT OR UPDATE OF company_id, starts_on, ends_on
ON app.gratuity_policies
FOR EACH ROW
EXECUTE FUNCTION app.enforce_gratuity_policy_period();

ALTER TABLE app.gratuity_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.gratuity_policies FORCE ROW LEVEL SECURITY;

CREATE POLICY gratuity_policies_migrator_all ON app.gratuity_policies
  FOR ALL TO zampayroll_migrator USING (true) WITH CHECK (true);

CREATE POLICY gratuity_policies_runtime_select ON app.gratuity_policies
  FOR SELECT TO zampayroll_app
  USING (company_id = app.current_company_id());
CREATE POLICY gratuity_policies_runtime_insert ON app.gratuity_policies
  FOR INSERT TO zampayroll_app
  WITH CHECK (company_id = app.current_company_id());
CREATE POLICY gratuity_policies_runtime_update ON app.gratuity_policies
  FOR UPDATE TO zampayroll_app
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

GRANT SELECT, INSERT, UPDATE ON TABLE app.gratuity_policies
TO zampayroll_app;

REVOKE DELETE ON TABLE app.gratuity_policies FROM zampayroll_app;

-- Down Migration

ALTER TABLE app.statutory_sources
  DROP CONSTRAINT statutory_sources_authority_check,
  ADD CONSTRAINT statutory_sources_authority_check CHECK (
    authority IN ('zra', 'napsa', 'nhima')
  );

DROP TABLE app.gratuity_policies;
DROP FUNCTION app.enforce_gratuity_policy_period();

COMMENT ON SCHEMA app IS
  'Version-controlled ZamPayroll application objects with tenant, identity, authentication, audit, workforce, compensation, payroll-period, statutory-configuration, and payroll-run foundations.';

-- Up Migration

COMMENT ON SCHEMA app IS
  'Version-controlled ZamPayroll application objects with tenant, identity, authentication, audit, workforce, compensation, payroll-period, and statutory-configuration foundations.';

CREATE TABLE app.statutory_configurations (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  configuration_version varchar(64) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'draft',
  effective_from date NOT NULL,
  effective_to date,
  parameters jsonb NOT NULL,
  verified_by_membership_id uuid,
  verified_at timestamptz,
  row_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT statutory_configurations_company_id_id_unique UNIQUE (
    company_id,
    id
  ),
  CONSTRAINT statutory_configurations_company_version_unique UNIQUE (
    company_id,
    configuration_version
  ),
  CONSTRAINT statutory_configurations_company_fk FOREIGN KEY (company_id)
    REFERENCES app.companies (id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT statutory_configurations_verifier_fk FOREIGN KEY (
    company_id,
    verified_by_membership_id
  )
    REFERENCES app.company_memberships (company_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT statutory_configurations_version_check CHECK (
    configuration_version = upper(btrim(configuration_version))
    AND char_length(configuration_version) BETWEEN 1 AND 64
    AND configuration_version ~ '^[A-Z0-9]+([._-][A-Z0-9]+)*$'
  ),
  CONSTRAINT statutory_configurations_status_check CHECK (
    status IN ('draft', 'verified', 'retired')
  ),
  CONSTRAINT statutory_configurations_dates_check CHECK (
    effective_from BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'
    AND (
      effective_to IS NULL
      OR effective_to BETWEEN effective_from AND DATE '9999-12-31'
    )
  ),
  CONSTRAINT statutory_configurations_parameters_check CHECK (
    jsonb_typeof(parameters) = 'object'
    AND octet_length(parameters::text) <= 65536
  ),
  CONSTRAINT statutory_configurations_verification_check CHECK (
    (
      status = 'draft'
      AND verified_by_membership_id IS NULL
      AND verified_at IS NULL
    )
    OR (
      status IN ('verified', 'retired')
      AND verified_by_membership_id IS NOT NULL
      AND verified_at IS NOT NULL
      AND parameters ?& ARRAY['paye', 'napsa', 'nhima']
    )
  ),
  CONSTRAINT statutory_configurations_row_version_check CHECK (
    row_version >= 1
  ),
  CONSTRAINT statutory_configurations_timestamps_check CHECK (
    updated_at >= created_at
  )
);

CREATE INDEX statutory_configurations_company_effective_idx
  ON app.statutory_configurations (
    company_id,
    effective_from DESC,
    effective_to,
    id
  );

CREATE TABLE app.statutory_sources (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  statutory_configuration_id uuid NOT NULL,
  authority varchar(16) NOT NULL,
  title varchar(240) NOT NULL,
  uri varchar(2048) NOT NULL,
  published_on date,
  accessed_on date NOT NULL,
  row_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT statutory_sources_company_id_id_unique UNIQUE (company_id, id),
  CONSTRAINT statutory_sources_evidence_unique UNIQUE (
    company_id,
    statutory_configuration_id,
    authority,
    uri
  ),
  CONSTRAINT statutory_sources_configuration_fk FOREIGN KEY (
    company_id,
    statutory_configuration_id
  )
    REFERENCES app.statutory_configurations (company_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT statutory_sources_authority_check CHECK (
    authority IN ('zra', 'napsa', 'nhima')
  ),
  CONSTRAINT statutory_sources_title_check CHECK (
    title = btrim(title)
    AND char_length(title) BETWEEN 1 AND 240
    AND title !~ '[[:cntrl:]]'
  ),
  CONSTRAINT statutory_sources_uri_check CHECK (
    char_length(uri) BETWEEN 1 AND 2048
    AND uri ~ '^https://'
    AND uri !~ '^https://[^/]*@'
    AND uri !~ '[[:cntrl:]]'
  ),
  CONSTRAINT statutory_sources_dates_check CHECK (
    accessed_on BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'
    AND (
      published_on IS NULL
      OR published_on BETWEEN DATE '0001-01-01' AND accessed_on
    )
  ),
  CONSTRAINT statutory_sources_row_version_check CHECK (row_version >= 1),
  CONSTRAINT statutory_sources_timestamps_check CHECK (
    updated_at >= created_at
  )
);

CREATE INDEX statutory_sources_configuration_idx
  ON app.statutory_sources (
    company_id,
    statutory_configuration_id,
    authority,
    id
  );

CREATE FUNCTION app.enforce_statutory_configuration_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, app
AS $function$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      NEW.company_id::text || ':statutory-configuration',
      0
    )
  );

  IF TG_OP = 'INSERT' AND NEW.status <> 'draft' THEN
    RAISE EXCEPTION 'statutory configuration must be created as a draft'
      USING ERRCODE = '23514',
            CONSTRAINT = 'statutory_configurations_create_draft';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id OR NEW.company_id <> OLD.company_id THEN
      RAISE EXCEPTION 'statutory configuration identity is immutable'
        USING ERRCODE = '23514',
              CONSTRAINT = 'statutory_configurations_identity_immutable';
    END IF;

    IF OLD.status = 'draft' AND NEW.status NOT IN ('draft', 'verified') THEN
      RAISE EXCEPTION 'draft configuration may only be verified'
        USING ERRCODE = '23514',
              CONSTRAINT = 'statutory_configurations_status_transition';
    ELSIF OLD.status = 'verified' AND NEW.status <> 'retired' THEN
      RAISE EXCEPTION 'verified configuration may only be retired'
        USING ERRCODE = '23514',
              CONSTRAINT = 'statutory_configurations_status_transition';
    ELSIF OLD.status = 'retired' THEN
      RAISE EXCEPTION 'retired configuration is immutable'
        USING ERRCODE = '23514',
              CONSTRAINT = 'statutory_configurations_immutable';
    END IF;

    IF OLD.status <> 'draft' OR NEW.status <> 'draft' THEN
      IF NEW.configuration_version IS DISTINCT FROM OLD.configuration_version
        OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
        OR NEW.effective_to IS DISTINCT FROM OLD.effective_to
        OR NEW.parameters IS DISTINCT FROM OLD.parameters
        OR (
          OLD.status <> 'draft'
          AND (
            NEW.verified_by_membership_id
              IS DISTINCT FROM OLD.verified_by_membership_id
            OR NEW.verified_at IS DISTINCT FROM OLD.verified_at
          )
        )
      THEN
        RAISE EXCEPTION 'verified statutory evidence is immutable'
          USING ERRCODE = '23514',
                CONSTRAINT = 'statutory_configurations_evidence_immutable';
      END IF;
    END IF;
  END IF;

  IF NEW.status = 'verified' AND (
    TG_OP = 'INSERT'
    OR OLD.status IS DISTINCT FROM 'verified'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM app.company_memberships AS membership
      WHERE membership.company_id = NEW.company_id
        AND membership.id = NEW.verified_by_membership_id
        AND membership.status = 'active'
    ) THEN
      RAISE EXCEPTION 'verification requires an active company membership'
        USING ERRCODE = '23514',
              CONSTRAINT = 'statutory_configurations_active_verifier';
    END IF;

    IF EXISTS (
      SELECT required.authority
      FROM unnest(ARRAY['zra', 'napsa', 'nhima']) AS required(authority)
      EXCEPT
      SELECT source.authority
      FROM app.statutory_sources AS source
      WHERE source.company_id = NEW.company_id
        AND source.statutory_configuration_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'verification requires evidence from ZRA, NAPSA, and NHIMA'
        USING ERRCODE = '23514',
              CONSTRAINT = 'statutory_configurations_complete_sources';
    END IF;
  END IF;

  IF NEW.status IN ('verified', 'retired') AND EXISTS (
    SELECT 1
    FROM app.statutory_configurations AS configuration
    WHERE configuration.company_id = NEW.company_id
      AND configuration.id <> NEW.id
      AND configuration.status IN ('verified', 'retired')
      AND pg_catalog.daterange(
        configuration.effective_from,
        COALESCE(configuration.effective_to, DATE 'infinity'),
        '[]'
      ) && pg_catalog.daterange(
        NEW.effective_from,
        COALESCE(NEW.effective_to, DATE 'infinity'),
        '[]'
      )
  ) THEN
    RAISE EXCEPTION 'applicable statutory configuration periods cannot overlap'
      USING ERRCODE = '23P01',
            CONSTRAINT = 'statutory_configurations_no_overlap';
  END IF;

  RETURN NEW;
END
$function$;

CREATE TRIGGER statutory_configurations_enforce_lifecycle
BEFORE INSERT OR UPDATE
ON app.statutory_configurations
FOR EACH ROW
EXECUTE FUNCTION app.enforce_statutory_configuration_lifecycle();

CREATE FUNCTION app.enforce_statutory_source_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, app
AS $function$
DECLARE
  parent_status varchar(16);
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT configuration.status
    INTO parent_status
    FROM app.statutory_configurations AS configuration
    WHERE configuration.company_id = OLD.company_id
      AND configuration.id = OLD.statutory_configuration_id;

    IF parent_status <> 'draft' THEN
      RAISE EXCEPTION 'verified statutory sources are immutable'
        USING ERRCODE = '23514',
              CONSTRAINT = 'statutory_sources_immutable';
    END IF;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT configuration.status
    INTO parent_status
    FROM app.statutory_configurations AS configuration
    WHERE configuration.company_id = NEW.company_id
      AND configuration.id = NEW.statutory_configuration_id;

    IF parent_status IS NOT NULL AND parent_status <> 'draft' THEN
      RAISE EXCEPTION 'sources may only be added to a draft configuration'
        USING ERRCODE = '23514',
              CONSTRAINT = 'statutory_sources_draft_only';
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END
$function$;

CREATE TRIGGER statutory_sources_enforce_lifecycle
BEFORE INSERT OR UPDATE OR DELETE
ON app.statutory_sources
FOR EACH ROW
EXECUTE FUNCTION app.enforce_statutory_source_lifecycle();

ALTER TABLE app.statutory_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.statutory_configurations FORCE ROW LEVEL SECURITY;
ALTER TABLE app.statutory_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.statutory_sources FORCE ROW LEVEL SECURITY;

CREATE POLICY statutory_configurations_migrator_all
ON app.statutory_configurations
  FOR ALL
  TO zampayroll_migrator
  USING (true)
  WITH CHECK (true);

CREATE POLICY statutory_sources_migrator_all ON app.statutory_sources
  FOR ALL
  TO zampayroll_migrator
  USING (true)
  WITH CHECK (true);

CREATE POLICY statutory_configurations_runtime_select
ON app.statutory_configurations
  FOR SELECT
  TO zampayroll_app
  USING (company_id = app.current_company_id());

CREATE POLICY statutory_configurations_runtime_insert
ON app.statutory_configurations
  FOR INSERT
  TO zampayroll_app
  WITH CHECK (company_id = app.current_company_id());

CREATE POLICY statutory_configurations_runtime_update
ON app.statutory_configurations
  FOR UPDATE
  TO zampayroll_app
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

CREATE POLICY statutory_sources_runtime_select ON app.statutory_sources
  FOR SELECT
  TO zampayroll_app
  USING (company_id = app.current_company_id());

CREATE POLICY statutory_sources_runtime_insert ON app.statutory_sources
  FOR INSERT
  TO zampayroll_app
  WITH CHECK (company_id = app.current_company_id());

CREATE POLICY statutory_sources_runtime_update ON app.statutory_sources
  FOR UPDATE
  TO zampayroll_app
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

GRANT SELECT, INSERT, UPDATE ON TABLE
  app.statutory_configurations,
  app.statutory_sources
TO zampayroll_app;

REVOKE DELETE ON TABLE
  app.statutory_configurations,
  app.statutory_sources
FROM zampayroll_app;

-- Down Migration

DROP TABLE app.statutory_sources;
DROP TABLE app.statutory_configurations;
DROP FUNCTION app.enforce_statutory_source_lifecycle();
DROP FUNCTION app.enforce_statutory_configuration_lifecycle();

COMMENT ON SCHEMA app IS
  'Version-controlled ZamPayroll application objects with tenant, identity, authentication, audit, workforce, compensation, and payroll-period foundations.';

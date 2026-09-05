-- Up Migration
CREATE TABLE app.operations_settings (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES app.companies(id),
  kind text NOT NULL CHECK (kind IN ('compliance_profile', 'export_template')),
  settings jsonb NOT NULL CHECK (jsonb_typeof(settings) = 'object' AND octet_length(settings::text) <= 65536),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  UNIQUE(company_id, id)
);
CREATE INDEX operations_settings_company_kind_idx ON app.operations_settings(company_id, kind, created_at DESC);
ALTER TABLE app.operations_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.operations_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY operations_settings_migrator ON app.operations_settings FOR ALL TO zampayroll_migrator USING (true) WITH CHECK (true);
CREATE POLICY operations_settings_read ON app.operations_settings FOR SELECT TO zampayroll_app USING (company_id = app.current_company_id());
CREATE POLICY operations_settings_insert ON app.operations_settings FOR INSERT TO zampayroll_app WITH CHECK (company_id = app.current_company_id());
GRANT SELECT, INSERT ON app.operations_settings TO zampayroll_app;
REVOKE UPDATE, DELETE ON app.operations_settings FROM zampayroll_app;

-- Down Migration
DROP TABLE app.operations_settings;

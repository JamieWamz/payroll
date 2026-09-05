-- Up Migration
ALTER TABLE app.payroll_run_components DROP CONSTRAINT payroll_run_components_amount_check;
ALTER TABLE app.payroll_run_components ADD CONSTRAINT payroll_run_components_amount_check
 CHECK (amount_minor_units >= 0 OR (code = 'PAYE' AND kind = 'statutory_deduction'));
CREATE UNIQUE INDEX payroll_run_components_line_unique ON app.payroll_run_components
 (company_id, payroll_run_employee_id, kind, code);

CREATE TABLE app.employee_payroll_details (
 company_id uuid NOT NULL,
 employee_id uuid NOT NULL,
 details jsonb NOT NULL CHECK (jsonb_typeof(details) = 'object' AND octet_length(details::text) < 16384),
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 PRIMARY KEY (company_id, employee_id),
 FOREIGN KEY (company_id, employee_id) REFERENCES app.employees(company_id, id)
);
CREATE TABLE app.company_payroll_settings (
 company_id uuid PRIMARY KEY REFERENCES app.companies(id),
 details jsonb NOT NULL CHECK (jsonb_typeof(details) = 'object' AND octet_length(details::text) < 16384),
 version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);
CREATE TABLE app.payroll_filing_events (
 id uuid PRIMARY KEY,
 company_id uuid NOT NULL,
 payroll_run_id uuid NOT NULL,
 authority varchar(8) NOT NULL CHECK (authority IN ('zra', 'napsa', 'nhima')),
 status varchar(24) NOT NULL CHECK (status IN ('draft','ready','generated','submitted','accepted','rejected','failed','requires_attention')),
 reference varchar(160),
 notes varchar(1000) NOT NULL DEFAULT '',
 recorded_by_membership_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 FOREIGN KEY (company_id, payroll_run_id) REFERENCES app.payroll_runs(company_id,id),
 FOREIGN KEY (company_id, recorded_by_membership_id) REFERENCES app.company_memberships(company_id,id),
 CHECK (status NOT IN ('submitted','accepted','rejected') OR length(btrim(reference)) > 0)
);
CREATE INDEX payroll_filing_events_history ON app.payroll_filing_events(company_id,payroll_run_id,created_at DESC);

ALTER TABLE app.employee_payroll_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.employee_payroll_details FORCE ROW LEVEL SECURITY;
ALTER TABLE app.company_payroll_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.company_payroll_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE app.payroll_filing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.payroll_filing_events FORCE ROW LEVEL SECURITY;
CREATE POLICY employee_details_migrator ON app.employee_payroll_details TO zampayroll_migrator USING (true) WITH CHECK (true);
CREATE POLICY company_settings_migrator ON app.company_payroll_settings TO zampayroll_migrator USING (true) WITH CHECK (true);
CREATE POLICY filing_events_migrator ON app.payroll_filing_events TO zampayroll_migrator USING (true) WITH CHECK (true);
CREATE POLICY employee_details_tenant ON app.employee_payroll_details TO zampayroll_app USING (company_id = app.current_company_id()) WITH CHECK (company_id = app.current_company_id());
CREATE POLICY company_settings_tenant ON app.company_payroll_settings TO zampayroll_app USING (company_id = app.current_company_id()) WITH CHECK (company_id = app.current_company_id());
CREATE POLICY filing_events_select ON app.payroll_filing_events FOR SELECT TO zampayroll_app USING (company_id = app.current_company_id());
CREATE POLICY filing_events_insert ON app.payroll_filing_events FOR INSERT TO zampayroll_app WITH CHECK (company_id = app.current_company_id());
GRANT SELECT, INSERT, UPDATE ON app.employee_payroll_details, app.company_payroll_settings TO zampayroll_app;
GRANT SELECT, INSERT ON app.payroll_filing_events TO zampayroll_app;

-- Down Migration
DROP TABLE app.payroll_filing_events;
DROP TABLE app.company_payroll_settings;
DROP TABLE app.employee_payroll_details;
DROP INDEX app.payroll_run_components_line_unique;
ALTER TABLE app.payroll_run_components DROP CONSTRAINT payroll_run_components_amount_check;
ALTER TABLE app.payroll_run_components ADD CONSTRAINT payroll_run_components_amount_check CHECK (amount_minor_units >= 0);

-- Up Migration
ALTER TABLE app.payroll_runs
 ADD COLUMN cancelled_at timestamptz,
 ADD COLUMN cancellation_reason varchar(500),
 ADD CONSTRAINT payroll_runs_cancellation_check CHECK (
  (cancelled_at IS NULL AND cancellation_reason IS NULL) OR
  (cancelled_at IS NOT NULL AND status <> 'finalized' AND length(btrim(cancellation_reason)) > 0)
 );
ALTER TABLE app.payroll_runs DROP CONSTRAINT payroll_runs_company_period_unique;
CREATE UNIQUE INDEX payroll_runs_company_period_active_unique ON app.payroll_runs(company_id,payroll_period_id) WHERE cancelled_at IS NULL;
CREATE FUNCTION app.guard_cancelled_payroll()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,app AS $function$
BEGIN
 IF TG_TABLE_NAME = 'payroll_runs' THEN
  IF OLD.cancelled_at IS NOT NULL THEN
   RAISE EXCEPTION 'cancelled payroll is immutable' USING ERRCODE='23514';
  END IF;
 ELSE
  IF EXISTS (SELECT 1 FROM app.payroll_runs WHERE company_id=NEW.company_id AND id=NEW.payroll_run_id AND cancelled_at IS NOT NULL) THEN
   RAISE EXCEPTION 'cancelled payroll evidence is immutable' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END
$function$;
CREATE TRIGGER payroll_runs_guard_cancellation BEFORE UPDATE ON app.payroll_runs FOR EACH ROW EXECUTE FUNCTION app.guard_cancelled_payroll();
CREATE TRIGGER payroll_employees_guard_cancellation BEFORE INSERT OR UPDATE ON app.payroll_run_employees FOR EACH ROW EXECUTE FUNCTION app.guard_cancelled_payroll();
CREATE TRIGGER payroll_components_guard_cancellation BEFORE INSERT OR UPDATE ON app.payroll_run_components FOR EACH ROW EXECUTE FUNCTION app.guard_cancelled_payroll();

-- Down Migration
-- Restoring the old uniqueness rule requires resolving any replacement runs first.
DROP TRIGGER payroll_components_guard_cancellation ON app.payroll_run_components;
DROP TRIGGER payroll_employees_guard_cancellation ON app.payroll_run_employees;
DROP TRIGGER payroll_runs_guard_cancellation ON app.payroll_runs;
DROP FUNCTION app.guard_cancelled_payroll();
DROP INDEX app.payroll_runs_company_period_active_unique;
ALTER TABLE app.payroll_runs ADD CONSTRAINT payroll_runs_company_period_unique UNIQUE(company_id,payroll_period_id);
ALTER TABLE app.payroll_runs DROP COLUMN cancellation_reason, DROP COLUMN cancelled_at;

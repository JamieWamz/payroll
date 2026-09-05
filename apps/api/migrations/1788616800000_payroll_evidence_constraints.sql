-- Up Migration
ALTER TABLE app.payroll_filing_events ADD CONSTRAINT payroll_filing_external_reference_required
 CHECK (status NOT IN ('submitted','accepted','rejected') OR (reference IS NOT NULL AND length(btrim(reference)) > 0));
ALTER TABLE app.payroll_runs DROP CONSTRAINT payroll_runs_cancellation_check;
ALTER TABLE app.payroll_runs ADD CONSTRAINT payroll_runs_cancellation_check CHECK (
 (cancelled_at IS NULL AND cancellation_reason IS NULL) OR
 (cancelled_at IS NOT NULL AND status <> 'finalized' AND cancellation_reason IS NOT NULL AND length(btrim(cancellation_reason)) > 0)
);
CREATE FUNCTION app.require_finalized_filing_payroll()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,app AS $function$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM app.payroll_runs WHERE company_id=NEW.company_id AND id=NEW.payroll_run_id AND status='finalized') THEN
  RAISE EXCEPTION 'filing evidence requires finalized payroll' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END
$function$;
CREATE TRIGGER filing_requires_finalized_payroll BEFORE INSERT ON app.payroll_filing_events FOR EACH ROW EXECUTE FUNCTION app.require_finalized_filing_payroll();

-- Down Migration
DROP TRIGGER filing_requires_finalized_payroll ON app.payroll_filing_events;
DROP FUNCTION app.require_finalized_filing_payroll();
ALTER TABLE app.payroll_filing_events DROP CONSTRAINT payroll_filing_external_reference_required;
ALTER TABLE app.payroll_runs DROP CONSTRAINT payroll_runs_cancellation_check;
ALTER TABLE app.payroll_runs ADD CONSTRAINT payroll_runs_cancellation_check CHECK (
 (cancelled_at IS NULL AND cancellation_reason IS NULL) OR
 (cancelled_at IS NOT NULL AND status <> 'finalized' AND length(btrim(cancellation_reason)) > 0)
);

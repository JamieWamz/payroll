-- Up Migration
-- A calculated payroll is evidence for review, not authority to lock payment.
-- Approval is recorded separately so the review and finalization trail is clear.
ALTER TABLE app.payroll_runs
  ADD COLUMN approved_by_membership_id uuid,
  ADD COLUMN approved_at timestamptz,
  ADD CONSTRAINT payroll_runs_approver_fk FOREIGN KEY (
    company_id,
    approved_by_membership_id
  )
    REFERENCES app.company_memberships (company_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT;

ALTER TABLE app.payroll_runs
  DROP CONSTRAINT payroll_runs_status_check,
  DROP CONSTRAINT payroll_runs_lifecycle_fields_check,
  DROP CONSTRAINT payroll_runs_time_order_check,
  ADD CONSTRAINT payroll_runs_status_check CHECK (
    status IN ('draft', 'calculated', 'approved', 'finalized')
  ),
  ADD CONSTRAINT payroll_runs_lifecycle_fields_check CHECK (
    (
      status = 'draft'
      AND calculation_version IS NULL
      AND rounding_policy IS NULL
      AND calculated_by_membership_id IS NULL
      AND calculated_at IS NULL
      AND approved_by_membership_id IS NULL
      AND approved_at IS NULL
      AND finalized_by_membership_id IS NULL
      AND finalized_at IS NULL
    )
    OR (
      status = 'calculated'
      AND calculation_version IS NOT NULL
      AND rounding_policy IS NOT NULL
      AND calculated_by_membership_id IS NOT NULL
      AND calculated_at IS NOT NULL
      AND approved_by_membership_id IS NULL
      AND approved_at IS NULL
      AND finalized_by_membership_id IS NULL
      AND finalized_at IS NULL
    )
    OR (
      status = 'approved'
      AND calculation_version IS NOT NULL
      AND rounding_policy IS NOT NULL
      AND calculated_by_membership_id IS NOT NULL
      AND calculated_at IS NOT NULL
      AND approved_by_membership_id IS NOT NULL
      AND approved_at IS NOT NULL
      AND finalized_by_membership_id IS NULL
      AND finalized_at IS NULL
    )
    OR (
      status = 'finalized'
      AND calculation_version IS NOT NULL
      AND rounding_policy IS NOT NULL
      AND calculated_by_membership_id IS NOT NULL
      AND calculated_at IS NOT NULL
      AND approved_by_membership_id IS NOT NULL
      AND approved_at IS NOT NULL
      AND finalized_by_membership_id IS NOT NULL
      AND finalized_at IS NOT NULL
    )
  ),
  ADD CONSTRAINT payroll_runs_time_order_check CHECK (
    (calculated_at IS NULL OR calculated_at >= created_at)
    AND (approved_at IS NULL OR approved_at >= calculated_at)
    AND (finalized_at IS NULL OR finalized_at >= approved_at)
    AND updated_at >= created_at
  );

-- Down Migration
DO $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM app.payroll_runs
    WHERE status = 'approved'
       OR approved_by_membership_id IS NOT NULL
       OR approved_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Cannot remove payroll approval workflow while approval evidence exists';
  END IF;
END
$function$;

ALTER TABLE app.payroll_runs
  DROP CONSTRAINT payroll_runs_status_check,
  DROP CONSTRAINT payroll_runs_lifecycle_fields_check,
  DROP CONSTRAINT payroll_runs_time_order_check,
  ADD CONSTRAINT payroll_runs_status_check CHECK (
    status IN ('draft', 'calculated', 'finalized')
  ),
  ADD CONSTRAINT payroll_runs_lifecycle_fields_check CHECK (
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
  ADD CONSTRAINT payroll_runs_time_order_check CHECK (
    (calculated_at IS NULL OR calculated_at >= created_at)
    AND (finalized_at IS NULL OR finalized_at >= calculated_at)
    AND updated_at >= created_at
  ),
  DROP CONSTRAINT payroll_runs_approver_fk,
  DROP COLUMN approved_at,
  DROP COLUMN approved_by_membership_id;

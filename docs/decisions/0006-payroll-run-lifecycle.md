# ADR 0006: Payroll run calculation and finalization lifecycle

- Status: Accepted
- Date: 2026-09-04

## Context

A payroll run must remain explainable after employee compensation or statutory
rules change. It also needs a review window in which administrators can correct
inputs and calculate again without creating a false finalized history. Actual
Zambia statutory arithmetic is still blocked pending verified rule parameters,
but the system can establish the orchestration and persistence boundaries that
any calculator must satisfy.

## Decision

- Create every run as a company-scoped draft for exactly one payroll period,
  one verified statutory configuration, and at least one selected employee.
- Require the statutory configuration to cover the entire payroll period. This
  deliberately avoids guessing how a mid-period statutory change should be
  apportioned.
- Pin immutable period and statutory-configuration snapshots in the domain and
  persist immutable employee input and result snapshots for auditability.
- Invoke payroll arithmetic through the isolated `PayrollCalculator` contract.
  The run orchestrator does not implement or know statutory rates.
- Reject a calculation batch unless it returns exactly one result for every
  selected employee and all tenant, employment, period, configuration,
  calculation-version, and rounding-policy references match.
- Reconcile result totals before accepting a batch: earnings must equal gross;
  statutory lines must equal PAYE plus NAPSA plus NHIMA; other deductions and
  employer contributions must match their breakdown lines; and net must equal
  gross less statutory and other deductions.
- Allow a draft or calculated run to be calculated again during review. A
  calculated run may return to draft only after its calculated employee results
  and component lines are cleared.
- Allow finalization only when every selected employee has a result, and record
  the active company memberships and timestamps that created, calculated, and
  finalized the run.
- Make finalized run metadata, employee snapshots, and component lines
  immutable. Runtime hard deletes are denied.
- Permit one run per payroll period in the MVP. A later explicit
  correction/reversal design may introduce linked runs without weakening the
  original finalized record.

## Consequences

- The real statutory engine can be added behind the existing pure interface
  once its typed rules and test vectors are approved.
- Review and recalculation are explicit states, while finalized history cannot
  silently drift.
- PostgreSQL retains normalized component lines for reporting as well as the
  complete JSON input/result evidence supplied by the calculation boundary.
- HTTP commands remain closed until authentication, permission checks, CSRF,
  tenant resolution, transactions, and audit-event writes are integrated.
- Payslips, bank exports, statutory reports, corrections, and reversals remain
  later workflows built from finalized snapshots.

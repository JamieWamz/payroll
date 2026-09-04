# ADR 0010: Tenant-authorized payroll-period HTTP workflows

- Status: Accepted
- Date: 2026-09-04

## Context

A payroll run needs an explicit pay period before employees can be selected or
calculations can be reviewed. Regular schedules cannot overlap, while a bonus
or correction may legitimately use an off-cycle period covering the same dates.
The payment date is distinct from the dates in which pay was earned.

## Decision

- Expose a bounded, optionally kind-filtered payroll-period list to principals
  with `payroll.read`.
- Expose payroll-period creation to principals with `payroll.calculate`, with
  session-backed CSRF validation and a success audit event in the same
  transaction as the insert.
- Normalize and validate period codes and ISO local dates through the payroll
  domain. Keep period start, period end, and payment date as separate values.
- Reject duplicate identifiers or codes and overlapping regular periods in the
  domain, with PostgreSQL constraints and a serialized trigger as the
  concurrency backstop. Permit off-cycle periods to overlap regular or other
  off-cycle periods.
- Keep existing period rows immutable through the HTTP API. A period may later
  be pinned by a payroll run, so silent historical edits are not exposed.
- Do not derive dates, pay frequencies, or statutory configuration from the
  period code.

## Consequences

- Authorized users can establish an auditable period schedule for later
  employee selection and payroll-run creation.
- Concurrent attempts cannot introduce overlapping regular periods even when
  both requests pass domain validation before either commits.
- Period correction and deletion are intentionally unavailable until an
  explicit policy accounts for linked draft and finalized runs.
- This workflow creates no statutory figures and makes no assertion that a
  configuration is valid for the period.

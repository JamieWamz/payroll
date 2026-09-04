# ADR 0004: Effective-dated compensation and payroll periods

- Status: Accepted
- Date: 2026-09-04

## Context

Payroll calculations need reproducible employee pay inputs and an explicit
period boundary before draft runs can be built. Salary changes must preserve
history rather than overwrite the amount that was effective for an earlier
run. Allowances and deductions need the same effective-date behavior, but the
application must not guess whether an item is taxable before verified
statutory configuration exists.

Regular pay periods must not overlap. Off-cycle periods, such as a separately
approved bonus run, may cover dates that overlap a regular period. A payment
date is stored independently because payment can occur before, on, or after a
period boundary according to company policy; this foundation does not invent
a legal timing rule.

## Decision

- Store monthly base salary as positive ZMW minor units with scale two and an
  inclusive effective-date interval wholly contained by its employment.
- Permit only one salary to be effective for an employment on any date.
- Store recurring allowances and deductions as positive, fixed-per-period
  values. Their kind determines whether they add to or subtract from payroll;
  their eventual statutory treatment belongs to a verified configuration,
  not the compensation record.
- Treat a matching component as the tuple of employment, kind, and normalized
  code, and reject overlapping effective intervals for that tuple.
- Store explicit regular and off-cycle payroll periods with separate payment
  dates. Reject overlapping regular periods while allowing off-cycle overlap.
- Enforce the same ownership, amount, identifier, effective-date, and overlap
  rules in pure domain code and PostgreSQL.
- Serialize competing period writes with transaction-scoped advisory locks so
  concurrent requests cannot both pass an overlap check.
- Force row-level security on every new table and deny runtime hard deletes.

## Consequences

- A pay change is represented by closing the previous effective interval and
  adding a new record. Draft-run orchestration can select exactly one salary
  and each applicable component for a date.
- No taxability, PAYE, NAPSA, NHIMA, proration, or rounding assumption is made
  by this slice.
- ZMW with scale two is intentionally the MVP compensation unit. Multi-country
  and multi-currency payroll remain outside scope.
- Finalized runs will need immutable input and output snapshots. Later edits to
  compensation history must never rewrite those snapshots.
- HTTP workflows remain closed until authenticated tenant resolution,
  authorization, CSRF protection, throttling, and audit integration exist.

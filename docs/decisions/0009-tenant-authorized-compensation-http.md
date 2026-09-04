# ADR 0009: Tenant-authorized compensation HTTP workflows

- Status: Accepted
- Date: 2026-09-04

## Context

Salary, allowance, and deduction history directly affects future payroll
calculations. Changes must preserve effective dates, company isolation,
employment boundaries, concurrency safety, and an attributable audit trail.
Taxability cannot be inferred from a component name or code because that would
silently invent statutory behavior.

## Decision

- Expose one authenticated compensation-history query for an employment and
  commands to create or end-date monthly ZMW salaries and fixed-per-period
  allowances or deductions.
- Resolve live membership and the `compensation.read` or `compensation.write`
  permission inside the same tenant-scoped transaction as each query or write.
  Require the session-backed CSRF proof for every command.
- Validate employment ownership and reconstruct domain records from stored
  employee, employment, and compensation data before applying lifecycle rules.
- Preserve compensation history by end-dating records. Do not expose update or
  delete operations that rewrite historical amounts, dates, codes, or kinds.
- Reject overlapping effective periods in both the domain and PostgreSQL. Use
  optimistic versions for end-dating and return a conflict when another request
  changed the record first.
- Append salary and component create/end events in the transaction containing
  the successful mutation.
- Store component identity and value only. Do not classify a component as
  taxable, pensionable, or insurable without a verified statutory rule set.

## Consequences

- Authorized clients can maintain auditable compensation history without
  bypassing row-level security or application permissions.
- Employment cannot be ended before its open compensation records are ended,
  and compensation cannot extend beyond its employment.
- Current compensation data is suitable as input to later payroll-period and
  run workflows, but it does not itself calculate statutory deductions.
- Corrections that require replacing historical values need an explicit future
  correction policy; this API intentionally does not mutate them in place.

# ADR 0001: Phase 2 Domain and Security Boundaries

- Status: Accepted
- Date: 2026-09-01

## Context

Phase 2 introduces company, identity, workforce, compensation, payroll-period,
and payroll-run foundations. These records will eventually contain sensitive
tenant and payroll data. The repository does not yet have authentication,
tenant authorization, verified statutory configuration, or a payroll
calculator.

Temporary identity headers, shared development keys, client-selected roles,
or placeholder statutory behavior would create interfaces that are unsafe to
retain and easy to mistake for production behavior.

## Decision

ZamPayroll will use these boundaries:

1. The backend remains a modular monolith. Domain code has no dependency on
   Fastify, PostgreSQL, React, or Docker.
2. Users are global identities. Company access is represented by explicit
   memberships and company-scoped roles so one accounting user can eventually
   work with multiple client companies.
3. No company, identity, workforce, compensation, payroll-period, or
   payroll-run HTTP mutation route is exposed until opaque server-side
   sessions, CSRF protection, live membership checks, RBAC, tenant resolution,
   and append-only security audit events are in place.
4. Tenant-owned database records include `company_id` in keys and references.
   PostgreSQL row-level security will be used as defense in depth with
   transaction-local tenant context. It does not replace application
   authentication and authorization.
5. Calendar-effective dates use validated ISO `YYYY-MM-DD` values rather than
   timestamps or the JavaScript `Date` type. Instants such as creation and
   audit times remain UTC `timestamptz` values at the persistence boundary.
6. Money uses integer minor units, an explicit ISO-style currency code, and an
   explicit scale. Decimal input must be represented as a string and rejected
   when it exceeds the selected scale; domain code never rounds implicitly or
   uses floating-point values for money.
7. The payroll calculation boundary is pure and deterministic. Its input must
   carry immutable employee, employment, compensation, period, verified
   statutory-configuration, source, calculation-version, and rounding-policy
   snapshots. Its output must retain those identifiers and a complete
   breakdown.
8. Phase 2 provides the calculation contract only until statutory rules and
   rounding behavior have been verified against authoritative Zambian sources.
   There is no default calculator, default rounding policy, calculate endpoint,
   or finalization endpoint.
9. Payroll runs remain draft-only until reproducible calculation snapshots and
   database immutability guards exist. Corrections and reversals will create
   linked records rather than rewriting a finalized result.

## Implementation sequence

1. Pure shared value objects and payroll calculation contract.
2. Company, user, membership, and role persistence with tenant-deny defaults.
3. Opaque database-backed sessions, credentials, CSRF, throttling, RBAC,
   tenant resolution, and append-only audit.
4. Authorized company and membership behavior.
5. Employee and effective-dated employment behavior.
6. Effective-dated compensation and payroll periods.
7. Draft payroll runs and explicit correction/reversal relationships.
8. A verified, separately tested calculator and finalization workflow only
   after authoritative rule research is reviewed.

Each junction includes its own migrations where applicable, validation,
automated tests, security review, documentation, commit, and push.

## Implementation status

Steps 1 and 2 are implemented. Step 3's internal password, opaque token,
authorization, credential/session schema, and append-only audit foundations
exist, but its runtime access layer, cookie delivery, throttling, and routes do
not. Step 5's internal employee and effective-dated employment foundations are
also implemented. Steps 4 and 5's authorized HTTP behavior remains blocked on
completion of step 3. There are no registration, login, company, membership,
role, employee, or employment routes.

## Consequences

The first Phase 2 commits add internal contracts before visible CRUD. This is
intentional: sensitive records are not exposed behind a temporary security
model. Some types describe required future calculation input and output, but
they are not evidence that a calculation is implemented or compliant.

Integer money and calendar-date values require explicit serialization at HTTP
and PostgreSQL boundaries. Tenant context must be set inside a transaction and
cleared automatically on commit or rollback. Integration tests must prove
cross-company references and missing tenant context are denied before business
routes are enabled.

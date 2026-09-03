# ADR 0003: Minimal Effective-Dated Workforce Foundation

- Status: Accepted
- Date: 2026-09-03

## Context

Phase 2 requires Employee and Employment foundations before compensation and
payroll periods. Employee data is sensitive, authentication HTTP workflows are
not complete, and the product does not yet need national identifiers, banking
details, contact details, or broad HR functionality to define a reliable
payroll relationship.

Employment history must support re-employment without allowing ambiguous
overlapping records. The distinction between a calendar date and an instant is
also significant for payroll-period selection.

## Decision

1. An employee is company-scoped and currently contains only a company-unique
   employee number, structured name, and `active` or `archived` lifecycle
   state.
2. Employee numbers are NFKC-normalized, uppercased, bounded to 64 characters,
   and contain alphanumeric segments separated by a single dot, slash, or
   hyphen. Names are NFC-normalized, bounded, and reject control characters.
3. An employment belongs to exactly one employee in the same company and
   contains only a position title plus an inclusive start/end date interval.
   An absent end date means the employment remains open.
4. Employment termination creates a new immutable domain value. It cannot move
   before the start date, and an ended employment cannot be ended again.
5. Employment histories must contain records for one employee and company,
   contain no duplicate IDs, and have no overlapping inclusive intervals.
   Re-employment may begin on the day after the preceding interval ends.
6. An employee cannot be archived while any employment interval is open.
   Archival does not delete or rewrite employment history, and new employment
   cannot be attached to an archived employee.
7. Both tables use forced tenant RLS, composite tenant references, bounded
   values, optimistic versions, and no runtime delete privilege. The database
   additionally prevents more than one open employment per employee.
8. Historical overlap is checked by the domain and must be checked by a future
   transactional application service before writes. No workforce route is
   exposed until authentication, live membership authorization, CSRF,
   throttling, and audit emission are complete.

## Consequences

The workforce foundation can represent a current employment and a
nonoverlapping re-employment history without adding unneeded personal data.
Compensation, statutory identifiers, contact data, and payment instructions are
not part of this record and require separate reviewed contracts if introduced.

Database constraints reject malformed dates, names, employee numbers, tenant
mismatches, multiple open periods, and hard deletes. A future repository must
lock and evaluate an employee's complete employment history in one transaction
to make the cross-record overlap and archival checks safe under concurrency.

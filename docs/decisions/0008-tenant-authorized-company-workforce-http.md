# ADR 0008: Tenant-authorized company and workforce HTTP workflows

- Status: Accepted
- Date: 2026-09-04

## Context

Authentication alone does not authorize a company operation. A client can
select a company URL, but the API must prove that the live session belongs to
an active membership in that company and must load current permissions without
opening a time-of-check/time-of-use gap. State changes also require CSRF
protection and an audit record.

## Decision

- Resolve the requested company identifier through the domain UUID parser and
  use it only to open the transaction-local row-level-security scope.
- Within that same transaction, call a narrow security-definer function that
  refreshes a valid, unexpired opaque session and returns an active membership
  plus permissions from active roles. Never accept user, membership, role, or
  permission identifiers from request headers.
- Return `401` for a missing, malformed, expired, revoked, or inactive-account
  session and `403` when the authenticated account has no active membership or
  required permission in the requested company.
- Require the independently stored CSRF cookie, `X-CSRF-Token` header, and
  server-side token digest to match before every company or workforce write.
- Expose company read/name-update and employee list/create/detail plus
  employment-create routes. Use bounded list sizes, domain normalization,
  employment-history validation, and database constraints at the boundary.
- Use optimistic company versions to reject lost updates. Translate expected
  uniqueness and concurrency conflicts to `409` without exposing PostgreSQL
  details.
- Append successful company and workforce write events in the same transaction
  as their target mutation. A rollback therefore cannot leave an audit event
  claiming a write succeeded.
- Keep direct runtime access to session and audit tables revoked; the runtime
  role receives execute permission only on the reviewed authorization and
  audit functions.

## Consequences

- Company and first workforce workflows are reachable through authenticated,
  tenant-isolated HTTP APIs and have PostgreSQL-backed integration coverage.
- A valid session does not imply access to every company, and changing a role
  or permission takes effect on the next request.
- Employee editing, ending employment, archival/reactivation policy, company
  payroll settings, statutory identifiers, invitations, and role-management
  routes remain later incremental work.
- Compensation, payroll, statutory configuration, reports, and payslips remain
  closed until each command receives the same authorization, CSRF, validation,
  concurrency, and audit treatment.

# ADR 0012: Tenant-authorized statutory-configuration HTTP workflows

- Status: Accepted
- Date: 2026-09-04

## Context

Payroll calculations must pin an effective, human-verified statutory rule
version. Operators also need to reevaluate percentages, thresholds, caps, and
earning treatments without changing code or rewriting completed payroll.
Published reference figures are useful during entry, but incomplete or stale
evidence must never become an active default.

## Decision

- Expose bounded configuration history and detail to principals with
  `statutory-config.read`.
- Allow principals with `statutory-config.verify` to create drafts and to
  verify or retire a version. Writes require the authenticated session's CSRF
  token and emit an audit event in the same database transaction.
- Require verification requests to explicitly attest that the evidence and
  applicability have been reviewed. The stored verifier membership and UTC
  timestamp identify the accountable reviewer.
- Keep verified parameters and sources immutable. An operator reevaluation is
  represented by a new effective-dated draft and version, never by editing the
  old configuration.
- Reject overlapping applicable versions, duplicate versions, stale row
  versions, cross-tenant access, and verification without source records from
  ZRA, NAPSA, and NHIMA.
- Publish authorized reference endpoints for the confirmed ZRA PAYE bands and
  the documented NAPSA/NHIMA contribution percentages. Reference responses are
  evidence-entry aids; the calculator does not import or activate them.
- Mark the NAPSA monthly ceiling as unresolved until a current dated authority
  notice is reviewed. Do not reinterpret the 2025 ceiling as a 2026 figure.

## Consequences

- An authorized operator can maintain versioned rules through the API and can
  adjust percentages after reevaluation while preserving historical results.
- The reference endpoint identifies NAPSA as 5% employee plus 5% employer and
  NHIMA as 1% employee plus 1% employer on basic salary.
- Human verification remains a governance decision; the software records that
  decision and its evidence but does not claim independent legal approval.
- Payroll-run calculation remains closed until orchestration can select exactly
  one verified version and persist complete employee calculation snapshots.

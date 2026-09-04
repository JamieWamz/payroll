# ADR 0005: Verified statutory configuration evidence

- Status: Accepted
- Date: 2026-09-04

## Context

PAYE, NAPSA, and NHIMA parameters change independently and can be published in
different forms by different authorities. A calculation engine must be able to
reproduce which rules were used for a historical payroll. Treating rates as
unversioned constants would make silent changes possible and would leave no
review trail when an authority page is revised.

The available primary material is not yet sufficient to approve a complete
2026 rule set. In particular, a clearly dated 2026 NAPSA ceiling notice has not
been captured. No production calculation should substitute an older notice,
search-result excerpt, or third-party tax summary for current authority
evidence.

## Decision

- Store statutory configuration as a company-scoped, effective-dated version
  with `draft`, `verified`, and `retired` states.
- Require separate HTTPS source records for ZRA, NAPSA, and NHIMA before a
  configuration can be verified.
- Record the active company membership and instant responsible for human
  verification.
- Permit evidence and parameters to change only while the configuration is a
  draft. A verified configuration can only be retired; a retired configuration
  cannot change.
- Reject overlapping verified or retired effective periods for one company and
  serialize competing verification writes.
- Store rule parameters as bounded JSON for now. Typed PAYE bands,
  contribution bases, ceilings, caps, and rounding policies will replace the
  placeholder shape when current primary evidence is approved.
- Enforce tenant ownership, lifecycle transitions, evidence completeness,
  immutability, and non-overlap in both domain code and PostgreSQL.
- Do not seed or infer statutory percentages, bands, ceilings, or rounding
  behavior in this foundation.

## Consequences

- The schema can preserve the evidence behind a future calculation without
  claiming that the statutory calculator exists today.
- Drafts may be corrected safely. Once verified, corrections require a new
  version rather than rewriting history.
- Payroll-run finalization will later reference a verified configuration and
  snapshot its typed inputs and results.
- An operational workflow must show sources and require an authorized human
  review before verification.
- Current Zambia parameters remain a deliberate blocker for the calculation
  engine until the source register records sufficient primary evidence.

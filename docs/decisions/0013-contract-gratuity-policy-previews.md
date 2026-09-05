# ADR 0013: Contract-expiry gratuity policy previews

Date: 2026-09-05. Status: Accepted for preview workflows only.

## Scope and decision

The product owner explicitly expanded the original MVP exclusion of gratuity.
This implementation concerns end-of-contract benefits, not recurring monthly
allowances. A company records a named, effective-dated percentage policy with
its contract/HR-policy reference. Policy periods cannot overlap. Changes use
end-dating and a replacement version, not a rate-edit endpoint.

The preview accepts total basic pay actually earned during the contract,
contract-end date, settlement date, policy ID and a statutory-configuration ID.
It uses integer minor units, basis points and one half-up rounding operation.
It rejects settlement before expiry, a policy not effective at expiry, and a
policy rate below the configured applicable minimum. The configuration must
be verified, cover the contract-end date and contain labour-source evidence.
It must include `parameters.gratuity.minimumRatePercent` as a decimal string.

## Evidence and limitations

[Employment Code Act No. 3 of 2019](https://www.parliament.gov.zm/sites/default/files/documents/acts/The%20Employment%20Code%20Act%20No.%203%20of%202019.pdf),
section 73, provides a 25% basic-pay-earned minimum for covered long-term
contracts. Section 54 concerns other severance circumstances and exceptions.
These are not interchangeable blanket rules for every employee. The reviewer
must establish contract classification, scope, amendments, exemptions and
collective-agreement obligations before configuring an applicable minimum.
The evidence reference is not an automatically active statutory rule.

ZRA's specific
[PAYE refunds / cessation-of-employment guidance](https://www.zra.org.zm/wp-content/uploads/2023/06/Pay-As-You-Earn-PAYE-Refunds.pdf)
classifies qualifying gratuity as tax-exempt pension benefits. A general
emoluments description must not override this specific treatment. The
reference therefore says `exempt_qualifying_gratuity`; this preview calculates
only the gross benefit and does not calculate PAYE/NAPSA/NHIMA on it.

This is **not** an employee entitlement determination or a posted settlement.
It does not load historical earnings, pin a policy to an employment contract,
handle early termination/redundancy, accrue benefits, prevent duplicate benefit
payments, or feed finalized payroll. Policy-at-expiry is a preview convention,
not an assertion that later company policies can diminish accrued contractual
rights. These controls are required before a settlement posting workflow.

## Controls and endpoints

All routes use `/api/companies/:companyId` and tenant authorization:

- `GET /gratuity-policies`: compensation-read permission, bounded list.
- `POST /gratuity-policies`: compensation-write permission, CSRF, audit.
- `PATCH /gratuity-policies/:policyId/end`: write permission, CSRF,
  optimistic row version, audit.
- `POST /gratuity-policies/:policyId/preview`: read permission, CSRF,
  verified applicable evidence; response explicitly includes `preview: true`.
- `GET /statutory-configurations/references/terminal-benefits`: evidence only.

Database RLS and overlap locking supplement application validation. Preview
inputs/results are not retained. Domain and PostgreSQL HTTP tests cover the
calculation, policy lifecycle, cross-tenant denial, CSRF and audit events.

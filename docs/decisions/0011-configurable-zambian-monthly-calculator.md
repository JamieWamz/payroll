# ADR 0011: Configurable Zambian monthly calculator

- Status: Accepted
- Date: 2026-09-04

## Context

The product needs the progressive method used by ZRA and the employee/employer
contribution mechanics administered by NAPSA and NHIMA. Rates and ceilings can
change, and operators need to reevaluate them without changing code or altering
previous payroll. Effective PAYE also depends on cumulative chargeable income
and tax already deducted, while an off-cycle run can consume the remainder of a
monthly NAPSA cap.

Official ZRA material retains the monthly bands of K5,100 at 0%, income through
K7,100 at 20%, income through K9,200 at 30%, and the balance at 37%. Those
figures are useful evidence but must remain part of a verified configuration,
not hidden constants in arithmetic.

## Decision

- Implement a pure `ZAMBIA-MONTHLY-1` calculator using integer minor units and
  the explicit `ZMW-2DP-HALF-UP` rounding contract.
- Read PAYE bands, NAPSA and NHIMA employee/employer percentages, contribution
  caps, and earning-code treatments only from the payroll run's pinned,
  verified statutory configuration.
- Retain the ZRA published bands as a configuration-tooling reference with its
  source and confirmed charge year. The calculator itself does not import or
  default to that reference.
- Require every earning code to declare whether it is PAYE taxable and included
  in the NAPSA or NHIMA base. Reject unclassified earnings instead of guessing
  from their names.
- Calculate PAYE cumulatively using the payment month's expanded bands,
  chargeable income before the run, and PAYE already deducted. Preserve a
  negative current PAYE result as a refund and include it in net-pay
  reconciliation.
- Calculate each NAPSA portion against month-to-date eligible earnings and
  subtract the corresponding contribution already taken that month, enforcing
  the configured employee and employer caps independently.
- Calculate NHIMA employee and employer portions from explicitly included
  earnings. Other deductions are applied after statutory calculations.
- Reject malformed percentages, nonascending or bounded final PAYE bands,
  unsupported versions, invalid money, inconsistent prior contribution state,
  and negative final net pay.

## Consequences

- Operators can change evaluated percentages, ranges, caps, and component
  treatments in a new draft configuration without a software deployment.
- Verification makes a configuration immutable; reevaluation publishes a new
  effective-dated version, while each payroll run remains reproducible from its
  pinned inputs and outputs.
- The calculation domain handles ordinary and cumulative/off-cycle mechanics,
  but no 2026 configuration is automatically approved. The current annual
  NAPSA ceiling and all special-case PAYE treatment still need explicit evidence
  before calculation routes can be enabled.
- Employee disability credits, casual/daily tables, part-time special rates,
  benefits in kind, termination payments, and correction workflows are not
  silently approximated. They require explicit domain inputs and evidence in a
  later increment.

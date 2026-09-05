# Payroll workspace operations

The API remains authoritative. Money uses bigint minor units in the calculator,
serialized decimal strings in responses, immutable input/result snapshots and
normalized component lines in PostgreSQL. Frontend totals come from the API.

## Prepare and finalize monthly payroll

1. Save the business's TPIN, NAPSA and NHIMA registrations in **Settings**.
2. Add employees in **People**. Open each profile to maintain employment,
   effective-dated salary, fixed allowances/deductions and statutory identifiers.
   Bank instructions are needed for payment-instruction exports, not cash payroll.
3. If taking over during a tax year, record reviewed cumulative taxable income and
   PAYE through the month before the first payroll. Explicitly record zero amounts
   when that is correct. Do not overlap opening balances with finalized history.
4. Create a period in **Payroll periods** and sourced rules in **Statutory rules**.
   Review official evidence, treatment of each allowance, rates, caps, effective
   dates and rounding before recording verification. There is no automatic 2026
   configuration. Invalid monthly parameter structures are rejected on creation.
5. Choose **Payroll → Prepare payroll**, the full monthly period, verified rules
   and employees. Calculate, inspect per-person breakdowns and resolve exceptions.
6. Finalize after confirming review. Source changes invalidate the review and
   require recalculation. Missing employee or employer statutory identifiers block
   finalization. Company mutations share a transaction lock with finalization.
7. Generate payslips, payroll registers, statutory working schedules and payment
   instructions from the finalized record. Subsequent employee edits do not alter
   those documents. PDF fonts are bundled with the API, including its Docker image.

Draft and calculated payroll can be cancelled with a reason. Evidence is retained
and frozen, and another run can use that period. Finalized records cannot be
cancelled, recalculated or overwritten. Corrections/reversals require a separate
settlement design; do not mutate the database to simulate one.

This orchestration supports regular, full calendar months paid during that month.
It rejects partial-month employment, mid-month salary/component changes and
missing cumulative history. Off-cycle periods and gratuity previews remain
available, but are not posted by the monthly payroll orchestrator. An explicit
allocation policy is required to extend calculation to those cases.

## Documents and filing

**Reports** provides PDF payslips and employee-detail registers, CSV payroll
registers, PAYE/NAPSA/NHIMA working schedules, payment instructions and annual
employee tax reconciliation. Annual output includes finalized payroll only,
excludes imported opening balances and states its coverage. It is P9 preparation
support, not an official P9 form. General payment instructions are not certified
bank upload files. Saved operator templates can export finalized payroll directly through Bank batches / PAYE export templates. The FNB-specific review generator also remains available.

**ZRA returns** contains the statutory filing register for ZRA, NAPSA and NHIMA.
Generating a schedule records **Generated** and returns its actual contents.
It does not contact an authority. **Submitted**, **Accepted** and **Rejected**
require a manually supplied external reference and operator attestation.
Acceptance/rejection requires a preceding submission. Concurrent changes are
checked against the latest filing event. Events retain actor membership, time,
notes and reference, and runtime roles cannot rewrite or delete them.

No direct ZRA or bank API endpoint, credentials, upload certification or submission
contract has been supplied. No environment-variable switch can activate an
undocumented integration. Obtain the provider's approved API/upload specification,
authentication method, sandbox access and credentials before implementing a live
adapter. The current supported path is review/export and external submission.

## Local validation

Use the existing `.env` configuration and migrated PostgreSQL runtime/migration
roles. Keep credentials out of command logs. See the README's localhost overrides
for this machine's ports (database 55433, API 3100, web 5173).

- `npm run db:migrate`
- `npm run format:check`
- `npm run lint`
- `npm run typecheck`
- `npm run test --workspace @zampayroll/api -- --maxWorkers=1`
- `npm run test --workspace @zampayroll/web -- --maxWorkers=1`
- `npm run build`
- `npx playwright install chromium`
- `npm run test:e2e`

Database tests require `TEST_DATABASE_URL` and `TEST_DATABASE_MIGRATION_URL`.
The browser test requires the running application, `TEST_DATABASE_MIGRATION_URL`
for cleanup, and optionally `E2E_BASE_URL` (default `http://127.0.0.1:5173`). It
creates a separate synthetic company with historical test rules and cleans up its
records. It never installs verified rates into an existing business. Browser
screenshots, trace and generated PDF evidence are under ignored `test-results/`.

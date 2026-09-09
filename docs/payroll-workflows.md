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
   dates and rounding before recording verification. Use **Use 2026 rates** to prefill a dated draft, then save and
   verify it after reviewing the evidence and company component treatments. Invalid monthly parameter structures are rejected on creation.
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

## Guided setup and employee imports

New company registration has two steps: account details, then business details.
The company opens on **Setup**. The five steps cover employer registrations,
employees and salaries, monthly periods, reviewed rules and the first finalized
payroll. Progress is derived from database records and survives reloads; there is
no client-side checkbox that can mark missing records complete. The people step
checks open employment and salary records, and the rules step checks coverage of
a saved regular period. Calculation still validates exact dates, selected employees,
statutory identifiers and cumulative balances.

**People → Import employees** downloads a header-only CSV template, accepts up to
250 employees / 500 KB, validates each row and previews normalized records. Confirm
review to create employee, employment, salary and optional payroll details in one
transaction. Repeated employee numbers, stale review digests, invalid dates or
amounts block the entire import. Existing records are never overwritten. Retrying
a committed file is rejected as a duplicate. Import requires both workforce-write
and compensation-write permissions. Opening tax balances are reviewed separately
in each employee profile.

## Team access

Owners use **Team** to create expiring, single-use invitation links, review invitation
history and suspend/restore non-owner access with optimistic version checks.
The invitation token is shown only at creation; only its digest is stored. Links
expire after seven days and can be revoked. No invitation email is sent: the owner
shares the link directly with its intended recipient. Tokens travel in the URL
fragment and POST body, not API URL paths or query strings.

Recipients can create an account without creating a company. Existing account
holders must authenticate with their existing password. Failed attempts use the
existing lockout mechanism. Accepting a link consumes it transactionally and opens
the invited company. Owner/self access cannot be suspended through this UI.
Suspension affects subsequent authorized requests immediately; restoring a
membership does not require changing its account or password.

Available invitation roles:

- Payroll operator: employee/compensation maintenance and calculation; no finalization.
- Payroll reviewer: employee/payroll reading and finalization; no calculation or employee edits.
- Report reader: payroll reading and report downloads; no record changes or team management.

These roles can expose sensitive company payroll information as described above.
There is no employee self-service role. Owner transfer, configurable custom roles,
email delivery and password recovery are separate capabilities, not implied by
invitation support. No new environment variables are required for the manual-link
workflow. A configured delivery provider would be required for future email flows.

## 2026 monthly statutory starting point

**Statutory rules → Use 2026 rates** prefills a company draft for 1 January–31 December 2026. PAYE retains cumulative monthly bounds K5,100 / K7,100 / K9,200 and rates 0% / 20% / 30% / 37%. NAPSA remains 5% each of covered gross earnings, with the annual contribution cap increased to K1,861.80 each (earnings ceiling K37,236). NHIMA remains 1% each of basic salary, with no monetary cap. Only BASE_SALARY treatment is supplied; add and review every company allowance code.

Evidence reviewed 6 September 2026:

- [PwC 2026 income-tax table](https://taxsummaries.pwc.com/zambia/individual/taxes-on-personal-income), reviewed 24 July 2026: annual bands divided by 12 match the existing monthly ZRA reference. The ZRA 2026 practice-note download could not be retrieved during this review; the preset labels PwC as its publisher.
- [NAPSA notice dated 5 January 2026, copy hosted by CRS](https://www.crs.co.za/wp-content/uploads/2026/01/NAPSA_Revision_of_Contribution_Ceiling_2026.pdf), read directly and corroborated against [PwC's 2026 NAPSA update](https://taxsummaries.pwc.com/zambia/individual/significant-developments). The rate is unchanged; carrying forward the 2025 cap would be incorrect.
- [NHIMA regulations, Third Schedule](https://www.nhima.co.zm/download/document/813df761802019102159cc9cc7.pdf), supported by the [NHIMA FAQ](https://www.nhima.co.zm/elementor-1783/).

Reference retrieval writes nothing. Saving creates a draft through the existing authorized API; recorded verification is still required before calculation. The preset never updates existing configurations or finalized snapshots, and never serves as a calculator fallback. Do not extend its dates into 2027 without a new annual review.

## Bank access and statement reconciliation

**Bank batches** now includes Bank access, Salary files and Reconciliation. The
access guide covers 15 commercial banks with sources and downloadable request
briefs. The employer must obtain bank onboarding and technical access before live
payments or automatic statement feeds can be implemented. No bank is connected.
See [bank research and onboarding](bank-integration-research.md) for the complete
bank-by-bank findings and requirements.

Reconciliation compares an uploaded, normalized ZMW statement with immutable
finalized payroll. Download the template, preserve transaction IDs/references,
use negative debits with two decimal places and select the full statement date
range. The review flags missing, mismatched and multiple entries, including
possible reversals, and leaves unrelated entries unmatched. It never infers
individual payment settlement from a consolidated batch debit. Files are limited
to 500 KB / 5,000 rows. Results are transient, with a full CSV download; no bank
confirmation or paid status is recorded. The upload's ownership, authenticity and
completeness require the operator's review against the original bank statement.

Payment instructions and generated salary-template references now share a stable
20-character reference per company/period/employee. Previously downloaded files
retain their original references and need manual matching if already submitted.
Do not submit a payroll again just to change its reference. The reference is not
a live bank idempotency implementation. The existing FNB file workflow and
reviewed custom templates remain manual bank-upload tools.

# ADR 0014: Industry wage checks and configurable export preparation

Date: 2026-09-05. Status: Accepted for preparation and preview only.

## Honest integration boundary

The user confirmed that “ZRA SmartSearch CSV” means the **TaxOnline PAYE
return**. We have not obtained a current, authoritative machine-readable
upload schema. A configurable CSV is not a certified TaxOnline return.

[Zanaco's published banking FAQ](https://www.zanaco.co.zm/new-internet-banking-faqs/)
documents bulk CSV salary payments and host-to-host integration, but this is
not an API specification or an exact file layout. The bank directory covers
the 15 institutions in the
[Bank of Zambia register](https://www.boz.zm/Registered_Banks_January_2026.pdf)
and [deposit-insurance notice](https://www.boz.zm/Public_Notice_Deposit_Insurance_Scheme.pdf).
Every connection is explicitly `not_connected`; names do not indicate tested
format compatibility. No bank credentials are collected and no money is sent.

Live integrations require each selected bank's onboarding, interface contract,
credentials held in an appropriate secret store, sandbox acceptance, maker /
checker approval, idempotent execution, status reconciliation and reversal /
failure handling. Automatic export generation must take immutable finalized
payroll snapshots, which are not yet exposed by a payroll-run API.

## Immutable company settings

`app.operations_settings` stores tenant-scoped, append-only configuration
versions: `compliance_profile` or `export_template`. Runtime users cannot
update/delete them. UI/API lists the most recent 100 settings, explicitly not
a complete historical browser. Selection by ID remains available for previews.

Endpoints under `/api/companies/:companyId/operations`:

- `GET`: company-read permission, returns settings and disconnected directory.
- `POST`: company-update permission and CSRF; validates settings, saves and
  audits atomically. Source references must not contain bank credentials.
- `POST /export-preview`: payroll-read permission and CSRF; returns an audited
  CSV preview for a tenant-owned template and operator-entered rows.
- `POST /compliance-preview`: compensation-read permission and CSRF; compares
  basic pay with an applicable, verified, labour-sourced minimum.

Exports accept exact decimal strings (two fractional places), preserve
identifier bytes/leading zeros, enforce required columns and unique payment
references, and reject formula/control-character cells. Delimiter and header
presence/order are configurable. Fields are allowlisted; duplicate columns
are rejected. Salary amounts must be positive; monetary return fields are
currently nonnegative, so refund/adjustment layouts are not supported. CSV
preview data is not persisted or included in audit metadata. API request body
limit is 1 MiB and row limit 10,000 (whichever is reached first); UI is capped
at 200 manually entered rows. Opening a CSV in spreadsheet software may coerce
identifiers; use text-column imports when checking account/TPIN values.

## Industry-specific minimum basic pay

The reviewer identifies the industry, worker category, governing wage order /
agreement, applicability and exemptions. The profile pins a verified statutory
configuration ID. Rules are explicit operator-provided parameters:

```ts
parameters.labourMinimumWages: Array<{
  industry: string;
  workerCategory: string;
  minimumMonthlyBasicPay: string; // exact ZMW, e.g. two decimal places
}>;
```

This is an extension to the existing full statutory-configuration parameters,
not a substitute for mandatory ZRA/NAPSA/NHIMA sources. A labour source is
additionally required at assessment. There must be exactly one matching rule
for the industry/category. Missing, retired, unverified, out-of-date or
ambiguous rules block the check. Amount comparisons use integer minor units.

Sources to assess include the Ministry of Labour's
[General Order 2023](https://www.mlss.gov.zm/wp-content/uploads/2023/12/IS-NO.48-1.pdf)
and [Shop Workers Order 2023](https://www.mlss.gov.zm/wp-content/uploads/2023/12/IS-NO.50-1.pdf).
Sector coverage and exclusions matter: no rates are installed automatically.
Tests deliberately use synthetic industry/category values, not claimed legal
minimums. Later amendments must be reviewed before activating any rule.

The result is scoped to `monthly_basic_pay_only`, not “legally compliant”.
Working hours, overtime, leave, notice, redundancy, working-condition rules,
contract applicability and collective-agreement compliance are not assessed.

## User interface and verification

A responsive sidebar workspace replaces the static progress page. It provides
session restoration, login/registration/logout, a company switcher, employee
creation, period creation, gratuity workflows, wage checks, template mapping
and CSV previews. Statutory configuration is listed; editing/verification
still uses the existing authorized API. Permissions are enforced server-side;
the UI does not yet tailor its navigation to each role.

Cookies are same-origin and CSRF tokens stay in memory. Company/page changes
reset form and record state and abort pending reads/exports. No invented
payroll totals, connected-bank claims or completed filing states are shown.
Frontend tests exercise authentication, CSRF, employee creation, session expiry
and tenant switching. API tests cover persistence, authorization, audit,
cross-tenant settings access, applicable dates and CSV validation.

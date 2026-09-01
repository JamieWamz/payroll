# Contributing to ZamPayroll

Thank you for helping build ZamPayroll. Payroll software carries financial,
privacy, and regulatory risk, so correctness and evidence take priority over
speed or a convincing demo.

> [!IMPORTANT]
> Do not invent, estimate, or silently assume PAYE, NAPSA, NHIMA, or any other
> statutory rule or rate. Phase 1 contains no payroll calculations. Future rule
> changes require authoritative Zambian sources, effective dates, source
> metadata, and boundary-focused automated tests.

## Before changing code

1. Read [README.md](README.md), [docs/architecture.md](docs/architecture.md),
   and [SECURITY.md](SECURITY.md).
2. Use an issue or design discussion before a large or architecture-changing
   contribution.
3. Keep the change within one clear objective. Do not combine unrelated
   cleanup with product behavior.
4. Use your own accurate Git author identity and never impersonate another
   contributor.

Follow the setup instructions in the README, then create a focused branch from
the latest `main`.

## Engineering requirements

- Keep presentation, application/domain behavior, and infrastructure concerns
  separated. Do not place payroll logic in React components or HTTP handlers.
- Prefer the modular monolith. Do not add a service, queue, datastore, or
  framework without a concrete need and an explicit architectural decision.
- Validate untrusted inputs at API and database boundaries.
- Authorize every future company-scoped operation; UI visibility is not an
  authorization control.
- Avoid collecting or retaining sensitive payroll information unless it is
  required for an implemented feature.
- Use deterministic inputs and outputs for future calculations. Do not read the
  current clock or mutable process state from calculation code.
- Return safe errors to clients and structured operational context to logs.
  Never log credentials, tokens, connection URLs, complete request bodies, or
  unnecessary employee/payroll values.
- Add tests with every significant behavior or bug fix.
- Update documentation when commands, configuration, routes, topology,
  invariants, or operator responsibilities change.

## Statutory and payroll changes

A future statutory-rule pull request must identify the authoritative Zambian
source and the date it was accessed, retain source/reference metadata in the
configuration, specify inclusive/exclusive effective-date boundaries, and add
tests for thresholds, rounding, and adjacent configuration periods.

Do not treat blog posts, search snippets, screenshots, sample spreadsheets, or
an AI-generated answer as authoritative. If a rule cannot be verified, stop and
mark the work blocked; do not add a placeholder rate that could be mistaken for
real payroll behavior.

Future finalized payroll records must never be updated silently. Changes must
use explicit correction or reversal workflows that preserve the original
calculation and audit trail.

## Database migration discipline

- Put every schema or privilege change in a timestamped SQL file under
  `apps/api/migrations`.
- Create migrations with
  `npm run db:migrate:create -- describe-the-change`; do not manufacture a
  conflicting timestamp.
- Keep one coherent change per migration and review both `Up` and `Down`
  sections.
- Never edit or reorder a migration after it has been shared or applied to a
  non-disposable environment. Add a corrective migration.
- Run DDL with the migration role. The runtime role must not gain schema-creation
  or migration-metadata access.
- Preserve least privilege: explicitly review schema, table, sequence,
  function, and `PUBLIC` grants.
- Test a clean database initialization and an upgrade from the previous schema.
  Test rollback only against disposable data; production recovery should use a
  reviewed forward migration and backup/restore plan.
- Inspect lock duration, table rewrites, nullability, defaults, backfills, and
  data-loss risk before approving a migration.

## Secrets, personal data, and test fixtures

Never commit `.env` files, credentials, API keys, private certificates,
database dumps, access tokens, or production configuration. The values in
`.env.example` must remain unmistakably local placeholders.

Do not use real employee, company, bank, tax, national-identifier, salary, or
payroll information in source code, tests, screenshots, issues, pull requests,
logs, or fixtures. Use clearly synthetic data. If sensitive data is exposed,
stop sharing it, preserve only the minimum incident evidence, rotate affected
secrets, and follow the private process in SECURITY.md.

## Local quality gates

Before each developmental junction and before opening or updating a pull
request, run:

```sh
npm run check
```

This checks formatting, linting, types, tests, and builds. Database-affecting
changes must also run the PostgreSQL integration suite against an initialized,
migrated disposable database:

```sh
set -a
. ./.env
set +a
npm run check
```

Inspect migration files and security implications separately; a green command
does not replace review. Consider `npm audit` findings in the context of both
development and production dependency trees, and document any accepted risk.

## Commits and pull requests

Commit completed, verified developmental junctions with concise descriptive
messages. Keep commits reviewable and avoid committing generated `dist`,
coverage, tool-cache, local environment, or editor files. Push the working
branch after each meaningful junction so reviewed progress is not stranded
locally.

A pull request should explain:

- the problem and the implemented scope;
- what is deliberately not included;
- tests and manual verification performed;
- migrations and rollback/recovery considerations;
- security, authorization, privacy, and audit implications;
- documentation changes; and
- authoritative sources for any future statutory behavior.

Do not merge with failing required checks. A UI demonstration alone is not a
definition of done: implemented features also need appropriate migrations, API
validation, domain logic, automated tests, error handling, authorization,
documentation, and audit consideration.

Report suspected vulnerabilities privately as described in
[SECURITY.md](SECURITY.md), not in a public issue or pull request.

By intentionally submitting a contribution for inclusion, you agree that it
is licensed under the repository's [Apache License 2.0](LICENSE), unless you
explicitly state otherwise as permitted by that license.

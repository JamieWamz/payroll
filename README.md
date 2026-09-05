# ZamPayroll

ZamPayroll is a Zambia-specific payroll SaaS under active development for SMEs
and accounting firms.

> [!WARNING]
> **Phase 1 is complete and Phase 2 application work is in progress.** The
> system now implements registration, login, secure session restoration, and
> logout, plus tenant-authorized company, workforce, and effective-dated
> compensation workflows, payroll-period creation/history, and statutory
> configuration administration. It does not yet expose payroll calculation or
> finalization and has no approved 2026 statutory configuration. The isolated
> calculator is not yet available through the API;
> payslips and statutory reports are also not implemented. No unverified rate
> should be used for real payroll. The current application is not production-ready.

## What exists today

- A TypeScript npm workspace with a React/Vite web application and a Fastify
  API.
- PostgreSQL 18 initialization, least-privilege runtime and migration roles,
  and version-controlled SQL migrations.
- Docker images and Compose orchestration for PostgreSQL, migrations, the API,
  and the Nginx-served web application.
- Runtime environment validation, API liveness/readiness routes, security
  headers, structured logging, and graceful shutdown.
- Framework-independent company, user, role, permission, and membership domain
  values with validation and immutable update operations.
- A tenant and identity PostgreSQL schema with composite tenant references,
  forced row-level security, deny-by-default global users, and no runtime hard
  deletes.
- A database adapter that scopes tenant work to one transaction and clears its
  company context automatically on commit or rollback.
- Registration and login with Argon2id password verification, a blocklist
  contract, generic credential failures, throttling, bounded lockout, and
  atomic first-company owner provisioning.
- Server-side opaque sessions with idle and absolute expiration, HttpOnly
  SameSite cookies, independently generated CSRF tokens, session restoration,
  CSRF-checked logout, and authentication audit events.
- Transaction-atomic tenant authorization that resolves each requested company
  to a live membership and current role permissions, with CSRF checks and audit
  writes for company and workforce mutations.
- Authenticated company read/name-update; employee list/create/detail/update/
  archive; and employment-create/end HTTP workflows with bounded queries,
  optimistic versions, conflict handling, and audit events.
- Authenticated compensation history, salary creation/end-dating, and fixed
  allowance/deduction creation/end-dating workflows with CSRF protection,
  optimistic versions, conflict handling, and atomic audit events.
- Authenticated payroll-period history and creation workflows, including
  regular-period overlap prevention, explicit off-cycle periods, bounded
  filtering, CSRF protection, permissions, and atomic audit events.
- Authenticated statutory-configuration list/detail/create/verify/retire
  workflows with source evidence, reviewer attestation, optimistic versions,
  immutable verified history, and official PAYE/contribution reference data.
- Effective-dated company gratuity policies and exact contract-expiry benefit
  previews, gated on an applicable verified labour-sourced configuration.
  These are not posted settlements or automatic employee entitlements.
- Industry/category profiles and verified-rule monthly basic-pay checks (not
  whole-law compliance certification).
- Immutable operator-defined bank/PAYE CSV templates and validated preview
  downloads. All 15 listed bank connections are explicitly disconnected;
  TaxOnline upload certification and finalized-payroll extraction are pending.
- A responsive authenticated workspace for employee and period creation,
  gratuity policies/previews, wage checks, and CSV template mapping. It replaces
  the former static progress page and resets company data on tenant switches.
- Forced-RLS credential, server-side session, and append-only audit tables.
  The runtime role has no direct access to those tables; only a tenant-checked
  audit append function is currently exposed.
- Minimal employee identity and effective-dated employment domain models with
  checked history, termination, and archival behavior.
- Tenant-isolated employee and employment tables with composite cross-company
  references, forced RLS, one open employment per employee, and no runtime
  hard deletes.
- Effective-dated monthly ZMW salaries and fixed-per-period allowances and
  deductions, with employment-bound dates and concurrent overlap protection.
- Explicit regular and off-cycle payroll periods with separate payment dates;
  regular periods cannot overlap within a company.
- Effective-dated statutory configuration drafts with required ZRA, NAPSA, and
  NHIMA source evidence, human verification attribution, immutable verified
  history, tenant isolation, and concurrent overlap prevention. This layer
  deliberately contains no approved rates yet.
- Draft, calculated, and finalized payroll-run domain and database lifecycles;
  pinned period/configuration references; employee input/result snapshots;
  normalized breakdown components; reconciliation checks; review
  recalculation; and immutable finalized history.
- A deterministic Zambian monthly calculator implementing cumulative
  progressive PAYE, separately capped employee/employer NAPSA contributions,
  NHIMA contributions, auditable component treatment, signed PAYE refunds, and
  exact integer rounding. All bands, rates, caps, and treatments come from the
  pinned verified configuration; no configuration is silently built into the
  engine. The official ZRA 2025 bands are retained as a configuration reference,
  not as an active 2026 rule set.
- Unit, API, frontend, and PostgreSQL integration test foundations.
- Shared linting, formatting, type-checking, build, and CI gates.

The architecture and controls planned for later payroll work are documented in
[docs/architecture.md](docs/architecture.md). They are future design
constraints, not implemented features.

The accepted Phase 2 sequencing and security boundary is recorded in
[ADR 0001](docs/decisions/0001-phase-2-domain-boundaries.md). In particular,
business CRUD will not be exposed through temporary identity headers or other
insecure development shortcuts.

The authentication primitives and their intentionally closed runtime boundary
are recorded in
[ADR 0002](docs/decisions/0002-authentication-security-foundation.md).
Workforce data-minimization and employment-history decisions are recorded in
[ADR 0003](docs/decisions/0003-workforce-foundation.md).
Compensation and payroll-period decisions are recorded in
[ADR 0004](docs/decisions/0004-compensation-payroll-period-foundation.md).
Statutory evidence decisions and current source gaps are recorded in
[ADR 0005](docs/decisions/0005-statutory-configuration-evidence.md) and the
[statutory source register](docs/statutory-source-register.md).
Payroll-run orchestration and finalization decisions are recorded in
[ADR 0006](docs/decisions/0006-payroll-run-lifecycle.md).
Authentication runtime decisions are recorded in
[ADR 0007](docs/decisions/0007-authentication-runtime.md).
Tenant-authorized company and workforce HTTP decisions are recorded in
[ADR 0008](docs/decisions/0008-tenant-authorized-company-workforce-http.md).
Tenant-authorized compensation HTTP decisions are recorded in
[ADR 0009](docs/decisions/0009-tenant-authorized-compensation-http.md).
Tenant-authorized payroll-period HTTP decisions are recorded in
[ADR 0010](docs/decisions/0010-tenant-authorized-payroll-period-http.md).
Configurable Zambian calculation decisions are recorded in
[ADR 0011](docs/decisions/0011-configurable-zambian-monthly-calculator.md).
Tenant-authorized statutory-configuration HTTP decisions are recorded in
[ADR 0012](docs/decisions/0012-tenant-authorized-statutory-configuration-http.md).
The externally researched interaction direction is recorded in the
[product design guidelines](docs/product-design-guidelines.md).
Gratuity scope and legal limitations are recorded in
[ADR 0013](docs/decisions/0013-contract-gratuity-policy-previews.md).
Industry checks, bank onboarding gaps and TaxOnline export limitations are in
[ADR 0014](docs/decisions/0014-industry-and-export-preparation.md).

## Technology

- Node.js 24 and npm 11
- TypeScript 6
- React 19 and Vite 8
- Fastify 5
- PostgreSQL 18
- Vitest, ESLint, and Prettier
- Docker and Docker Compose

## Prerequisites

Install the following before starting:

- Git
- Node.js 24 (the exact development version is in `.nvmrc`)
- npm 11
- Docker Engine with Docker Compose v2
- `curl` for the verification examples

The default local ports are `5173` for Vite, `3000` for the API, `5432` for
PostgreSQL when the development override is used, and `8080` for the
containerized web application. Change the matching values in `.env` if a port
is already in use.

## Initial setup

```sh
git clone git@github.com:JamieWamz/payroll.git
cd payroll
# If Node Version Manager is installed:
nvm use
npm ci
cp .env.example .env
chmod 600 .env
```

Before starting PostgreSQL, replace all three example passwords in `.env` and
update every connection URL that contains them. URL-encode reserved characters
inside URLs. The checked-in values are development placeholders, not secrets.
Never put real payroll data or production credentials in this environment.

### Run applications on the host

This workflow runs PostgreSQL in Docker and the API and Vite development server
on the host:

```sh
npm run db:up
docker compose --env-file .env -f compose.yaml -f compose.dev.yaml ps postgres
npm run db:migrate
npm run dev
```

Wait until PostgreSQL reports `healthy` before running the migration. Open
<http://127.0.0.1:5173>. Vite proxies `/api` requests to the API at
<http://127.0.0.1:3000>.

Stop the application processes with `Ctrl+C`, then stop Compose services while
preserving the database volume:

```sh
npm run db:down
```

### Run the complete Compose stack

The base Compose file does not publish PostgreSQL to the host. It runs a
one-shot migration container before starting the API, then starts the web
container only after the API is ready.

```sh
docker compose --env-file .env config --quiet
docker compose --env-file .env up --detach --build
docker compose --env-file .env ps
```

Open <http://127.0.0.1:8080>. To inspect startup failures:

```sh
docker compose --env-file .env logs postgres migrate api web
```

Stop the stack without deleting its data:

```sh
docker compose --env-file .env down
```

Use `compose.dev.yaml` only when host tools need direct PostgreSQL access. It
publishes PostgreSQL on loopback:

```sh
docker compose --env-file .env -f compose.yaml -f compose.dev.yaml up --detach postgres
```

## Endpoints

| Runtime              | Address                                                                                      | Purpose                                                   |
| -------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Host development web | `http://127.0.0.1:5173`                                                                      | Vite development server                                   |
| Compose web          | `http://127.0.0.1:8080`                                                                      | Nginx static frontend and `/api` proxy                    |
| API                  | `http://127.0.0.1:3000`                                                                      | Direct Fastify access                                     |
| API liveness         | `/api/health/live`                                                                           | Confirms the API process can respond                      |
| API readiness        | `/api/health/ready`                                                                          | Confirms the runtime DB role and `app` schema are ready   |
| Register owner       | `POST /api/auth/register`                                                                    | Creates the first company owner and a secure session      |
| Log in               | `POST /api/auth/login`                                                                       | Verifies credentials and creates a secure session         |
| Restore session      | `GET /api/auth/session`                                                                      | Returns the active user and company memberships           |
| Log out              | `POST /api/auth/logout`                                                                      | CSRF-checks and revokes the current session               |
| Company profile      | `GET, PATCH /api/companies/:companyId`                                                       | Reads or renames an authorized company                    |
| Employees            | `GET, POST /api/companies/:companyId/employees`                                              | Lists or creates employees                                |
| Employee detail      | `GET, PATCH /api/companies/:companyId/employees/:employeeId`                                 | Reads, edits, or archives an employee                     |
| Add employment       | `POST /api/companies/:companyId/employees/:employeeId/employments`                           | Adds validated history                                    |
| End employment       | `PATCH /api/companies/:companyId/employees/:employeeId/employments/:employmentId`            | Ends active employment                                    |
| Compensation history | `GET /api/companies/:companyId/employments/:employmentId/compensation`                       | Lists salary and component history                        |
| Add salary           | `POST /api/companies/:companyId/employments/:employmentId/salaries`                          | Adds an effective-dated monthly ZMW salary                |
| End salary           | `PATCH /api/companies/:companyId/employments/:employmentId/salaries/:salaryId/end`           | Ends an open salary                                       |
| Add component        | `POST /api/companies/:companyId/employments/:employmentId/components`                        | Adds a fixed allowance or deduction                       |
| End component        | `PATCH /api/companies/:companyId/employments/:employmentId/components/:componentId/end`      | Ends an open allowance or deduction                       |
| Payroll periods      | `GET, POST /api/companies/:companyId/payroll-periods`                                        | Lists or creates regular and off-cycle periods            |
| Statutory versions   | `GET, POST /api/companies/:companyId/statutory-configurations`                               | Lists or creates evidence-backed configuration drafts     |
| Statutory detail     | `GET /api/companies/:companyId/statutory-configurations/:configurationId`                    | Reads parameters, evidence, and verification state        |
| Verify/retire rules  | `POST /api/companies/:companyId/statutory-configurations/:configurationId/{verify,retire}`   | Publishes or retires an immutable rule version            |
| Statutory references | `GET /api/companies/:companyId/statutory-configurations/references/{zra-paye,contributions}` | Returns sourced configuration aids, never active defaults |
| Web-container health | `http://127.0.0.1:8080/health`                                                               | Confirms Nginx can serve requests                         |

State-changing company, workforce, compensation, payroll-period, and
statutory-configuration requests require the CSRF token returned by
authentication in both the `zampayroll_csrf` cookie and `X-CSRF-Token` header.
A readiness failure returns HTTP `503` without returning the underlying
database error to the client.

## Quality checks and tests

Run the complete local gate:

```sh
npm run check
```

That command checks formatting, linting, types, tests, and production builds.
PostgreSQL integration suites run only when `TEST_DATABASE_URL` is exported;
the tenant/identity, authentication/audit, and workforce suites also require
`TEST_DATABASE_MIGRATION_URL`. Apply all migrations first. To include them with
the values in your local `.env`:

```sh
set -a
. ./.env
set +a
npm run check
```

Other useful commands are:

```sh
npm test
npm run test:coverage
npm run lint
npm run typecheck
npm run build
npm run format
```

## Database migrations

Migrations are timestamped SQL files in `apps/api/migrations`. They run as
`zampayroll_migrator`; the API connects separately as the restricted
`zampayroll_app` role.

```sh
# Apply all pending migrations
npm run db:migrate

# Create a timestamped SQL migration
npm run db:migrate:create -- describe-the-change

# Revert the most recent migration in a disposable local database only
npm run db:migrate:down
```

Review both migration directions, privilege changes, and data-safety
implications before committing. Do not edit a migration that has already been
shared or applied outside your disposable environment; add a corrective
migration instead. Never use `db:migrate:down` as a production deployment
strategy.

### Password and volume caveat

The PostgreSQL role-creation scripts run only when the named `postgres_data`
volume is initialized. Editing passwords in `.env` later does **not** rotate the
passwords stored in an existing database. Rotate roles explicitly through an
authorized administrative procedure. For disposable local data only, you may
delete and recreate the volume after confirming nothing is needed; Compose
volume deletion is irreversible.

`docker compose down` preserves the named volume. Adding `--volumes` deletes it.

## Environment configuration

`.env.example` is the authoritative local template. `.env` and other local
environment files are ignored by Git.

| Group                 | Variables                                                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| API runtime           | `NODE_ENV`, `LOG_LEVEL`, `WEB_ORIGIN`, `TRUST_PROXY`, `HOST`, `PORT`                                                               |
| Local web proxy       | `API_PROXY_TARGET` (defaults to `http://127.0.0.1:3000`)                                                                           |
| Host port mappings    | `API_PORT`, `WEB_PORT`, `POSTGRES_PORT`                                                                                            |
| PostgreSQL bootstrap  | `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`                                                                                |
| Least-privilege roles | `MIGRATION_DB_PASSWORD`, `APP_DB_PASSWORD`                                                                                         |
| Host DB URLs          | `DATABASE_MIGRATION_URL`, `DATABASE_URL`, `TEST_DATABASE_MIGRATION_URL`, `TEST_DATABASE_URL`                                       |
| Compose DB URLs       | `COMPOSE_DATABASE_MIGRATION_URL`, `COMPOSE_DATABASE_URL`                                                                           |
| Pool and TLS          | `DATABASE_SSL`, `DATABASE_POOL_MAX`, `DATABASE_CONNECTION_TIMEOUT_MS`, `DATABASE_IDLE_TIMEOUT_MS`, `DATABASE_STATEMENT_TIMEOUT_MS` |

`API_PORT` controls the Compose host mapping; the host-run API reads `PORT` and
defaults to `3000`. Keep `TRUST_PROXY=false` unless the deployment has a known,
trusted proxy configuration. Production credentials must come from a secret
manager or equivalent deployment mechanism, not a committed `.env` file.

## Repository layout

```text
apps/
  api/                    Fastify API, DB adapter, migrations, and tests
  web/                    React/Vite frontend, tests, and Nginx configuration
docker/postgres/init/     First-volume PostgreSQL role/bootstrap scripts
docs/architecture.md      Current topology and future architecture constraints
.github/workflows/        Continuous-integration workflows
compose.yaml              Hardened complete-stack services and segmented networks
compose.dev.yaml          Local-only PostgreSQL loopback exposure
```

See [CONTRIBUTING.md](CONTRIBUTING.md) before making changes and
[SECURITY.md](SECURITY.md) before reporting a vulnerability.

## License

Licensed under the [Apache License 2.0](LICENSE).

Copyright 2026 Wamz Wamu.

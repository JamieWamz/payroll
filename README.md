# ZamPayroll

ZamPayroll is a Zambia-specific payroll SaaS under active development for SMEs
and accounting firms.

> [!WARNING]
> **Phase 1 is complete and Phase 2 domain work is in progress.** The system
> does not yet implement authentication requests, employee workflows, payroll
> calculations, PAYE, NAPSA, NHIMA, payslips, or statutory reports. The new
> company, identity, workforce, compensation, and payroll-period foundations
> are internal only and have no business HTTP routes. No statutory rate should be
> inferred or used for real payroll. The current application is not
> production-ready.

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
- Argon2id password-verifier, opaque session/CSRF token, authorization
  principal, and bounded audit-event contracts. Registration and login routes
  are intentionally not open yet.
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
The externally researched interaction direction is recorded in the
[product design guidelines](docs/product-design-guidelines.md).

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

| Runtime              | Address                        | Purpose                                                 |
| -------------------- | ------------------------------ | ------------------------------------------------------- |
| Host development web | `http://127.0.0.1:5173`        | Vite development server                                 |
| Compose web          | `http://127.0.0.1:8080`        | Nginx static frontend and `/api` proxy                  |
| API                  | `http://127.0.0.1:3000`        | Direct Fastify access                                   |
| API liveness         | `/api/health/live`             | Confirms the API process can respond                    |
| API readiness        | `/api/health/ready`            | Confirms the runtime DB role and `app` schema are ready |
| Web-container health | `http://127.0.0.1:8080/health` | Confirms Nginx can serve requests                       |

The API still exposes health routes only. Company, identity, and workforce
records are not reachable through HTTP until the authentication,
authorization, tenant resolution, CSRF, throttling, and audit boundaries are
implemented. A readiness failure returns HTTP `503` without returning the
underlying database error to the client.

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

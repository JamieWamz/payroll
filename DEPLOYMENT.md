# OCI Compute + Neon deployment runbook

## Deployment architecture

ZamPayroll is deployable today as a Dockerized React/Vite web service plus a
Fastify API, with the web service proxying `/api` to the API. Its database is
PostgreSQL 18, so it is compatible with Neon PostgreSQL without an ORM or SQL
rewrite. The intended staging and production architecture is:

```text
GitHub → OCI Compute VM → Nginx → web/API containers → Neon PostgreSQL
```

The API uses the PostgreSQL `pg` driver, PostgreSQL parameter syntax, and
versioned `node-pg-migrate` migrations. Tenant isolation relies on PostgreSQL
row-level security, transaction-local settings, advisory locks, range types,
`jsonb`, and PostgreSQL functions—all supported by Neon PostgreSQL. No database
adapter, migration, or payroll business-logic change is required for Neon.

Do not use Oracle connection strings in `DATABASE_URL`; the application
intentionally accepts PostgreSQL URLs only.

## Environments and branches

Use `feature/*` → `development` → `staging` → `main`.

- `development` is local/integration work and uses `DEPLOYMENT_ENV=development`.
- `staging` deploys to an isolated staging OCI VM and Neon project/database and uses
  `DEPLOYMENT_ENV=staging`, `NODE_ENV=production`.
- `main` is the intentional production release branch, OCI VM, and Neon
  project/database and uses
  `DEPLOYMENT_ENV=production`, `NODE_ENV=production`.

Create the `development` and `staging` branches in GitHub before relying on the
workflow. CI runs on those branches, `main`, feature branches, and their pull
requests. The manual **Release images** workflow only permits `staging` or
`main`; it verifies first and publishes immutable GHCR images, but does not
deploy a server. Apply `.github/branch-protection.json` to `development`,
`staging`, and `main` through GitHub administration.

`DEPLOYMENT_ENV` prevents accidentally running a staging/production-labelled
server with development Node settings. Production mode also rejects an HTTP
`WEB_ORIGIN` or insecure session cookies.

## Local development

Use two terminals. This workflow uses a local Docker PostgreSQL database and
runs the API/Vite development servers on your host; it has no OCI dependency.

**Terminal 1 — install, configure, and start PostgreSQL**

```sh
nvm use
npm ci
cp .env.example .env
npm run db:up
docker compose --env-file .env -f compose.yaml -f compose.dev.yaml ps postgres
```

Wait until `postgres` is `healthy`. The sample `.env` values are local-only and
internally consistent, so they work for a fresh clone. If you change a local
password, update every local connection URL in `.env` that contains it.

**Terminal 1 — migrate and run the application**

```sh
npm run db:migrate
npm run dev
```

Keep that terminal open. The API is at `http://127.0.0.1:3000`; Vite is at
`http://127.0.0.1:5173` and proxies `/api` to the API.

**Terminal 2 — verify and open the application**

```sh
curl --fail http://127.0.0.1:5173/api/health/ready
```

Open <http://127.0.0.1:5173>. Stop the development servers with `Ctrl+C`, then
run `npm run db:down` to stop PostgreSQL while preserving its data volume. Run
`npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` before
merging. PostgreSQL integration tests additionally need `TEST_DATABASE_URL` and
`TEST_DATABASE_MIGRATION_URL`.

Migration commands are intentionally distinct:

```sh
npm run db:migrate:create -- descriptive-name
npm run db:migrate
npm run db:migrate:down
```

Only use `db:migrate:down` against a disposable development database or during
a reviewed recovery procedure; it rolls back one migration and can be
destructive.

## Neon staging and production configuration

Do not copy `.env.example` to either environment. Create an ignored, permission
restricted environment file (or inject values from a secrets manager) per VM
and per Neon project. Create separate Neon projects for staging and production;
do not use a production branch or role for staging. Each project needs its own
database, endpoint, migration role, runtime role, and credentials.

Required application variables:

```text
DEPLOYMENT_ENV
NODE_ENV
HOST
PORT
DATABASE_URL
DATABASE_MIGRATION_URL
DATABASE_SSL
DATABASE_POOL_MAX
DATABASE_CONNECTION_TIMEOUT_MS
DATABASE_IDLE_TIMEOUT_MS
DATABASE_STATEMENT_TIMEOUT_MS
WEB_ORIGIN
SESSION_COOKIE_SECURE
SESSION_IDLE_TTL_SECONDS
SESSION_ABSOLUTE_TTL_SECONDS
TRUST_PROXY
LOG_LEVEL
```

Copy the two connection strings from the corresponding Neon project. They must
use that project's endpoint and include `sslmode=require`; set
`DATABASE_SSL=true` so the runtime verifies the server certificate. Set
`DATABASE_MIGRATION_URL` to the `zampayroll_migrator` role and `DATABASE_URL`
to the least-privileged `zampayroll_app` role. Never put either connection
string in GitHub workflow files, image layers, logs, or the frontend build.
Use Neon’s direct (non-pooled) endpoint for `DATABASE_MIGRATION_URL`; the
runtime URL may use the Neon pooled endpoint only after it has been verified
with the application’s transaction and readiness checks.

Before the first migration for each Neon project, connect with the project
owner connection string and run the supplied role bootstrap script. It creates
the two required application roles and applies the privileges expected by the
existing migrations:

```sh
psql "$NEON_OWNER_DATABASE_URL" \
  --set=ON_ERROR_STOP=1 \
  --set=migration_password="$NEON_MIGRATION_ROLE_PASSWORD" \
  --set=app_password="$NEON_APP_ROLE_PASSWORD" \
  --file deploy/neon/bootstrap-roles.sql
```

Keep these shell variables and connection strings out of shell history and CI
logs. Use the resulting role-specific Neon URLs for the two `DATABASE_*_URL`
environment variables. The bootstrap is a one-time privileged operation; do
not give the project-owner URL to the running application.

This application uses host-only cookies (`Path=/api`, `HttpOnly` for the
session, `SameSite=Strict`); no `COOKIE_DOMAIN` is needed when Nginx serves the
frontend and API under the same HTTPS origin. Set `WEB_ORIGIN` exactly to that
origin and set `SESSION_COOKIE_SECURE=true` and `TRUST_PROXY=true` in both
staging and production.

For the currently supported Docker deployment, bind the API and web services to
loopback only, run the `migrate` service once with the matching environment,
then start `api` and `web`. The supplied Compose PostgreSQL container is for
local development/CI only; in staging and production the application connects
to Neon and no database container is started or exposed. For a host-run API, run `npm run build` then
`npm start --workspace @zampayroll/api`; use a service manager such as systemd
to restart that process after crashes. Docker's `restart: unless-stopped` is
the supplied process-management mechanism for the container deployment.

Install [deploy/nginx/zampayroll.conf.example](deploy/nginx/zampayroll.conf.example)
on each OCI VM only after replacing its placeholder domain/certificate paths.
It redirects HTTP to HTTPS and proxies to the loopback-only web container. The
web container preserves the original HTTPS forwarding header to Fastify, which
allows `TRUST_PROXY=true` without downgrading the request scheme internally.

Health endpoints are unauthenticated and contain no database details:

- `GET /health` at the web proxy confirms that Nginx can serve traffic.
- `GET /api/health/live` confirms the API process is running.
- `GET /api/health/ready` checks that the configured database/schema is ready.

## Deployment checklist

Before every staging or production release:

- [ ] Pull the correct `staging` or `main` commit/image digest.
- [ ] Confirm the environment has its own database and secrets.
- [ ] Confirm `DATABASE_URL` and `DATABASE_MIGRATION_URL` point to the correct
      Neon project and use TLS.
- [ ] Back up and verify the current database restore procedure.
- [ ] Run the one-off migration job with the environment's migration role.
- [ ] Build or pull the verified API and web images.
- [ ] Restart the API/web process or containers.
- [ ] Check `/health`, `/api/health/live`, and `/api/health/ready`.
- [ ] Check the HTTPS frontend, login, and an authenticated database request.
- [ ] Monitor safe stdout/stderr logs; never place credentials or payroll data
      in log commands.

Schema migrations are forward-only operationally: take a backup first and use
a reviewed forward corrective migration if an application rollback is needed.
Only roll back an image when its schema compatibility has been confirmed.

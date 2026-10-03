# OCI deployment status and runbook

## Current compatibility boundary

ZamPayroll is deployable today as a Dockerized React/Vite web service plus a
Fastify API, with the web service proxying `/api` to the API. Its database is
**PostgreSQL 18**, not Oracle Database. It cannot safely connect to Oracle
Autonomous AI Database by changing an environment variable:

- the runtime uses the PostgreSQL `pg` driver and PostgreSQL parameter syntax;
- all 16 versioned migrations use PostgreSQL SQL and `node-pg-migrate`;
- tenant isolation depends on PostgreSQL row-level security, policies,
  transaction-local `set_config`, PostgreSQL functions, advisory locks, range
  types, `jsonb`, `RETURNING`, and PostgreSQL casts.

Do not put an Oracle connection string in `DATABASE_URL`; startup intentionally
rejects it. An Oracle migration is a separate, tested database-port project:
choose an Oracle Node driver, replace the database adapter and migrations,
reimplement tenant isolation and locking, migrate a copy of data, and run the
complete integration suite against an Autonomous AI Database. Until that work
is complete, the supported OCI database is a separately managed PostgreSQL
instance, not Oracle Autonomous AI Database.

This boundary is deliberate: a partial conversion would weaken tenant isolation
and could corrupt payroll data.

## Environments and branches

Use `feature/*` → `development` → `staging` → `main`.

- `development` is local/integration work and uses `DEPLOYMENT_ENV=development`.
- `staging` deploys to an isolated staging VM/database and uses
  `DEPLOYMENT_ENV=staging`, `NODE_ENV=production`.
- `main` is the intentional production release branch and uses
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

```sh
nvm use
npm ci
cp .env.example .env
# replace only the local placeholder passwords in .env
npm run db:up
npm run db:migrate
npm run dev
```

The host API runs on `HOST`/`PORT`; Vite is at `http://127.0.0.1:5173` and
proxies `/api` to `API_PROXY_TARGET`. Run `npm test`, `npm run lint`,
`npm run typecheck`, and `npm run build` before merging. PostgreSQL integration
tests additionally need `TEST_DATABASE_URL` and `TEST_DATABASE_MIGRATION_URL`.

Migration commands are intentionally distinct:

```sh
npm run db:migrate:create -- descriptive-name
npm run db:migrate
npm run db:migrate:down
```

Only use `db:migrate:down` against a disposable development database or during
a reviewed recovery procedure; it rolls back one migration and can be
destructive.

## Staging and production configuration

Do not copy `.env.example` to either environment. Create an ignored, permission
restricted environment file (or inject values from a secrets manager) per VM
and per database. Staging and production values must never overlap.

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

`DATABASE_URL` is the least-privileged runtime PostgreSQL role. Keep
`DATABASE_MIGRATION_URL` separate and provide it only to the one-off migration
job. This application uses host-only cookies (`Path=/api`, `HttpOnly` for the
session, `SameSite=Strict`); no `COOKIE_DOMAIN` is needed when Nginx serves the
frontend and API under the same HTTPS origin. Set `WEB_ORIGIN` exactly to that
origin and set `SESSION_COOKIE_SECURE=true` and `TRUST_PROXY=true` in both
staging and production.

For the currently supported Docker deployment, bind the API and web services to
loopback only, run the `migrate` service once with the matching environment,
then start `api` and `web`. The supplied Compose files include a PostgreSQL
container for local/CI use; do not use it as an Oracle substitute or expose it
publicly. For a host-run API, run `npm run build` then
`npm start --workspace @zampayroll/api`; use a service manager such as systemd
to restart that process after crashes. Docker's `restart: unless-stopped` is
the supplied process-management mechanism for the container deployment.

Install [deploy/nginx/zampayroll.conf.example](deploy/nginx/zampayroll.conf.example)
on the OCI VM only after replacing its placeholder domain/certificate paths.
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

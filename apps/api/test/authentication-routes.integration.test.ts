import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadEnvironment } from '../src/config/environment.js';
import { createPostgresDatabase } from '../src/infrastructure/database.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const testDatabaseMigrationUrl = process.env.TEST_DATABASE_MIGRATION_URL;
const fixtureEmail = 'owner.auth-route@example.com';
const fixtureCompanyCode = 'auth-route-company';
const validPassword = 'Correct horse battery staple 2026!';

describe.runIf(
  testDatabaseUrl !== undefined && testDatabaseMigrationUrl !== undefined,
)('authentication HTTP workflow', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  let migrationPool: Pool | undefined;

  beforeAll(async () => {
    if (
      testDatabaseUrl === undefined ||
      testDatabaseMigrationUrl === undefined
    ) {
      throw new Error('Test database URLs are required');
    }
    migrationPool = new Pool({
      application_name: 'zampayroll-auth-routes-ddl',
      connectionString: testDatabaseMigrationUrl,
      connectionTimeoutMillis: 5_000,
      max: 1,
      statement_timeout: 10_000,
    });
    await cleanFixture(migrationPool);
    const environment = loadEnvironment({
      DATABASE_URL: testDatabaseUrl,
      NODE_ENV: 'test',
      SESSION_ABSOLUTE_TTL_SECONDS: '3600',
      SESSION_COOKIE_SECURE: 'false',
      SESSION_IDLE_TTL_SECONDS: '600',
    });
    app = await buildApp({
      database: createPostgresDatabase(environment),
      environment,
    });
  });

  afterAll(async () => {
    await app?.close();
    if (migrationPool !== undefined) {
      await cleanFixture(migrationPool);
      await migrationPool.end();
    }
  });

  it('rejects a blocked password without creating an account', async () => {
    const response = await requireApp().inject({
      method: 'POST',
      payload: registrationPayload('passwordpassword'),
      url: '/api/auth/register',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'DomainError' });
  });

  it('registers, restores a session, enforces CSRF, logs out, and logs in', async () => {
    const registration = await requireApp().inject({
      method: 'POST',
      payload: registrationPayload(validPassword),
      url: '/api/auth/register',
    });
    expect(registration.statusCode).toBe(201);
    expect(registration.json()).toMatchObject({
      companies: [{ code: fixtureCompanyCode }],
      user: { email: fixtureEmail },
    });
    const registeredCookies = readCookies(registration.headers['set-cookie']);
    const registrationCsrf = registration.json<{ csrfToken: string }>()
      .csrfToken;
    expect(registeredCookies.header).toContain('zampayroll_session=');
    expect(registeredCookies.header).toContain('zampayroll_csrf=');

    const stored = await requireMigrationPool().query<{
      auditCount: string;
      permissionCount: string;
    }>(`
      SELECT
        (SELECT count(*)::text FROM app.audit_events AS event
         JOIN app.user_accounts AS account
           ON account.id = event.actor_user_account_id
         WHERE account.email = '${fixtureEmail}') AS "auditCount",
        (SELECT count(*)::text FROM app.role_permissions AS permission
         JOIN app.companies AS company
           ON company.id = permission.company_id
         WHERE company.code = '${fixtureCompanyCode}') AS "permissionCount"
    `);
    expect(stored.rows).toEqual([{ auditCount: '2', permissionCount: '13' }]);

    const duplicate = await requireApp().inject({
      method: 'POST',
      payload: registrationPayload(validPassword),
      url: '/api/auth/register',
    });
    expect(duplicate.statusCode).toBe(409);

    const session = await requireApp().inject({
      headers: { cookie: registeredCookies.header },
      method: 'GET',
      url: '/api/auth/session',
    });
    expect(session.statusCode).toBe(200);
    expect(session.json()).toMatchObject({
      companies: [{ code: fixtureCompanyCode }],
      csrfToken: registrationCsrf,
      user: { email: fixtureEmail },
    });

    const rejectedLogout = await requireApp().inject({
      headers: {
        cookie: registeredCookies.header,
        'x-csrf-token': 'invalid',
      },
      method: 'POST',
      url: '/api/auth/logout',
    });
    expect(rejectedLogout.statusCode).toBe(403);

    const logout = await requireApp().inject({
      headers: {
        cookie: registeredCookies.header,
        'x-csrf-token': registrationCsrf,
      },
      method: 'POST',
      url: '/api/auth/logout',
    });
    expect(logout.statusCode).toBe(204);

    const expiredSession = await requireApp().inject({
      headers: { cookie: registeredCookies.header },
      method: 'GET',
      url: '/api/auth/session',
    });
    expect(expiredSession.statusCode).toBe(401);

    const wrongPassword = await requireApp().inject({
      method: 'POST',
      payload: { email: fixtureEmail, password: `${validPassword}wrong` },
      url: '/api/auth/login',
    });
    expect(wrongPassword.statusCode).toBe(401);
    expect(wrongPassword.json()).toMatchObject({
      message: 'Email or password is incorrect',
    });

    const login = await requireApp().inject({
      method: 'POST',
      payload: { email: fixtureEmail, password: validPassword },
      url: '/api/auth/login',
    });
    expect(login.statusCode).toBe(200);
    expect(login.json()).toMatchObject({
      companies: [{ code: fixtureCompanyCode }],
      user: { id: expect.any(String) },
    });
    expect(readCookies(login.headers['set-cookie']).header).toContain(
      'zampayroll_session=',
    );
  });

  function requireApp(): Awaited<ReturnType<typeof buildApp>> {
    if (app === undefined) {
      throw new Error('App is not initialized');
    }
    return app;
  }

  function requireMigrationPool(): Pool {
    if (migrationPool === undefined) {
      throw new Error('Migration pool is not initialized');
    }
    return migrationPool;
  }
});

function registrationPayload(password: string) {
  return {
    companyCode: fixtureCompanyCode,
    companyName: 'Authentication Route Company',
    displayName: 'Route Owner',
    email: fixtureEmail,
    password,
  };
}

function readCookies(value: string | string[] | undefined) {
  const cookies =
    value === undefined ? [] : Array.isArray(value) ? value : [value];
  return { header: cookies.map((item) => item.split(';')[0]).join('; ') };
}

async function cleanFixture(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const account = await client.query<{ id: string }>(
      'SELECT id FROM app.user_accounts WHERE email = $1',
      [fixtureEmail],
    );
    const company = await client.query<{ id: string }>(
      'SELECT id FROM app.companies WHERE code = $1',
      [fixtureCompanyCode],
    );
    const userIds = account.rows.map((row) => row.id);
    const companyIds = company.rows.map((row) => row.id);

    await client.query(
      `DELETE FROM app.audit_events
       WHERE actor_user_account_id = ANY($1::uuid[])
          OR company_id = ANY($2::uuid[])`,
      [userIds, companyIds],
    );
    await client.query(
      'DELETE FROM app.sessions WHERE user_account_id = ANY($1::uuid[])',
      [userIds],
    );
    await client.query(
      'DELETE FROM app.role_permissions WHERE company_id = ANY($1::uuid[])',
      [companyIds],
    );
    await client.query(
      'DELETE FROM app.membership_roles WHERE company_id = ANY($1::uuid[])',
      [companyIds],
    );
    await client.query(
      'DELETE FROM app.company_memberships WHERE company_id = ANY($1::uuid[])',
      [companyIds],
    );
    await client.query(
      'DELETE FROM app.roles WHERE company_id = ANY($1::uuid[])',
      [companyIds],
    );
    await client.query(
      'DELETE FROM app.password_credentials WHERE user_account_id = ANY($1::uuid[])',
      [userIds],
    );
    await client.query('DELETE FROM app.companies WHERE id = ANY($1::uuid[])', [
      companyIds,
    ]);
    await client.query(
      'DELETE FROM app.user_accounts WHERE id = ANY($1::uuid[])',
      [userIds],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

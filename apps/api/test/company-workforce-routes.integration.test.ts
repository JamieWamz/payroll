import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadEnvironment } from '../src/config/environment.js';
import { createPostgresDatabase } from '../src/infrastructure/database.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const testDatabaseMigrationUrl = process.env.TEST_DATABASE_MIGRATION_URL;
const password = 'Correct horse battery staple 2026!';
const fixture = {
  primary: {
    code: 'workforce-route-primary',
    email: 'owner.workforce-route.primary@example.com',
  },
  secondary: {
    code: 'workforce-route-secondary',
    email: 'owner.workforce-route.secondary@example.com',
  },
} as const;

describe.runIf(
  testDatabaseUrl !== undefined && testDatabaseMigrationUrl !== undefined,
)('authorized company and workforce HTTP workflows', () => {
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
      application_name: 'zampayroll-company-workforce-routes-ddl',
      connectionString: testDatabaseMigrationUrl,
      connectionTimeoutMillis: 5_000,
      max: 1,
      statement_timeout: 10_000,
    });
    await cleanFixtures(migrationPool);
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
      await cleanFixtures(migrationPool);
      await migrationPool.end();
    }
  });

  it('requires authentication and canonical company identifiers', async () => {
    const missingSession = await requireApp().inject({
      method: 'GET',
      url: '/api/companies/10000000-0000-4000-8000-000000000001',
    });
    expect(missingSession.statusCode).toBe(401);

    const invalidCompany = await requireApp().inject({
      method: 'GET',
      url: '/api/companies/not-a-company',
    });
    expect(invalidCompany.statusCode).toBe(400);
  });

  it('isolates companies and protects mutations with permissions and CSRF', async () => {
    const primary = await register(fixture.primary, 'Primary Route Company');
    const secondary = await register(
      fixture.secondary,
      'Secondary Route Company',
    );

    const company = await requireApp().inject({
      headers: { cookie: primary.cookie },
      method: 'GET',
      url: `/api/companies/${primary.companyId}`,
    });
    expect(company.statusCode).toBe(200);
    expect(company.json()).toMatchObject({
      code: fixture.primary.code,
      name: 'Primary Route Company',
      version: 1,
    });

    const crossTenant = await requireApp().inject({
      headers: { cookie: primary.cookie },
      method: 'GET',
      url: `/api/companies/${secondary.companyId}`,
    });
    expect(crossTenant.statusCode).toBe(403);

    const missingCsrf = await requireApp().inject({
      headers: { cookie: primary.cookie },
      method: 'PATCH',
      payload: { expectedVersion: 1, name: 'Changed Without CSRF' },
      url: `/api/companies/${primary.companyId}`,
    });
    expect(missingCsrf.statusCode).toBe(403);

    const updated = await requireApp().inject({
      headers: {
        cookie: primary.cookie,
        'x-csrf-token': primary.csrfToken,
      },
      method: 'PATCH',
      payload: { expectedVersion: 1, name: 'Primary Payroll Limited' },
      url: `/api/companies/${primary.companyId}`,
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      name: 'Primary Payroll Limited',
      version: 2,
    });

    const staleUpdate = await requireApp().inject({
      headers: {
        cookie: primary.cookie,
        'x-csrf-token': primary.csrfToken,
      },
      method: 'PATCH',
      payload: { expectedVersion: 1, name: 'Stale Company Name' },
      url: `/api/companies/${primary.companyId}`,
    });
    expect(staleUpdate.statusCode).toBe(409);

    const employee = await requireApp().inject({
      headers: {
        cookie: primary.cookie,
        'x-csrf-token': primary.csrfToken,
      },
      method: 'POST',
      payload: {
        employeeNumber: 'emp-001',
        employment: {
          positionTitle: 'Payroll Officer',
          startsOn: '2026-01-01',
        },
        familyName: 'Banda',
        givenName: 'Mutinta',
      },
      url: `/api/companies/${primary.companyId}/employees`,
    });
    expect(employee.statusCode).toBe(201);
    expect(employee.json()).toMatchObject({
      employeeNumber: 'EMP-001',
      employment: {
        endsOn: null,
        positionTitle: 'Payroll Officer',
        startsOn: '2026-01-01',
      },
      familyName: 'Banda',
      status: 'active',
    });
    const employeeId = employee.json<{ id: string }>().id;

    const list = await requireApp().inject({
      headers: { cookie: primary.cookie },
      method: 'GET',
      url: `/api/companies/${primary.companyId}/employees?status=active&limit=10`,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({
      items: [{ employeeNumber: 'EMP-001', id: employeeId }],
      limit: 10,
    });

    const detail = await requireApp().inject({
      headers: { cookie: primary.cookie },
      method: 'GET',
      url: `/api/companies/${primary.companyId}/employees/${employeeId}`,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      employments: [{ positionTitle: 'Payroll Officer' }],
      id: employeeId,
    });

    const overlappingEmployment = await requireApp().inject({
      headers: {
        cookie: primary.cookie,
        'x-csrf-token': primary.csrfToken,
      },
      method: 'POST',
      payload: { positionTitle: 'Manager', startsOn: '2026-06-01' },
      url: `/api/companies/${primary.companyId}/employees/${employeeId}/employments`,
    });
    expect(overlappingEmployment.statusCode).toBe(400);
    expect(overlappingEmployment.json()).toMatchObject({
      error: 'DomainError',
      message: 'Employment periods for one employee cannot overlap',
    });

    const audit = await requireMigrationPool().query<{
      eventType: string;
      targetId: string;
    }>(
      `
        SELECT event_type AS "eventType", target_id AS "targetId"
        FROM app.audit_events
        WHERE company_id = $1
          AND event_type IN (
            'company.profile-updated',
            'workforce.employee-created'
          )
        ORDER BY event_type
      `,
      [primary.companyId],
    );
    expect(audit.rows).toEqual([
      { eventType: 'company.profile-updated', targetId: primary.companyId },
      { eventType: 'workforce.employee-created', targetId: employeeId },
    ]);

    await requireMigrationPool().query(
      `
        DELETE FROM app.role_permissions AS permission
        USING app.roles AS role
        WHERE permission.company_id = $1
          AND permission.role_id = role.id
          AND role.code = 'owner'
          AND permission.permission_key = 'workforce.write'
      `,
      [primary.companyId],
    );
    const deniedWrite = await requireApp().inject({
      headers: {
        cookie: primary.cookie,
        'x-csrf-token': primary.csrfToken,
      },
      method: 'POST',
      payload: {
        employeeNumber: 'EMP-002',
        familyName: 'Phiri',
        givenName: 'Chanda',
      },
      url: `/api/companies/${primary.companyId}/employees`,
    });
    expect(deniedWrite.statusCode).toBe(403);
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

  async function register(
    identity: { code: string; email: string },
    companyName: string,
  ): Promise<{ companyId: string; cookie: string; csrfToken: string }> {
    const response = await requireApp().inject({
      method: 'POST',
      payload: {
        companyCode: identity.code,
        companyName,
        displayName: 'Workforce Route Owner',
        email: identity.email,
        password,
      },
      url: '/api/auth/register',
    });
    expect(response.statusCode).toBe(201);
    const payload = response.json<{
      companies: [{ id: string }];
      csrfToken: string;
    }>();
    return {
      companyId: payload.companies[0].id,
      cookie: readCookieHeader(response.headers['set-cookie']),
      csrfToken: payload.csrfToken,
    };
  }
});

function readCookieHeader(value: string | string[] | undefined): string {
  const cookies =
    value === undefined ? [] : Array.isArray(value) ? value : [value];
  return cookies.map((item) => item.split(';')[0]).join('; ');
}

async function cleanFixtures(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const accounts = await client.query<{ id: string }>(
      'SELECT id FROM app.user_accounts WHERE email = ANY($1::text[])',
      [[fixture.primary.email, fixture.secondary.email]],
    );
    const companies = await client.query<{ id: string }>(
      'SELECT id FROM app.companies WHERE code = ANY($1::text[])',
      [[fixture.primary.code, fixture.secondary.code]],
    );
    const userIds = accounts.rows.map((row) => row.id);
    const companyIds = companies.rows.map((row) => row.id);

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
      'DELETE FROM app.employments WHERE company_id = ANY($1::uuid[])',
      [companyIds],
    );
    await client.query(
      'DELETE FROM app.employees WHERE company_id = ANY($1::uuid[])',
      [companyIds],
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

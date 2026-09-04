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
    code: 'payroll-period-route-primary',
    email: 'owner.payroll-period-route.primary@example.com',
  },
  secondary: {
    code: 'payroll-period-route-secondary',
    email: 'owner.payroll-period-route.secondary@example.com',
  },
} as const;

describe.runIf(
  testDatabaseUrl !== undefined && testDatabaseMigrationUrl !== undefined,
)('authorized payroll-period HTTP workflows', () => {
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
      application_name: 'zampayroll-payroll-period-routes-ddl',
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

  it('creates and lists regular and off-cycle periods within one company', async () => {
    const primary = await register(fixture.primary, 'Primary Period Company');
    const secondary = await register(
      fixture.secondary,
      'Secondary Period Company',
    );

    const unauthenticated = await requireApp().inject({
      method: 'GET',
      url: `/api/companies/${primary.companyId}/payroll-periods`,
    });
    expect(unauthenticated.statusCode).toBe(401);

    const crossTenant = await requireApp().inject({
      headers: { cookie: primary.cookie },
      method: 'GET',
      url: `/api/companies/${secondary.companyId}/payroll-periods`,
    });
    expect(crossTenant.statusCode).toBe(403);

    const missingCsrf = await requireApp().inject({
      headers: { cookie: primary.cookie },
      method: 'POST',
      payload: {
        code: 'SEP-2026',
        endsOn: '2026-09-30',
        paymentDate: '2026-09-25',
        startsOn: '2026-09-01',
      },
      url: `/api/companies/${primary.companyId}/payroll-periods`,
    });
    expect(missingCsrf.statusCode).toBe(403);

    const regular = await createPeriod(primary, {
      code: ' sep-2026 ',
      endsOn: '2026-09-30',
      paymentDate: '2026-09-25',
      startsOn: '2026-09-01',
    });
    expect(regular.statusCode).toBe(201);
    expect(regular.json()).toMatchObject({
      code: 'SEP-2026',
      kind: 'regular',
      version: 1,
    });

    const overlap = await createPeriod(primary, {
      code: 'SEP-OCT-2026',
      endsOn: '2026-10-31',
      paymentDate: '2026-10-25',
      startsOn: '2026-09-30',
    });
    expect(overlap.statusCode).toBe(409);
    expect(overlap.json()).toMatchObject({
      message: 'Regular payroll periods cannot overlap or reuse identifiers',
    });

    const offCycle = await createPeriod(primary, {
      code: 'bonus-sep-2026',
      endsOn: '2026-09-30',
      kind: 'off_cycle',
      paymentDate: '2026-09-30',
      startsOn: '2026-09-01',
    });
    expect(offCycle.statusCode).toBe(201);
    expect(offCycle.json()).toMatchObject({
      code: 'BONUS-SEP-2026',
      kind: 'off_cycle',
    });

    const duplicateCode = await createPeriod(primary, {
      code: 'BONUS-SEP-2026',
      endsOn: '2026-10-31',
      kind: 'off_cycle',
      paymentDate: '2026-10-31',
      startsOn: '2026-10-01',
    });
    expect(duplicateCode.statusCode).toBe(409);

    const list = await requireApp().inject({
      headers: { cookie: primary.cookie },
      method: 'GET',
      url: `/api/companies/${primary.companyId}/payroll-periods?limit=10`,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({
      items: [
        { code: 'BONUS-SEP-2026', kind: 'off_cycle' },
        { code: 'SEP-2026', kind: 'regular' },
      ],
      limit: 10,
    });

    const offCycleList = await requireApp().inject({
      headers: { cookie: primary.cookie },
      method: 'GET',
      url: `/api/companies/${primary.companyId}/payroll-periods?kind=off_cycle`,
    });
    expect(offCycleList.statusCode).toBe(200);
    expect(offCycleList.json()).toMatchObject({
      items: [{ code: 'BONUS-SEP-2026' }],
    });

    const audit = await requireMigrationPool().query<{
      eventType: string;
      targetId: string;
    }>(
      `
        SELECT event_type AS "eventType", target_id AS "targetId"
        FROM app.audit_events
        WHERE company_id = $1 AND event_type = 'payroll.period-created'
        ORDER BY occurred_at, id
      `,
      [primary.companyId],
    );
    expect(audit.rows).toEqual([
      {
        eventType: 'payroll.period-created',
        targetId: regular.json<{ id: string }>().id,
      },
      {
        eventType: 'payroll.period-created',
        targetId: offCycle.json<{ id: string }>().id,
      },
    ]);

    await requireMigrationPool().query(
      `
        DELETE FROM app.role_permissions AS permission
        USING app.roles AS role
        WHERE permission.company_id = $1
          AND permission.role_id = role.id
          AND role.code = 'owner'
          AND permission.permission_key = 'payroll.calculate'
      `,
      [primary.companyId],
    );
    const deniedWrite = await createPeriod(primary, {
      code: 'OCT-2026',
      endsOn: '2026-10-31',
      paymentDate: '2026-10-25',
      startsOn: '2026-10-01',
    });
    expect(deniedWrite.statusCode).toBe(403);
  });

  function requireApp(): Awaited<ReturnType<typeof buildApp>> {
    if (app === undefined) throw new Error('App is not initialized');
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
        displayName: 'Payroll Period Owner',
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

  async function createPeriod(
    authentication: {
      companyId: string;
      cookie: string;
      csrfToken: string;
    },
    payload: {
      code: string;
      endsOn: string;
      kind?: 'regular' | 'off_cycle';
      paymentDate: string;
      startsOn: string;
    },
  ) {
    return requireApp().inject({
      headers: {
        cookie: authentication.cookie,
        'x-csrf-token': authentication.csrfToken,
      },
      method: 'POST',
      payload,
      url: `/api/companies/${authentication.companyId}/payroll-periods`,
    });
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
      'DELETE FROM app.payroll_periods WHERE company_id = ANY($1::uuid[])',
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

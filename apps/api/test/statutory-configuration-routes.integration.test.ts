import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadEnvironment } from '../src/config/environment.js';
import { createPostgresDatabase } from '../src/infrastructure/database.js';
import {
  zambianPublishedContributionReference,
  zraPublishedMonthlyPayeReference,
} from '../src/modules/payroll/calculation/index.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const testDatabaseMigrationUrl = process.env.TEST_DATABASE_MIGRATION_URL;
const password = 'Correct horse battery staple 2026!';
const fixture = {
  primary: {
    code: 'statutory-route-primary',
    email: 'owner.statutory-route.primary@example.com',
  },
  secondary: {
    code: 'statutory-route-secondary',
    email: 'owner.statutory-route.secondary@example.com',
  },
} as const;

describe.runIf(
  testDatabaseUrl !== undefined && testDatabaseMigrationUrl !== undefined,
)('authorized statutory-configuration HTTP workflows', () => {
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
      application_name: 'zampayroll-statutory-routes-ddl',
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

  it('publishes immutable evidence versions and supports operator reevaluation', async () => {
    const primary = await register(
      fixture.primary,
      'Primary Statutory Company',
    );
    const secondary = await register(
      fixture.secondary,
      'Secondary Statutory Company',
    );

    const reference = await requireApp().inject({
      headers: { cookie: primary.cookie },
      method: 'GET',
      url: `/api/companies/${primary.companyId}/statutory-configurations/references/zra-paye`,
    });
    expect(reference.statusCode).toBe(200);
    expect(reference.json()).toMatchObject({
      bands: [
        { ratePercent: '0', upTo: '5100.00' },
        { ratePercent: '20', upTo: '7100.00' },
        { ratePercent: '30', upTo: '9200.00' },
        { ratePercent: '37', upTo: null },
      ],
      confirmedChargeYear: 2025,
    });

    const contributions = await requireApp().inject({
      headers: { cookie: primary.cookie },
      method: 'GET',
      url: `/api/companies/${primary.companyId}/statutory-configurations/references/contributions`,
    });
    expect(contributions.statusCode).toBe(200);
    expect(contributions.json()).toEqual(zambianPublishedContributionReference);
    expect(contributions.json()).toMatchObject({
      napsa: {
        employeeRatePercent: '5',
        employerRatePercent: '5',
        monthlyCeiling: { status: 'requires-current-dated-notice' },
      },
      nhima: {
        contributionBase: 'basic_salary',
        employeeRatePercent: '1',
        employerRatePercent: '1',
      },
    });

    const crossTenant = await requireApp().inject({
      headers: { cookie: primary.cookie },
      method: 'GET',
      url: `/api/companies/${secondary.companyId}/statutory-configurations`,
    });
    expect(crossTenant.statusCode).toBe(403);

    const missingCsrf = await requireApp().inject({
      headers: { cookie: primary.cookie },
      method: 'POST',
      payload: configurationPayload(
        'REFERENCE-2025.1',
        '2025-01-01',
        '2025-12-31',
      ),
      url: `/api/companies/${primary.companyId}/statutory-configurations`,
    });
    expect(missingCsrf.statusCode).toBe(403);

    const draft = await createConfiguration(
      primary,
      configurationPayload('REFERENCE-2025.1', '2025-01-01', '2025-12-31'),
    );
    expect(draft.statusCode).toBe(201);
    expect(draft.json()).toMatchObject({
      effectiveFrom: '2025-01-01',
      rowVersion: 1,
      status: 'draft',
      version: 'REFERENCE-2025.1',
    });
    const configurationId = draft.json<{ id: string }>().id;

    const detail = await requireApp().inject({
      headers: { cookie: primary.cookie },
      method: 'GET',
      url: `/api/companies/${primary.companyId}/statutory-configurations/${configurationId}`,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      parameters: {
        paye: { bands: zraPublishedMonthlyPayeReference.bands },
      },
      sources: [
        { authority: 'napsa' },
        { authority: 'nhima' },
        { authority: 'zra' },
      ],
    });

    const unattestedVerification = await requireApp().inject({
      headers: authHeaders(primary),
      method: 'POST',
      payload: { expectedRowVersion: 1 },
      url: `/api/companies/${primary.companyId}/statutory-configurations/${configurationId}/verify`,
    });
    expect(unattestedVerification.statusCode).toBe(400);

    const verified = await transition(primary, configurationId, 'verify', 1);
    expect(verified.statusCode).toBe(200);
    expect(verified.json()).toMatchObject({
      rowVersion: 2,
      status: 'verified',
      verification: { verifiedByMembershipId: expect.any(String) },
    });

    const repeatedVerification = await transition(
      primary,
      configurationId,
      'verify',
      2,
    );
    expect(repeatedVerification.statusCode).toBe(409);

    const overlapDraft = await createConfiguration(
      primary,
      configurationPayload('OVERLAP-2025.1', '2025-06-01', '2025-12-31'),
    );
    expect(overlapDraft.statusCode).toBe(201);
    const overlapVerification = await transition(
      primary,
      overlapDraft.json<{ id: string }>().id,
      'verify',
      1,
    );
    expect(overlapVerification.statusCode).toBe(409);

    const retired = await transition(primary, configurationId, 'retire', 2);
    expect(retired.statusCode).toBe(200);
    expect(retired.json()).toMatchObject({ rowVersion: 3, status: 'retired' });

    const reevaluatedPayload = configurationPayload(
      'OPERATOR-2026.1',
      '2026-01-01',
      '2026-12-31',
    );
    reevaluatedPayload.parameters.napsa.employeeRatePercent = '6';
    const reevaluated = await createConfiguration(primary, reevaluatedPayload);
    expect(reevaluated.statusCode).toBe(201);
    expect(reevaluated.json()).toMatchObject({
      parameters: { napsa: { employeeRatePercent: '6' } },
      status: 'draft',
    });

    const list = await requireApp().inject({
      headers: { cookie: primary.cookie },
      method: 'GET',
      url: `/api/companies/${primary.companyId}/statutory-configurations?limit=10`,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({
      items: [
        { status: 'draft', version: 'OPERATOR-2026.1' },
        { status: 'draft', version: 'OVERLAP-2025.1' },
        { status: 'retired', version: 'REFERENCE-2025.1' },
      ],
      limit: 10,
    });

    const audit = await requireMigrationPool().query<{ eventType: string }>(
      `
        SELECT event_type AS "eventType"
        FROM app.audit_events
        WHERE company_id = $1
          AND event_type LIKE 'statutory-configuration.%'
        ORDER BY event_type
      `,
      [primary.companyId],
    );
    expect(audit.rows).toEqual([
      { eventType: 'statutory-configuration.draft-created' },
      { eventType: 'statutory-configuration.draft-created' },
      { eventType: 'statutory-configuration.draft-created' },
      { eventType: 'statutory-configuration.retired' },
      { eventType: 'statutory-configuration.verified' },
    ]);

    await requireMigrationPool().query(
      `
        DELETE FROM app.role_permissions AS permission
        USING app.roles AS role
        WHERE permission.company_id = $1
          AND permission.role_id = role.id
          AND role.code = 'owner'
          AND permission.permission_key = 'statutory-config.verify'
      `,
      [primary.companyId],
    );
    const denied = await createConfiguration(
      primary,
      configurationPayload('DENIED-2027.1', '2027-01-01', '2027-12-31'),
    );
    expect(denied.statusCode).toBe(403);
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
  ): Promise<Authentication> {
    const response = await requireApp().inject({
      method: 'POST',
      payload: {
        companyCode: identity.code,
        companyName,
        displayName: 'Statutory Configuration Owner',
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

  function createConfiguration(
    authentication: Authentication,
    payload: ReturnType<typeof configurationPayload>,
  ) {
    return requireApp().inject({
      headers: authHeaders(authentication),
      method: 'POST',
      payload,
      url: `/api/companies/${authentication.companyId}/statutory-configurations`,
    });
  }

  function transition(
    authentication: Authentication,
    configurationId: string,
    action: 'retire' | 'verify',
    expectedRowVersion: number,
  ) {
    return requireApp().inject({
      headers: authHeaders(authentication),
      method: 'POST',
      payload:
        action === 'verify'
          ? { evidenceAttestation: true, expectedRowVersion }
          : { expectedRowVersion },
      url: `/api/companies/${authentication.companyId}/statutory-configurations/${configurationId}/${action}`,
    });
  }
});

interface Authentication {
  companyId: string;
  cookie: string;
  csrfToken: string;
}

function authHeaders(authentication: Authentication) {
  return {
    cookie: authentication.cookie,
    'x-csrf-token': authentication.csrfToken,
  };
}

function configurationPayload(
  version: string,
  effectiveFrom: string,
  effectiveTo: string,
) {
  return {
    effectiveFrom,
    effectiveTo,
    parameters: {
      componentTreatments: {
        BASE_SALARY: {
          napsa: 'included',
          nhima: 'included',
          paye: 'taxable',
        },
      },
      napsa: {
        employeeMonthlyCap: '1708.20',
        employeeRatePercent: '5',
        employerMonthlyCap: '1708.20',
        employerRatePercent: '5',
      },
      nhima: {
        employeeMonthlyCap: null,
        employeeRatePercent: '1',
        employerMonthlyCap: null,
        employerRatePercent: '1',
      },
      paye: { bands: zraPublishedMonthlyPayeReference.bands },
      schemaVersion: 'ZAMBIA-MONTHLY-1',
    },
    sources: [
      {
        accessedOn: '2026-09-04',
        authority: 'zra' as const,
        title: zraPublishedMonthlyPayeReference.sourceTitle,
        uri: zraPublishedMonthlyPayeReference.sourceUri,
      },
      {
        accessedOn: '2026-09-04',
        authority: 'napsa' as const,
        publishedOn: '2025-01-07',
        title: 'NAPSA contribution ceiling for 2025',
        uri: 'https://www.napsa.co.zm/news/details?id=df81c3bb-5416-4a43-b521-73923e0ccf93',
      },
      {
        accessedOn: '2026-09-04',
        authority: 'nhima' as const,
        title: 'NHIMA contribution FAQ',
        uri: 'https://www.nhima.co.zm/elementor-1783/',
      },
    ],
    version,
  };
}

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
      'DELETE FROM app.payroll_run_components WHERE company_id = ANY($1::uuid[])',
      [companyIds],
    );
    await client.query(
      'DELETE FROM app.payroll_run_employees WHERE company_id = ANY($1::uuid[])',
      [companyIds],
    );
    await client.query(
      'DELETE FROM app.payroll_runs WHERE company_id = ANY($1::uuid[])',
      [companyIds],
    );
    await client.query(
      'DELETE FROM app.statutory_sources WHERE company_id = ANY($1::uuid[])',
      [companyIds],
    );
    await client.query(
      'DELETE FROM app.statutory_configurations WHERE company_id = ANY($1::uuid[])',
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

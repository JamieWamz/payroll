import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadEnvironment } from '../src/config/environment.js';
import { createPostgresDatabase } from '../src/infrastructure/database.js';
import { parseEntityId } from '../src/shared/domain/entity-id.js';
import {
  zambianPublishedTerminalBenefitReference,
  zraPublishedMonthlyPayeReference,
} from '../src/modules/payroll/calculation/index.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const testDatabaseMigrationUrl = process.env.TEST_DATABASE_MIGRATION_URL;
const password = 'Correct horse battery staple 2026!';
const fixture = {
  primary: {
    code: 'gratuity-route-primary',
    email: 'owner.gratuity-route.primary@example.com',
  },
  secondary: {
    code: 'gratuity-route-secondary',
    email: 'owner.gratuity-route.secondary@example.com',
  },
} as const;

describe.runIf(
  testDatabaseUrl !== undefined && testDatabaseMigrationUrl !== undefined,
)('authorized gratuity policy HTTP workflows', () => {
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
      application_name: 'zampayroll-gratuity-routes-ddl',
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

  it('stores company policy and previews completed-contract gratuity', async () => {
    const primary = await register(fixture.primary, 'Primary Gratuity Company');
    const secondary = await register(
      fixture.secondary,
      'Secondary Gratuity Company',
    );

    const reference = await requireApp().inject({
      headers: { cookie: primary.cookie },
      method: 'GET',
      url: `/api/companies/${primary.companyId}/statutory-configurations/references/terminal-benefits`,
    });
    expect(reference.statusCode).toBe(200);
    expect(reference.json()).toEqual(zambianPublishedTerminalBenefitReference);

    const crossTenant = await requireApp().inject({
      headers: { cookie: primary.cookie },
      method: 'GET',
      url: `/api/companies/${secondary.companyId}/gratuity-policies`,
    });
    expect(crossTenant.statusCode).toBe(403);

    const missingCsrf = await requireApp().inject({
      headers: { cookie: primary.cookie },
      method: 'POST',
      payload: policyPayload('30'),
      url: `/api/companies/${primary.companyId}/gratuity-policies`,
    });
    expect(missingCsrf.statusCode).toBe(403);

    const policy = await createPolicy(primary, policyPayload('30'));
    expect(policy.statusCode).toBe(201);
    expect(policy.json()).toMatchObject({
      name: 'Contract completion gratuity',
      policyReference: 'HR Policy 2025, clause 8',
      ratePercent: '30.00',
      rowVersion: 1,
    });
    const policyId = policy.json<{ id: string }>().id;

    const overlap = await createPolicy(primary, {
      ...policyPayload('35'),
      startsOn: '2025-06-01',
    });
    expect(overlap.statusCode).toBe(409);

    const statutoryConfigurationId = await createVerifiedConfiguration(primary);
    const preview = await requireApp().inject({
      headers: authHeaders(primary),
      method: 'POST',
      payload: {
        basicPayEarned: '240000',
        contractEndsOn: '2025-12-31',
        settlementDate: '2025-12-31',
        statutoryConfigurationId,
      },
      url: `/api/companies/${primary.companyId}/gratuity-policies/${policyId}/preview`,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      amount: { amount: '72000.00', currency: 'ZMW', scale: 2 },
      basicPayEarned: { amount: '240000.00' },
      basis: 'basic_pay_earned_during_contract',
      policyRatePercent: '30.00',
      preview: true,
      statutoryMinimumRatePercent: '25.00',
    });

    const operationsUrl = `/api/companies/${primary.companyId}/operations`;
    const settings = {
      kind: 'export_template',
      settings: {
        name: 'Test salary layout',
        purpose: 'salary_batch',
        bank: 'Zambia National Commercial Bank',
        sourceReference: 'Integration fixture only',
        header: true,
        delimiter: ',',
        columns: [
          { header: 'Account', field: 'accountNumber' },
          { header: 'Amount', field: 'netPay' },
          { header: 'Reference', field: 'reference' },
        ],
      },
    };
    const csrfDenied = await requireApp().inject({
      method: 'POST',
      url: operationsUrl,
      headers: { cookie: primary.cookie },
      payload: settings,
    });
    expect(csrfDenied.statusCode).toBe(403);
    const saved = await requireApp().inject({
      method: 'POST',
      url: operationsUrl,
      headers: authHeaders(primary),
      payload: settings,
    });
    expect(saved.statusCode).toBe(201);
    const templateId = saved.json<{ id: string }>().id;
    const exportBody = {
      templateId,
      rows: [
        {
          accountNumber: '0012345678',
          netPay: '2000.50',
          reference: 'PAY-001',
        },
      ],
    };
    const exported = await requireApp().inject({
      method: 'POST',
      url: `${operationsUrl}/export-preview`,
      headers: authHeaders(primary),
      payload: exportBody,
    });
    expect(exported.statusCode).toBe(200);
    expect(exported.headers['content-type']).toContain('text/csv');
    expect(exported.body).toContain('"0012345678","2000.50","PAY-001"');
    const foreign = await requireApp().inject({
      method: 'POST',
      url: `/api/companies/${secondary.companyId}/operations/export-preview`,
      headers: authHeaders(secondary),
      payload: exportBody,
    });
    expect(foreign.statusCode).toBe(404);
    const invalid = await requireApp().inject({
      method: 'POST',
      url: `${operationsUrl}/export-preview`,
      headers: authHeaders(primary),
      payload: {
        ...exportBody,
        rows: [{ ...exportBody.rows[0], reference: '=CMD' }],
      },
    });
    expect(invalid.statusCode).toBe(400);
    const profile = await requireApp().inject({
      method: 'POST',
      url: operationsUrl,
      headers: authHeaders(primary),
      payload: {
        kind: 'compliance_profile',
        settings: {
          industry: 'test_industry',
          workerCategory: 'test_category',
          agreementReference: 'Synthetic test rule',
          statutoryConfigurationId,
        },
      },
    });
    expect(profile.statusCode).toBe(201);
    const profileId = profile.json<{ id: string }>().id;
    for (const [monthlyBasicPay, result] of [
      ['2999.99', 'below_configured_minimum'],
      ['3000.00', 'meets_configured_minimum'],
    ]) {
      const checked = await requireApp().inject({
        method: 'POST',
        url: `${operationsUrl}/compliance-preview`,
        headers: authHeaders(primary),
        payload: { profileId, date: '2025-12-31', monthlyBasicPay },
      });
      expect(checked.statusCode).toBe(200);
      expect(checked.json()).toMatchObject({
        scope: 'monthly_basic_pay_only',
        minimumMonthlyBasicPay: '3000.00',
        result,
      });
    }
    const expired = await requireApp().inject({
      method: 'POST',
      url: `${operationsUrl}/compliance-preview`,
      headers: authHeaders(primary),
      payload: { profileId, date: '2026-01-01', monthlyBasicPay: '5000.00' },
    });
    expect(expired.statusCode).toBe(409);
    const foreignProfile = await requireApp().inject({
      method: 'POST',
      url: `/api/companies/${secondary.companyId}/operations/compliance-preview`,
      headers: authHeaders(secondary),
      payload: { profileId, date: '2025-12-31', monthlyBasicPay: '5000.00' },
    });
    expect(foreignProfile.statusCode).toBe(404);
    const operationsList = await requireApp().inject({
      method: 'GET',
      url: operationsUrl,
      headers: authHeaders(primary),
    });
    expect(operationsList.statusCode).toBe(200);
    expect(operationsList.json<{ items: unknown[] }>().items).toHaveLength(2);
    expect(
      operationsList
        .json<{ banks: { connectionStatus: string }[] }>()
        .banks.every((bank) => bank.connectionStatus === 'not_connected'),
    ).toBe(true);
    const settingsAudit = await requireMigrationPool().query(
      'SELECT id FROM app.audit_events WHERE company_id = $1 AND event_type = $2',
      [primary.companyId, 'operations.settings-created'],
    );
    expect(settingsAudit.rows).toHaveLength(2);

    const fnbPayload = {
      ownAccount: '62000031451',
      actionDate: new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Lusaka',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date()),
      rows: [
        {
          recipientName: 'Jane Banda',
          recipientAccount: '00123456789',
          accountType: '1',
          branchCode: '260006',
          amount: '2000.50',
          ownReference: 'EMP001',
          recipientReference: 'SALARY',
        },
      ],
    };
    const fnbResponse = await requireApp().inject({
      method: 'POST',
      url: `${operationsUrl}/fnb-zambia-preview`,
      headers: authHeaders(primary),
      payload: fnbPayload,
    });
    expect(fnbResponse.statusCode).toBe(200);
    expect(fnbResponse.headers['x-export-status']).toBe(
      'bank-validation-required',
    );
    expect(fnbResponse.body).toContain('62000031451,062123488240');
    const fnbNoCsrf = await requireApp().inject({
      method: 'POST',
      url: `${operationsUrl}/fnb-zambia-preview`,
      headers: { cookie: primary.cookie },
      payload: fnbPayload,
    });
    expect(fnbNoCsrf.statusCode).toBe(403);
    const fnbForeign = await requireApp().inject({
      method: 'POST',
      url: `/api/companies/${secondary.companyId}/operations/fnb-zambia-preview`,
      headers: authHeaders(primary),
      payload: fnbPayload,
    });
    expect(fnbForeign.statusCode).toBe(403);
    const fnbBadInput = await requireApp().inject({
      method: 'POST',
      url: `${operationsUrl}/fnb-zambia-preview`,
      headers: authHeaders(primary),
      payload: { ...fnbPayload, ownAccount: 'invalid' },
    });
    expect(fnbBadInput.statusCode).toBe(400);
    const fnbAudit = await requireMigrationPool().query(
      'SELECT id FROM app.audit_events WHERE company_id = $1 AND event_type = $2',
      [primary.companyId, 'operations.fnb-preview-generated'],
    );
    expect(fnbAudit.rows).toHaveLength(1);

    const runtime = createPostgresDatabase(
      loadEnvironment({ DATABASE_URL: testDatabaseUrl!, NODE_ENV: 'test' }),
    );
    try {
      const hidden = await runtime.withTenantTransaction(
        parseEntityId(secondary.companyId, 'Company'),
        (transaction) =>
          transaction.query(
            'SELECT id FROM app.operations_settings WHERE id = $1',
            [templateId],
          ),
      );
      expect(hidden.rows).toHaveLength(0);
      await expect(
        runtime.withTenantTransaction(
          parseEntityId(primary.companyId, 'Company'),
          (transaction) =>
            transaction.query(
              'UPDATE app.operations_settings SET settings = settings WHERE id = $1',
              [templateId],
            ),
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        runtime.withTenantTransaction(
          parseEntityId(primary.companyId, 'Company'),
          (transaction) =>
            transaction.query(
              'DELETE FROM app.operations_settings WHERE id = $1',
              [templateId],
            ),
        ),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await runtime.close();
    }

    await requireMigrationPool().query(
      "DELETE FROM app.role_permissions WHERE company_id = $1 AND permission_key = 'company.update'",
      [primary.companyId],
    );
    const permissionDenied = await requireApp().inject({
      method: 'POST',
      url: operationsUrl,
      headers: authHeaders(primary),
      payload: settings,
    });
    expect(permissionDenied.statusCode).toBe(403);

    const ended = await requireApp().inject({
      headers: authHeaders(primary),
      method: 'PATCH',
      payload: { endsOn: '2025-12-31', expectedRowVersion: 1 },
      url: `/api/companies/${primary.companyId}/gratuity-policies/${policyId}/end`,
    });
    expect(ended.statusCode).toBe(200);
    expect(ended.json()).toMatchObject({
      endsOn: '2025-12-31',
      rowVersion: 2,
    });

    const replacement = await createPolicy(primary, {
      ...policyPayload('32.5'),
      startsOn: '2026-01-01',
    });
    expect(replacement.statusCode).toBe(201);

    const list = await requireApp().inject({
      headers: { cookie: primary.cookie },
      method: 'GET',
      url: `/api/companies/${primary.companyId}/gratuity-policies`,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({
      items: [
        { ratePercent: '32.50', startsOn: '2026-01-01' },
        { ratePercent: '30.00', startsOn: '2025-01-01' },
      ],
    });

    const audit = await requireMigrationPool().query<{ eventType: string }>(
      `
        SELECT event_type AS "eventType"
        FROM app.audit_events
        WHERE company_id = $1 AND event_type LIKE 'gratuity-policy.%'
        ORDER BY occurred_at, id
      `,
      [primary.companyId],
    );
    expect(audit.rows).toEqual([
      { eventType: 'gratuity-policy.created' },
      { eventType: 'gratuity-policy.ended' },
      { eventType: 'gratuity-policy.created' },
    ]);
  });

  function requireApp(): Awaited<ReturnType<typeof buildApp>> {
    if (app === undefined) throw new Error('App is not initialized');
    return app;
  }

  function requireMigrationPool(): Pool {
    if (migrationPool === undefined) throw new Error('Pool is not initialized');
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
        displayName: 'Gratuity Policy Owner',
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

  function createPolicy(
    authentication: Authentication,
    payload: ReturnType<typeof policyPayload>,
  ) {
    return requireApp().inject({
      headers: authHeaders(authentication),
      method: 'POST',
      payload,
      url: `/api/companies/${authentication.companyId}/gratuity-policies`,
    });
  }

  async function createVerifiedConfiguration(
    authentication: Authentication,
  ): Promise<string> {
    const created = await requireApp().inject({
      headers: authHeaders(authentication),
      method: 'POST',
      payload: statutoryPayload(),
      url: `/api/companies/${authentication.companyId}/statutory-configurations`,
    });
    expect(created.statusCode).toBe(201);
    const id = created.json<{ id: string }>().id;
    const verified = await requireApp().inject({
      headers: authHeaders(authentication),
      method: 'POST',
      payload: { evidenceAttestation: true, expectedRowVersion: 1 },
      url: `/api/companies/${authentication.companyId}/statutory-configurations/${id}/verify`,
    });
    expect(verified.statusCode).toBe(200);
    return id;
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

function policyPayload(ratePercent: string) {
  return {
    name: 'Contract completion gratuity',
    policyReference: 'HR Policy 2025, clause 8',
    ratePercent,
    startsOn: '2025-01-01',
  };
}

function statutoryPayload() {
  return {
    effectiveFrom: '2025-01-01',
    effectiveTo: '2025-12-31',
    parameters: {
      componentTreatments: {
        BASE_SALARY: {
          napsa: 'included',
          nhima: 'included',
          paye: 'taxable',
        },
      },
      gratuity: { minimumRatePercent: '25' },
      // Synthetic values for testing the comparator, not published statutory rates.
      labourMinimumWages: [
        {
          industry: 'test_industry',
          workerCategory: 'test_category',
          minimumMonthlyBasicPay: '3000.00',
        },
      ],
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
      source(
        'zra',
        zraPublishedMonthlyPayeReference.sourceTitle,
        zraPublishedMonthlyPayeReference.sourceUri,
      ),
      source(
        'napsa',
        'NAPSA contribution ceiling for 2025',
        'https://www.napsa.co.zm/news/details?id=df81c3bb-5416-4a43-b521-73923e0ccf93',
      ),
      source(
        'nhima',
        'NHIMA contribution FAQ',
        'https://www.nhima.co.zm/elementor-1783/',
      ),
      source(
        'labour',
        'Employment Code Act No. 3 of 2019',
        'https://www.parliament.gov.zm/sites/default/files/documents/acts/The%20Employment%20Code%20Act%20No.%203%20of%202019.pdf',
      ),
    ],
    version: 'REFERENCE-2025-GRATUITY.1',
  };
}

function source(
  authority: 'labour' | 'napsa' | 'nhima' | 'zra',
  title: string,
  uri: string,
) {
  return { accessedOn: '2026-09-04', authority, title, uri };
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
      'DELETE FROM app.operations_settings WHERE company_id = ANY($1::uuid[])',
      [companyIds],
    );
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
      'DELETE FROM app.gratuity_policies WHERE company_id = ANY($1::uuid[])',
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

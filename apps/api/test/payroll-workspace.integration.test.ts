import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
type HTTPMethods = 'GET' | 'POST' | 'PUT' | 'PATCH';
import { buildApp } from '../src/app.js';
import { loadEnvironment } from '../src/config/environment.js';
import { createPostgresDatabase } from '../src/infrastructure/database.js';
import { zraPublishedMonthlyPayeReference } from '../src/modules/payroll/calculation/zra-paye-reference.js';

const url = process.env.TEST_DATABASE_URL;
const migrationUrl = process.env.TEST_DATABASE_MIGRATION_URL;
const marker = `workspace-${randomUUID().slice(0, 8)}`;
const companyIds: string[] = [];
const userIds: string[] = [];
const parameters = {
  schemaVersion: 'ZAMBIA-MONTHLY-1',
  componentTreatments: {
    BASE_SALARY: { paye: 'taxable', napsa: 'included', nhima: 'included' },
    TRANSPORT: { paye: 'taxable', napsa: 'included', nhima: 'excluded' },
  },
  paye: { bands: zraPublishedMonthlyPayeReference.bands },
  napsa: {
    employeeRatePercent: '5',
    employerRatePercent: '5',
    employeeMonthlyCap: '1708.20',
    employerMonthlyCap: '1708.20',
  },
  nhima: {
    employeeRatePercent: '1',
    employerRatePercent: '1',
    employeeMonthlyCap: null,
    employerMonthlyCap: null,
  },
};

describe.runIf(url && migrationUrl)(
  'complete payroll workspace HTTP workflow',
  () => {
    let app: Awaited<ReturnType<typeof buildApp>>;
    let pool: Pool;
    let cookie: string;
    let csrf: string;
    let base: string;
    let employeeId: string;
    let employmentId: string;
    let configurationId: string;
    let runId: string;
    let detailsVersion = 0;
    beforeAll(async () => {
      const environment = loadEnvironment({
        DATABASE_URL: url,
        NODE_ENV: 'test',
      });
      app = await buildApp({
        database: createPostgresDatabase(environment),
        environment,
      });
      pool = new Pool({ connectionString: migrationUrl });
    });
    afterAll(async () => {
      await app?.close();
      if (pool) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          for (const table of [
            'operations_settings',
            'payroll_filing_events',
            'payroll_run_components',
            'payroll_run_employees',
            'payroll_runs',
            'employee_payroll_details',
            'company_payroll_settings',
            'compensation_components',
            'salaries',
            'employments',
            'employees',
            'payroll_periods',
            'statutory_sources',
            'statutory_configurations',
            'audit_events',
            'role_permissions',
            'membership_roles',
            'company_memberships',
            'roles',
          ])
            await client.query(
              `DELETE FROM app.${table} WHERE company_id=ANY($1::uuid[])`,
              [companyIds],
            );
          await client.query(
            'DELETE FROM app.audit_events WHERE actor_user_account_id=ANY($1::uuid[])',
            [userIds],
          );
          for (const table of ['sessions', 'password_credentials'])
            await client.query(
              `DELETE FROM app.${table} WHERE user_account_id=ANY($1::uuid[])`,
              [userIds],
            );
          await client.query(
            'DELETE FROM app.companies WHERE id=ANY($1::uuid[])',
            [companyIds],
          );
          await client.query(
            'DELETE FROM app.user_accounts WHERE id=ANY($1::uuid[])',
            [userIds],
          );
          await client.query('COMMIT');
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        } finally {
          client.release();
          await pool.end();
        }
      }
    });
    async function call(method: HTTPMethods, path: string, payload?: unknown) {
      return app.inject({
        method,
        url: `${base}${path}`,
        headers: { cookie, 'x-csrf-token': csrf },
        ...(payload ? { payload } : {}),
      });
    }
    async function success(
      method: HTTPMethods,
      path: string,
      payload?: unknown,
      status = 200,
    ) {
      const result = await call(method, path, payload);
      expect(result.statusCode, result.body).toBe(status);
      return result;
    }
    async function period(code: string, startsOn: string, endsOn: string) {
      return (
        await success(
          'POST',
          '/payroll-periods',
          { code, startsOn, endsOn, paymentDate: endsOn },
          201,
        )
      ).json<{ id: string }>().id;
    }
    const details = {
      tpin: '1000000001',
      napsaNumber: 'TEST-NAPSA',
      nhimaNumber: 'TEST-NHIMA',
      bankName: 'Test Bank',
      accountName: 'Test Employee',
      accountNumber: '0012345678',
      branchCode: '001',
    };
    it('authenticates and prepares a tenant with evidence, employees and compensation', async () => {
      const auth = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          companyCode: marker,
          companyName: 'Synthetic Payroll Test Company',
          displayName: 'Test Owner',
          email: `${marker}@example.com`,
          password: 'Correct horse battery staple 2026!',
        },
      });
      expect(auth.statusCode, auth.body).toBe(201);
      const session = auth.json<{
        companies: { id: string }[];
        user: { id: string };
        csrfToken: string;
      }>();
      companyIds.push(session.companies[0]!.id);
      userIds.push(session.user.id);
      base = `/api/companies/${companyIds[0]}`;
      csrf = session.csrfToken;
      cookie = auth.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
      expect(
        (await app.inject({ method: 'GET', url: `${base}/payroll-runs` }))
          .statusCode,
      ).toBe(401);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `${base}/payroll-runs`,
            headers: { cookie },
            payload: {
              payrollPeriodId: randomUUID(),
              statutoryConfigurationId: randomUUID(),
              employeeIds: [randomUUID()],
            },
          })
        ).statusCode,
      ).toBe(403);
      await success('PUT', '/payroll-settings', {
        expectedVersion: 0,
        details: {
          tpin: '1000000000',
          napsaNumber: 'EMPLOYER-NAPSA',
          nhimaNumber: 'EMPLOYER-NHIMA',
        },
      });
      const config = await success(
        'POST',
        '/statutory-configurations',
        {
          version: 'TEST-2025',
          effectiveFrom: '2025-01-01',
          effectiveTo: '2025-12-31',
          parameters,
          sources: [
            {
              authority: 'zra',
              title: 'Test evidence: published 2025 bands',
              uri: 'https://www.zra.org.zm/paye-calculator/',
              accessedOn: '2025-01-01',
            },
            {
              authority: 'napsa',
              title: 'Test evidence: 2025 contribution ceiling',
              uri: 'https://www.napsa.co.zm/revision-in-contribution-ceiling-for-the-year-2025/',
              accessedOn: '2025-01-01',
            },
            {
              authority: 'nhima',
              title: 'Test evidence: contributions',
              uri: 'https://www.nhima.co.zm/elementor-1783/',
              accessedOn: '2025-01-01',
            },
          ],
        },
        201,
      );
      configurationId = config.json<{ id: string }>().id;
      await success(
        'POST',
        `/statutory-configurations/${configurationId}/verify`,
        { expectedRowVersion: 1, evidenceAttestation: true },
      );
      const employee = (
        await success(
          'POST',
          '/employees',
          {
            employeeNumber: 'TEST-001',
            givenName: 'Test',
            familyName: 'Employee',
            employment: { positionTitle: 'Accountant', startsOn: '2025-01-01' },
          },
          201,
        )
      ).json<{ id: string; employment: { id: string } }>();
      employeeId = employee.id;
      employmentId = employee.employment.id;
      const p = await period('JAN-2025', '2025-01-01', '2025-01-31');
      runId = (
        await success(
          'POST',
          '/payroll-runs',
          {
            payrollPeriodId: p,
            statutoryConfigurationId: configurationId,
            employeeIds: [employeeId],
          },
          201,
        )
      ).json<{ id: string }>().id;
      const noSalary = await call('POST', `/payroll-runs/${runId}/calculate`, {
        expectedVersion: 1,
      });
      expect(noSalary.statusCode, noSalary.body).toBe(400);
      expect(noSalary.body).toContain('monthly salary');
      await success(
        'POST',
        `/employments/${employmentId}/salaries`,
        { amount: '15000.00', startsOn: '2025-01-01' },
        201,
      );
      await success(
        'POST',
        `/employments/${employmentId}/components`,
        {
          code: 'TRANSPORT',
          name: 'Transport allowance',
          kind: 'allowance',
          amount: '1000.00',
          startsOn: '2025-01-01',
        },
        201,
      );
      await success(
        'POST',
        `/employments/${employmentId}/components`,
        {
          code: 'LOAN',
          name: 'Loan recovery',
          kind: 'deduction',
          amount: '500.00',
          startsOn: '2025-01-01',
        },
        201,
      );
      const filtered = await success(
        'GET',
        '/employees?search=TEST-001&offset=0&sort=number',
      );
      expect(filtered.json<{ items: unknown[] }>().items).toHaveLength(1);
      expect(
        (await success('GET', '/employees?search=absent')).json<{
          items: unknown[];
        }>().items,
      ).toHaveLength(0);
    });
    it('calculates exact totals, catches missing identifiers and stale review, and finalizes immutable snapshots', async () => {
      const result = await success('POST', `/payroll-runs/${runId}/calculate`, {
        expectedVersion: 1,
      });
      expect(result.json()).toMatchObject({
        status: 'calculated',
        version: 2,
        totals: {
          grossPay: { amount: '16000.00' },
          paye: { amount: '3546.00' },
          napsa: { amount: '800.00' },
          nhima: { amount: '150.00' },
          netPay: { amount: '11004.00' },
          employerCost: { amount: '16950.00' },
        },
      });
      const missing = await call('POST', `/payroll-runs/${runId}/finalize`, {
        expectedVersion: 2,
        confirmed: true,
      });
      expect(missing.statusCode, missing.body).toBe(400);
      expect(missing.body).toContain('identifiers');
      await success('PUT', `/employees/${employeeId}/payroll-details`, {
        expectedVersion: 0,
        details,
      });
      detailsVersion = 1;
      const stale = await call('POST', `/payroll-runs/${runId}/finalize`, {
        expectedVersion: 2,
        confirmed: true,
      });
      expect(stale.statusCode, stale.body).toBe(409);
      expect(stale.body).toContain('Recalculate');
      await success('POST', `/payroll-runs/${runId}/calculate`, {
        expectedVersion: 2,
      });
      const finalized = await success(
        'POST',
        `/payroll-runs/${runId}/finalize`,
        { expectedVersion: 3, confirmed: true },
      );
      expect(finalized.json()).toMatchObject({
        status: 'finalized',
        version: 4,
      });
      expect(
        (
          await call('POST', `/payroll-runs/${runId}/calculate`, {
            expectedVersion: 4,
          })
        ).statusCode,
      ).toBe(409);
      await success('PATCH', `/employees/${employeeId}`, {
        givenName: 'Changed',
        expectedVersion: 1,
      });
      const old = await success('GET', `/payroll-runs/${runId}`);
      expect(old.body).toContain('Test Employee');
      expect(old.body).not.toContain('Changed Employee');
    });
    it('generates valid PDFs, reconciling CSV schedules and truthful filing transitions', async () => {
      const pdf = await success(
        'GET',
        `/payroll-runs/${runId}/documents/payslips`,
      );
      expect(pdf.headers['content-type']).toBe('application/pdf');
      expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
      expect(pdf.rawPayload.length).toBeGreaterThan(1800);
      for (const kind of ['register', 'paye', 'napsa', 'nhima', 'payments']) {
        const report = await success(
          'GET',
          `/payroll-runs/${runId}/documents/${kind}`,
        );
        expect(report.body).toContain('TEST-001');
        expect(report.headers['cache-control']).toBe('no-store');
      }
      const template = await success(
        'POST',
        '/operations',
        {
          kind: 'export_template',
          settings: {
            name: 'Test PAYE layout',
            purpose: 'paye_return',
            sourceReference: 'Synthetic operator template',
            header: true,
            delimiter: ',',
            columns: [
              { header: 'TPIN', field: 'employeeTpin' },
              { header: 'Taxable', field: 'taxableIncome' },
              { header: 'PAYE', field: 'paye' },
            ],
          },
        },
        201,
      );
      const mapped = await success(
        'GET',
        `/payroll-runs/${runId}/template-export/${template.json<{ id: string }>().id}`,
      );
      expect(mapped.body).toContain('"1000000001","16000.00","3546.00"');
      const annual = await success('GET', '/annual-tax?year=2025');
      expect(annual.body).toContain('16000.00');
      expect(annual.body).toContain('not an official P9');
      const acceptedFirst = await call(
        'POST',
        `/payroll-runs/${runId}/filings/zra`,
        {
          status: 'accepted',
          reference: 'REF-1',
          attestation: true,
          expectedEventId: null,
        },
      );
      expect(acceptedFirst.statusCode).toBe(409);
      const generated = await success(
        'POST',
        `/payroll-runs/${runId}/filings/zra`,
        { status: 'generated', attestation: true, expectedEventId: null },
      );
      const first = generated.json<{ id: string; file: string }>();
      expect(first.file).toContain('3546.00');
      const missingReference = await call(
        'POST',
        `/payroll-runs/${runId}/filings/zra`,
        { status: 'submitted', attestation: true, expectedEventId: first.id },
      );
      expect(missingReference.statusCode).toBe(400);
      const submitted = await success(
        'POST',
        `/payroll-runs/${runId}/filings/zra`,
        {
          status: 'submitted',
          reference: 'TEST-EXTERNAL-REF',
          attestation: true,
          expectedEventId: first.id,
        },
      );
      await success('POST', `/payroll-runs/${runId}/filings/zra`, {
        status: 'accepted',
        reference: 'TEST-RESPONSE',
        attestation: true,
        expectedEventId: submitted.json<{ id: string }>().id,
      });
      const history = await success('GET', `/payroll-runs/${runId}/filings`);
      expect(history.json()).toMatchObject({
        integrationStatus: 'manual',
        uploadFormatStatus: 'not_certified',
      });
      expect(history.json<{ items: unknown[] }>().items).toHaveLength(3);
      await expect(
        pool.query(
          `INSERT INTO app.payroll_filing_events (id,company_id,payroll_run_id,authority,status,reference,recorded_by_membership_id) SELECT gen_random_uuid(),$1,$2,'zra','submitted',NULL,id FROM app.company_memberships WHERE company_id=$1 LIMIT 1`,
          [companyIds[0], runId],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
    it('carries forward cumulative PAYE and rejects missing history and overlapping openings', async () => {
      const p = await period('FEB-2025', '2025-02-01', '2025-02-28');
      const run = (
        await success(
          'POST',
          '/payroll-runs',
          {
            payrollPeriodId: p,
            statutoryConfigurationId: configurationId,
            employeeIds: [employeeId],
          },
          201,
        )
      ).json<{ id: string }>().id;
      const calculated = await success(
        'POST',
        `/payroll-runs/${run}/calculate`,
        { expectedVersion: 1 },
      );
      expect(calculated.json()).toMatchObject({
        totals: { paye: { amount: '3546.00' }, netPay: { amount: '11004.00' } },
      });
      await success('PUT', `/employees/${employeeId}/payroll-details`, {
        expectedVersion: detailsVersion,
        details: {
          ...details,
          openingAsOf: '2025-01-31',
          openingTaxableIncome: '16000.00',
          openingPaye: '3546.00',
        },
      });
      detailsVersion++;
      const overlap = await call('POST', `/payroll-runs/${run}/calculate`, {
        expectedVersion: 2,
      });
      expect(overlap.statusCode, overlap.body).toBe(400);
      expect(overlap.body).toContain('overlap');
      await success('PUT', `/employees/${employeeId}/payroll-details`, {
        expectedVersion: detailsVersion,
        details,
      });
      detailsVersion++;
      const march = await period('MAR-2025', '2025-03-01', '2025-03-31');
      const marchRun = (
        await success(
          'POST',
          '/payroll-runs',
          {
            payrollPeriodId: march,
            statutoryConfigurationId: configurationId,
            employeeIds: [employeeId],
          },
          201,
        )
      ).json<{ id: string }>().id;
      const gap = await call('POST', `/payroll-runs/${marchRun}/calculate`, {
        expectedVersion: 1,
      });
      expect(gap.statusCode, gap.body).toBe(400);
      expect(gap.body).toContain('incomplete');
      await success('POST', `/payroll-runs/${marchRun}/cancel`, {
        expectedVersion: 1,
        reason: 'Replace employee selection',
      });
      expect(
        (
          await call('POST', `/payroll-runs/${marchRun}/calculate`, {
            expectedVersion: 2,
          })
        ).statusCode,
      ).toBe(409);
      const cancelled = await success('GET', `/payroll-runs/${marchRun}`);
      expect(cancelled.json()).toMatchObject({
        cancellationReason: 'Replace employee selection',
      });
      const replacement = await success(
        'POST',
        '/payroll-runs',
        {
          payrollPeriodId: march,
          statutoryConfigurationId: configurationId,
          employeeIds: [employeeId],
        },
        201,
      );
      expect(replacement.json<{ id: string }>().id).not.toBe(marchRun);
      await expect(
        pool.query(
          `UPDATE app.payroll_runs SET cancelled_at=statement_timestamp(),cancellation_reason=NULL WHERE id=$1`,
          [replacement.json<{ id: string }>().id],
        ),
      ).rejects.toMatchObject({ code: '23514' });

      expect(
        (
          await call('POST', `/payroll-runs/${runId}/cancel`, {
            expectedVersion: 4,
            reason: 'Not allowed',
          })
        ).statusCode,
      ).toBe(409);
    });
    it('enforces tenant, role and session boundaries on documents and payroll writes', async () => {
      const secondary = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          companyCode: `${marker}-b`,
          companyName: 'Other test tenant',
          displayName: 'Other owner',
          email: `${marker}-b@example.com`,
          password: 'Correct horse battery staple 2026!',
        },
      });
      expect(secondary.statusCode, secondary.body).toBe(201);
      const second = secondary.json<{
        companies: { id: string }[];
        user: { id: string };
      }>();
      companyIds.push(second.companies[0]!.id);
      userIds.push(second.user.id);
      const secondCookie = secondary.cookies
        .map((c) => `${c.name}=${c.value}`)
        .join('; ');
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `${base}/payroll-runs/${runId}/documents/payslips`,
            headers: { cookie: secondCookie },
          })
        ).statusCode,
      ).toBe(403);
      await pool.query(
        "DELETE FROM app.role_permissions WHERE company_id=$1 AND permission_key='payroll.finalize'",
        [companyIds[0]],
      );
      expect(
        (
          await call('POST', `/payroll-runs/${runId}/finalize`, {
            expectedVersion: 4,
            confirmed: true,
          })
        ).statusCode,
      ).toBe(403);
      const logout = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { cookie, 'x-csrf-token': csrf },
      });
      expect(logout.statusCode).toBe(204);
      expect((await call('GET', '/payroll-runs')).statusCode).toBe(401);
    });
  },
);

import { withWorkspaceInvitation } from './helpers/workspace-invitation.js';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadEnvironment } from '../src/config/environment.js';
import { createPostgresDatabase } from '../src/infrastructure/database.js';
const url = process.env.TEST_DATABASE_URL;
const migrationUrl = process.env.TEST_DATABASE_MIGRATION_URL;
describe.runIf(url && migrationUrl)(
  'setup, atomic imports and team access',
  () => {
    let app: Awaited<ReturnType<typeof buildApp>>;
    let pool: Pool;
    let companyId: string;
    let ownerId: string;
    let cookie: string;
    let csrf: string;
    let membershipId: string;
    const companyIds: string[] = [];
    const userIds: string[] = [];
    const marker = `setup-${randomUUID().slice(0, 8)}`;
    const password = 'Correct horse battery staple 2026!';
    beforeAll(async () => {
      const environment = loadEnvironment({
        DATABASE_URL: url,
        NODE_ENV: 'test',
      });
      app = await buildApp({
        environment,
        database: createPostgresDatabase(environment),
      });
      pool = new Pool({ connectionString: migrationUrl });
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: await withWorkspaceInvitation({
          companyCode: marker,
          companyName: 'Setup test',
          displayName: 'Owner',
          email: `${marker}@example.com`,
          password,
        }),
      });
      expect(response.statusCode, response.body).toBe(201);
      const session = response.json();
      companyId = session.companies[0].id;
      membershipId = session.companies[0].membershipId;
      ownerId = session.user.id;
      csrf = session.csrfToken;
      cookie = response.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
      companyIds.push(companyId);
      userIds.push(ownerId);
    });
    afterAll(async () => {
      await app?.close();
      if (!pool) return;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const table of [
          'company_invitations',
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
    });
    const call = (
      method: 'GET' | 'POST' | 'PATCH',
      path: string,
      payload?: unknown,
      headers = { cookie, 'x-csrf-token': csrf },
    ) =>
      app.inject({
        method,
        url: `/api/companies/${companyId}${path}`,
        headers,
        ...(payload ? { payload } : {}),
      });
    it('derives setup from persisted records and validates imports before an atomic commit', async () => {
      const setup = await call('GET', '/setup');
      expect(setup.statusCode, setup.body).toBe(200);
      expect(setup.json()).toMatchObject({ completed: 0, total: 5 });
      const csv =
        'employeeNumber,givenName,familyName,positionTitle,startsOn,salary,tpin\n00001,Jane,Banda,Accountant,2025-01-01,15000.35,1000000001\n00002,John,Banda,Clerk,2025-01-01,9000.00,1000000002';
      expect(
        (
          await call(
            'POST',
            '/employee-import',
            { mode: 'preview', csv },
            { cookie, 'x-csrf-token': 'wrong' },
          )
        ).statusCode,
      ).toBe(403);
      const preview = await call('POST', '/employee-import', {
        mode: 'preview',
        csv,
      });
      expect(preview.statusCode, preview.body).toBe(200);
      expect(preview.json()).toMatchObject({
        total: 2,
        imported: 0,
        errors: [],
      });
      expect((await call('GET', '/employees')).json().items).toHaveLength(0);
      expect(
        (
          await call('POST', '/employee-import', {
            mode: 'commit',
            csv: csv + '\n',
            reviewDigest: preview.json().reviewDigest,
          })
        ).statusCode,
      ).toBe(409);
      const committed = await call('POST', '/employee-import', {
        mode: 'commit',
        csv,
        reviewDigest: preview.json().reviewDigest,
      });
      expect(committed.statusCode, committed.body).toBe(201);
      expect(committed.json().imported).toBe(2);
      expect((await call('GET', '/setup')).json()).toMatchObject({
        completed: 1,
        counts: { employees: 2, salaries: 2 },
      });
      const replay = await call('POST', '/employee-import', {
        mode: 'commit',
        csv,
        reviewDigest: preview.json().reviewDigest,
      });
      expect(replay.statusCode).toBe(409);
      const mixed = csv.replace('00002', '00003');
      const conflict = await call('POST', '/employee-import', {
        mode: 'preview',
        csv: mixed,
      });
      expect(conflict.json().errors).toHaveLength(1);
      expect(
        (
          await call('POST', '/employee-import', {
            mode: 'commit',
            csv: mixed,
            reviewDigest: conflict.json().reviewDigest,
          })
        ).statusCode,
      ).toBe(409);
      expect((await call('GET', '/employees')).json().items).toHaveLength(2);
    });
    it('creates one-use invitations, protects owner access and enforces reader permissions immediately', async () => {
      const invitation = await call('POST', '/team/invitations', {
        email: `${marker}-reader@example.com`,
        role: 'report-reader',
      });
      expect(invitation.statusCode, invitation.body).toBe(201);
      const token = invitation.json().token;
      expect((await call('GET', '/team')).body).not.toContain(token);
      const join = await app.inject({
        method: 'POST',
        url: '/api/auth/join-company',
        payload: { token, displayName: 'Reader', password },
      });
      expect(join.statusCode, join.body).toBe(201);
      userIds.push(join.json().user.id);
      const readerMembership = join.json().companies[0].membershipId;
      const readerHeaders = {
        cookie: join.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
        'x-csrf-token': join.json().csrfToken,
      };
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/auth/join-company',
            payload: { token, displayName: 'Reader', password },
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (await call('GET', '/team', undefined, readerHeaders)).statusCode,
      ).toBe(403);
      expect(
        (await call('GET', '/employees', undefined, readerHeaders)).statusCode,
      ).toBe(403);
      expect(
        (
          await call(
            'POST',
            '/payroll-runs',
            {
              payrollPeriodId: randomUUID(),
              statutoryConfigurationId: randomUUID(),
              employeeIds: [randomUUID()],
            },
            readerHeaders,
          )
        ).statusCode,
      ).toBe(403);
      expect(
        (await call('GET', '/access', undefined, readerHeaders)).json()
          .permissions,
      ).toEqual(['company.read', 'payroll.read', 'reports.read']);
      expect(
        (
          await call('PATCH', `/team/members/${membershipId}`, {
            status: 'suspended',
            expectedVersion: 1,
          })
        ).statusCode,
      ).toBe(409);
      expect(
        (
          await call('PATCH', `/team/members/${readerMembership}`, {
            status: 'suspended',
            expectedVersion: 1,
          })
        ).statusCode,
      ).toBe(204);
      expect(
        (await call('GET', '/payroll-runs', undefined, readerHeaders))
          .statusCode,
      ).toBe(403);
      expect(
        (
          await call('PATCH', `/team/members/${readerMembership}`, {
            status: 'active',
            expectedVersion: 1,
          })
        ).statusCode,
      ).toBe(409);
      expect(
        (
          await call('PATCH', `/team/members/${readerMembership}`, {
            status: 'active',
            expectedVersion: 2,
          })
        ).statusCode,
      ).toBe(204);
      expect(
        (await call('GET', '/payroll-runs', undefined, readerHeaders))
          .statusCode,
      ).toBe(200);
    });
    it('requires existing account credentials, isolates companies and rejects revoked or expired links', async () => {
      const second = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: await withWorkspaceInvitation({
          companyCode: `${marker}-b`,
          companyName: 'Second company',
          displayName: 'Second owner',
          email: `${marker}-existing@example.com`,
          password,
        }),
      });
      expect(second.statusCode, second.body).toBe(201);
      companyIds.push(second.json().companies[0].id);
      userIds.push(second.json().user.id);
      const secondHeaders = {
        cookie: second.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
        'x-csrf-token': second.json().csrfToken,
      };
      expect(
        (await call('GET', '/team', undefined, secondHeaders)).statusCode,
      ).toBe(403);
      expect(
        (await call('GET', '/setup', undefined, secondHeaders)).statusCode,
      ).toBe(403);
      const invited = await call('POST', '/team/invitations', {
        email: `${marker}-existing@example.com`,
        role: 'payroll-operator',
      });
      const token = invited.json().token;
      const wrong = await app.inject({
        method: 'POST',
        url: '/api/auth/join-company',
        payload: { token, displayName: 'Other', password: 'wrong' },
      });
      expect(wrong.statusCode, wrong.body).toBe(401);
      const accepted = await app.inject({
        method: 'POST',
        url: '/api/auth/join-company',
        payload: { token, displayName: 'Other', password },
      });
      expect(accepted.statusCode, accepted.body).toBe(201);
      expect(accepted.json().companies[0].id).toBe(companyId);
      expect(accepted.json().user.id).toBe(second.json().user.id);
      const revoked = await call('POST', '/team/invitations', {
        email: `${marker}-revoked@example.com`,
        role: 'payroll-reviewer',
      });
      expect(
        (
          await call('POST', `/team/invitations/${revoked.json().id}/revoke`, {
            expectedVersion: 1,
          })
        ).statusCode,
      ).toBe(204);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/auth/invitation',
            payload: { token: revoked.json().token },
          })
        ).statusCode,
      ).toBe(404);
      const expired = await call('POST', '/team/invitations', {
        email: `${marker}-expired@example.com`,
        role: 'report-reader',
      });
      await pool.query(
        "UPDATE app.company_invitations SET created_at=statement_timestamp()-interval '8 days',expires_at=statement_timestamp()-interval '1 day' WHERE id=$1",
        [expired.json().id],
      );
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/auth/invitation',
            payload: { token: expired.json().token },
          })
        ).statusCode,
      ).toBe(404);
    });
  },
);

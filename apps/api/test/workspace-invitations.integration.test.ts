import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadEnvironment } from '../src/config/environment.js';
import { createPostgresDatabase } from '../src/infrastructure/database.js';
import {
  issueWorkspaceInvitation,
  revokeWorkspaceInvitation,
} from '../src/modules/identity-access/application/workspace-invitations.js';
import { digestSecurityToken } from '../src/modules/identity-access/security/index.js';

const migrationUrl = process.env.TEST_DATABASE_MIGRATION_URL;
const runtimeUrl = process.env.TEST_DATABASE_URL;
describe.runIf(migrationUrl && runtimeUrl)(
  'operator-controlled workspace access',
  () => {
    let app: Awaited<ReturnType<typeof buildApp>>;
    let pool: Pool;
    let runtime: Pool;
    const marker = `invite-${randomUUID().slice(0, 8)}`;
    const password = 'Correct horse battery staple 2026!';
    const invitations: string[] = [];
    const companyCodes: string[] = [];
    const emails: string[] = [];
    let sequence = 0;
    beforeAll(async () => {
      pool = new Pool({ connectionString: migrationUrl, max: 1 });
      runtime = new Pool({ connectionString: runtimeUrl, max: 1 });
      const environment = loadEnvironment({
        DATABASE_URL: runtimeUrl,
        NODE_ENV: 'test',
      });
      app = await buildApp({
        environment,
        database: createPostgresDatabase(environment),
      });
    });
    afterAll(async () => {
      await app?.close();
      await runtime?.end();
      if (!pool) return;
      try {
        await pool.query(
          'DELETE FROM app.workspace_invitations WHERE id=ANY($1::uuid[])',
          [invitations],
        );
        const companies = (
          await pool.query(
            'SELECT id FROM app.companies WHERE code=ANY($1::text[])',
            [companyCodes],
          )
        ).rows.map((r) => r.id);
        const users = (
          await pool.query(
            'SELECT id FROM app.user_accounts WHERE email=ANY($1::text[])',
            [emails],
          )
        ).rows.map((r) => r.id);
        await pool.query(
          'DELETE FROM app.audit_events WHERE company_id=ANY($1::uuid[]) OR actor_user_account_id=ANY($2::uuid[])',
          [companies, users],
        );
        await pool.query(
          'DELETE FROM app.sessions WHERE user_account_id=ANY($1::uuid[])',
          [users],
        );
        for (const table of [
          'role_permissions',
          'membership_roles',
          'company_memberships',
          'roles',
        ]) {
          await pool.query(
            `DELETE FROM app.${table} WHERE company_id=ANY($1::uuid[])`,
            [companies],
          );
        }
        await pool.query('DELETE FROM app.companies WHERE id=ANY($1::uuid[])', [
          companies,
        ]);
        await pool.query(
          'DELETE FROM app.password_credentials WHERE user_account_id=ANY($1::uuid[])',
          [users],
        );
        await pool.query(
          'DELETE FROM app.user_accounts WHERE id=ANY($1::uuid[])',
          [users],
        );
      } finally {
        await pool.end();
      }
    });
    function payload() {
      const companyCode = `${marker}-${++sequence}`;
      const email = `${companyCode}@example.com`;
      companyCodes.push(companyCode);
      emails.push(email);
      return {
        companyCode,
        companyName: 'Invited Company',
        email,
        displayName: 'Invited Owner',
        password,
      };
    }
    async function issue(details = payload()) {
      const invitation = await issueWorkspaceInvitation(pool, {
        ...details,
        operator: 'automated-test',
      });
      invitations.push(invitation.id);
      return { ...details, inviteToken: invitation.token, invitation };
    }
    function register(
      details: ReturnType<typeof payload> & { inviteToken?: string },
    ) {
      return app.inject({
        method: 'POST',
        url: '/api/auth/register',
        remoteAddress: `127.0.0.${++sequence}`,
        payload: {
          companyCode: details.companyCode,
          companyName: details.companyName,
          email: details.email,
          displayName: details.displayName,
          password: details.password,
          ...(details.inviteToken ? { inviteToken: details.inviteToken } : {}),
        },
      });
    }
    it('blocks direct public registration without creating accounts or companies', async () => {
      const details = payload();
      expect((await register(details)).statusCode).toBe(403);
      expect(
        (
          await pool.query('SELECT 1 FROM app.user_accounts WHERE email=$1', [
            details.email,
          ])
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await pool.query('SELECT 1 FROM app.companies WHERE code=$1', [
            details.companyCode,
          ])
        ).rowCount,
      ).toBe(0);
    });
    it('prevents the runtime role from issuing invitations or using the old registration function', async () => {
      expect(
        (
          await runtime.query(`SELECT
      has_table_privilege(current_user,'app.workspace_invitations','INSERT') AS issue,
      has_function_privilege(current_user,'app.register_company_owner(uuid,uuid,uuid,uuid,text,text,text,text,text,uuid,text,text)','EXECUTE') AS register`)
        ).rows,
      ).toEqual([{ issue: false, register: false }]);
      await expect(
        issueWorkspaceInvitation(runtime, { ...payload(), operator: 'tenant' }),
      ).rejects.toThrow('deployment operator');
    });
    it('binds the invitation to its company and email, stores only its digest and accepts it once under concurrency', async () => {
      const details = await issue();
      const stored = (
        await pool.query(
          'SELECT token_digest FROM app.workspace_invitations WHERE id=$1',
          [details.invitation.id],
        )
      ).rows[0];
      expect(stored.token_digest).toBe(
        digestSecurityToken(details.invitation.token),
      );
      expect(stored.token_digest).not.toBe(details.inviteToken);
      const inspection = await app.inject({
        method: 'POST',
        url: '/api/auth/workspace-invitation',
        payload: { token: details.inviteToken },
      });
      expect(inspection.statusCode).toBe(200);
      expect(inspection.headers['cache-control']).toBe('no-store');
      expect(inspection.json()).toEqual({
        email: details.email,
        companyCode: details.companyCode,
        companyName: details.companyName,
      });
      for (const changed of [
        { email: 'other@example.com' },
        { companyCode: 'other-company' },
        { companyName: 'Other Company' },
      ]) {
        expect((await register({ ...details, ...changed })).statusCode).toBe(
          403,
        );
      }
      const results = await Promise.all([register(details), register(details)]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
      expect((await register(details)).statusCode).toBe(409);
      expect(
        (
          await pool.query(
            'SELECT action FROM app.workspace_invitation_events WHERE invitation_id=$1 ORDER BY occurred_at',
            [details.invitation.id],
          )
        ).rows,
      ).toEqual([{ action: 'issued' }, { action: 'accepted' }]);
    });
    it('rejects unknown, revoked and expired links and audits revocation', async () => {
      const unknown = await issue();
      expect(
        (await register({ ...unknown, inviteToken: 'a'.repeat(43) }))
          .statusCode,
      ).toBe(409);
      await revokeWorkspaceInvitation(
        pool,
        unknown.invitation.id,
        'automated-test',
      );
      expect((await register(unknown)).statusCode).toBe(409);
      expect(
        (
          await pool.query(
            "SELECT 1 FROM app.workspace_invitation_events WHERE invitation_id=$1 AND action='revoked'",
            [unknown.invitation.id],
          )
        ).rowCount,
      ).toBe(1);
      const expired = await issue();
      await pool.query(
        "UPDATE app.workspace_invitations SET created_at=now()-interval '8 days',expires_at=now()-interval '1 day' WHERE id=$1",
        [expired.invitation.id],
      );
      expect((await register(expired)).statusCode).toBe(409);
    });
    it('requires existing credentials before adding a second company and preserves the account', async () => {
      const first = await issue();
      const firstResponse = await register(first);
      expect(firstResponse.statusCode, firstResponse.body).toBe(201);
      const second = await issue({ ...payload(), email: first.email });
      expect(
        (await register({ ...second, password: `${password}wrong` }))
          .statusCode,
      ).toBe(401);
      const accepted = await register({
        ...second,
        displayName: 'Should not replace name',
      });
      expect(accepted.statusCode, accepted.body).toBe(201);
      expect(accepted.json().user).toEqual(firstResponse.json().user);
      expect(accepted.json().companies).toHaveLength(2);
      expect(accepted.json().companies[0].code).toBe(second.companyCode);
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: first.email, password },
      });
      expect(login.statusCode).toBe(200);
      expect(login.json().companies).toHaveLength(2);
    });
  },
);

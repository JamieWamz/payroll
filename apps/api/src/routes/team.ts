import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Database } from '../infrastructure/database.js';
import type { Environment } from '../config/environment.js';
import { createUserAccount } from '../modules/identity-access/domain/index.js';
import {
  createOpaqueSecurityToken,
  digestSecurityToken,
} from '../modules/identity-access/security/index.js';
import { withAuthorizedCompanyTransaction } from './tenant-authorization.js';
import { parse } from './payroll-runs.js';
import { appendSuccessfulAuditEvent } from './audit.js';
import { ApiError } from './api-error.js';
const companyParams = z.object({ companyId: z.uuid() });
export const teamRoutes: FastifyPluginAsync<{
  database: Database;
  environment: Environment;
}> = async (app, options) => {
  app.get('/companies/:companyId/access', async (request, reply) => {
    const { companyId } = parse(companyParams, request.params);
    const access = await withAuthorizedCompanyTransaction(
      options.database,
      {
        companyId,
        environment: options.environment,
        request,
        permission: 'company.read',
      },
      async (_tx, principal) => ({
        permissions: principal.permissionIdentifiers,
      }),
    );
    return reply.header('cache-control', 'no-store').send(access);
  });
  app.get('/companies/:companyId/team', async (request, reply) => {
    const { companyId } = parse(companyParams, request.params);
    const result = await withAuthorizedCompanyTransaction(
      options.database,
      {
        companyId,
        environment: options.environment,
        request,
        permission: 'users.manage',
      },
      async (tx, principal) => ({
        currentMembershipId: principal.membershipId,
        members: (
          await tx.query(
            'SELECT id,display_name AS "displayName",email,status,version::int,role_codes AS roles FROM app.list_company_team() ORDER BY display_name,id',
          )
        ).rows,
        invitations: (
          await tx.query(
            `SELECT id,email,role_code AS role,CASE WHEN status='pending' AND expires_at<=statement_timestamp() THEN 'expired' ELSE status END AS status,expires_at AS "expiresAt",version FROM app.company_invitations WHERE company_id=app.current_company_id() ORDER BY created_at DESC,id LIMIT 100`,
          )
        ).rows,
      }),
    );
    return reply.header('cache-control', 'no-store').send(result);
  });
  app.post('/companies/:companyId/team/invitations', async (request, reply) => {
    const { companyId } = parse(companyParams, request.params);
    const body = parse(
      z
        .object({
          email: z.string().max(254),
          role: z.enum([
            'payroll-operator',
            'payroll-reviewer',
            'report-reader',
          ]),
        })
        .strict(),
      request.body,
    );
    const email = createUserAccount({
      id: randomUUID(),
      email: body.email,
      displayName: 'Invitation',
    }).email;
    const token = createOpaqueSecurityToken();
    const invitation = await withAuthorizedCompanyTransaction(
      options.database,
      {
        companyId,
        environment: options.environment,
        request,
        permission: 'users.manage',
        requireCsrf: true,
      },
      async (tx, principal) => {
        if (
          (
            await tx.query(
              'SELECT 1 FROM app.list_company_team() WHERE email=$1',
              [email],
            )
          ).rows.length
        )
          throw new ApiError(
            409,
            'This account already belongs to the company. Manage its access below.',
          );
        if (
          (
            await tx.query(
              "SELECT 1 FROM app.company_invitations WHERE company_id=app.current_company_id() AND email=$1 AND status='pending' AND expires_at>statement_timestamp()",
              [email],
            )
          ).rows.length
        )
          throw new ApiError(
            409,
            'An active invitation already exists. Revoke it before creating a replacement.',
          );
        const id = randomUUID();
        const result = (
          await tx.query(
            'INSERT INTO app.company_invitations(id,company_id,email,role_code,token_digest,invited_by_membership_id,expires_at) VALUES($1,app.current_company_id(),$2,$3,$4,$5,statement_timestamp()+interval \'7 days\') RETURNING id,expires_at AS "expiresAt"',
            [
              id,
              email,
              body.role,
              digestSecurityToken(token),
              principal.membershipId,
            ],
          )
        ).rows[0]!;
        await appendSuccessfulAuditEvent(tx, principal, request.id, {
          eventType: 'team.invitation-created',
          targetType: 'invitation',
          targetId: id,
        });
        return result;
      },
    );
    return reply
      .header('cache-control', 'no-store')
      .status(201)
      .send({ ...invitation, token });
  });
  app.post(
    '/companies/:companyId/team/invitations/:id/revoke',
    async (request, reply) => {
      const { companyId, id } = parse(
        companyParams.extend({ id: z.uuid() }),
        request.params,
      );
      const { expectedVersion } = parse(
        z.object({ expectedVersion: z.number().int().positive() }).strict(),
        request.body,
      );
      await withAuthorizedCompanyTransaction(
        options.database,
        {
          companyId,
          environment: options.environment,
          request,
          permission: 'users.manage',
          requireCsrf: true,
        },
        async (tx, principal) => {
          const result = await tx.query(
            "UPDATE app.company_invitations SET status='revoked',version=version+1,updated_at=statement_timestamp() WHERE company_id=app.current_company_id() AND id=$1 AND status='pending' AND version=$2 RETURNING id",
            [id, expectedVersion],
          );
          if (!result.rows.length)
            throw new ApiError(
              409,
              'Invitation has changed or is no longer pending. Refresh the team list.',
            );
          await appendSuccessfulAuditEvent(tx, principal, request.id, {
            eventType: 'team.invitation-revoked',
            targetType: 'invitation',
            targetId: id,
          });
        },
      );
      return reply.status(204).send();
    },
  );
  app.patch(
    '/companies/:companyId/team/members/:id',
    async (request, reply) => {
      const { companyId, id } = parse(
        companyParams.extend({ id: z.uuid() }),
        request.params,
      );
      const body = parse(
        z
          .object({
            expectedVersion: z.number().int().positive(),
            status: z.enum(['active', 'suspended']),
          })
          .strict(),
        request.body,
      );
      await withAuthorizedCompanyTransaction(
        options.database,
        {
          companyId,
          environment: options.environment,
          request,
          permission: 'users.manage',
          requireCsrf: true,
        },
        async (tx, principal) => {
          const member = (
            await tx.query<{ roles: string[] }>(
              'SELECT role_codes AS roles FROM app.list_company_team() WHERE id=$1',
              [id],
            )
          ).rows[0];
          if (!member) throw new ApiError(404, 'Team member not found.');
          if (id === principal.membershipId || member.roles.includes('owner'))
            throw new ApiError(
              409,
              'Owner and self access cannot be changed here.',
            );
          const updated = await tx.query(
            'UPDATE app.company_memberships SET status=$1,version=version+1,updated_at=statement_timestamp() WHERE company_id=app.current_company_id() AND id=$2 AND version=$3 RETURNING id',
            [body.status, id, body.expectedVersion],
          );
          if (!updated.rows.length)
            throw new ApiError(
              409,
              'Membership has changed. Refresh the team list.',
            );
          await appendSuccessfulAuditEvent(tx, principal, request.id, {
            eventType: `team.member-${body.status}`,
            targetType: 'membership',
            targetId: id,
          });
        },
      );
      return reply.status(204).send();
    },
  );
};

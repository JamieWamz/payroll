import type { FastifyRequest } from 'fastify';

import type { Environment } from '../config/environment.js';
import type {
  Database,
  TenantTransaction,
} from '../infrastructure/database.js';
import {
  createAuthorizationPrincipal,
  digestSecurityToken,
  parseOpaqueSecurityToken,
  parseSecurityTokenDigest,
  requirePermission,
  securityTokenMatchesDigest,
  type AuthorizationPrincipal,
} from '../modules/identity-access/security/index.js';
import { DomainError } from '../shared/domain/domain-error.js';
import { parseEntityId } from '../shared/domain/entity-id.js';
import { ApiError } from './api-error.js';
import { csrfCookieName, sessionCookieName } from './authentication-cookies.js';

interface CompanyAuthorizationRecord {
  csrfTokenDigest: string;
  membershipId: string | null;
  permissionKeys: string[];
  sessionId: string;
  userAccountId: string;
}

interface AuthorizeCompanyRequestOptions {
  companyId: string;
  environment: Environment;
  permission: string;
  requireCsrf?: boolean;
  request: FastifyRequest;
}

export async function withAuthorizedCompanyTransaction<Result>(
  database: Database,
  options: AuthorizeCompanyRequestOptions,
  operation: (
    transaction: TenantTransaction,
    principal: Readonly<AuthorizationPrincipal>,
  ) => Promise<Result>,
): Promise<Result> {
  const companyId = parseEntityId(options.companyId, 'Company');
  const sessionToken = options.request.cookies[sessionCookieName];
  if (sessionToken === undefined) {
    throw new ApiError(401, 'Authentication is required');
  }

  let tokenDigest: string;
  try {
    tokenDigest = digestSecurityToken(parseOpaqueSecurityToken(sessionToken));
  } catch {
    throw new ApiError(401, 'Authentication is required');
  }

  return database.withTenantTransaction(companyId, async (transaction) => {
    const result = await transaction.query<CompanyAuthorizationRecord>(
      `
        SELECT
          session_id AS "sessionId",
          user_account_id AS "userAccountId",
          membership_id AS "membershipId",
          csrf_token_digest AS "csrfTokenDigest",
          permission_keys AS "permissionKeys"
        FROM app.resolve_company_authorization($1, $2, $3)
      `,
      [tokenDigest, companyId, options.environment.SESSION_IDLE_TTL_SECONDS],
    );
    const authorization = result.rows[0];
    if (authorization === undefined) {
      throw new ApiError(401, 'Authentication is required');
    }
    if (authorization.membershipId === null) {
      throw new ApiError(403, 'Company access is forbidden');
    }

    if (options.requireCsrf === true) {
      validateCsrf(options.request, authorization.csrfTokenDigest);
    }

    const principal = createAuthorizationPrincipal({
      companyId,
      membershipId: authorization.membershipId,
      permissionIdentifiers: authorization.permissionKeys,
      sessionId: authorization.sessionId,
      userAccountId: authorization.userAccountId,
    });

    try {
      requirePermission(principal, options.permission);
    } catch (error) {
      if (
        error instanceof DomainError &&
        error.code === 'FORBIDDEN_OPERATION'
      ) {
        throw new ApiError(403, 'Company access is forbidden');
      }
      throw error;
    }

    // Serialize company mutations with payroll calculation/finalization. This also
    // covers new compensation rows, which row locks alone cannot protect.
    if (options.requireCsrf === true) {
      await transaction.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`${companyId}:payroll`],
      );
    }
    return operation(transaction, principal);
  });
}

function validateCsrf(request: FastifyRequest, digest: string): void {
  const cookie = request.cookies[csrfCookieName];
  const header = readSingleHeader(request.headers['x-csrf-token']);

  if (
    cookie === undefined ||
    header === undefined ||
    cookie !== header ||
    !securityTokenMatchesDigest(header, parseSecurityTokenDigest(digest))
  ) {
    throw new ApiError(403, 'CSRF validation failed');
  }
}

function readSingleHeader(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : undefined;
}

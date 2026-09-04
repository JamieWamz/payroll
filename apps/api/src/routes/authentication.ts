import rateLimit from '@fastify/rate-limit';
import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';

import { createCompany } from '../modules/companies/domain/index.js';
import { createUserAccount } from '../modules/identity-access/domain/index.js';
import {
  commonPasswordBlocklist,
  createSessionSecrets,
  digestSecurityToken,
  hashPassword,
  parseOpaqueSecurityToken,
  parsePasswordHash,
  parseSecurityTokenDigest,
  securityTokenMatchesDigest,
  validateNewPassword,
  verifyPassword,
  type PasswordBlocklist,
  type ValidatedPassword,
} from '../modules/identity-access/security/index.js';
import type { Environment } from '../config/environment.js';
import type {
  Database,
  TenantTransaction,
} from '../infrastructure/database.js';
import { ApiError } from './api-error.js';
import { csrfCookieName, sessionCookieName } from './authentication-cookies.js';

interface AuthenticationRoutesOptions {
  database: Database;
  environment: Environment;
  passwordBlocklist?: PasswordBlocklist;
  prefix?: string;
}

interface AuthenticationRecord {
  accountStatus: string;
  displayName: string;
  email: string;
  failedAttempts: number;
  lockedUntil: Date | null;
  passwordHash: string;
  userAccountId: string;
}

interface MembershipRecord {
  companyCode: string;
  companyId: string;
  companyName: string;
  membershipId: string;
}

interface SessionRecord {
  absoluteExpiresAt: Date;
  csrfTokenDigest: string;
  displayName: string;
  email: string;
  idleExpiresAt: Date;
  sessionId: string;
  userAccountId: string;
}

const registrationSchema = z
  .object({
    companyCode: z.string().max(128),
    companyName: z.string().max(320),
    displayName: z.string().max(240),
    email: z.string().max(320),
    password: z.string().max(256),
  })
  .strict();
const loginSchema = z
  .object({ email: z.string().max(320), password: z.string().max(256) })
  .strict();
const dummyPassword = 'zampayroll-timing-equalizer' as ValidatedPassword;

export const authenticationRoutes: FastifyPluginAsync<
  AuthenticationRoutesOptions
> = async (app, options) => {
  const passwordBlocklist =
    options.passwordBlocklist ?? commonPasswordBlocklist;
  const dummyPasswordHash = await hashPassword(dummyPassword);

  await app.register(rateLimit, { global: false });

  app.post(
    '/auth/register',
    { config: { rateLimit: { max: 3, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = parseBody(registrationSchema, request.body);
      const userAccountId = randomUUID();
      const companyId = randomUUID();
      const membershipId = randomUUID();
      const roleId = randomUUID();
      const user = createUserAccount({
        displayName: body.displayName,
        email: body.email,
        id: userAccountId,
      });
      const company = createCompany({
        code: body.companyCode,
        id: companyId,
        name: body.companyName,
      });
      const password = await validateNewPassword(
        body.password,
        passwordBlocklist,
      );
      const passwordHash = await hashPassword(password);
      const session = createNewSession(options.environment);

      try {
        await options.database.withSystemTransaction(async (transaction) => {
          await transaction.query(
            `SELECT app.register_company_owner(
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
             )`,
            [
              user.id,
              company.id,
              membershipId,
              roleId,
              user.email,
              user.displayName,
              company.code,
              company.name,
              passwordHash,
              randomUUID(),
              request.id,
              null,
            ],
          );
          await persistSession(transaction, user.id, session, request.id);
        });
      } catch (error) {
        if (isPostgresError(error, '23505')) {
          throw new ApiError(409, 'Account or company already exists');
        }
        throw error;
      }

      setAuthenticationCookies(reply, options.environment, session);
      await reply
        .status(201)
        .header('cache-control', 'no-store')
        .send({
          companies: [
            {
              code: company.code,
              id: company.id,
              membershipId,
              name: company.name,
            },
          ],
          csrfToken: session.secrets.csrfToken,
          user: {
            displayName: user.displayName,
            email: user.email,
            id: user.id,
          },
        });
    },
  );

  app.post(
    '/auth/login',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = parseBody(loginSchema, request.body);
      const authentication = await options.database.withSystemTransaction(
        async (transaction) => {
          const record = await findAuthenticationRecord(
            transaction,
            body.email,
          );
          const passwordHash =
            record === undefined
              ? dummyPasswordHash
              : parsePasswordHash(record.passwordHash);
          const passwordMatches = await verifyPassword(
            passwordHash,
            body.password,
          );
          const isLocked =
            record?.lockedUntil !== null &&
            record?.lockedUntil !== undefined &&
            record.lockedUntil.getTime() > Date.now();

          if (
            record === undefined ||
            record.accountStatus !== 'active' ||
            isLocked ||
            !passwordMatches
          ) {
            if (record !== undefined && !isLocked && !passwordMatches) {
              await transaction.query(
                'SELECT app.record_authentication_failure($1)',
                [record.userAccountId],
              );
            }
            await appendDeniedLoginAudit(
              transaction,
              record?.userAccountId,
              request.id,
            );
            return undefined;
          }

          await transaction.query(
            'SELECT app.record_authentication_success($1)',
            [record.userAccountId],
          );
          const session = createNewSession(options.environment);
          await persistSession(
            transaction,
            record.userAccountId,
            session,
            request.id,
          );
          const memberships = await findMemberships(
            transaction,
            record.userAccountId,
          );
          return { memberships, record, session };
        },
      );

      if (authentication === undefined) {
        throw new ApiError(401, 'Email or password is incorrect');
      }

      setAuthenticationCookies(
        reply,
        options.environment,
        authentication.session,
      );
      await reply.header('cache-control', 'no-store').send({
        companies: serializeMemberships(authentication.memberships),
        csrfToken: authentication.session.secrets.csrfToken,
        user: {
          displayName: authentication.record.displayName,
          email: authentication.record.email,
          id: authentication.record.userAccountId,
        },
      });
    },
  );

  app.get('/auth/session', async (request, reply) => {
    const token = request.cookies[sessionCookieName];
    const csrfToken = request.cookies[csrfCookieName];
    const authenticated = await resolveSession(
      options.database,
      options.environment,
      token,
    );

    if (
      authenticated === undefined ||
      csrfToken === undefined ||
      !securityTokenMatchesDigest(
        csrfToken,
        parseSecurityTokenDigest(authenticated.session.csrfTokenDigest),
      )
    ) {
      clearAuthenticationCookies(reply, options.environment);
      throw new ApiError(401, 'Authentication is required');
    }

    await reply.header('cache-control', 'no-store').send({
      companies: serializeMemberships(authenticated.memberships),
      csrfToken,
      user: {
        displayName: authenticated.session.displayName,
        email: authenticated.session.email,
        id: authenticated.session.userAccountId,
      },
    });
  });

  app.post('/auth/logout', async (request, reply) => {
    const token = request.cookies[sessionCookieName];
    const csrfCookie = request.cookies[csrfCookieName];
    const csrfHeader = readSingleHeader(request.headers['x-csrf-token']);
    const authenticated = await resolveSession(
      options.database,
      options.environment,
      token,
    );

    if (
      authenticated === undefined ||
      csrfCookie === undefined ||
      csrfHeader === undefined ||
      csrfCookie !== csrfHeader ||
      !securityTokenMatchesDigest(
        csrfHeader,
        parseSecurityTokenDigest(authenticated.session.csrfTokenDigest),
      )
    ) {
      throw new ApiError(403, 'CSRF validation failed');
    }

    const tokenDigest = digestSecurityToken(parseOpaqueSecurityToken(token!));
    await options.database.withSystemTransaction(async (transaction) => {
      await transaction.query(
        'SELECT app.revoke_authenticated_session($1, $2, $3, $4)',
        [tokenDigest, randomUUID(), request.id, null],
      );
    });
    clearAuthenticationCookies(reply, options.environment);
    await reply.status(204).header('cache-control', 'no-store').send();
  });
};

function parseBody<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
): z.output<Schema> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(400, 'Request body is invalid');
  }
  return parsed.data;
}

function createNewSession(environment: Environment) {
  const now = Date.now();
  return {
    absoluteExpiresAt: new Date(
      now + environment.SESSION_ABSOLUTE_TTL_SECONDS * 1_000,
    ),
    idleExpiresAt: new Date(now + environment.SESSION_IDLE_TTL_SECONDS * 1_000),
    id: randomUUID(),
    secrets: createSessionSecrets(),
  };
}

async function persistSession(
  transaction: TenantTransaction,
  userAccountId: string,
  session: ReturnType<typeof createNewSession>,
  requestId: string,
): Promise<void> {
  await transaction.query(
    `SELECT app.create_authenticated_session(
       $1, $2, $3, $4, $5, $6, $7, $8, $9
     )`,
    [
      session.id,
      userAccountId,
      session.secrets.sessionTokenDigest,
      session.secrets.csrfTokenDigest,
      session.idleExpiresAt,
      session.absoluteExpiresAt,
      randomUUID(),
      requestId,
      null,
    ],
  );
}

async function findAuthenticationRecord(
  transaction: TenantTransaction,
  email: string,
): Promise<AuthenticationRecord | undefined> {
  const result = await transaction.query<AuthenticationRecord>(
    `
    SELECT
      user_account_id AS "userAccountId",
      account_status AS "accountStatus",
      email,
      display_name AS "displayName",
      password_hash AS "passwordHash",
      failed_attempts AS "failedAttempts",
      locked_until AS "lockedUntil"
    FROM app.find_authentication_record($1)
  `,
    [email],
  );
  return result.rows[0];
}

async function appendDeniedLoginAudit(
  transaction: TenantTransaction,
  userAccountId: string | undefined,
  requestId: string,
): Promise<void> {
  await transaction.query(
    `SELECT app.append_audit_event(
       $1, NULL, $2, 'authentication.login', 'denied',
       NULL, NULL, $3, NULL, '{}'::jsonb
     )`,
    [randomUUID(), userAccountId ?? null, requestId],
  );
}

async function findMemberships(
  transaction: TenantTransaction,
  userAccountId: string,
): Promise<readonly MembershipRecord[]> {
  const result = await transaction.query<MembershipRecord>(
    `
    SELECT
      company_id AS "companyId",
      company_code AS "companyCode",
      company_name AS "companyName",
      membership_id AS "membershipId"
    FROM app.authentication_memberships($1)
  `,
    [userAccountId],
  );
  return result.rows;
}

async function resolveSession(
  database: Database,
  environment: Environment,
  token: string | undefined,
): Promise<
  | { memberships: readonly MembershipRecord[]; session: SessionRecord }
  | undefined
> {
  if (token === undefined) {
    return undefined;
  }

  let tokenDigest: string;
  try {
    tokenDigest = digestSecurityToken(parseOpaqueSecurityToken(token));
  } catch {
    return undefined;
  }

  return database.withSystemTransaction(async (transaction) => {
    const result = await transaction.query<SessionRecord>(
      `
      SELECT
        session_id AS "sessionId",
        user_account_id AS "userAccountId",
        email,
        display_name AS "displayName",
        csrf_token_digest AS "csrfTokenDigest",
        idle_expires_at AS "idleExpiresAt",
        absolute_expires_at AS "absoluteExpiresAt"
      FROM app.resolve_authenticated_session($1, $2)
    `,
      [tokenDigest, environment.SESSION_IDLE_TTL_SECONDS],
    );
    const session = result.rows[0];
    if (session === undefined) {
      return undefined;
    }
    return {
      memberships: await findMemberships(transaction, session.userAccountId),
      session,
    };
  });
}

function setAuthenticationCookies(
  reply: FastifyReply,
  environment: Environment,
  session: ReturnType<typeof createNewSession>,
): void {
  const common = {
    maxAge: environment.SESSION_ABSOLUTE_TTL_SECONDS,
    path: '/api',
    sameSite: 'strict' as const,
    secure: environment.SESSION_COOKIE_SECURE,
  };
  reply.setCookie(sessionCookieName, session.secrets.sessionToken, {
    ...common,
    httpOnly: true,
  });
  reply.setCookie(csrfCookieName, session.secrets.csrfToken, {
    ...common,
    httpOnly: false,
  });
}

function clearAuthenticationCookies(
  reply: FastifyReply,
  environment: Environment,
): void {
  const options = {
    path: '/api',
    sameSite: 'strict' as const,
    secure: environment.SESSION_COOKIE_SECURE,
  };
  reply.clearCookie(sessionCookieName, options);
  reply.clearCookie(csrfCookieName, options);
}

function serializeMemberships(memberships: readonly MembershipRecord[]) {
  return memberships.map((membership) => ({
    code: membership.companyCode,
    id: membership.companyId,
    membershipId: membership.membershipId,
    name: membership.companyName,
  }));
}

function readSingleHeader(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : undefined;
}

function isPostgresError(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}

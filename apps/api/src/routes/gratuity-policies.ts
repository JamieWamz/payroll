import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import type { Environment } from '../config/environment.js';
import type {
  Database,
  TenantTransaction,
} from '../infrastructure/database.js';
import {
  assertGratuityPolicySchedule,
  calculateContractGratuity,
  createGratuityPolicy,
  endGratuityPolicy,
  type GratuityPolicy,
} from '../modules/compensation/domain/index.js';
import { DomainError } from '../shared/domain/domain-error.js';
import { parseEntityId } from '../shared/domain/entity-id.js';
import { parseLocalDate } from '../shared/domain/local-date.js';
import { serializeMoney } from '../shared/domain/money.js';
import { ApiError } from './api-error.js';
import { appendSuccessfulAuditEvent } from './audit.js';
import { withAuthorizedCompanyTransaction } from './tenant-authorization.js';

interface GratuityPolicyRoutesOptions {
  database: Database;
  environment: Environment;
  prefix?: string;
}

interface PolicyRecord {
  companyId: string;
  endsOn: string | null;
  id: string;
  name: string;
  policyReference: string;
  rateBasisPoints: number;
  rowVersion: string;
  startsOn: string;
}

interface StatutoryRecord {
  effectiveFrom: string;
  effectiveTo: string | null;
  parameters: Record<string, unknown>;
  status: string;
}

const companyParamsSchema = z
  .object({ companyId: z.string().max(36) })
  .strict();
const policyParamsSchema = companyParamsSchema.extend({
  policyId: z.string().max(36),
});
const listSchema = z
  .object({ limit: z.coerce.number().int().min(1).max(100).default(50) })
  .strict();
const createSchema = z
  .object({
    endsOn: z.string().max(10).optional(),
    name: z.string().max(160),
    policyReference: z.string().max(480),
    ratePercent: z.string().max(12),
    startsOn: z.string().max(10),
  })
  .strict();
const endSchema = z
  .object({
    endsOn: z.string().max(10),
    expectedRowVersion: z.number().int().positive(),
  })
  .strict();
const previewSchema = z
  .object({
    basicPayEarned: z.string().max(40),
    contractEndsOn: z.string().max(10),
    settlementDate: z.string().max(10),
    statutoryConfigurationId: z.string().max(36),
  })
  .strict();

export const gratuityPolicyRoutes: FastifyPluginAsync<
  GratuityPolicyRoutesOptions
> = async (app, options) => {
  app.get('/companies/:companyId/gratuity-policies', async (request, reply) => {
    const params = parseInput(companyParamsSchema, request.params);
    const query = parseInput(listSchema, request.query);
    const records = await withAuthorizedCompanyTransaction(
      options.database,
      {
        companyId: params.companyId,
        environment: options.environment,
        permission: 'compensation.read',
        request,
      },
      (transaction) => findPolicies(transaction, query.limit),
    );
    await reply.header('cache-control', 'no-store').send({
      items: records.map(serializePolicyRecord),
      limit: query.limit,
    });
  });

  app.post(
    '/companies/:companyId/gratuity-policies',
    async (request, reply) => {
      const params = parseInput(companyParamsSchema, request.params);
      const companyId = parseEntityId(params.companyId, 'Company');
      const body = parseInput(createSchema, request.body);
      try {
        const policy = await withAuthorizedCompanyTransaction(
          options.database,
          {
            companyId,
            environment: options.environment,
            permission: 'compensation.write',
            request,
            requireCsrf: true,
          },
          async (transaction, principal) => {
            const created = createGratuityPolicy({
              companyId,
              id: randomUUID(),
              name: body.name,
              policyReference: body.policyReference,
              ratePercent: body.ratePercent,
              startsOn: body.startsOn,
              ...(body.endsOn === undefined ? {} : { endsOn: body.endsOn }),
            });
            const existing = (await findPolicies(transaction)).map(toDomain);
            assertGratuityPolicySchedule(companyId, [...existing, created]);
            await insertPolicy(transaction, created);
            await appendSuccessfulAuditEvent(
              transaction,
              principal,
              request.id,
              {
                eventType: 'gratuity-policy.created',
                targetId: created.id,
                targetType: 'gratuity-policy',
              },
            );
            return created;
          },
        );
        await reply
          .status(201)
          .header('cache-control', 'no-store')
          .send(serializePolicy(policy, 1));
      } catch (error) {
        throw mapConflict(error);
      }
    },
  );

  app.patch(
    '/companies/:companyId/gratuity-policies/:policyId/end',
    async (request, reply) => {
      const params = parseInput(policyParamsSchema, request.params);
      const policyId = parseEntityId(params.policyId, 'GratuityPolicy');
      const body = parseInput(endSchema, request.body);
      try {
        const updated = await withAuthorizedCompanyTransaction(
          options.database,
          {
            companyId: params.companyId,
            environment: options.environment,
            permission: 'compensation.write',
            request,
            requireCsrf: true,
          },
          async (transaction, principal) => {
            const stored = await requirePolicy(transaction, policyId);
            const ended = endGratuityPolicy(toDomain(stored), body.endsOn);
            const record = await updatePolicyEnd(
              transaction,
              ended,
              body.expectedRowVersion,
            );
            await appendSuccessfulAuditEvent(
              transaction,
              principal,
              request.id,
              {
                eventType: 'gratuity-policy.ended',
                targetId: ended.id,
                targetType: 'gratuity-policy',
              },
            );
            return record;
          },
        );
        await reply
          .header('cache-control', 'no-store')
          .send(serializePolicyRecord(updated));
      } catch (error) {
        throw mapConflict(error);
      }
    },
  );

  app.post(
    '/companies/:companyId/gratuity-policies/:policyId/preview',
    async (request, reply) => {
      const params = parseInput(policyParamsSchema, request.params);
      const policyId = parseEntityId(params.policyId, 'GratuityPolicy');
      const body = parseInput(previewSchema, request.body);
      parseLocalDate(body.contractEndsOn);
      parseLocalDate(body.settlementDate);
      const statutoryConfigurationId = parseEntityId(
        body.statutoryConfigurationId,
        'StatutoryConfiguration',
      );
      try {
        const calculation = await withAuthorizedCompanyTransaction(
          options.database,
          {
            companyId: params.companyId,
            environment: options.environment,
            permission: 'compensation.read',
            request,
            requireCsrf: true,
          },
          async (transaction) => {
            const [policy, configuration] = await Promise.all([
              requirePolicy(transaction, policyId),
              requireStatutoryConfiguration(
                transaction,
                statutoryConfigurationId,
                body.contractEndsOn,
              ),
            ]);
            return calculateContractGratuity({
              basicPayEarned: body.basicPayEarned,
              contractEndsOn: body.contractEndsOn,
              policy: toDomain(policy),
              settlementDate: body.settlementDate,
              statutoryMinimumRatePercent:
                readStatutoryMinimumRate(configuration),
            });
          },
        );
        await reply.header('cache-control', 'no-store').send({
          ...calculation,
          amount: serializeMoney(calculation.amount),
          basicPayEarned: serializeMoney(calculation.basicPayEarned),
          preview: true,
        });
      } catch (error) {
        throw mapConflict(error);
      }
    },
  );
};

function parseInput<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
): z.output<Schema> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, 'Request input is invalid');
  return parsed.data;
}

async function findPolicies(
  transaction: TenantTransaction,
  limit = 1000,
): Promise<PolicyRecord[]> {
  return (
    await transaction.query<PolicyRecord>(
      `
        SELECT id, company_id AS "companyId", name,
          policy_reference AS "policyReference",
          rate_basis_points AS "rateBasisPoints",
          starts_on::text AS "startsOn", ends_on::text AS "endsOn",
          row_version::text AS "rowVersion"
        FROM app.gratuity_policies
        WHERE company_id = app.current_company_id()
        ORDER BY starts_on DESC, id
        LIMIT $1
      `,
      [limit],
    )
  ).rows;
}

async function requirePolicy(
  transaction: TenantTransaction,
  policyId: string,
): Promise<PolicyRecord> {
  const result = await transaction.query<PolicyRecord>(
    `
      SELECT id, company_id AS "companyId", name,
        policy_reference AS "policyReference",
        rate_basis_points AS "rateBasisPoints",
        starts_on::text AS "startsOn", ends_on::text AS "endsOn",
        row_version::text AS "rowVersion"
      FROM app.gratuity_policies
      WHERE company_id = app.current_company_id() AND id = $1
    `,
    [policyId],
  );
  const policy = result.rows[0];
  if (policy === undefined)
    throw new ApiError(404, 'Gratuity policy was not found');
  return policy;
}

async function requireStatutoryConfiguration(
  transaction: TenantTransaction,
  configurationId: string,
  applicableOn: string,
): Promise<StatutoryRecord> {
  const result = await transaction.query<StatutoryRecord>(
    `
      SELECT status, effective_from::text AS "effectiveFrom",
        effective_to::text AS "effectiveTo", parameters
      FROM app.statutory_configurations
      WHERE company_id = app.current_company_id() AND id = $1
    `,
    [configurationId],
  );
  const configuration = result.rows[0];
  if (
    configuration === undefined ||
    configuration.status !== 'verified' ||
    configuration.effectiveFrom > applicableOn ||
    (configuration.effectiveTo !== null &&
      configuration.effectiveTo < applicableOn)
  ) {
    throw new ApiError(
      409,
      'A verified statutory configuration covering contract expiry is required',
    );
  }
  const evidence = await transaction.query<{ present: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM app.statutory_sources
      WHERE company_id = app.current_company_id()
        AND statutory_configuration_id = $1 AND authority = 'labour'
    ) AS present`,
    [configurationId],
  );
  if (evidence.rows[0]?.present !== true) {
    throw new ApiError(409, 'Gratuity requires reviewed labour evidence');
  }
  return configuration;
}

function readStatutoryMinimumRate(configuration: StatutoryRecord): string {
  const gratuity = configuration.parameters['gratuity'];
  if (
    gratuity === null ||
    typeof gratuity !== 'object' ||
    Array.isArray(gratuity)
  ) {
    throw new ApiError(
      409,
      'The statutory configuration has no verified gratuity rule',
    );
  }
  const minimum = (gratuity as Record<string, unknown>)['minimumRatePercent'];
  if (typeof minimum !== 'string') {
    throw new ApiError(
      409,
      'The statutory configuration has no verified gratuity rule',
    );
  }
  return minimum;
}

function toDomain(record: PolicyRecord): Readonly<GratuityPolicy> {
  return createGratuityPolicy({
    companyId: record.companyId,
    id: record.id,
    name: record.name,
    policyReference: record.policyReference,
    ratePercent: formatRate(record.rateBasisPoints),
    startsOn: record.startsOn,
    ...(record.endsOn === null ? {} : { endsOn: record.endsOn }),
  });
}

async function insertPolicy(
  transaction: TenantTransaction,
  policy: Readonly<GratuityPolicy>,
): Promise<void> {
  await transaction.query(
    `
      INSERT INTO app.gratuity_policies
        (id, company_id, name, policy_reference, rate_basis_points,
         starts_on, ends_on)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      policy.id,
      policy.companyId,
      policy.name,
      policy.policyReference,
      policy.rateBasisPoints,
      policy.effectivePeriod.startsOn,
      policy.effectivePeriod.endsOn ?? null,
    ],
  );
}

async function updatePolicyEnd(
  transaction: TenantTransaction,
  policy: Readonly<GratuityPolicy>,
  expectedRowVersion: number,
): Promise<PolicyRecord> {
  const result = await transaction.query<PolicyRecord>(
    `
      UPDATE app.gratuity_policies
      SET ends_on = $1, row_version = row_version + 1,
        updated_at = statement_timestamp()
      WHERE company_id = app.current_company_id() AND id = $2
        AND row_version = $3
      RETURNING id, company_id AS "companyId", name,
        policy_reference AS "policyReference",
        rate_basis_points AS "rateBasisPoints",
        starts_on::text AS "startsOn", ends_on::text AS "endsOn",
        row_version::text AS "rowVersion"
    `,
    [policy.effectivePeriod.endsOn, policy.id, expectedRowVersion],
  );
  const record = result.rows[0];
  if (record === undefined) {
    throw new ApiError(409, 'Gratuity policy was changed by another request');
  }
  return record;
}

function serializePolicyRecord(record: PolicyRecord) {
  return {
    endsOn: record.endsOn,
    id: record.id,
    name: record.name,
    policyReference: record.policyReference,
    ratePercent: formatRate(record.rateBasisPoints),
    rowVersion: Number(record.rowVersion),
    startsOn: record.startsOn,
  };
}

function serializePolicy(policy: Readonly<GratuityPolicy>, rowVersion: number) {
  return {
    endsOn: policy.effectivePeriod.endsOn ?? null,
    id: policy.id,
    name: policy.name,
    policyReference: policy.policyReference,
    ratePercent: policy.ratePercent,
    rowVersion,
    startsOn: policy.effectivePeriod.startsOn,
  };
}

function formatRate(basisPoints: number): string {
  return `${Math.floor(basisPoints / 100)}.${String(basisPoints % 100).padStart(2, '0')}`;
}

function mapConflict(error: unknown): unknown {
  if (
    error instanceof DomainError &&
    (error.code === 'GRATUITY_POLICY_ALREADY_ENDED' ||
      error.code === 'GRATUITY_POLICY_HISTORY_OVERLAP' ||
      (error.code === 'INVALID_TERMINAL_BENEFIT_CALCULATION' &&
        (error.details?.rule === 'policy_below_statutory_minimum' ||
          error.details?.rule === 'policy_not_effective_at_contract_end' ||
          error.details?.rule === 'settlement_before_contract_end')))
  ) {
    return new ApiError(409, error.message);
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === '23505' || error.code === '23514' || error.code === '23P01')
  ) {
    return new ApiError(409, 'Gratuity policy conflicts with existing history');
  }
  return error;
}

import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { Environment } from '../config/environment.js';
import type {
  Database,
  TenantTransaction,
} from '../infrastructure/database.js';
import {
  zambianPublishedContributionReference,
  zraPublishedMonthlyPayeReference,
} from '../modules/payroll/calculation/index.js';
import {
  assertStatutoryConfigurationSchedule,
  createDraftStatutoryConfiguration,
  retireStatutoryConfiguration,
  verifyStatutoryConfiguration,
  type StatutoryConfiguration,
} from '../modules/statutory-configuration/domain/index.js';
import { DomainError } from '../shared/domain/domain-error.js';
import { parseEntityId } from '../shared/domain/entity-id.js';
import { ApiError } from './api-error.js';
import { appendSuccessfulAuditEvent } from './audit.js';
import { withAuthorizedCompanyTransaction } from './tenant-authorization.js';

interface StatutoryConfigurationRoutesOptions {
  database: Database;
  environment: Environment;
  prefix?: string;
}

interface ConfigurationRecord {
  companyId: string;
  configurationVersion: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  id: string;
  parameters: Record<string, unknown>;
  rowVersion: string;
  status: string;
  verifiedAt: Date | null;
  verifiedByMembershipId: string | null;
}

interface SourceRecord {
  accessedOn: string;
  authority: string;
  id: string;
  publishedOn: string | null;
  statutoryConfigurationId: string;
  title: string;
  uri: string;
}

const companyParamsSchema = z
  .object({ companyId: z.string().max(36) })
  .strict();
const configurationParamsSchema = companyParamsSchema.extend({
  configurationId: z.string().max(36),
});
const listSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    status: z.enum(['draft', 'verified', 'retired']).optional(),
  })
  .strict();
const sourceSchema = z
  .object({
    accessedOn: z.string().max(10),
    authority: z.enum(['zra', 'napsa', 'nhima']),
    publishedOn: z.string().max(10).optional(),
    title: z.string().max(480),
    uri: z.string().max(4096),
  })
  .strict();
const createSchema = z
  .object({
    effectiveFrom: z.string().max(10),
    effectiveTo: z.string().max(10).optional(),
    parameters: z.unknown(),
    sources: z.array(sourceSchema).max(20),
    version: z.string().max(128),
  })
  .strict();
const transitionSchema = z
  .object({ expectedRowVersion: z.number().int().positive() })
  .strict();
const verifySchema = transitionSchema.extend({
  evidenceAttestation: z.literal(true),
});

export const statutoryConfigurationRoutes: FastifyPluginAsync<
  StatutoryConfigurationRoutesOptions
> = async (app, options) => {
  app.get(
    '/companies/:companyId/statutory-configurations/references/zra-paye',
    async (request, reply) => {
      const params = parseInput(companyParamsSchema, request.params);
      await authorizeReferenceRead(request, options, params.companyId);
      await reply
        .header('cache-control', 'no-store')
        .send(zraPublishedMonthlyPayeReference);
    },
  );

  app.get(
    '/companies/:companyId/statutory-configurations/references/contributions',
    async (request, reply) => {
      const params = parseInput(companyParamsSchema, request.params);
      await authorizeReferenceRead(request, options, params.companyId);
      await reply
        .header('cache-control', 'no-store')
        .send(zambianPublishedContributionReference);
    },
  );

  app.get(
    '/companies/:companyId/statutory-configurations',
    async (request, reply) => {
      const params = parseInput(companyParamsSchema, request.params);
      const query = parseInput(listSchema, request.query);
      const records = await withAuthorizedCompanyTransaction(
        options.database,
        {
          companyId: params.companyId,
          environment: options.environment,
          permission: 'statutory-config.read',
          request,
        },
        (transaction) =>
          findConfigurations(transaction, query.status, query.limit),
      );
      await reply.header('cache-control', 'no-store').send({
        items: records.map(serializeConfigurationSummary),
        limit: query.limit,
      });
    },
  );

  app.get(
    '/companies/:companyId/statutory-configurations/:configurationId',
    async (request, reply) => {
      const params = parseInput(configurationParamsSchema, request.params);
      const configurationId = parseEntityId(
        params.configurationId,
        'StatutoryConfiguration',
      );
      const result = await withAuthorizedCompanyTransaction(
        options.database,
        {
          companyId: params.companyId,
          environment: options.environment,
          permission: 'statutory-config.read',
          request,
        },
        async (transaction) => {
          const configuration = await findConfiguration(
            transaction,
            configurationId,
          );
          if (configuration === undefined) return undefined;
          return {
            configuration,
            sources: await findSources(transaction, configurationId),
          };
        },
      );
      if (result === undefined) {
        throw new ApiError(404, 'Statutory configuration was not found');
      }
      await reply.header('cache-control', 'no-store').send({
        ...serializeConfigurationSummary(result.configuration),
        parameters: result.configuration.parameters,
        sources: result.sources.map(serializeSource),
      });
    },
  );

  app.post(
    '/companies/:companyId/statutory-configurations',
    async (request, reply) => {
      const params = parseInput(companyParamsSchema, request.params);
      const companyId = parseEntityId(params.companyId, 'Company');
      const body = parseInput(createSchema, request.body);
      try {
        const configuration = await withAuthorizedCompanyTransaction(
          options.database,
          {
            companyId,
            environment: options.environment,
            permission: 'statutory-config.verify',
            request,
            requireCsrf: true,
          },
          async (transaction, principal) => {
            const created = createDraftStatutoryConfiguration({
              companyId,
              effectiveFrom: body.effectiveFrom,
              id: randomUUID(),
              parameters: body.parameters,
              sources: body.sources.map((source) => ({
                accessedOn: source.accessedOn,
                authority: source.authority,
                title: source.title,
                uri: source.uri,
                ...(source.publishedOn === undefined
                  ? {}
                  : { publishedOn: source.publishedOn }),
              })),
              version: body.version,
              ...(body.effectiveTo === undefined
                ? {}
                : { effectiveTo: body.effectiveTo }),
            });
            const existing = await loadDomainConfigurations(transaction);
            assertStatutoryConfigurationSchedule(companyId, [
              ...existing,
              created,
            ]);
            await insertConfiguration(transaction, created);
            await insertSources(transaction, created);
            await appendSuccessfulAuditEvent(
              transaction,
              principal,
              request.id,
              {
                eventType: 'statutory-configuration.draft-created',
                targetId: created.id,
                targetType: 'statutory-configuration',
              },
            );
            return created;
          },
        );
        await reply
          .status(201)
          .header('cache-control', 'no-store')
          .send({
            ...serializeDomainConfiguration(configuration),
            rowVersion: 1,
          });
      } catch (error) {
        throw mapConfigurationConflict(error);
      }
    },
  );

  app.post(
    '/companies/:companyId/statutory-configurations/:configurationId/verify',
    async (request, reply) => {
      await transitionConfiguration(request, reply, options, 'verify');
    },
  );

  app.post(
    '/companies/:companyId/statutory-configurations/:configurationId/retire',
    async (request, reply) => {
      await transitionConfiguration(request, reply, options, 'retire');
    },
  );
};

async function transitionConfiguration(
  request: FastifyRequest,
  reply: FastifyReply,
  options: StatutoryConfigurationRoutesOptions,
  transition: 'retire' | 'verify',
): Promise<void> {
  const params = parseInput(configurationParamsSchema, request.params);
  const configurationId = parseEntityId(
    params.configurationId,
    'StatutoryConfiguration',
  );
  const body = parseInput(
    transition === 'verify' ? verifySchema : transitionSchema,
    request.body,
  );
  try {
    const record = await withAuthorizedCompanyTransaction(
      options.database,
      {
        companyId: params.companyId,
        environment: options.environment,
        permission: 'statutory-config.verify',
        request,
        requireCsrf: true,
      },
      async (transaction, principal) => {
        const stored = await requireConfiguration(transaction, configurationId);
        const sources = await findSources(transaction, configurationId);
        const domain = toDomain(stored, sources);
        const transitioned =
          transition === 'verify'
            ? verifyStatutoryConfiguration(
                domain,
                principal.membershipId,
                new Date().toISOString(),
              )
            : retireStatutoryConfiguration(domain);
        if (transition === 'verify') {
          const existing = (await loadDomainConfigurations(transaction)).filter(
            (configuration) => configuration.id !== transitioned.id,
          );
          assertStatutoryConfigurationSchedule(principal.companyId, [
            ...existing,
            transitioned,
          ]);
        }
        const updated = await updateConfigurationStatus(
          transaction,
          transitioned,
          body.expectedRowVersion,
        );
        await appendSuccessfulAuditEvent(transaction, principal, request.id, {
          eventType: `statutory-configuration.${transition === 'verify' ? 'verified' : 'retired'}`,
          targetId: configurationId,
          targetType: 'statutory-configuration',
        });
        return updated;
      },
    );
    await reply
      .header('cache-control', 'no-store')
      .send(serializeConfigurationSummary(record));
  } catch (error) {
    throw mapConfigurationConflict(error);
  }
}

function parseInput<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
): z.output<Schema> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, 'Request input is invalid');
  return parsed.data;
}

async function findConfigurations(
  transaction: TenantTransaction,
  status?: 'draft' | 'retired' | 'verified',
  limit?: number,
): Promise<ConfigurationRecord[]> {
  return (
    await transaction.query<ConfigurationRecord>(
      `
        SELECT id, company_id AS "companyId",
          configuration_version AS "configurationVersion", status,
          effective_from::text AS "effectiveFrom",
          effective_to::text AS "effectiveTo", parameters,
          verified_by_membership_id AS "verifiedByMembershipId",
          verified_at AS "verifiedAt", row_version::text AS "rowVersion"
        FROM app.statutory_configurations
        WHERE company_id = app.current_company_id()
          AND ($1::text IS NULL OR status = $1)
        ORDER BY effective_from DESC, configuration_version, id
        LIMIT $2
      `,
      [status ?? null, limit ?? null],
    )
  ).rows;
}

async function findConfiguration(
  transaction: TenantTransaction,
  configurationId: string,
): Promise<ConfigurationRecord | undefined> {
  return (
    await transaction.query<ConfigurationRecord>(
      `
        SELECT id, company_id AS "companyId",
          configuration_version AS "configurationVersion", status,
          effective_from::text AS "effectiveFrom",
          effective_to::text AS "effectiveTo", parameters,
          verified_by_membership_id AS "verifiedByMembershipId",
          verified_at AS "verifiedAt", row_version::text AS "rowVersion"
        FROM app.statutory_configurations
        WHERE company_id = app.current_company_id() AND id = $1
      `,
      [configurationId],
    )
  ).rows[0];
}

async function requireConfiguration(
  transaction: TenantTransaction,
  configurationId: string,
): Promise<ConfigurationRecord> {
  const record = await findConfiguration(transaction, configurationId);
  if (record === undefined) {
    throw new ApiError(404, 'Statutory configuration was not found');
  }
  return record;
}

async function findSources(
  transaction: TenantTransaction,
  configurationId: string,
): Promise<SourceRecord[]> {
  return (
    await transaction.query<SourceRecord>(
      `
        SELECT id, statutory_configuration_id AS "statutoryConfigurationId",
          authority, title, uri, published_on::text AS "publishedOn",
          accessed_on::text AS "accessedOn"
        FROM app.statutory_sources
        WHERE company_id = app.current_company_id()
          AND statutory_configuration_id = $1
        ORDER BY authority, uri, id
      `,
      [configurationId],
    )
  ).rows;
}

async function loadDomainConfigurations(
  transaction: TenantTransaction,
): Promise<Readonly<StatutoryConfiguration>[]> {
  const records = await findConfigurations(transaction);
  const result: Readonly<StatutoryConfiguration>[] = [];
  for (const record of records) {
    result.push(toDomain(record, await findSources(transaction, record.id)));
  }
  return result;
}

function toDomain(
  record: ConfigurationRecord,
  sources: readonly SourceRecord[],
): Readonly<StatutoryConfiguration> {
  const draft = createDraftStatutoryConfiguration({
    companyId: record.companyId,
    effectiveFrom: record.effectiveFrom,
    id: record.id,
    parameters: record.parameters,
    sources: sources.map((source) => ({
      accessedOn: source.accessedOn,
      authority: source.authority,
      title: source.title,
      uri: source.uri,
      ...(source.publishedOn === null
        ? {}
        : { publishedOn: source.publishedOn }),
    })),
    version: record.configurationVersion,
    ...(record.effectiveTo === null ? {} : { effectiveTo: record.effectiveTo }),
  });
  if (record.status === 'draft') return draft;
  if (record.verifiedByMembershipId === null || record.verifiedAt === null) {
    throw new Error('Persisted statutory verification is incomplete');
  }
  const verified = verifyStatutoryConfiguration(
    draft,
    record.verifiedByMembershipId,
    record.verifiedAt.toISOString(),
  );
  return record.status === 'retired'
    ? retireStatutoryConfiguration(verified)
    : verified;
}

async function insertConfiguration(
  transaction: TenantTransaction,
  configuration: Readonly<StatutoryConfiguration>,
): Promise<void> {
  await transaction.query(
    `
      INSERT INTO app.statutory_configurations
        (id, company_id, configuration_version, effective_from, effective_to, parameters)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    `,
    [
      configuration.id,
      configuration.companyId,
      configuration.version,
      configuration.effectivePeriod.startsOn,
      configuration.effectivePeriod.endsOn ?? null,
      JSON.stringify(configuration.parameters),
    ],
  );
}

async function insertSources(
  transaction: TenantTransaction,
  configuration: Readonly<StatutoryConfiguration>,
): Promise<void> {
  for (const source of configuration.sources) {
    await transaction.query(
      `
        INSERT INTO app.statutory_sources
          (id, company_id, statutory_configuration_id, authority, title, uri,
           published_on, accessed_on)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        randomUUID(),
        configuration.companyId,
        configuration.id,
        source.authority,
        source.title,
        source.uri,
        source.publishedOn ?? null,
        source.accessedOn,
      ],
    );
  }
}

async function updateConfigurationStatus(
  transaction: TenantTransaction,
  configuration: Readonly<StatutoryConfiguration>,
  expectedRowVersion: number,
): Promise<ConfigurationRecord> {
  const result = await transaction.query<ConfigurationRecord>(
    `
      UPDATE app.statutory_configurations
      SET status = $1, verified_by_membership_id = $2, verified_at = $3,
        row_version = row_version + 1, updated_at = statement_timestamp()
      WHERE company_id = app.current_company_id() AND id = $4
        AND row_version = $5
      RETURNING id, company_id AS "companyId",
        configuration_version AS "configurationVersion", status,
        effective_from::text AS "effectiveFrom",
        effective_to::text AS "effectiveTo", parameters,
        verified_by_membership_id AS "verifiedByMembershipId",
        verified_at AS "verifiedAt", row_version::text AS "rowVersion"
    `,
    [
      configuration.status,
      configuration.verification?.verifiedByMembershipId ?? null,
      configuration.verification?.verifiedAt ?? null,
      configuration.id,
      expectedRowVersion,
    ],
  );
  const updated = result.rows[0];
  if (updated === undefined) {
    throw new ApiError(
      409,
      'Statutory configuration was changed by another request',
    );
  }
  return updated;
}

function serializeConfigurationSummary(record: ConfigurationRecord) {
  return {
    effectiveFrom: record.effectiveFrom,
    effectiveTo: record.effectiveTo,
    id: record.id,
    rowVersion: Number(record.rowVersion),
    status: record.status,
    verification:
      record.verifiedAt === null || record.verifiedByMembershipId === null
        ? null
        : {
            verifiedAt: record.verifiedAt.toISOString(),
            verifiedByMembershipId: record.verifiedByMembershipId,
          },
    version: record.configurationVersion,
  };
}

function serializeDomainConfiguration(
  configuration: Readonly<StatutoryConfiguration>,
) {
  return {
    effectiveFrom: configuration.effectivePeriod.startsOn,
    effectiveTo: configuration.effectivePeriod.endsOn ?? null,
    id: configuration.id,
    parameters: configuration.parameters,
    sources: configuration.sources,
    status: configuration.status,
    verification: configuration.verification ?? null,
    version: configuration.version,
  };
}

function serializeSource(source: SourceRecord) {
  return {
    accessedOn: source.accessedOn,
    authority: source.authority,
    id: source.id,
    publishedOn: source.publishedOn,
    title: source.title,
    uri: source.uri,
  };
}

function mapConfigurationConflict(error: unknown): unknown {
  if (
    error instanceof DomainError &&
    (error.code === 'STATUTORY_CONFIGURATION_IMMUTABLE' ||
      (error.code === 'INVALID_STATUTORY_CONFIGURATION' &&
        (error.details?.rule === 'duplicate_configuration' ||
          error.details?.rule === 'overlapping_verified_configuration')))
  ) {
    return new ApiError(409, error.message);
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === '23505' || error.code === '23514' || error.code === '23P01')
  ) {
    return new ApiError(
      409,
      'Statutory configuration conflicts with existing history',
    );
  }
  return error;
}

async function authorizeReferenceRead(
  request: FastifyRequest,
  options: StatutoryConfigurationRoutesOptions,
  companyId: string,
): Promise<void> {
  await withAuthorizedCompanyTransaction(
    options.database,
    {
      companyId,
      environment: options.environment,
      permission: 'statutory-config.read',
      request,
    },
    async () => undefined,
  );
}

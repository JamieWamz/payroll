import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Environment } from '../config/environment.js';
import type { Database } from '../infrastructure/database.js';
import {
  bankNames,
  complianceProfileSchema,
  exportTemplateSchema,
  exportRowsSchema,
  renderExportPreview,
  labourRuleSchema,
} from '../modules/operations/contracts.js';
import { parseLocalDate } from '../shared/domain/local-date.js';
import {
  parseCurrencyCode,
  parseDecimalMoney,
} from '../shared/domain/money.js';
import { ApiError } from './api-error.js';
import { appendSuccessfulAuditEvent } from './audit.js';
import { withAuthorizedCompanyTransaction } from './tenant-authorization.js';

const paramsSchema = z.object({ companyId: z.string().uuid() }).strict();
const saveSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('compliance_profile'),
      settings: complianceProfileSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('export_template'),
      settings: exportTemplateSchema,
    })
    .strict(),
]);
function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new ApiError(400, 'Invalid operations settings or input');
  return result.data;
}

export const operationsRoutes: FastifyPluginAsync<{
  database: Database;
  environment: Environment;
  prefix?: string;
}> = async (app, options) => {
  app.get('/companies/:companyId/operations', async (request, reply) => {
    const { companyId } = parse(paramsSchema, request.params);
    const records = await withAuthorizedCompanyTransaction(
      options.database,
      {
        companyId,
        environment: options.environment,
        permission: 'company.read',
        request,
      },
      async (transaction) =>
        (
          await transaction.query(
            `SELECT id, kind, settings, created_at AS "createdAt" FROM app.operations_settings
       WHERE company_id = app.current_company_id() ORDER BY created_at DESC, id DESC LIMIT 100`,
          )
        ).rows,
    );
    return reply.header('cache-control', 'no-store').send({
      items: records,
      banks: bankNames.map((name) => ({
        name,
        connectionStatus: 'not_connected',
      })),
      bankRegisterSource:
        'https://www.boz.zm/Public_Notice_Deposit_Insurance_Scheme.pdf',
    });
  });
  app.post('/companies/:companyId/operations', async (request, reply) => {
    const { companyId } = parse(paramsSchema, request.params);
    const body = parse(saveSchema, request.body);
    const id = randomUUID();
    await withAuthorizedCompanyTransaction(
      options.database,
      {
        companyId,
        environment: options.environment,
        permission: 'company.update',
        requireCsrf: true,
        request,
      },
      async (transaction, principal) => {
        await transaction.query(
          `INSERT INTO app.operations_settings (id, company_id, kind, settings) VALUES ($1,$2,$3,$4::jsonb)`,
          [id, companyId, body.kind, JSON.stringify(body.settings)],
        );
        await appendSuccessfulAuditEvent(transaction, principal, request.id, {
          eventType: 'operations.settings-created',
          targetId: id,
          targetType: body.kind.replaceAll('_', '-'),
        });
      },
    );
    return reply
      .status(201)
      .header('cache-control', 'no-store')
      .send({ id, ...body });
  });
  app.post(
    '/companies/:companyId/operations/export-preview',
    async (request, reply) => {
      const { companyId } = parse(paramsSchema, request.params);
      const body = parse(
        z
          .object({ templateId: z.string().uuid(), rows: exportRowsSchema })
          .strict(),
        request.body,
      );
      const csv = await withAuthorizedCompanyTransaction(
        options.database,
        {
          companyId,
          environment: options.environment,
          permission: 'payroll.read',
          requireCsrf: true,
          request,
        },
        async (transaction, principal) => {
          const stored = await transaction.query<{ settings: unknown }>(
            `SELECT settings FROM app.operations_settings WHERE company_id = app.current_company_id() AND id = $1 AND kind = 'export_template'`,
            [body.templateId],
          );
          if (!stored.rows[0])
            throw new ApiError(404, 'Export template was not found');
          let csv: string;
          try {
            csv = renderExportPreview(
              exportTemplateSchema.parse(stored.rows[0].settings),
              body.rows,
            );
          } catch (error) {
            throw new ApiError(
              400,
              error instanceof Error ? error.message : 'Invalid export data',
            );
          }
          await appendSuccessfulAuditEvent(transaction, principal, request.id, {
            eventType: 'operations.export-preview-generated',
            targetId: body.templateId,
            targetType: 'export-template',
          });
          return csv;
        },
      );
      return reply
        .header('cache-control', 'no-store')
        .header(
          'content-disposition',
          'attachment; filename="payroll-preview.csv"',
        )
        .type('text/csv; charset=utf-8')
        .send(csv);
    },
  );
  app.post(
    '/companies/:companyId/operations/compliance-preview',
    async (request, reply) => {
      const { companyId } = parse(paramsSchema, request.params);
      const body = parse(
        z
          .object({
            profileId: z.string().uuid(),
            date: z.string(),
            monthlyBasicPay: z.string().regex(/^(0|[1-9]\d*)\.\d{2}$/),
          })
          .strict(),
        request.body,
      );
      const date = parseLocalDate(body.date);
      const result = await withAuthorizedCompanyTransaction(
        options.database,
        {
          companyId,
          environment: options.environment,
          permission: 'compensation.read',
          requireCsrf: true,
          request,
        },
        async (transaction) => {
          const stored = await transaction.query<{ settings: unknown }>(
            `SELECT settings FROM app.operations_settings WHERE company_id = app.current_company_id() AND id = $1 AND kind = 'compliance_profile'`,
            [body.profileId],
          );
          if (!stored.rows[0])
            throw new ApiError(404, 'Compliance profile was not found');
          const profile = complianceProfileSchema.parse(
            stored.rows[0].settings,
          );
          const config = await transaction.query<{
            parameters: Record<string, unknown>;
            version: string;
          }>(
            `SELECT parameters, configuration_version AS version FROM app.statutory_configurations c
         WHERE company_id = app.current_company_id() AND id = $1 AND status = 'verified'
         AND effective_from <= $2 AND (effective_to IS NULL OR effective_to >= $2)
         AND EXISTS (SELECT 1 FROM app.statutory_sources s WHERE s.company_id = c.company_id AND s.statutory_configuration_id = c.id AND s.authority = 'labour')`,
            [profile.statutoryConfigurationId, date],
          );
          if (!config.rows[0])
            throw new ApiError(
              409,
              'Review an applicable labour configuration before checking pay',
            );
          const rules = z
            .array(labourRuleSchema)
            .safeParse(config.rows[0].parameters['labourMinimumWages']);
          if (!rules.success)
            throw new ApiError(
              409,
              'No valid industry wage rules are configured',
            );
          const matches = rules.data.filter(
            (rule) =>
              rule.industry === profile.industry &&
              rule.workerCategory === profile.workerCategory,
          );
          if (matches.length !== 1)
            throw new ApiError(
              409,
              'Exactly one matching industry and worker category is required',
            );
          const minimum = matches[0]!.minimumMonthlyBasicPay;
          const currency = parseCurrencyCode('ZMW');
          return {
            scope: 'monthly_basic_pay_only',
            profileId: body.profileId,
            configurationVersion: config.rows[0].version,
            minimumMonthlyBasicPay: minimum,
            result:
              parseDecimalMoney(body.monthlyBasicPay, currency, 2).minorUnits >=
              parseDecimalMoney(minimum, currency, 2).minorUnits
                ? 'meets_configured_minimum'
                : 'below_configured_minimum',
          };
        },
      );
      return reply.header('cache-control', 'no-store').send(result);
    },
  );
};

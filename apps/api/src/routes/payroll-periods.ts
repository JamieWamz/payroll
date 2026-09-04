import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import type { Environment } from '../config/environment.js';
import type {
  Database,
  TenantTransaction,
} from '../infrastructure/database.js';
import {
  assertPayrollPeriodSchedule,
  createPayrollPeriod,
  type PayrollPeriod,
} from '../modules/payroll/domain/index.js';
import { DomainError } from '../shared/domain/domain-error.js';
import { parseEntityId } from '../shared/domain/entity-id.js';
import { ApiError } from './api-error.js';
import { appendSuccessfulAuditEvent } from './audit.js';
import { withAuthorizedCompanyTransaction } from './tenant-authorization.js';

interface PayrollPeriodRoutesOptions {
  database: Database;
  environment: Environment;
  prefix?: string;
}

interface PayrollPeriodRecord {
  code: string;
  companyId: string;
  endsOn: string;
  id: string;
  kind: string;
  paymentDate: string;
  startsOn: string;
  version: string;
}

const paramsSchema = z.object({ companyId: z.string().max(36) }).strict();
const listSchema = z
  .object({
    kind: z.enum(['regular', 'off_cycle']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
const createSchema = z
  .object({
    code: z.string().max(64),
    endsOn: z.string().max(10),
    kind: z.enum(['regular', 'off_cycle']).optional(),
    paymentDate: z.string().max(10),
    startsOn: z.string().max(10),
  })
  .strict();

export const payrollPeriodRoutes: FastifyPluginAsync<
  PayrollPeriodRoutesOptions
> = async (app, options) => {
  app.get('/companies/:companyId/payroll-periods', async (request, reply) => {
    const params = parseInput(paramsSchema, request.params);
    const query = parseInput(listSchema, request.query);
    const records = await withAuthorizedCompanyTransaction(
      options.database,
      {
        companyId: params.companyId,
        environment: options.environment,
        permission: 'payroll.read',
        request,
      },
      (transaction) => findPeriods(transaction, query.kind, query.limit),
    );
    await reply.header('cache-control', 'no-store').send({
      items: records.map(serializePayrollPeriodRecord),
      limit: query.limit,
    });
  });

  app.post('/companies/:companyId/payroll-periods', async (request, reply) => {
    const params = parseInput(paramsSchema, request.params);
    const companyId = parseEntityId(params.companyId, 'Company');
    const body = parseInput(createSchema, request.body);
    try {
      const period = await withAuthorizedCompanyTransaction(
        options.database,
        {
          companyId,
          environment: options.environment,
          permission: 'payroll.calculate',
          request,
          requireCsrf: true,
        },
        async (transaction, principal) => {
          const created = createPayrollPeriod({
            code: body.code,
            companyId,
            endsOn: body.endsOn,
            id: randomUUID(),
            paymentDate: body.paymentDate,
            startsOn: body.startsOn,
            ...(body.kind === undefined ? {} : { kind: body.kind }),
          });
          const current = (await findPeriods(transaction)).map(toDomain);
          assertPayrollPeriodSchedule(companyId, [...current, created]);
          await insertPeriod(transaction, created);
          await appendSuccessfulAuditEvent(transaction, principal, request.id, {
            eventType: 'payroll.period-created',
            targetId: created.id,
            targetType: 'payroll-period',
          });
          return created;
        },
      );
      await reply
        .status(201)
        .header('cache-control', 'no-store')
        .send(serializePayrollPeriod(period));
    } catch (error) {
      throw mapPayrollPeriodConflict(error);
    }
  });
};

function parseInput<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
): z.output<Schema> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, 'Request input is invalid');
  return parsed.data;
}

async function findPeriods(
  transaction: TenantTransaction,
  kind?: 'regular' | 'off_cycle',
  limit?: number,
): Promise<PayrollPeriodRecord[]> {
  return (
    await transaction.query<PayrollPeriodRecord>(
      `
        SELECT id, company_id AS "companyId", code, kind,
          starts_on::text AS "startsOn", ends_on::text AS "endsOn",
          payment_date::text AS "paymentDate", version::text AS version
        FROM app.payroll_periods
        WHERE company_id = app.current_company_id()
          AND ($1::text IS NULL OR kind = $1)
        ORDER BY starts_on DESC, payment_date DESC, id
        LIMIT $2
      `,
      [kind ?? null, limit ?? null],
    )
  ).rows;
}

async function insertPeriod(
  transaction: TenantTransaction,
  period: Readonly<PayrollPeriod>,
): Promise<void> {
  await transaction.query(
    `
      INSERT INTO app.payroll_periods
        (id, company_id, code, kind, starts_on, ends_on, payment_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      period.id,
      period.companyId,
      period.code,
      period.kind,
      period.period.startsOn,
      period.period.endsOn,
      period.paymentDate,
    ],
  );
}

function toDomain(record: PayrollPeriodRecord): Readonly<PayrollPeriod> {
  return createPayrollPeriod({
    code: record.code,
    companyId: record.companyId,
    endsOn: record.endsOn,
    id: record.id,
    kind: record.kind,
    paymentDate: record.paymentDate,
    startsOn: record.startsOn,
  });
}

function serializePayrollPeriodRecord(record: PayrollPeriodRecord) {
  return {
    code: record.code,
    endsOn: record.endsOn,
    id: record.id,
    kind: record.kind,
    paymentDate: record.paymentDate,
    startsOn: record.startsOn,
    version: Number(record.version),
  };
}

function serializePayrollPeriod(period: Readonly<PayrollPeriod>) {
  return {
    code: period.code,
    endsOn: period.period.endsOn,
    id: period.id,
    kind: period.kind,
    paymentDate: period.paymentDate,
    startsOn: period.period.startsOn,
    version: 1,
  };
}

function mapPayrollPeriodConflict(error: unknown): unknown {
  if (
    error instanceof DomainError &&
    error.code === 'INVALID_PAYROLL_PERIOD_SCHEDULE'
  ) {
    return new ApiError(409, error.message);
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === '23505' || error.code === '23P01')
  ) {
    return new ApiError(409, 'Payroll period conflicts with existing history');
  }
  return error;
}

import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import type { Environment } from '../config/environment.js';
import type {
  Database,
  TenantTransaction,
} from '../infrastructure/database.js';
import {
  createCompensationComponent,
  createSalary,
  endCompensationComponent,
  endSalary,
  type CompensationComponent,
  type Salary,
} from '../modules/compensation/domain/index.js';
import {
  createEmployee,
  createEmployment,
  type Employment,
} from '../modules/workforce/domain/index.js';
import {
  moneyFromMinorUnits,
  parseCurrencyCode,
  serializeMoney,
} from '../shared/domain/money.js';
import { parseEntityId } from '../shared/domain/entity-id.js';
import { DomainError } from '../shared/domain/domain-error.js';
import { ApiError } from './api-error.js';
import { appendSuccessfulAuditEvent } from './audit.js';
import { withAuthorizedCompanyTransaction } from './tenant-authorization.js';

interface CompensationRoutesOptions {
  database: Database;
  environment: Environment;
  prefix?: string;
}

interface EmploymentContextRecord {
  companyId: string;
  employeeFamilyName: string;
  employeeGivenName: string;
  employeeId: string;
  employeeMiddleName: string | null;
  employeeNumber: string;
  employeeStatus: string;
  endsOn: string | null;
  id: string;
  positionTitle: string;
  startsOn: string;
}

interface SalaryRecord {
  amountMinorUnits: string;
  currency: string;
  currencyScale: number;
  employmentId: string;
  endsOn: string | null;
  id: string;
  startsOn: string;
  version: string;
}

interface ComponentRecord extends SalaryRecord {
  code: string;
  kind: string;
  name: string;
}

const paramsSchema = z
  .object({ companyId: z.string().max(36), employmentId: z.string().max(36) })
  .strict();
const salaryParamsSchema = paramsSchema.extend({
  salaryId: z.string().max(36),
});
const componentParamsSchema = paramsSchema.extend({
  componentId: z.string().max(36),
});
const endSchema = z
  .object({
    endsOn: z.string().max(10),
    expectedVersion: z.number().int().positive(),
  })
  .strict();
const salarySchema = z
  .object({
    amount: z.string().max(40),
    endsOn: z.string().max(10).optional(),
    startsOn: z.string().max(10),
  })
  .strict();
const componentSchema = z
  .object({
    amount: z.string().max(40),
    code: z.string().max(64),
    endsOn: z.string().max(10).optional(),
    kind: z.enum(['allowance', 'deduction']),
    name: z.string().max(160),
    startsOn: z.string().max(10),
  })
  .strict();

export const compensationRoutes: FastifyPluginAsync<
  CompensationRoutesOptions
> = async (app, options) => {
  app.get(
    '/companies/:companyId/employments/:employmentId/compensation',
    async (request, reply) => {
      const params = parseInput(paramsSchema, request.params);
      const employmentId = parseEntityId(params.employmentId, 'Employment');
      const compensation = await withAuthorizedCompanyTransaction(
        options.database,
        {
          companyId: params.companyId,
          environment: options.environment,
          permission: 'compensation.read',
          request,
        },
        async (transaction) => {
          if ((await findEmployment(transaction, employmentId)) === undefined) {
            throw new ApiError(404, 'Employment was not found');
          }
          const [salaries, components] = await Promise.all([
            findSalaries(transaction, employmentId),
            findComponents(transaction, employmentId),
          ]);
          return { components, salaries };
        },
      );
      await reply.header('cache-control', 'no-store').send({
        components: compensation.components.map(serializeComponentRecord),
        salaries: compensation.salaries.map(serializeSalaryRecord),
      });
    },
  );

  app.post(
    '/companies/:companyId/employments/:employmentId/salaries',
    async (request, reply) => {
      const params = parseInput(paramsSchema, request.params);
      const employmentId = parseEntityId(params.employmentId, 'Employment');
      const body = parseInput(salarySchema, request.body);
      try {
        const salary = await withAuthorizedCompanyTransaction(
          options.database,
          {
            companyId: params.companyId,
            environment: options.environment,
            permission: 'compensation.write',
            request,
            requireCsrf: true,
          },
          async (transaction, principal) => {
            const employment = await requireEmployment(
              transaction,
              employmentId,
            );
            const created = createSalary(employment, {
              amount: body.amount,
              id: randomUUID(),
              startsOn: body.startsOn,
              ...(body.endsOn === undefined ? {} : { endsOn: body.endsOn }),
            });
            await insertSalary(transaction, created);
            await appendSuccessfulAuditEvent(
              transaction,
              principal,
              request.id,
              {
                eventType: 'compensation.salary-created',
                targetId: created.id,
                targetType: 'salary',
              },
            );
            return created;
          },
        );
        await reply
          .status(201)
          .header('cache-control', 'no-store')
          .send(serializeSalary(salary));
      } catch (error) {
        throw mapCompensationConflict(error);
      }
    },
  );

  app.post(
    '/companies/:companyId/employments/:employmentId/components',
    async (request, reply) => {
      const params = parseInput(paramsSchema, request.params);
      const employmentId = parseEntityId(params.employmentId, 'Employment');
      const body = parseInput(componentSchema, request.body);
      try {
        const component = await withAuthorizedCompanyTransaction(
          options.database,
          {
            companyId: params.companyId,
            environment: options.environment,
            permission: 'compensation.write',
            request,
            requireCsrf: true,
          },
          async (transaction, principal) => {
            const employment = await requireEmployment(
              transaction,
              employmentId,
            );
            const created = createCompensationComponent(employment, {
              amount: body.amount,
              code: body.code,
              id: randomUUID(),
              kind: body.kind,
              name: body.name,
              startsOn: body.startsOn,
              ...(body.endsOn === undefined ? {} : { endsOn: body.endsOn }),
            });
            await insertComponent(transaction, created);
            await appendSuccessfulAuditEvent(
              transaction,
              principal,
              request.id,
              {
                eventType: 'compensation.component-created',
                targetId: created.id,
                targetType: 'compensation-component',
              },
            );
            return created;
          },
        );
        await reply
          .status(201)
          .header('cache-control', 'no-store')
          .send(serializeComponent(component));
      } catch (error) {
        throw mapCompensationConflict(error);
      }
    },
  );

  app.patch(
    '/companies/:companyId/employments/:employmentId/salaries/:salaryId/end',
    async (request, reply) => {
      const params = parseInput(salaryParamsSchema, request.params);
      const employmentId = parseEntityId(params.employmentId, 'Employment');
      const salaryId = parseEntityId(params.salaryId, 'Salary');
      const body = parseInput(endSchema, request.body);
      try {
        const record = await withAuthorizedCompanyTransaction(
          options.database,
          {
            companyId: params.companyId,
            environment: options.environment,
            permission: 'compensation.write',
            request,
            requireCsrf: true,
          },
          async (transaction, principal) => {
            const employment = await requireEmployment(
              transaction,
              employmentId,
            );
            const stored = (await findSalaries(transaction, employmentId)).find(
              (salary) => salary.id === salaryId,
            );
            if (stored === undefined)
              throw new ApiError(404, 'Salary was not found');
            const current = createSalary(employment, {
              amount: serializeStoredMoney(stored).amount,
              id: stored.id,
              startsOn: stored.startsOn,
              ...(stored.endsOn === null ? {} : { endsOn: stored.endsOn }),
            });
            const ended = endSalary(employment, current, body.endsOn);
            const updated = await transaction.query<SalaryRecord>(
              `
                UPDATE app.salaries SET ends_on = $1, version = version + 1,
                  updated_at = statement_timestamp()
                WHERE company_id = app.current_company_id() AND employment_id = $2
                  AND id = $3 AND version = $4
                RETURNING id, employment_id AS "employmentId",
                  amount_minor_units::text AS "amountMinorUnits", currency,
                  currency_scale AS "currencyScale", starts_on::text AS "startsOn",
                  ends_on::text AS "endsOn", version::text AS version
              `,
              [
                ended.effectivePeriod.endsOn,
                employmentId,
                salaryId,
                body.expectedVersion,
              ],
            );
            const updatedRecord = updated.rows[0];
            if (updatedRecord === undefined)
              throw new ApiError(409, 'Salary was changed by another request');
            await appendSuccessfulAuditEvent(
              transaction,
              principal,
              request.id,
              {
                eventType: 'compensation.salary-ended',
                targetId: salaryId,
                targetType: 'salary',
              },
            );
            return updatedRecord;
          },
        );
        await reply
          .header('cache-control', 'no-store')
          .send(serializeSalaryRecord(record));
      } catch (error) {
        throw mapCompensationConflict(error);
      }
    },
  );

  app.patch(
    '/companies/:companyId/employments/:employmentId/components/:componentId/end',
    async (request, reply) => {
      const params = parseInput(componentParamsSchema, request.params);
      const employmentId = parseEntityId(params.employmentId, 'Employment');
      const componentId = parseEntityId(
        params.componentId,
        'CompensationComponent',
      );
      const body = parseInput(endSchema, request.body);
      try {
        const record = await withAuthorizedCompanyTransaction(
          options.database,
          {
            companyId: params.companyId,
            environment: options.environment,
            permission: 'compensation.write',
            request,
            requireCsrf: true,
          },
          async (transaction, principal) => {
            const employment = await requireEmployment(
              transaction,
              employmentId,
            );
            const stored = (
              await findComponents(transaction, employmentId)
            ).find((component) => component.id === componentId);
            if (stored === undefined)
              throw new ApiError(404, 'Compensation component was not found');
            const current = createCompensationComponent(employment, {
              amount: serializeStoredMoney(stored).amount,
              code: stored.code,
              id: stored.id,
              kind: stored.kind,
              name: stored.name,
              startsOn: stored.startsOn,
              ...(stored.endsOn === null ? {} : { endsOn: stored.endsOn }),
            });
            const ended = endCompensationComponent(
              employment,
              current,
              body.endsOn,
            );
            const updated = await transaction.query<ComponentRecord>(
              `
                UPDATE app.compensation_components SET ends_on = $1, version = version + 1,
                  updated_at = statement_timestamp()
                WHERE company_id = app.current_company_id() AND employment_id = $2
                  AND id = $3 AND version = $4
                RETURNING id, employment_id AS "employmentId", code, name, kind,
                  amount_minor_units::text AS "amountMinorUnits", currency,
                  currency_scale AS "currencyScale", starts_on::text AS "startsOn",
                  ends_on::text AS "endsOn", version::text AS version
              `,
              [
                ended.effectivePeriod.endsOn,
                employmentId,
                componentId,
                body.expectedVersion,
              ],
            );
            const updatedRecord = updated.rows[0];
            if (updatedRecord === undefined)
              throw new ApiError(
                409,
                'Compensation component was changed by another request',
              );
            await appendSuccessfulAuditEvent(
              transaction,
              principal,
              request.id,
              {
                eventType: 'compensation.component-ended',
                targetId: componentId,
                targetType: 'compensation-component',
              },
            );
            return updatedRecord;
          },
        );
        await reply
          .header('cache-control', 'no-store')
          .send(serializeComponentRecord(record));
      } catch (error) {
        throw mapCompensationConflict(error);
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

async function requireEmployment(
  transaction: TenantTransaction,
  id: string,
): Promise<Readonly<Employment>> {
  const record = await findEmployment(transaction, id);
  if (record === undefined) throw new ApiError(404, 'Employment was not found');
  const employee = createEmployee({
    companyId: record.companyId,
    employeeNumber: record.employeeNumber,
    familyName: record.employeeFamilyName,
    givenName: record.employeeGivenName,
    id: record.employeeId,
    ...(record.employeeMiddleName === null
      ? {}
      : { middleName: record.employeeMiddleName }),
    status: record.employeeStatus,
  });
  return createEmployment(employee, {
    id: record.id,
    positionTitle: record.positionTitle,
    startsOn: record.startsOn,
    ...(record.endsOn === null ? {} : { endsOn: record.endsOn }),
  });
}

async function findEmployment(transaction: TenantTransaction, id: string) {
  const result = await transaction.query<EmploymentContextRecord>(
    `
    SELECT employment.id, employment.company_id AS "companyId",
      employment.position_title AS "positionTitle", employment.starts_on::text AS "startsOn",
      employment.ends_on::text AS "endsOn", employee.id AS "employeeId",
      employee.employee_number AS "employeeNumber", employee.given_name AS "employeeGivenName",
      employee.middle_name AS "employeeMiddleName", employee.family_name AS "employeeFamilyName",
      employee.status AS "employeeStatus"
    FROM app.employments AS employment
    JOIN app.employees AS employee ON employee.company_id = employment.company_id AND employee.id = employment.employee_id
    WHERE employment.company_id = app.current_company_id() AND employment.id = $1
  `,
    [id],
  );
  return result.rows[0];
}

async function findSalaries(
  transaction: TenantTransaction,
  employmentId: string,
) {
  return (
    await transaction.query<SalaryRecord>(
      `
    SELECT id, employment_id AS "employmentId", amount_minor_units::text AS "amountMinorUnits",
      currency, currency_scale AS "currencyScale", starts_on::text AS "startsOn",
      ends_on::text AS "endsOn", version::text AS version
    FROM app.salaries WHERE company_id = app.current_company_id() AND employment_id = $1
    ORDER BY starts_on DESC, id
  `,
      [employmentId],
    )
  ).rows;
}

async function findComponents(
  transaction: TenantTransaction,
  employmentId: string,
) {
  return (
    await transaction.query<ComponentRecord>(
      `
    SELECT id, employment_id AS "employmentId", code, name, kind,
      amount_minor_units::text AS "amountMinorUnits", currency,
      currency_scale AS "currencyScale", starts_on::text AS "startsOn",
      ends_on::text AS "endsOn", version::text AS version
    FROM app.compensation_components
    WHERE company_id = app.current_company_id() AND employment_id = $1
    ORDER BY kind, code, starts_on DESC, id
  `,
      [employmentId],
    )
  ).rows;
}

async function insertSalary(
  transaction: TenantTransaction,
  salary: Readonly<Salary>,
) {
  await transaction.query(
    `INSERT INTO app.salaries
    (id, company_id, employment_id, basis, amount_minor_units, currency, currency_scale, starts_on, ends_on)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      salary.id,
      salary.companyId,
      salary.employmentId,
      salary.basis,
      salary.amount.minorUnits.toString(),
      salary.amount.currency,
      salary.amount.scale,
      salary.effectivePeriod.startsOn,
      salary.effectivePeriod.endsOn ?? null,
    ],
  );
}

async function insertComponent(
  transaction: TenantTransaction,
  component: Readonly<CompensationComponent>,
) {
  await transaction.query(
    `INSERT INTO app.compensation_components
    (id, company_id, employment_id, code, name, kind, basis, amount_minor_units, currency, currency_scale, starts_on, ends_on)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      component.id,
      component.companyId,
      component.employmentId,
      component.code,
      component.name,
      component.kind,
      component.basis,
      component.amount.minorUnits.toString(),
      component.amount.currency,
      component.amount.scale,
      component.effectivePeriod.startsOn,
      component.effectivePeriod.endsOn ?? null,
    ],
  );
}

function serializeStoredMoney(record: SalaryRecord) {
  return serializeMoney(
    moneyFromMinorUnits(
      BigInt(record.amountMinorUnits),
      parseCurrencyCode(record.currency),
      record.currencyScale,
    ),
  );
}
function serializeSalaryRecord(record: SalaryRecord) {
  return {
    amount: serializeStoredMoney(record),
    basis: 'monthly',
    employmentId: record.employmentId,
    endsOn: record.endsOn,
    id: record.id,
    startsOn: record.startsOn,
    version: Number(record.version),
  };
}
function serializeComponentRecord(record: ComponentRecord) {
  return {
    ...serializeSalaryRecord(record),
    basis: 'fixed_per_period',
    code: record.code,
    kind: record.kind,
    name: record.name,
  };
}
function serializeSalary(salary: Readonly<Salary>) {
  return {
    amount: serializeMoney(salary.amount),
    basis: salary.basis,
    employmentId: salary.employmentId,
    endsOn: salary.effectivePeriod.endsOn ?? null,
    id: salary.id,
    startsOn: salary.effectivePeriod.startsOn,
    version: 1,
  };
}
function serializeComponent(component: Readonly<CompensationComponent>) {
  return {
    amount: serializeMoney(component.amount),
    basis: component.basis,
    code: component.code,
    employmentId: component.employmentId,
    endsOn: component.effectivePeriod.endsOn ?? null,
    id: component.id,
    kind: component.kind,
    name: component.name,
    startsOn: component.effectivePeriod.startsOn,
    version: 1,
  };
}
function mapCompensationConflict(error: unknown): unknown {
  if (
    error instanceof DomainError &&
    error.code === 'COMPENSATION_ALREADY_ENDED'
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
      'Compensation period conflicts with existing history',
    );
  }
  return error;
}

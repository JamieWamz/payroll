import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import type { Environment } from '../config/environment.js';
import type {
  Database,
  TenantTransaction,
} from '../infrastructure/database.js';
import { normalizeCompanyName } from '../modules/companies/domain/index.js';
import {
  archiveEmployee,
  assertEmploymentHistory,
  createEmployee,
  createEmployment,
  endEmployment,
  type Employee,
  type Employment,
} from '../modules/workforce/domain/index.js';
import { parseEntityId } from '../shared/domain/entity-id.js';
import { ApiError } from './api-error.js';
import { appendSuccessfulAuditEvent } from './audit.js';
import { withAuthorizedCompanyTransaction } from './tenant-authorization.js';

interface CompanyWorkforceRoutesOptions {
  database: Database;
  environment: Environment;
  prefix?: string;
}

interface CompanyRecord {
  code: string;
  id: string;
  name: string;
  status: string;
  updatedAt: Date;
  version: string;
}

interface EmployeeRecord {
  companyId: string;
  employeeNumber: string;
  familyName: string;
  givenName: string;
  id: string;
  middleName: string | null;
  status: string;
  updatedAt: Date;
  version: string;
}

interface EmploymentRecord {
  companyId: string;
  employeeId: string;
  endsOn: string | null;
  id: string;
  positionTitle: string;
  startsOn: string;
  updatedAt: Date;
  version: string;
}

const companyParamsSchema = z
  .object({ companyId: z.string().max(36) })
  .strict();
const employeeParamsSchema = z
  .object({ companyId: z.string().max(36), employeeId: z.string().max(36) })
  .strict();
const employmentParamsSchema = z
  .object({
    companyId: z.string().max(36),
    employeeId: z.string().max(36),
    employmentId: z.string().max(36),
  })
  .strict();
const companyUpdateSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    name: z.string().max(320),
  })
  .strict();
const employeeListSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    status: z.enum(['active', 'archived']).optional(),
    search: z.string().trim().max(160).default(''),
    offset: z.coerce.number().int().min(0).max(1000000).default(0),
    sort: z.enum(['name', 'number']).default('name'),
  })
  .strict();
const employmentSchema = z
  .object({
    endsOn: z.string().max(10).optional(),
    positionTitle: z.string().max(240),
    startsOn: z.string().max(10),
  })
  .strict();
const employeeCreateSchema = z
  .object({
    employeeNumber: z.string().max(128),
    employment: employmentSchema.optional(),
    familyName: z.string().max(160),
    givenName: z.string().max(160),
    middleName: z.string().max(160).optional(),
  })
  .strict();
const employeeUpdateSchema = z
  .object({
    employeeNumber: z.string().max(128).optional(),
    expectedVersion: z.number().int().positive(),
    familyName: z.string().max(160).optional(),
    givenName: z.string().max(160).optional(),
    middleName: z.string().max(160).nullable().optional(),
    status: z.enum(['active', 'archived']).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.employeeNumber !== undefined ||
      value.familyName !== undefined ||
      value.givenName !== undefined ||
      value.middleName !== undefined ||
      value.status !== undefined,
  );
const employmentEndSchema = z
  .object({
    endsOn: z.string().max(10),
    expectedVersion: z.number().int().positive(),
  })
  .strict();

export const companyWorkforceRoutes: FastifyPluginAsync<
  CompanyWorkforceRoutesOptions
> = async (app, options) => {
  app.get('/companies/:companyId', async (request, reply) => {
    const params = parseInput(companyParamsSchema, request.params);
    const company = await withAuthorizedCompanyTransaction(
      options.database,
      {
        companyId: params.companyId,
        environment: options.environment,
        permission: 'company.read',
        request,
      },
      async (transaction) => findCompany(transaction),
    );
    if (company === undefined) {
      throw new ApiError(404, 'Company was not found');
    }
    await reply
      .header('cache-control', 'no-store')
      .send(serializeCompany(company));
  });

  app.patch('/companies/:companyId', async (request, reply) => {
    const params = parseInput(companyParamsSchema, request.params);
    const body = parseInput(companyUpdateSchema, request.body);
    const normalizedName = normalizeCompanyName(body.name);
    const company = await withAuthorizedCompanyTransaction(
      options.database,
      {
        companyId: params.companyId,
        environment: options.environment,
        permission: 'company.update',
        request,
        requireCsrf: true,
      },
      async (transaction, principal) => {
        const updated = await transaction.query<CompanyRecord>(
          `
            UPDATE app.companies
            SET name = $1,
                version = version + 1,
                updated_at = statement_timestamp()
            WHERE id = app.current_company_id()
              AND version = $2
            RETURNING
              id,
              code,
              name,
              status,
              version::text AS version,
              updated_at AS "updatedAt"
          `,
          [normalizedName, body.expectedVersion],
        );
        const companyRecord = updated.rows[0];
        if (companyRecord === undefined) {
          throw new ApiError(409, 'Company was changed by another request');
        }
        await appendSuccessfulAuditEvent(transaction, principal, request.id, {
          eventType: 'company.profile-updated',
          targetId: companyRecord.id,
          targetType: 'company',
        });
        return companyRecord;
      },
    );
    await reply
      .header('cache-control', 'no-store')
      .send(serializeCompany(company));
  });

  app.get('/companies/:companyId/employees', async (request, reply) => {
    const params = parseInput(companyParamsSchema, request.params);
    const query = parseInput(employeeListSchema, request.query);
    const employees = await withAuthorizedCompanyTransaction(
      options.database,
      {
        companyId: params.companyId,
        environment: options.environment,
        permission: 'workforce.read',
        request,
      },
      async (transaction) => {
        const result = await transaction.query<EmployeeRecord>(
          `
            SELECT
              id,
              company_id AS "companyId",
              employee_number AS "employeeNumber",
              given_name AS "givenName",
              middle_name AS "middleName",
              family_name AS "familyName",
              status,
              version::text AS version,
              updated_at AS "updatedAt"
            FROM app.employees
            WHERE company_id = app.current_company_id()
              AND ($1::text IS NULL OR status = $1)
              AND ($3 = '' OR position(lower($3) in lower(employee_number || ' ' || given_name || ' ' || family_name)) > 0)
            ORDER BY CASE WHEN $5 = 'number' THEN employee_number ELSE family_name END, given_name, employee_number, id
            LIMIT $2 OFFSET $4
          `,
          [
            query.status ?? null,
            query.limit,
            query.search,
            query.offset,
            query.sort,
          ],
        );
        return result.rows;
      },
    );
    await reply.header('cache-control', 'no-store').send({
      items: employees.map(serializeEmployee),
      limit: query.limit,
    });
  });

  app.post('/companies/:companyId/employees', async (request, reply) => {
    const params = parseInput(companyParamsSchema, request.params);
    const body = parseInput(employeeCreateSchema, request.body);
    const employee = createEmployee({
      companyId: params.companyId,
      employeeNumber: body.employeeNumber,
      familyName: body.familyName,
      givenName: body.givenName,
      id: randomUUID(),
      ...(body.middleName === undefined ? {} : { middleName: body.middleName }),
    });
    const employment =
      body.employment === undefined
        ? undefined
        : createEmployment(employee, {
            id: randomUUID(),
            positionTitle: body.employment.positionTitle,
            startsOn: body.employment.startsOn,
            ...(body.employment.endsOn === undefined
              ? {}
              : { endsOn: body.employment.endsOn }),
          });

    try {
      await withAuthorizedCompanyTransaction(
        options.database,
        {
          companyId: params.companyId,
          environment: options.environment,
          permission: 'workforce.write',
          request,
          requireCsrf: true,
        },
        async (transaction, principal) => {
          await insertEmployee(transaction, employee);
          if (employment !== undefined) {
            await insertEmployment(transaction, employment);
          }
          await appendSuccessfulAuditEvent(transaction, principal, request.id, {
            eventType: 'workforce.employee-created',
            targetId: employee.id,
            targetType: 'employee',
          });
        },
      );
    } catch (error) {
      if (isPostgresError(error, '23505')) {
        throw new ApiError(409, 'Employee or employment already exists');
      }
      throw error;
    }

    await reply
      .status(201)
      .header('cache-control', 'no-store')
      .send({
        ...serializeEmployeeDomain(employee),
        employment:
          employment === undefined
            ? null
            : serializeEmploymentDomain(employment),
      });
  });

  app.get(
    '/companies/:companyId/employees/:employeeId',
    async (request, reply) => {
      const params = parseInput(employeeParamsSchema, request.params);
      const employeeId = parseEntityId(params.employeeId, 'Employee');
      const result = await withAuthorizedCompanyTransaction(
        options.database,
        {
          companyId: params.companyId,
          environment: options.environment,
          permission: 'workforce.read',
          request,
        },
        async (transaction) => {
          const employee = await findEmployee(transaction, employeeId);
          if (employee === undefined) {
            return undefined;
          }
          const employments = await findEmployments(transaction, employee.id);
          return { employee, employments };
        },
      );
      if (result === undefined) {
        throw new ApiError(404, 'Employee was not found');
      }
      await reply.header('cache-control', 'no-store').send({
        ...serializeEmployee(result.employee),
        employments: result.employments.map(serializeEmployment),
      });
    },
  );

  app.patch(
    '/companies/:companyId/employees/:employeeId',
    async (request, reply) => {
      const params = parseInput(employeeParamsSchema, request.params);
      const employeeId = parseEntityId(params.employeeId, 'Employee');
      const body = parseInput(employeeUpdateSchema, request.body);

      try {
        const updated = await withAuthorizedCompanyTransaction(
          options.database,
          {
            companyId: params.companyId,
            environment: options.environment,
            permission: 'workforce.write',
            request,
            requireCsrf: true,
          },
          async (transaction, principal) => {
            const record = await findEmployee(transaction, employeeId);
            if (record === undefined) {
              throw new ApiError(404, 'Employee was not found');
            }
            if (record.status === 'archived' && body.status === 'active') {
              throw new ApiError(
                409,
                'Archived employees cannot be reactivated implicitly',
              );
            }

            let employee = createEmployee({
              companyId: record.companyId,
              employeeNumber: body.employeeNumber ?? record.employeeNumber,
              familyName: body.familyName ?? record.familyName,
              givenName: body.givenName ?? record.givenName,
              id: record.id,
              ...(body.middleName === undefined
                ? record.middleName === null
                  ? {}
                  : { middleName: record.middleName }
                : body.middleName === null
                  ? {}
                  : { middleName: body.middleName }),
              status: record.status,
            });
            if (record.status === 'active' && body.status === 'archived') {
              const history = (
                await findEmployments(transaction, employee.id)
              ).map((employment) => toEmploymentDomain(employment, employee));
              employee = archiveEmployee(employee, history);
            }

            const result = await transaction.query<EmployeeRecord>(
              `
                UPDATE app.employees
                SET employee_number = $1,
                    given_name = $2,
                    middle_name = $3,
                    family_name = $4,
                    status = $5,
                    version = version + 1,
                    updated_at = statement_timestamp()
                WHERE company_id = app.current_company_id()
                  AND id = $6
                  AND version = $7
                RETURNING
                  id,
                  company_id AS "companyId",
                  employee_number AS "employeeNumber",
                  given_name AS "givenName",
                  middle_name AS "middleName",
                  family_name AS "familyName",
                  status,
                  version::text AS version,
                  updated_at AS "updatedAt"
              `,
              [
                employee.employeeNumber,
                employee.name.givenName,
                employee.name.middleName ?? null,
                employee.name.familyName,
                employee.status,
                employee.id,
                body.expectedVersion,
              ],
            );
            const updatedRecord = result.rows[0];
            if (updatedRecord === undefined) {
              throw new ApiError(
                409,
                'Employee was changed by another request',
              );
            }
            await appendSuccessfulAuditEvent(
              transaction,
              principal,
              request.id,
              {
                eventType: 'workforce.employee-updated',
                targetId: updatedRecord.id,
                targetType: 'employee',
              },
            );
            return updatedRecord;
          },
        );
        await reply
          .header('cache-control', 'no-store')
          .send(serializeEmployee(updated));
      } catch (error) {
        if (isPostgresError(error, '23505')) {
          throw new ApiError(409, 'Employee number already exists');
        }
        throw error;
      }
    },
  );

  app.post(
    '/companies/:companyId/employees/:employeeId/employments',
    async (request, reply) => {
      const params = parseInput(employeeParamsSchema, request.params);
      const employeeId = parseEntityId(params.employeeId, 'Employee');
      const body = parseInput(employmentSchema, request.body);

      try {
        const created = await withAuthorizedCompanyTransaction(
          options.database,
          {
            companyId: params.companyId,
            environment: options.environment,
            permission: 'workforce.write',
            request,
            requireCsrf: true,
          },
          async (transaction, principal) => {
            const employeeRecord = await findEmployee(transaction, employeeId);
            if (employeeRecord === undefined) {
              throw new ApiError(404, 'Employee was not found');
            }
            const employee = toEmployeeDomain(employeeRecord);
            const employment = createEmployment(employee, {
              id: randomUUID(),
              positionTitle: body.positionTitle,
              startsOn: body.startsOn,
              ...(body.endsOn === undefined ? {} : { endsOn: body.endsOn }),
            });
            const existing = (
              await findEmployments(transaction, employeeRecord.id)
            ).map((record) => toEmploymentDomain(record, employee));
            assertEmploymentHistory(employee, [...existing, employment]);
            await insertEmployment(transaction, employment);
            await appendSuccessfulAuditEvent(
              transaction,
              principal,
              request.id,
              {
                eventType: 'workforce.employment-created',
                targetId: employment.id,
                targetType: 'employment',
              },
            );
            return employment;
          },
        );
        await reply
          .status(201)
          .header('cache-control', 'no-store')
          .send(serializeEmploymentDomain(created));
      } catch (error) {
        if (isPostgresError(error, '23505')) {
          throw new ApiError(409, 'Employment conflicts with existing history');
        }
        throw error;
      }
    },
  );

  app.patch(
    '/companies/:companyId/employees/:employeeId/employments/:employmentId',
    async (request, reply) => {
      const params = parseInput(employmentParamsSchema, request.params);
      const employeeId = parseEntityId(params.employeeId, 'Employee');
      const employmentId = parseEntityId(params.employmentId, 'Employment');
      const body = parseInput(employmentEndSchema, request.body);

      try {
        const updated = await withAuthorizedCompanyTransaction(
          options.database,
          {
            companyId: params.companyId,
            environment: options.environment,
            permission: 'workforce.write',
            request,
            requireCsrf: true,
          },
          async (transaction, principal) => {
            const employeeRecord = await findEmployee(transaction, employeeId);
            if (employeeRecord === undefined) {
              throw new ApiError(404, 'Employee was not found');
            }
            const record = await findEmployment(
              transaction,
              employeeId,
              employmentId,
            );
            if (record === undefined) {
              throw new ApiError(404, 'Employment was not found');
            }
            const employee = toEmployeeDomain(employeeRecord);
            const employment = endEmployment(
              toEmploymentDomain(record, employee),
              body.endsOn,
            );
            const result = await transaction.query<EmploymentRecord>(
              `
                UPDATE app.employments
                SET ends_on = $1,
                    version = version + 1,
                    updated_at = statement_timestamp()
                WHERE company_id = app.current_company_id()
                  AND employee_id = $2
                  AND id = $3
                  AND version = $4
                RETURNING
                  id,
                  company_id AS "companyId",
                  employee_id AS "employeeId",
                  position_title AS "positionTitle",
                  starts_on::text AS "startsOn",
                  ends_on::text AS "endsOn",
                  version::text AS version,
                  updated_at AS "updatedAt"
              `,
              [
                employment.effectivePeriod.endsOn,
                employeeId,
                employmentId,
                body.expectedVersion,
              ],
            );
            const updatedRecord = result.rows[0];
            if (updatedRecord === undefined) {
              throw new ApiError(
                409,
                'Employment was changed by another request',
              );
            }
            await appendSuccessfulAuditEvent(
              transaction,
              principal,
              request.id,
              {
                eventType: 'workforce.employment-ended',
                targetId: updatedRecord.id,
                targetType: 'employment',
              },
            );
            return updatedRecord;
          },
        );
        await reply
          .header('cache-control', 'no-store')
          .send(serializeEmployment(updated));
      } catch (error) {
        if (isPostgresError(error, '23514')) {
          throw new ApiError(
            409,
            'Employment end conflicts with compensation history',
          );
        }
        throw error;
      }
    },
  );
};

function parseInput<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
): z.output<Schema> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(400, 'Request input is invalid');
  }
  return parsed.data;
}

async function findCompany(
  transaction: TenantTransaction,
): Promise<CompanyRecord | undefined> {
  const result = await transaction.query<CompanyRecord>(`
    SELECT
      id,
      code,
      name,
      status,
      version::text AS version,
      updated_at AS "updatedAt"
    FROM app.companies
    WHERE id = app.current_company_id()
  `);
  return result.rows[0];
}

async function findEmployee(
  transaction: TenantTransaction,
  employeeId: string,
): Promise<EmployeeRecord | undefined> {
  const result = await transaction.query<EmployeeRecord>(
    `
      SELECT
        id,
        company_id AS "companyId",
        employee_number AS "employeeNumber",
        given_name AS "givenName",
        middle_name AS "middleName",
        family_name AS "familyName",
        status,
        version::text AS version,
        updated_at AS "updatedAt"
      FROM app.employees
      WHERE company_id = app.current_company_id()
        AND id = $1
    `,
    [employeeId],
  );
  return result.rows[0];
}

async function findEmployments(
  transaction: TenantTransaction,
  employeeId: string,
): Promise<readonly EmploymentRecord[]> {
  const result = await transaction.query<EmploymentRecord>(
    `
      SELECT
        id,
        company_id AS "companyId",
        employee_id AS "employeeId",
        position_title AS "positionTitle",
        starts_on::text AS "startsOn",
        ends_on::text AS "endsOn",
        version::text AS version,
        updated_at AS "updatedAt"
      FROM app.employments
      WHERE company_id = app.current_company_id()
        AND employee_id = $1
      ORDER BY starts_on DESC, id
    `,
    [employeeId],
  );
  return result.rows;
}

async function findEmployment(
  transaction: TenantTransaction,
  employeeId: string,
  employmentId: string,
): Promise<EmploymentRecord | undefined> {
  const records = await findEmployments(transaction, employeeId);
  return records.find((record) => record.id === employmentId);
}

async function insertEmployee(
  transaction: TenantTransaction,
  employee: Readonly<Employee>,
): Promise<void> {
  await transaction.query(
    `
      INSERT INTO app.employees (
        id,
        company_id,
        employee_number,
        given_name,
        middle_name,
        family_name,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      employee.id,
      employee.companyId,
      employee.employeeNumber,
      employee.name.givenName,
      employee.name.middleName ?? null,
      employee.name.familyName,
      employee.status,
    ],
  );
}

async function insertEmployment(
  transaction: TenantTransaction,
  employment: Readonly<Employment>,
): Promise<void> {
  await transaction.query(
    `
      INSERT INTO app.employments (
        id,
        company_id,
        employee_id,
        position_title,
        starts_on,
        ends_on
      ) VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [
      employment.id,
      employment.companyId,
      employment.employeeId,
      employment.positionTitle,
      employment.effectivePeriod.startsOn,
      employment.effectivePeriod.endsOn ?? null,
    ],
  );
}

function toEmployeeDomain(record: EmployeeRecord): Readonly<Employee> {
  return createEmployee({
    companyId: record.companyId,
    employeeNumber: record.employeeNumber,
    familyName: record.familyName,
    givenName: record.givenName,
    id: record.id,
    ...(record.middleName === null ? {} : { middleName: record.middleName }),
    status: record.status,
  });
}

function toEmploymentDomain(
  record: EmploymentRecord,
  employee: Readonly<Employee>,
): Readonly<Employment> {
  return createEmployment(employee, {
    id: record.id,
    positionTitle: record.positionTitle,
    startsOn: record.startsOn,
    ...(record.endsOn === null ? {} : { endsOn: record.endsOn }),
  });
}

function serializeCompany(record: CompanyRecord) {
  return {
    code: record.code,
    id: record.id,
    name: record.name,
    status: record.status,
    updatedAt: record.updatedAt.toISOString(),
    version: Number(record.version),
  };
}

function serializeEmployee(record: EmployeeRecord) {
  return {
    employeeNumber: record.employeeNumber,
    familyName: record.familyName,
    givenName: record.givenName,
    id: record.id,
    middleName: record.middleName,
    status: record.status,
    updatedAt: record.updatedAt.toISOString(),
    version: Number(record.version),
  };
}

function serializeEmployment(record: EmploymentRecord) {
  return {
    employeeId: record.employeeId,
    endsOn: record.endsOn,
    id: record.id,
    positionTitle: record.positionTitle,
    startsOn: record.startsOn,
    updatedAt: record.updatedAt.toISOString(),
    version: Number(record.version),
  };
}

function serializeEmployeeDomain(employee: Readonly<Employee>) {
  return {
    employeeNumber: employee.employeeNumber,
    familyName: employee.name.familyName,
    givenName: employee.name.givenName,
    id: employee.id,
    middleName: employee.name.middleName ?? null,
    status: employee.status,
  };
}

function serializeEmploymentDomain(employment: Readonly<Employment>) {
  return {
    employeeId: employment.employeeId,
    endsOn: employment.effectivePeriod.endsOn ?? null,
    id: employment.id,
    positionTitle: employment.positionTitle,
    startsOn: employment.effectivePeriod.startsOn,
  };
}

function isPostgresError(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Database } from '../infrastructure/database.js';
import type { Environment } from '../config/environment.js';
import { parseLocalDate } from '../shared/domain/local-date.js';
import { ApiError } from './api-error.js';
import { withAuthorizedCompanyTransaction } from './tenant-authorization.js';
import { appendSuccessfulAuditEvent } from './audit.js';

const text = z
  .string()
  .trim()
  .max(160)
  .regex(/^[^\p{Cc}]*$/u);
const tpin = z
  .union([
    z.literal(''),
    z.string().regex(/^\d{10}$/, 'TPIN must contain 10 digits'),
  ])
  .default('');
const amount = z.string().regex(/^(0|[1-9]\d{0,12})(\.\d{1,2})?$/);
export const employeePayrollDetailsSchema = z
  .object({
    tpin,
    napsaNumber: text.default(''),
    nhimaNumber: text.default(''),
    nrc: text.default(''),
    email: z.union([z.email(), z.literal('')]).default(''),
    bankName: text.default(''),
    accountName: text.default(''),
    accountNumber: text.default(''),
    branchCode: text.default(''),
    bankCode: text.default(''),
    openingAsOf: z.string().max(10).default(''),
    openingTaxableIncome: amount.default('0.00'),
    openingPaye: amount.default('0.00'),
  })
  .strict();
export type EmployeePayrollDetails = z.infer<
  typeof employeePayrollDetailsSchema
>;
const companySchema = z
  .object({
    tpin,
    napsaNumber: text.default(''),
    nhimaNumber: text.default(''),
    address: z.string().trim().max(500).default(''),
    contactEmail: z.union([z.email(), z.literal('')]).default(''),
  })
  .strict();
export const payrollDetailsRoutes: FastifyPluginAsync<{
  database: Database;
  environment: Environment;
}> = async (app, options) => {
  for (const employee of [true, false]) {
    const path = employee
      ? '/companies/:companyId/employees/:employeeId/payroll-details'
      : '/companies/:companyId/payroll-settings';
    const paramsSchema = employee
      ? z.object({ companyId: z.uuid(), employeeId: z.uuid() })
      : z.object({ companyId: z.uuid() });
    const table = employee
      ? 'app.employee_payroll_details'
      : 'app.company_payroll_settings';
    const schema = employee ? employeePayrollDetailsSchema : companySchema;
    for (const method of ['GET', 'PUT'] as const) {
      app.route({
        method,
        url: path,
        handler: async (request, reply) => {
          const params = paramsSchema.safeParse(request.params);
          if (!params.success)
            throw new ApiError(400, 'Invalid company or employee identifier');
          const companyId = params.data.companyId;
          const employeeId =
            'employeeId' in params.data
              ? String(params.data.employeeId)
              : undefined;
          const write = method === 'PUT';
          const body = write
            ? z
                .object({
                  expectedVersion: z.number().int().nonnegative(),
                  details: schema,
                })
                .strict()
                .safeParse(request.body)
            : undefined;
          if (body && !body.success)
            throw new ApiError(
              400,
              body.error.issues
                .map((i) => `${i.path.join('.')}: ${i.message}`)
                .join('; '),
            );
          const result = await withAuthorizedCompanyTransaction(
            options.database,
            {
              companyId,
              environment: options.environment,
              request,
              requireCsrf: write,
              permission: employee
                ? write
                  ? 'compensation.write'
                  : 'compensation.read'
                : write
                  ? 'company.update'
                  : 'company.read',
            },
            async (tx, principal) => {
              if (employeeId) {
                const exists = await tx.query(
                  'SELECT id FROM app.employees WHERE company_id = app.current_company_id() AND id = $1',
                  [employeeId],
                );
                if (!exists.rows.length)
                  throw new ApiError(404, 'Employee was not found');
              }
              const values = employeeId ? [companyId, employeeId] : [companyId];
              const where = employeeId
                ? 'company_id = $1 AND employee_id = $2'
                : 'company_id = $1';
              await tx.query(
                'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
                [`${companyId}:${employeeId ?? 'company'}:details`],
              );
              const existing = (
                await tx.query<{
                  details: Record<string, unknown>;
                  version: number;
                }>(
                  `SELECT details, version FROM ${table} WHERE ${where}`,
                  values,
                )
              ).rows[0];
              if (!body?.success)
                return existing ?? { details: schema.parse({}), version: 0 };
              if ((existing?.version ?? 0) !== body.data.expectedVersion)
                throw new ApiError(
                  409,
                  'These details changed. Reload before saving.',
                );
              if (
                'openingAsOf' in body.data.details &&
                body.data.details.openingAsOf
              )
                parseLocalDate(String(body.data.details.openingAsOf));
              const json = JSON.stringify(body.data.details);
              if (existing)
                await tx.query(
                  `UPDATE ${table} SET details = $${values.length + 1}::jsonb, version = version + 1 WHERE ${where}`,
                  [...values, json],
                );
              else
                await tx.query(
                  `INSERT INTO ${table} (company_id, ${employeeId ? 'employee_id, ' : ''}details) VALUES (${values.map((_, i) => `$${i + 1}`).join(', ')}, $${values.length + 1}::jsonb)`,
                  [...values, json],
                );
              await appendSuccessfulAuditEvent(tx, principal, request.id, {
                eventType: 'payroll.details-updated',
                targetType: employee ? 'employee' : 'company',
                targetId: employeeId ?? companyId,
              });
              return {
                details: body.data.details,
                version: (existing?.version ?? 0) + 1,
              };
            },
          );
          return reply.header('cache-control', 'no-store').send(result);
        },
      });
    }
  }
};

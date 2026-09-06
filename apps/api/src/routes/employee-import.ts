import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Database } from '../infrastructure/database.js';
import type { Environment } from '../config/environment.js';
import { formatMoney } from '../shared/domain/money.js';
import { requirePermission } from '../modules/identity-access/security/index.js';
import {
  employeeImportColumns,
  prepareEmployeeImport,
} from '../modules/workforce/application/employee-import.js';
import { withAuthorizedCompanyTransaction } from './tenant-authorization.js';
import { insertEmployee, insertEmployment } from './company-workforce.js';
import { insertSalary } from './compensation.js';
import { appendSuccessfulAuditEvent } from './audit.js';
import { parse } from './payroll-runs.js';
import { ApiError } from './api-error.js';
export const employeeImportRoutes: FastifyPluginAsync<{
  database: Database;
  environment: Environment;
}> = async (app, options) => {
  app.get(
    '/companies/:companyId/employee-import/template',
    async (request, reply) => {
      const { companyId } = parse(
        z.object({ companyId: z.uuid() }),
        request.params,
      );
      await withAuthorizedCompanyTransaction(
        options.database,
        {
          companyId,
          environment: options.environment,
          request,
          permission: 'workforce.read',
        },
        async () => undefined,
      );
      return reply
        .header('cache-control', 'no-store')
        .header(
          'content-disposition',
          'attachment; filename="employee-import-template.csv"',
        )
        .type('text/csv; charset=utf-8')
        .send(employeeImportColumns.join(',') + '\r\n');
    },
  );
  app.post('/companies/:companyId/employee-import', async (request, reply) => {
    const { companyId } = parse(
      z.object({ companyId: z.uuid() }),
      request.params,
    );
    const body = parse(
      z
        .object({
          csv: z.string().min(1).max(500000),
          mode: z.enum(['preview', 'commit']),
          reviewDigest: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .optional(),
        })
        .strict(),
      request.body,
    );
    const result = await withAuthorizedCompanyTransaction(
      options.database,
      {
        companyId,
        environment: options.environment,
        request,
        permission: 'workforce.write',
        requireCsrf: true,
      },
      async (tx, principal) => {
        try {
          requirePermission(principal, 'compensation.write');
        } catch {
          throw new ApiError(
            403,
            'Compensation access is required to import salaries.',
          );
        }
        const prepared = prepareEmployeeImport(companyId, body.csv);
        const existing = (
          await tx.query<{ employeeNumber: string }>(
            'SELECT employee_number AS "employeeNumber" FROM app.employees WHERE company_id=app.current_company_id() AND employee_number=ANY($1::text[])',
            [prepared.entries.map((e) => e.employee.employeeNumber)],
          )
        ).rows;
        const numbers = new Set(existing.map((e) => e.employeeNumber));
        for (const entry of prepared.entries)
          if (numbers.has(entry.employee.employeeNumber))
            prepared.errors.push({
              row: entry.rowNumber,
              message:
                'Employee number already exists in this company. Existing employees are never overwritten by an import.',
            });
        if (body.mode === 'commit') {
          if (!body.reviewDigest || body.reviewDigest !== prepared.digest)
            throw new ApiError(
              409,
              'The file has changed. Preview it again before importing.',
            );
          if (prepared.errors.length)
            throw new ApiError(
              409,
              'Import validation failed. Preview again and fix all row errors. No employees were created.',
            );
          for (const entry of prepared.entries) {
            await insertEmployee(tx, entry.employee);
            await insertEmployment(tx, entry.employment);
            await insertSalary(tx, entry.salary);
            await tx.query(
              'INSERT INTO app.employee_payroll_details (company_id,employee_id,details) VALUES (app.current_company_id(),$1,$2::jsonb)',
              [entry.employee.id, JSON.stringify(entry.details)],
            );
            await appendSuccessfulAuditEvent(tx, principal, request.id, {
              eventType: 'workforce.employee-imported',
              targetType: 'employee',
              targetId: entry.employee.id,
            });
          }
        }
        return {
          total: prepared.total,
          errors: prepared.errors,
          reviewDigest: prepared.digest,
          imported: body.mode === 'commit' ? prepared.entries.length : 0,
          rows: prepared.entries.map((e) => ({
            row: e.rowNumber,
            employeeNumber: e.employee.employeeNumber,
            name: `${e.employee.name.givenName} ${e.employee.name.familyName}`,
            positionTitle: e.employment.positionTitle,
            startsOn: e.employment.effectivePeriod.startsOn,
            salary: formatMoney(e.salary.amount),
          })),
        };
      },
    );
    return reply
      .header('cache-control', 'no-store')
      .status(body.mode === 'commit' ? 201 : 200)
      .send(result);
  });
};

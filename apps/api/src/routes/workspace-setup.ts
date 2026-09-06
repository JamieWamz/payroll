import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Database } from '../infrastructure/database.js';
import type { Environment } from '../config/environment.js';
import { parse } from './payroll-runs.js';
import { withAuthorizedCompanyTransaction } from './tenant-authorization.js';

export const workspaceSetupRoutes: FastifyPluginAsync<{
  database: Database;
  environment: Environment;
}> = async (app, options) => {
  app.get('/companies/:companyId/setup', async (request, reply) => {
    const { companyId } = parse(
      z.object({ companyId: z.uuid() }),
      request.params,
    );
    const setup = await withAuthorizedCompanyTransaction(
      options.database,
      {
        companyId,
        environment: options.environment,
        request,
        permission: 'payroll.read',
      },
      async (tx) => {
        const counts = (
          await tx.query<{
            business: boolean;
            employees: number;
            salaries: number;
            periods: number;
            rules: number;
            finalized: number;
            asOf: string;
          }>(`SELECT
        (CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Lusaka')::date::text AS "asOf",
        EXISTS(SELECT 1 FROM app.company_payroll_settings WHERE company_id=app.current_company_id() AND coalesce(details->>'tpin','')<>'' AND coalesce(details->>'napsaNumber','')<>'' AND coalesce(details->>'nhimaNumber','')<>'') AS business,
        (SELECT count(*)::int FROM app.employees WHERE company_id=app.current_company_id() AND status='active') AS employees,
        (SELECT count(DISTINCT e.id)::int FROM app.employees e JOIN app.employments j ON j.company_id=e.company_id AND j.employee_id=e.id JOIN app.salaries s ON s.company_id=j.company_id AND s.employment_id=j.id WHERE e.company_id=app.current_company_id() AND e.status='active' AND s.ends_on IS NULL AND j.ends_on IS NULL) AS salaries,
        (SELECT count(*)::int FROM app.payroll_periods WHERE company_id=app.current_company_id() AND kind='regular') AS periods,
        (SELECT count(*)::int FROM app.statutory_configurations c WHERE c.company_id=app.current_company_id() AND c.status='verified' AND c.parameters->>'schemaVersion'='ZAMBIA-MONTHLY-1' AND EXISTS(SELECT 1 FROM app.payroll_periods p WHERE p.company_id=c.company_id AND p.kind='regular' AND c.effective_from<=p.starts_on AND (c.effective_to IS NULL OR c.effective_to>=p.ends_on))) AS rules,
        (SELECT count(*)::int FROM app.payroll_runs WHERE company_id=app.current_company_id() AND status='finalized') AS finalized`)
        ).rows[0]!;
        const steps = [
          {
            id: 'business',
            title: 'Your business',
            description:
              'Save your employer registrations and contact details.',
            complete: counts.business,
          },
          {
            id: 'people',
            title: 'People & pay',
            description: 'Add employees and their monthly salary records.',
            complete:
              counts.employees > 0 && counts.salaries === counts.employees,
          },
          {
            id: 'period',
            title: 'Pay schedule',
            description: 'Choose your first monthly period and pay date.',
            complete: counts.periods > 0,
          },
          {
            id: 'rules',
            title: 'Statutory rules',
            description:
              'Review sourced rules covering a saved payroll period.',
            complete: counts.rules > 0,
          },
          {
            id: 'payroll',
            title: 'First payroll',
            description: 'Calculate, review and finalize your first payroll.',
            complete: counts.finalized > 0,
          },
        ];
        return {
          steps,
          completed: steps.filter((s) => s.complete).length,
          total: steps.length,
          counts,
        };
      },
    );
    return reply.header('cache-control', 'no-store').send(setup);
  });
};

import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type {
  Database,
  TenantTransaction,
} from '../infrastructure/database.js';
import type { Environment } from '../config/environment.js';
import { createPayrollPeriod } from '../modules/payroll/domain/payroll-period.js';
import {
  createDraftPayrollRun,
  calculatePayrollRun,
  finalizePayrollRun,
  type PayrollRun,
} from '../modules/payroll/domain/payroll-run.js';
import { zambianMonthlyPayrollCalculator } from '../modules/payroll/calculation/zambian-monthly-calculator.js';
import type { PayrollCalculationOutcome } from '../modules/payroll/calculation/types.js';
import {
  assertMonthlyPeriod,
  prepareInputs,
  encode,
  decode,
  fingerprint,
  type PreparedInput,
  money,
} from '../modules/payroll/application/preparation.js';
import { DomainError } from '../shared/domain/domain-error.js';
import { parseEntityId } from '../shared/domain/entity-id.js';
import { parseInstant } from '../shared/domain/instant.js';
import { serializeMoney } from '../shared/domain/money.js';
import { loadPayrollConfiguration } from './statutory-configurations.js';
import { ApiError } from './api-error.js';
import { withAuthorizedCompanyTransaction } from './tenant-authorization.js';
import { appendSuccessfulAuditEvent } from './audit.js';

export const runParams = z
  .object({ companyId: z.uuid(), runId: z.uuid() })
  .strict();
export function parse<S extends z.ZodType>(
  schema: S,
  value: unknown,
): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new ApiError(
      400,
      result.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; '),
    );
  return result.data;
}
interface RunRow {
  id: string;
  companyId: string;
  payrollPeriodId: string;
  statutoryConfigurationId: string;
  status: 'draft' | 'calculated' | 'finalized';
  createdAt: Date;
  createdBy: string;
  calculatedAt: Date | null;
  calculatedBy: string | null;
  finalizedAt: Date | null;
  finalizedBy: string | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  version: string;
  code: string;
  startsOn: string;
  endsOn: string;
  paymentDate: string;
  kind: string;
}
export interface RunEmployeeRow {
  id: string;
  employeeId: string;
  employmentId: string;
  input: unknown;
  outcome: unknown;
}
const selectRun = `SELECT r.id, r.company_id AS "companyId", r.payroll_period_id AS "payrollPeriodId", r.statutory_configuration_id AS "statutoryConfigurationId", r.status, r.created_at AS "createdAt", r.created_by_membership_id AS "createdBy", r.calculated_at AS "calculatedAt", r.calculated_by_membership_id AS "calculatedBy", r.finalized_at AS "finalizedAt", r.finalized_by_membership_id AS "finalizedBy", r.row_version::text AS version, r.cancelled_at AS "cancelledAt", r.cancellation_reason AS "cancellationReason", p.code, p.starts_on::text AS "startsOn", p.ends_on::text AS "endsOn", p.payment_date::text AS "paymentDate", p.kind FROM app.payroll_runs r JOIN app.payroll_periods p ON p.company_id = r.company_id AND p.id = r.payroll_period_id WHERE r.company_id = app.current_company_id()`;
export async function loadRun(tx: TenantTransaction, id: string) {
  const record = (await tx.query<RunRow>(`${selectRun} AND r.id = $1`, [id]))
    .rows[0];
  if (!record) throw new ApiError(404, 'Payroll run was not found');
  const employees = (
    await tx.query<RunEmployeeRow>(
      `SELECT id, employee_id AS "employeeId", employment_id AS "employmentId", input_snapshot AS input, result_snapshot AS outcome FROM app.payroll_run_employees WHERE company_id = app.current_company_id() AND payroll_run_id = $1 ORDER BY employee_id`,
      [id],
    )
  ).rows;
  const config = await loadPayrollConfiguration(
    tx,
    record.statutoryConfigurationId,
  );
  // Retired configurations remain valid evidence for previously pinned runs.
  const run = createDraftPayrollRun({
    id: record.id,
    companyId: record.companyId,
    createdAt: record.createdAt.toISOString(),
    createdByMembershipId: record.createdBy,
    employeeIds: employees.map((e) => e.employeeId),
    payrollPeriod: createPayrollPeriod({
      ...record,
      id: record.payrollPeriodId,
    }),
    statutoryConfiguration: { ...config, status: 'verified' },
  });
  const restored: Readonly<PayrollRun> = {
    ...run,
    status: record.status,
    calculation:
      record.calculatedAt && record.calculatedBy
        ? {
            calculatedAt: parseInstant(record.calculatedAt.toISOString()),
            calculatedByMembershipId: parseEntityId(
              record.calculatedBy,
              'CompanyMembership',
            ),
            entries: employees.map((e) => ({
              input: decode<PreparedInput>(e.input),
              outcome: decode<PayrollCalculationOutcome>(e.outcome),
            })),
          }
        : undefined,
    finalization:
      record.finalizedAt && record.finalizedBy
        ? {
            finalizedAt: parseInstant(record.finalizedAt.toISOString()),
            finalizedByMembershipId: parseEntityId(
              record.finalizedBy,
              'CompanyMembership',
            ),
          }
        : undefined,
  };
  return { record, employees, run: restored };
}
export function serializeOutcome(result: PayrollCalculationOutcome) {
  return JSON.parse(
    JSON.stringify(result, (_, value: unknown) => {
      if (
        value &&
        typeof value === 'object' &&
        'minorUnits' in value &&
        typeof value.minorUnits === 'bigint'
      )
        return serializeMoney(money(value.minorUnits));
      return value;
    }),
  ) as Record<string, unknown>;
}
export function totals(outcomes: PayrollCalculationOutcome[]) {
  const keys = [
    'grossPay',
    'taxableIncome',
    'paye',
    'napsa',
    'nhima',
    'otherDeductions',
    'netPay',
  ] as const;
  const sums = Object.fromEntries(
    keys.map((key) => [
      key,
      serializeMoney(
        money(outcomes.reduce((sum, o) => sum + o[key].minorUnits, 0n)),
      ),
    ]),
  );
  const contributions = outcomes.reduce(
    (sum, o) =>
      sum +
      o.employerContributions.reduce((s, c) => s + c.amount.minorUnits, 0n),
    0n,
  );
  return {
    ...sums,
    employerContributions: serializeMoney(money(contributions)),
    employerCost: serializeMoney(
      money(
        contributions +
          outcomes.reduce((s, o) => s + o.grossPay.minorUnits, 0n),
      ),
    ),
  };
}
export async function runView(tx: TenantTransaction, id: string) {
  const { record, employees, run } = await loadRun(tx, id);
  const items = employees.map((e) => {
    const input = decode<PreparedInput>(e.input);
    const outcome = e.outcome
      ? decode<PayrollCalculationOutcome>(e.outcome)
      : null;
    return {
      id: e.employeeId,
      identity: input.identity ?? null,
      outcome: outcome ? serializeOutcome(outcome) : null,
    };
  });
  return {
    ...record,
    version: Number(record.version),
    configurationVersion: run.statutoryConfigurationVersion,
    employees: items,
    totals: totals(
      employees
        .filter((e) => e.outcome)
        .map((e) => decode<PayrollCalculationOutcome>(e.outcome)),
    ),
  };
}
export const payrollRunRoutes: FastifyPluginAsync<{
  database: Database;
  environment: Environment;
}> = async (app, options) => {
  app.get('/companies/:companyId/payroll-overview', async (request, reply) => {
    const { companyId } = parse(
      z.object({ companyId: z.uuid() }),
      request.params,
    );
    const result = await withAuthorizedCompanyTransaction(
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
            employees: number;
            missingSalaries: number;
            verifiedRules: number;
            periods: number;
          }>(`SELECT
        (SELECT count(*)::int FROM app.employees WHERE company_id=app.current_company_id() AND status='active') AS employees,
        (SELECT count(*)::int FROM app.employees e WHERE e.company_id=app.current_company_id() AND e.status='active' AND NOT EXISTS (SELECT 1 FROM app.employments j JOIN app.salaries s ON s.company_id=j.company_id AND s.employment_id=j.id WHERE j.company_id=e.company_id AND j.employee_id=e.id AND j.starts_on<=CURRENT_DATE AND (j.ends_on IS NULL OR j.ends_on>=CURRENT_DATE) AND s.starts_on<=CURRENT_DATE AND (s.ends_on IS NULL OR s.ends_on>=CURRENT_DATE))) AS "missingSalaries",
        (SELECT count(*)::int FROM app.statutory_configurations WHERE company_id=app.current_company_id() AND status='verified' AND effective_from<=CURRENT_DATE AND (effective_to IS NULL OR effective_to>=CURRENT_DATE)) AS "verifiedRules",
        (SELECT count(*)::int FROM app.payroll_periods WHERE company_id=app.current_company_id()) AS periods`)
        ).rows[0]!;
        const runs = (
          await tx.query<RunRow>(
            `${selectRun} AND r.cancelled_at IS NULL ORDER BY p.starts_on DESC,r.id LIMIT 6`,
          )
        ).rows;
        const latest = runs[0] ? await runView(tx, runs[0].id) : null;
        return { counts, runs, latest };
      },
    );
    return reply.header('cache-control', 'no-store').send(result);
  });
  app.get('/companies/:companyId/payroll-runs', async (request, reply) => {
    const { companyId } = parse(
      z.object({ companyId: z.uuid() }),
      request.params,
    );
    const query = parse(
      z
        .object({
          limit: z.coerce.number().int().min(1).max(100).default(50),
          employeeId: z.uuid().optional(),
        })
        .strict(),
      request.query,
    );
    const items = await withAuthorizedCompanyTransaction(
      options.database,
      {
        companyId,
        environment: options.environment,
        request,
        permission: 'payroll.read',
      },
      async (tx) =>
        (
          await tx.query(
            `${selectRun} AND ($1::uuid IS NULL OR EXISTS (SELECT 1 FROM app.payroll_run_employees re WHERE re.company_id = r.company_id AND re.payroll_run_id = r.id AND re.employee_id = $1)) ORDER BY p.starts_on DESC, r.id LIMIT $2`,
            [query.employeeId ?? null, query.limit],
          )
        ).rows,
    );
    return reply
      .header('cache-control', 'no-store')
      .send({ items, limit: query.limit });
  });
  app.get(
    '/companies/:companyId/payroll-runs/:runId',
    async (request, reply) => {
      const { companyId, runId } = parse(runParams, request.params);
      const result = await withAuthorizedCompanyTransaction(
        options.database,
        {
          companyId,
          environment: options.environment,
          request,
          permission: 'payroll.read',
        },
        (tx) => runView(tx, runId),
      );
      return reply.header('cache-control', 'no-store').send(result);
    },
  );
  app.post('/companies/:companyId/payroll-runs', async (request, reply) => {
    const { companyId } = parse(
      z.object({ companyId: z.uuid() }),
      request.params,
    );
    const body = parse(
      z
        .object({
          payrollPeriodId: z.uuid(),
          statutoryConfigurationId: z.uuid(),
          employeeIds: z.array(z.uuid()).min(1).max(1000),
        })
        .strict(),
      request.body,
    );
    const id = randomUUID();
    try {
      await withAuthorizedCompanyTransaction(
        options.database,
        {
          companyId,
          environment: options.environment,
          request,
          permission: 'payroll.calculate',
          requireCsrf: true,
        },
        async (tx, principal) => {
          await tx.query(
            'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
            [`${companyId}:payroll`],
          );
          const p = (
            await tx.query<{
              id: string;
              companyId: string;
              code: string;
              startsOn: string;
              endsOn: string;
              paymentDate: string;
              kind: string;
            }>(
              `SELECT id,company_id AS "companyId",code,starts_on::text AS "startsOn",ends_on::text AS "endsOn",payment_date::text AS "paymentDate",kind FROM app.payroll_periods WHERE company_id = app.current_company_id() AND id = $1`,
              [body.payrollPeriodId],
            )
          ).rows[0];
          if (!p) throw new ApiError(404, 'Payroll period was not found');
          const run = createDraftPayrollRun({
            id,
            companyId,
            createdAt: new Date().toISOString(),
            createdByMembershipId: principal.membershipId,
            employeeIds: body.employeeIds,
            payrollPeriod: createPayrollPeriod(p),
            statutoryConfiguration: await loadPayrollConfiguration(
              tx,
              body.statutoryConfigurationId,
            ),
          });
          assertMonthlyPeriod(run);
          await tx.query(
            `INSERT INTO app.payroll_runs(id,company_id,payroll_period_id,statutory_configuration_id,created_by_membership_id) VALUES($1,$2,$3,$4,$5)`,
            [
              id,
              companyId,
              body.payrollPeriodId,
              body.statutoryConfigurationId,
              principal.membershipId,
            ],
          );
          for (const employeeId of run.employeeIds) {
            const employment = (
              await tx.query<{
                id: string;
                name: string;
                employeeNumber: string;
              }>(
                `SELECT j.id, e.given_name || ' ' || e.family_name AS name, e.employee_number AS "employeeNumber" FROM app.employments j JOIN app.employees e ON e.company_id = j.company_id AND e.id = j.employee_id WHERE j.company_id = app.current_company_id() AND j.employee_id = $1 AND e.status = 'active' AND j.starts_on <= $2::date AND (j.ends_on IS NULL OR j.ends_on >= $3::date)`,
                [employeeId, p.startsOn, p.endsOn],
              )
            ).rows[0];
            if (!employment)
              throw new ApiError(
                400,
                `${employeeId}: select an active employee whose employment covers the month.`,
              );
            await tx.query(
              `INSERT INTO app.payroll_run_employees(id,company_id,payroll_run_id,employee_id,employment_id,input_snapshot) VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
              [
                randomUUID(),
                companyId,
                id,
                employeeId,
                employment.id,
                encode({
                  identity: {
                    name: employment.name,
                    employeeNumber: employment.employeeNumber,
                  },
                }),
              ],
            );
          }
          await appendSuccessfulAuditEvent(tx, principal, request.id, {
            eventType: 'payroll.run-created',
            targetType: 'payroll-run',
            targetId: id,
          });
        },
      );
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === '23505'
      )
        throw new ApiError(
          409,
          'This period already has a payroll run. Open the existing run.',
        );
      throw error;
    }
    return reply
      .status(201)
      .header('cache-control', 'no-store')
      .send({ id, status: 'draft', version: 1 });
  });
  app.post(
    '/companies/:companyId/payroll-runs/:runId/cancel',
    async (request, reply) => {
      const { companyId, runId } = parse(runParams, request.params);
      const body = parse(
        z
          .object({
            expectedVersion: z.number().int().positive(),
            reason: z.string().trim().min(1).max(500),
          })
          .strict(),
        request.body,
      );
      await withAuthorizedCompanyTransaction(
        options.database,
        {
          companyId,
          environment: options.environment,
          request,
          permission: 'payroll.calculate',
          requireCsrf: true,
        },
        async (tx, principal) => {
          const { record } = await loadRun(tx, runId);
          if (record.status === 'finalized' || record.cancelledAt)
            throw new ApiError(
              409,
              'Only an active draft or calculated payroll can be cancelled.',
            );
          if (Number(record.version) !== body.expectedVersion)
            throw new ApiError(
              409,
              'Payroll changed. Reload before cancelling.',
            );
          await tx.query(
            `UPDATE app.payroll_runs SET cancelled_at=statement_timestamp(),cancellation_reason=$2,row_version=row_version+1,updated_at=statement_timestamp() WHERE company_id=app.current_company_id() AND id=$1`,
            [runId, body.reason],
          );
          await appendSuccessfulAuditEvent(tx, principal, request.id, {
            eventType: 'payroll.run-cancelled',
            targetType: 'payroll-run',
            targetId: runId,
          });
        },
      );
      return reply
        .header('cache-control', 'no-store')
        .send({ id: runId, cancelled: true });
    },
  );
  for (const action of ['calculate', 'finalize'] as const) {
    app.post(
      `/companies/:companyId/payroll-runs/:runId/${action}`,
      async (request, reply) => {
        const { companyId, runId } = parse(runParams, request.params);
        const body = parse(
          z
            .object({
              expectedVersion: z.number().int().positive(),
              confirmed: z.literal(true).optional(),
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
            permission:
              action === 'finalize' ? 'payroll.finalize' : 'payroll.calculate',
            requireCsrf: true,
          },
          async (tx, principal) => {
            await tx.query(
              'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
              [`${companyId}:payroll`],
            );
            await tx.query(
              'SELECT id FROM app.payroll_runs WHERE company_id = app.current_company_id() AND id = $1 FOR UPDATE',
              [runId],
            );
            const { record, run, employees } = await loadRun(tx, runId);
            if (Number(record.version) !== body.expectedVersion)
              throw new ApiError(
                409,
                'Payroll changed since you opened it. Reload and review the latest calculation.',
              );
            if (record.cancelledAt)
              throw new ApiError(
                409,
                'Cancelled payroll is immutable. Prepare a replacement run.',
              );
            if (run.status === 'finalized')
              throw new ApiError(409, 'Finalized payroll is immutable.');
            // Share-lock sources through commit so concurrent edits cannot cross the finalization boundary.
            await tx.query(
              'SELECT id FROM app.employees WHERE company_id = app.current_company_id() FOR SHARE',
            );
            await tx.query(
              'SELECT id FROM app.employments WHERE company_id = app.current_company_id() FOR SHARE',
            );
            await tx.query(
              'SELECT id FROM app.salaries WHERE company_id = app.current_company_id() FOR SHARE',
            );
            await tx.query(
              'SELECT id FROM app.compensation_components WHERE company_id = app.current_company_id() FOR SHARE',
            );
            await tx.query(
              'SELECT employee_id FROM app.employee_payroll_details WHERE company_id = app.current_company_id() FOR SHARE',
            );
            const inputs = await prepareInputs(tx, run);
            if (action === 'finalize') {
              if (!body.confirmed)
                throw new ApiError(
                  400,
                  'Confirm that the payroll and statutory deductions have been reviewed.',
                );
              if (!run.calculation)
                throw new ApiError(
                  409,
                  'Calculate and review payroll before finalizing.',
                );
              if (
                fingerprint(inputs) !==
                fingerprint(
                  employees.map((e) => decode<PreparedInput>(e.input)),
                )
              )
                throw new ApiError(
                  409,
                  'Employee details, compensation or tax history changed. Recalculate and review before finalizing.',
                );
              const employer = inputs[0]?.identity.employerDetails;
              if (
                !employer?.tpin ||
                !employer.napsaNumber ||
                !employer.nhimaNumber
              ) {
                throw new ApiError(
                  400,
                  'Add employer TPIN, NAPSA and NHIMA registrations in Settings, then recalculate before finalizing.',
                );
              }
              const incomplete = inputs.filter(
                (i) =>
                  !i.identity.details.tpin ||
                  !i.identity.details.napsaNumber ||
                  !i.identity.details.nhimaNumber,
              );
              if (incomplete.length)
                throw new ApiError(
                  400,
                  `${incomplete.map((i) => i.identity.employeeNumber).join(', ')}: add TPIN, NAPSA and NHIMA identifiers in the employee profile before finalizing.`,
                );
              finalizePayrollRun(
                run,
                principal.membershipId,
                new Date().toISOString(),
              );
              await tx.query(
                `UPDATE app.payroll_runs SET status='finalized', finalized_by_membership_id=$2, finalized_at=statement_timestamp(), row_version=row_version+1, updated_at=statement_timestamp() WHERE company_id = app.current_company_id() AND id=$1`,
                [runId, principal.membershipId],
              );
            } else {
              let calculated: Readonly<PayrollRun>;
              try {
                calculated = calculatePayrollRun(
                  run,
                  inputs,
                  zambianMonthlyPayrollCalculator,
                  principal.membershipId,
                  new Date().toISOString(),
                );
              } catch (error) {
                if (error instanceof DomainError)
                  throw new ApiError(
                    400,
                    `Payroll could not be calculated: ${error.message}. ${String(error.details?.rule ?? '').replaceAll('_', ' ')}. Review compensation and statutory rules.`,
                  );
                throw error;
              }
              for (const entry of calculated.calculation!.entries) {
                const employee = employees.find(
                  (e) => e.employeeId === entry.input.employee.employeeId,
                )!;
                if (
                  employee.employmentId !== entry.input.employment.employmentId
                )
                  throw new ApiError(
                    409,
                    'The selected employment changed. Review the payroll period and employment history.',
                  );
                await tx.query(
                  `UPDATE app.payroll_run_employees SET status='calculated',input_snapshot=$2::jsonb,result_snapshot=$3::jsonb,row_version=row_version+1,updated_at=statement_timestamp() WHERE company_id=app.current_company_id() AND id=$1`,
                  [employee.id, encode(entry.input), encode(entry.outcome)],
                );
                // Retain obsolete non-finalized component identities at zero; current snapshots are authoritative.
                await tx.query(
                  'UPDATE app.payroll_run_components SET amount_minor_units=0 WHERE company_id=app.current_company_id() AND payroll_run_employee_id=$1',
                  [employee.id],
                );
                for (const line of entry.outcome.breakdown)
                  await tx.query(
                    `INSERT INTO app.payroll_run_components(id,company_id,payroll_run_employee_id,payroll_run_id,code,kind,amount_minor_units,currency,currency_scale) VALUES($1,$2,$3,$4,$5,$6,$7,'ZMW',2) ON CONFLICT(company_id,payroll_run_employee_id,kind,code) DO UPDATE SET amount_minor_units=EXCLUDED.amount_minor_units,row_version=app.payroll_run_components.row_version+1,updated_at=statement_timestamp()`,
                    [
                      randomUUID(),
                      companyId,
                      employee.id,
                      runId,
                      line.code,
                      line.kind,
                      line.amount.minorUnits.toString(),
                    ],
                  );
              }
              await tx.query(
                `UPDATE app.payroll_runs SET status='calculated',calculation_version='ZAMBIA-MONTHLY-1',rounding_policy='ZMW-2DP-HALF-UP',calculated_by_membership_id=$2,calculated_at=statement_timestamp(),row_version=row_version+1,updated_at=statement_timestamp() WHERE company_id=app.current_company_id() AND id=$1`,
                [runId, principal.membershipId],
              );
            }
            await appendSuccessfulAuditEvent(tx, principal, request.id, {
              eventType: `payroll.run-${action === 'finalize' ? 'finalized' : 'calculated'}`,
              targetType: 'payroll-run',
              targetId: runId,
            });
            return runView(tx, runId);
          },
        );
        return reply.header('cache-control', 'no-store').send(result);
      },
    );
  }
};

import {
  exportTemplateSchema,
  renderExportPreview,
} from '../modules/operations/contracts.js';
import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type {
  Database,
  TenantTransaction,
} from '../infrastructure/database.js';
import type { Environment } from '../config/environment.js';
import {
  csv,
  payrollPdf,
  reportCsv,
  type DocumentEntry,
} from '../modules/payroll/application/documents.js';
import {
  decode,
  money,
  type PreparedInput,
} from '../modules/payroll/application/preparation.js';
import type { PayrollCalculationOutcome } from '../modules/payroll/calculation/types.js';
import { formatMoney } from '../shared/domain/money.js';
import { ApiError } from './api-error.js';
import { parse, runParams, loadRun } from './payroll-runs.js';
import { withAuthorizedCompanyTransaction } from './tenant-authorization.js';
import { appendSuccessfulAuditEvent } from './audit.js';

async function finalizedEntries(tx: TenantTransaction, runId: string) {
  const loaded = await loadRun(tx, runId);
  if (loaded.run.status !== 'finalized')
    throw new ApiError(
      409,
      'Finalize payroll before generating documents or filing records.',
    );
  return {
    code: loaded.record.code,
    entries: loaded.employees.map((e) => ({
      input: decode<PreparedInput>(e.input),
      outcome: decode<PayrollCalculationOutcome>(e.outcome),
    })),
  };
}
function readiness(entries: DocumentEntry[], authority: string) {
  const field =
    authority === 'zra'
      ? 'tpin'
      : authority === 'napsa'
        ? 'napsaNumber'
        : 'nhimaNumber';
  const missing = entries
    .filter((e) => !e.input.identity.details[field])
    .map((e) => `${e.input.identity.employeeNumber}: ${field} missing`);
  if (entries.some((e) => !e.input.identity.employerDetails[field]))
    missing.push(`Employer ${field} missing from finalized payroll`);
  return missing;
}
export const payrollDocumentRoutes: FastifyPluginAsync<{
  database: Database;
  environment: Environment;
}> = async (app, options) => {
  app.get(
    '/companies/:companyId/payroll-runs/:runId/template-export/:templateId',
    async (request, reply) => {
      const { companyId, runId, templateId } = parse(
        runParams.extend({ templateId: z.uuid() }),
        request.params,
      );
      const file = await withAuthorizedCompanyTransaction(
        options.database,
        {
          companyId,
          environment: options.environment,
          request,
          permission: 'reports.read',
        },
        async (tx) => {
          const data = await finalizedEntries(tx, runId);
          const record = (
            await tx.query<{ settings: unknown }>(
              `SELECT settings FROM app.operations_settings WHERE company_id=app.current_company_id() AND id=$1 AND kind='export_template'`,
              [templateId],
            )
          ).rows[0];
          if (!record)
            throw new ApiError(404, 'Export template was not found.');
          const template = exportTemplateSchema.parse(record.settings);
          const rows = data.entries.map(({ input: i, outcome: o }) => ({
            employeeNumber: i.identity.employeeNumber,
            employeeName: i.identity.name,
            employeeTpin: i.identity.details.tpin,
            employerTpin: i.identity.employerDetails.tpin ?? '',
            accountNumber: i.identity.details.accountNumber,
            bankCode: i.identity.details.bankCode,
            branchCode: i.identity.details.branchCode,
            reference: `${data.code}-${i.identity.employeeNumber}`,
            paymentDate: i.period.paymentDate,
            taxYear: i.period.paymentDate.slice(0, 4),
            taxMonth: i.period.paymentDate.slice(5, 7),
            grossPay: formatMoney(o.grossPay),
            taxableIncome: formatMoney(o.taxableIncome),
            paye: formatMoney(o.paye),
            napsa: formatMoney(o.napsa),
            nhima: formatMoney(o.nhima),
            netPay: formatMoney(o.netPay),
          }));
          try {
            return renderExportPreview(template, rows);
          } catch (error) {
            throw new ApiError(
              400,
              `The selected template cannot export this payroll: ${error instanceof Error ? error.message : 'review required fields'}. Download the payroll register for reconciliation.`,
            );
          }
        },
      );
      return reply
        .header('cache-control', 'no-store')
        .header(
          'content-disposition',
          `attachment; filename="payroll-template-${runId}.csv"`,
        )
        .type('text/csv; charset=utf-8')
        .send(file);
    },
  );
  app.get(
    '/companies/:companyId/payroll-runs/:runId/documents/:kind',
    async (request, reply) => {
      const { companyId, runId, kind } = parse(
        runParams.extend({
          kind: z.enum([
            'register',
            'paye',
            'napsa',
            'nhima',
            'payments',
            'payslips',
          ]),
        }),
        request.params,
      );
      const query = parse(
        z
          .object({
            format: z.enum(['csv', 'pdf']).default('csv'),
            employeeId: z.uuid().optional(),
          })
          .strict(),
        request.query,
      );
      const data = await withAuthorizedCompanyTransaction(
        options.database,
        {
          companyId,
          environment: options.environment,
          request,
          permission: 'reports.read',
        },
        async (tx) => {
          const data = await finalizedEntries(tx, runId);
          if (query.employeeId)
            data.entries = data.entries.filter(
              (e) => e.input.employee.employeeId === query.employeeId,
            );
          if (!data.entries.length)
            throw new ApiError(
              404,
              'Employee payslip was not found in this run.',
            );
          if (
            kind === 'payments' &&
            data.entries.some(
              (e) =>
                !e.input.identity.details.accountNumber ||
                !e.input.identity.details.bankName ||
                !e.input.identity.details.accountName,
            )
          )
            throw new ApiError(
              400,
              'Bank details are missing from finalized payroll. Download the register and reconcile payment instructions separately.',
            );
          return data;
        },
      );
      const pdf = query.format === 'pdf' || kind === 'payslips';
      if (pdf && kind !== 'register' && kind !== 'payslips')
        throw new ApiError(
          400,
          'Choose CSV for statutory and payment schedules.',
        );
      const file = pdf
        ? await payrollPdf(
            kind === 'payslips' ? 'payslips' : 'register',
            data.entries,
            data.code,
          )
        : reportCsv(kind, data.entries);
      return reply
        .header('cache-control', 'no-store')
        .header(
          'content-disposition',
          `attachment; filename="${kind}-${runId}.${pdf ? 'pdf' : 'csv'}"`,
        )
        .type(pdf ? 'application/pdf' : 'text/csv; charset=utf-8')
        .send(file);
    },
  );
  app.get(
    '/companies/:companyId/payroll-runs/:runId/filings',
    async (request, reply) => {
      const { companyId, runId } = parse(runParams, request.params);
      const result = await withAuthorizedCompanyTransaction(
        options.database,
        {
          companyId,
          environment: options.environment,
          request,
          permission: 'reports.read',
        },
        async (tx) => {
          const data = await finalizedEntries(tx, runId);
          const items = (
            await tx.query(
              `SELECT f.id,f.authority,f.status,f.reference,f.notes,f.created_at AS "createdAt",f.recorded_by_membership_id AS "recordedBy" FROM app.payroll_filing_events f WHERE company_id=app.current_company_id() AND payroll_run_id=$1 ORDER BY created_at DESC,id DESC`,
              [runId],
            )
          ).rows;
          return {
            items,
            readiness: Object.fromEntries(
              ['zra', 'napsa', 'nhima'].map((a) => [
                a,
                readiness(data.entries, a),
              ]),
            ),
            integrationStatus: 'manual',
            uploadFormatStatus: 'not_certified',
          };
        },
      );
      return reply.header('cache-control', 'no-store').send(result);
    },
  );
  app.post(
    '/companies/:companyId/payroll-runs/:runId/filings/:authority',
    async (request, reply) => {
      const { companyId, runId, authority } = parse(
        runParams.extend({ authority: z.enum(['zra', 'napsa', 'nhima']) }),
        request.params,
      );
      const body = parse(
        z
          .object({
            status: z.enum([
              'generated',
              'submitted',
              'accepted',
              'rejected',
              'failed',
              'requires_attention',
            ]),
            reference: z.string().trim().max(160).default(''),
            notes: z.string().trim().max(1000).default(''),
            attestation: z.literal(true),
            expectedEventId: z.uuid().nullable(),
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
          permission: 'payroll.finalize',
          requireCsrf: true,
        },
        async (tx, principal) => {
          const data = await finalizedEntries(tx, runId);
          const previous = (
            await tx.query<{ id: string; status: string }>(
              `SELECT id,status FROM app.payroll_filing_events WHERE company_id=app.current_company_id() AND payroll_run_id=$1 AND authority=$2 ORDER BY created_at DESC,id DESC LIMIT 1`,
              [runId, authority],
            )
          ).rows[0];
          if ((previous?.id ?? null) !== body.expectedEventId)
            throw new ApiError(
              409,
              'Filing history changed. Reload before recording a new status.',
            );
          if (
            ['submitted', 'accepted', 'rejected'].includes(body.status) &&
            !body.reference
          )
            throw new ApiError(
              400,
              'Enter the external submission or response reference.',
            );
          if (
            ['accepted', 'rejected'].includes(body.status) &&
            previous?.status !== 'submitted'
          )
            throw new ApiError(
              409,
              'Record the external submission before its acceptance or rejection.',
            );
          if (
            body.status === 'submitted' &&
            !['generated', 'rejected', 'failed', 'requires_attention'].includes(
              previous?.status ?? '',
            )
          )
            throw new ApiError(
              409,
              'Generate and review the schedule before recording an external submission.',
            );
          if (previous?.status === 'accepted')
            throw new ApiError(
              409,
              'This filing is accepted. Corrections require a separate amendment record.',
            );
          if (body.status === 'generated' && previous?.status === 'submitted')
            throw new ApiError(
              409,
              'A submitted return is awaiting an external response.',
            );
          const missing = readiness(data.entries, authority);
          if (
            ['generated', 'submitted'].includes(body.status) &&
            missing.length
          )
            throw new ApiError(400, missing.join('; '));
          const id = randomUUID();
          const file =
            body.status === 'generated'
              ? reportCsv(
                  authority === 'zra' ? 'paye' : authority,
                  data.entries,
                )
              : null;
          await tx.query(
            `INSERT INTO app.payroll_filing_events(id,company_id,payroll_run_id,authority,status,reference,notes,recorded_by_membership_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
            [
              id,
              companyId,
              runId,
              authority,
              body.status,
              body.reference || null,
              body.notes,
              principal.membershipId,
            ],
          );
          await appendSuccessfulAuditEvent(tx, principal, request.id, {
            eventType: 'payroll.filing-recorded',
            targetType: 'payroll-filing',
            targetId: id,
          });
          return { id, status: body.status, file };
        },
      );
      return reply.header('cache-control', 'no-store').send(result);
    },
  );
  app.get('/companies/:companyId/annual-tax', async (request, reply) => {
    const { companyId } = parse(
      z.object({ companyId: z.uuid() }),
      request.params,
    );
    const { year } = parse(
      z.object({ year: z.coerce.number().int().min(2000).max(2100) }).strict(),
      request.query,
    );
    const file = await withAuthorizedCompanyTransaction(
      options.database,
      {
        companyId,
        environment: options.environment,
        request,
        permission: 'reports.read',
      },
      async (tx) => {
        const rows = (
          await tx.query<{ input: unknown; outcome: unknown }>(
            `SELECT e.input_snapshot AS input,e.result_snapshot AS outcome FROM app.payroll_run_employees e JOIN app.payroll_runs r ON r.company_id=e.company_id AND r.id=e.payroll_run_id JOIN app.payroll_periods p ON p.company_id=r.company_id AND p.id=r.payroll_period_id WHERE e.company_id=app.current_company_id() AND r.status='finalized' AND p.payment_date >= $1::date AND p.payment_date < $2::date ORDER BY p.payment_date,e.employee_id`,
            [`${year}-01-01`, `${year + 1}-01-01`],
          )
        ).rows;
        if (!rows.length)
          throw new ApiError(
            404,
            'No finalized payroll exists for this tax year.',
          );
        const grouped = new Map<
          string,
          {
            number: string;
            name: string;
            tpin: string;
            gross: bigint;
            taxable: bigint;
            paye: bigint;
            months: number;
          }
        >();
        for (const row of rows) {
          const i = decode<PreparedInput>(row.input);
          const o = decode<PayrollCalculationOutcome>(row.outcome);
          const v = grouped.get(o.employeeId) ?? {
            number: i.identity.employeeNumber,
            name: i.identity.name,
            tpin: i.identity.details.tpin,
            gross: 0n,
            taxable: 0n,
            paye: 0n,
            months: 0,
          };
          v.gross += o.grossPay.minorUnits;
          v.taxable += o.taxableIncome.minorUnits;
          v.paye += o.paye.minorUnits;
          v.months++;
          grouped.set(o.employeeId, v);
        }
        return csv([
          [
            'Tax year',
            'Employee number',
            'Name',
            'TPIN',
            'Finalized periods',
            'Gross (ZMW)',
            'Taxable income (ZMW)',
            'PAYE (ZMW)',
            'Coverage',
          ],
          ...[...grouped.values()].map((v) => [
            String(year),
            v.number,
            v.name,
            v.tpin,
            String(v.months),
            ...[v.gross, v.taxable, v.paye].map((n) => ({
              amount: formatMoney(money(n)),
            })),
            'Finalized payroll only; opening balances excluded; not an official P9 form',
          ]),
        ]);
      },
    );
    return reply
      .header('cache-control', 'no-store')
      .header(
        'content-disposition',
        `attachment; filename="annual-tax-${year}.csv"`,
      )
      .type('text/csv; charset=utf-8')
      .send(file);
  });
};

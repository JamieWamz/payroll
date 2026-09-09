import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type {
  Database,
  TenantTransaction,
} from '../infrastructure/database.js';
import type { Environment } from '../config/environment.js';
import {
  bankCatalog,
  bankOnboardingRequirements,
  bankRegisterSource,
  bankRequestBrief,
} from '../modules/banking/catalog.js';
import { paymentReference } from '../modules/banking/payment-reference.js';
import {
  reconcileStatement,
  statementColumns,
} from '../modules/banking/reconciliation.js';
import { bankNames } from '../modules/operations/contracts.js';
import { formatMoney } from '../shared/domain/money.js';
import { csv } from '../modules/payroll/application/documents.js';
import { finalizedEntries } from './payroll-documents.js';
import { parse, runParams } from './payroll-runs.js';
import { withAuthorizedCompanyTransaction } from './tenant-authorization.js';

async function instructions(tx: TenantTransaction, runId: string) {
  const data = await finalizedEntries(tx, runId);
  return {
    code: data.code,
    items: data.entries.map(({ input, outcome }) => ({
      employeeNumber: input.identity.employeeNumber,
      employeeName: input.identity.name,
      reference: paymentReference(input),
      amount: formatMoney(outcome.netPay),
      paymentDate: input.period.paymentDate,
    })),
  };
}

export const bankingRoutes: FastifyPluginAsync<{
  database: Database;
  environment: Environment;
}> = async (app, options) => {
  app.get('/companies/:companyId/banking/catalog', async (request, reply) => {
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
        permission: 'reports.read',
      },
      async () => undefined,
    );
    return reply.header('cache-control', 'no-store').send({
      banks: bankCatalog,
      requirements: bankOnboardingRequirements,
      registerSource: bankRegisterSource,
      livePaymentsEnabled: false,
      liveStatementsEnabled: false,
    });
  });
  app.get(
    '/companies/:companyId/banking/request-brief',
    async (request, reply) => {
      const { companyId } = parse(
        z.object({ companyId: z.uuid() }),
        request.params,
      );
      const { bank } = parse(
        z.object({ bank: z.enum(bankNames) }).strict(),
        request.query,
      );
      await withAuthorizedCompanyTransaction(
        options.database,
        {
          companyId,
          environment: options.environment,
          request,
          permission: 'reports.read',
        },
        async () => undefined,
      );
      return reply
        .header('cache-control', 'no-store')
        .header(
          'content-disposition',
          'attachment; filename="bank-integration-request.txt"',
        )
        .type('text/plain; charset=utf-8')
        .send(bankRequestBrief(bank));
    },
  );
  app.get(
    '/companies/:companyId/banking/statement-template',
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
          permission: 'reports.read',
        },
        async () => undefined,
      );
      return reply
        .header('cache-control', 'no-store')
        .header(
          'content-disposition',
          'attachment; filename="statement-import-template.csv"',
        )
        .type('text/csv; charset=utf-8')
        .send(statementColumns.join(',') + '\r\n');
    },
  );
  app.get(
    '/companies/:companyId/payroll-runs/:runId/banking/instructions',
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
        (tx) => instructions(tx, runId),
      );
      return reply.header('cache-control', 'no-store').send(result);
    },
  );
  app.post(
    '/companies/:companyId/payroll-runs/:runId/banking/reconcile',
    async (request, reply) => {
      const { companyId, runId } = parse(runParams, request.params);
      const { format } = parse(
        z.object({ format: z.enum(['json', 'csv']).default('json') }).strict(),
        request.query,
      );
      const body = parse(
        z
          .object({
            bank: z.enum(bankNames),
            from: z.string().length(10),
            to: z.string().length(10),
            csv: z.string().max(500_000),
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
          permission: 'reports.read',
          requireCsrf: true,
        },
        async (tx) => {
          const expected = await instructions(tx, runId);
          return {
            bank: body.bank,
            payrollCode: expected.code,
            ...reconcileStatement(expected.items, body.csv, body.from, body.to),
          };
        },
      );
      reply.header('cache-control', 'no-store');
      if (format === 'csv') {
        return reply
          .header(
            'content-disposition',
            'attachment; filename="statement-reconciliation.csv"',
          )
          .type('text/csv; charset=utf-8')
          .send(
            csv([
              [
                'Employee number',
                'Employee name',
                'Payment reference',
                'Expected net (ZMW)',
                'Transaction ID',
                'Booking date',
                'Statement amount (ZMW)',
                'Review result',
              ],
              ...result.results.flatMap((payment) =>
                (payment.entries.length ? payment.entries : [undefined]).map(
                  (entry) => [
                    payment.employeeNumber,
                    payment.employeeName,
                    payment.reference,
                    { amount: payment.amount },
                    entry?.transactionId ?? '',
                    entry?.bookingDate ?? '',
                    entry ? { amount: entry.amount } : '',
                    payment.status,
                  ],
                ),
              ),
              ...result.unmatched.map((entry) => [
                '',
                '',
                entry.reference,
                '',
                entry.transactionId,
                entry.bookingDate,
                { amount: entry.amount },
                'unmatched_statement_entry',
              ]),
            ]),
          );
      }
      return reply.send(result);
    },
  );
};

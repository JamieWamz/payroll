import { z } from 'zod';
import { parseCsv } from '../../shared/csv.js';
import { parseLocalDate } from '../../shared/domain/local-date.js';
import { ApiError } from '../../routes/api-error.js';

export const statementColumns = [
  'transactionId',
  'bookingDate',
  'reference',
  'amount',
  'currency',
] as const;
const entrySchema = z
  .object({
    transactionId: z
      .string()
      .min(1)
      .max(160)
      .regex(/^[^\p{Cc}]*$/u),
    bookingDate: z.string().length(10),
    reference: z
      .string()
      .max(160)
      .regex(/^[^\p{Cc}]*$/u),
    amount: z.string().regex(/^-?(0|[1-9]\d{0,12})\.\d{2}$/),
    currency: z.literal('ZMW'),
  })
  .strict();
export interface ExpectedPayment {
  employeeNumber: string;
  employeeName: string;
  reference: string;
  amount: string;
  paymentDate: string;
}

export function reconcileStatement(
  expected: ExpectedPayment[],
  source: string,
  from: string,
  to: string,
) {
  parseLocalDate(from);
  parseLocalDate(to);
  if (from > to)
    throw new ApiError(400, 'Statement start must be on or before its end.');
  if (Buffer.byteLength(source) > 500_000)
    throw new ApiError(400, 'Statement CSV must be at most 500 KB.');
  const table = parseCsv(
    source,
    5001,
    'Import at most 5,000 statement entries.',
  );
  const headers = table.shift();
  if (
    !headers ||
    headers.length !== statementColumns.length ||
    new Set(headers).size !== headers.length ||
    statementColumns.some((c) => !headers.includes(c))
  ) {
    throw new ApiError(
      400,
      `Use the statement headers: ${statementColumns.join(', ')}.`,
    );
  }
  if (!table.length)
    throw new ApiError(400, 'The statement contains no entries.');
  const ids = new Set<string>();
  const entries = table.map((row, index) => {
    if (row.length !== headers.length)
      throw new ApiError(
        400,
        `Statement row ${index + 2}: column count does not match.`,
      );
    const parsed = entrySchema.safeParse(
      Object.fromEntries(headers.map((h, i) => [h, row[i]])),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        `Statement row ${index + 2}: check the transaction ID, date, reference, signed amount with two decimal places, and ZMW currency.`,
      );
    const entry = parsed.data;
    parseLocalDate(entry.bookingDate);
    if (entry.bookingDate < from || entry.bookingDate > to)
      throw new ApiError(
        400,
        `Statement row ${index + 2}: date falls outside the selected statement period.`,
      );
    if (ids.has(entry.transactionId))
      throw new ApiError(
        400,
        `Statement row ${index + 2}: duplicate transaction ID. Remove duplicate exports before review.`,
      );
    ids.add(entry.transactionId);
    return entry;
  });
  if (new Set(expected.map((e) => e.reference)).size !== expected.length)
    throw new ApiError(
      409,
      'Payment references are ambiguous. Reconcile this payroll manually.',
    );
  const entriesByReference = new Map<string, typeof entries>();
  for (const entry of entries) {
    const group = entriesByReference.get(entry.reference) ?? [];
    group.push(entry);
    entriesByReference.set(entry.reference, group);
  }
  const results = expected.map((payment) => {
    const matches = entriesByReference.get(payment.reference) ?? [];
    const net = BigInt(payment.amount.replace('.', ''));
    let status:
      | 'matched'
      | 'missing'
      | 'amount_mismatch'
      | 'multiple_entries'
      | 'no_payment_due';
    if (net === 0n)
      status = matches.length ? 'multiple_entries' : 'no_payment_due';
    else if (!matches.length) status = 'missing';
    else if (matches.length > 1) status = 'multiple_entries';
    else
      status =
        BigInt(matches[0]!.amount.replace('.', '')) === -net
          ? 'matched'
          : 'amount_mismatch';
    return { ...payment, status, entries: matches };
  });
  const refs = new Set(expected.map((p) => p.reference));
  const unmatched = entries.filter((e) => !refs.has(e.reference));
  return {
    mode: 'uploaded_statement_review',
    from,
    to,
    summary: {
      expected: expected.length,
      statementEntries: entries.length,
      matched: results.filter((r) => r.status === 'matched').length,
      missing: results.filter((r) => r.status === 'missing').length,
      exceptions: results.filter(
        (r) =>
          r.status === 'amount_mismatch' || r.status === 'multiple_entries',
      ).length,
      noPaymentDue: results.filter((r) => r.status === 'no_payment_due').length,
      unmatched: unmatched.length,
    },
    results,
    unmatched,
  };
}

import { z } from 'zod';
import { parseLocalDate } from '../../shared/domain/local-date.js';

// Deliberately limited to ordinary bank-account salary payments. No eWallet,
// public recipients, foreign currency, paid notifications or live submission.
const textField = z
  .string()
  .min(1)
  .max(20)
  .regex(/^[A-Za-z0-9][A-Za-z0-9 .'/&()-]*$/);
export const fnbBatchSchema = z
  .object({
    ownAccount: z
      .string()
      .regex(/^\d{11}$/)
      .refine((value) => /[1-9]/.test(value)),
    actionDate: z.string().length(10),
    rows: z
      .array(
        z
          .object({
            recipientName: textField,
            recipientAccount: z
              .string()
              .regex(/^\d{1,20}$/)
              .refine((value) => /[1-9]/.test(value)),
            accountType: z.enum(['1', '2', '3']),
            branchCode: z
              .string()
              .regex(/^\d{6}$/)
              .refine((value) => value !== '000000'),
            amount: z
              .string()
              .max(11)
              .regex(/^(0|[1-9]\d*)\.\d{2}$/)
              .refine((value) => value !== '0.00'),
            ownReference: textField,
            recipientReference: textField,
          })
          .strict(),
      )
      .min(1)
      .max(10000),
  })
  .strict();
export type FnbBatch = z.infer<typeof fnbBatchSchema>;

// Exact structural headings from the bank's downloadable 36-column template.
export const fnbColumnHeadings = [
  'RECIPIENT NAME',
  'RECIPIENT ACCOUNT',
  'RECIPIENT ACCOUNT TYPE',
  'BRANCHCODE',
  'AMOUNT',
  'OWN REFERENCE',
  'RECIPIENT REFERENCE',
  ...[1, 2, 3, 4, 5].flatMap((number) => [
    `EMAIL ${number} NOTIFY`,
    `EMAIL ${number} ADDRESS`,
    `EMAIL ${number} SUBJECT`,
  ]),
  ...[1, 2].flatMap((number) => [
    `FAX ${number} NOTIFY`,
    `FAX ${number} CODE`,
    `FAX ${number} NUMBER`,
    `FAX ${number} SUBJECT`,
  ]),
  ...[1, 2].flatMap((number) => [
    `SMS ${number} NOTIFY`,
    `SMS ${number} CODE`,
    `SMS ${number} NUMBER`,
  ]),
] as const;

/** Pure file-generation boundary; today is supplied by the service in Lusaka time. */
export function renderFnbZambiaBatch(input: FnbBatch, today: string): string {
  const batch = fnbBatchSchema.parse(input);
  const actionDate = parseLocalDate(batch.actionDate);
  const currentDate = parseLocalDate(today);
  const daysAhead =
    (Date.parse(`${actionDate}T00:00:00Z`) -
      Date.parse(`${currentDate}T00:00:00Z`)) /
    86_400_000;
  if (daysAhead < 0 || daysAhead > 365)
    throw new Error(
      'FNB action date must be today or within the next 365 days',
    );
  const references = new Set<string>();
  let sum = BigInt(batch.ownAccount);
  for (const row of batch.rows) {
    if (references.has(row.ownReference))
      throw new Error('Own references must be unique within this batch');
    references.add(row.ownReference);
    sum += BigInt(row.recipientAccount);
  }
  // Bank guide: sum recipient account numbers, add own account once, retain
  // the rightmost 12 digits. This is a control total, NOT a cryptographic hash.
  const hashTotal = (sum % 1_000_000_000_000n).toString().padStart(12, '0');
  const lines = [
    record(['BInSol - U ver 1.00']),
    record([actionDate]),
    record([batch.ownAccount, hashTotal]),
    fnbColumnHeadings.join(','),
    ...batch.rows.map((row) =>
      record([
        row.recipientName,
        row.recipientAccount,
        row.accountType,
        row.branchCode,
        row.amount,
        row.ownReference,
        row.recipientReference,
      ]),
    ),
  ];
  return lines.join('\r\n') + '\r\n';
}

function record(values: readonly string[]): string {
  // The supported subset excludes commas, quotes, formulas and control chars.
  return [...values, ...Array<string>(36 - values.length).fill('')].join(',');
}

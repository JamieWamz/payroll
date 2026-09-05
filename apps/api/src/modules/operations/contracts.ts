import { z } from 'zod';

export const bankNames = [
  'AB Bank Zambia',
  'Absa Bank Zambia',
  'Access Bank Zambia',
  'Bank of China Zambia',
  'Citibank Zambia',
  'Ecobank Zambia',
  'First Alliance Bank Zambia',
  'First Capital Bank Zambia',
  'First National Bank Zambia',
  'Indo-Zambia Bank',
  'Stanbic Bank Zambia',
  'Standard Chartered Bank Zambia',
  'United Bank for Africa Zambia',
  'Zambia Industrial Commercial Bank',
  'Zambia National Commercial Bank',
] as const;

const fieldNames = [
  'employeeNumber',
  'employeeName',
  'employeeTpin',
  'employerTpin',
  'accountNumber',
  'bankCode',
  'branchCode',
  'reference',
  'grossPay',
  'taxableIncome',
  'paye',
  'napsa',
  'nhima',
  'netPay',
  'paymentDate',
  'taxYear',
  'taxMonth',
] as const;

export const exportTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    purpose: z.enum(['salary_batch', 'paye_return']),
    bank: z.enum(bankNames).optional(),
    sourceReference: z.string().trim().min(1).max(500),
    header: z.boolean(),
    delimiter: z.enum([',', ';', '\t']),
    columns: z
      .array(
        z
          .object({
            header: z.string().trim().min(1).max(100),
            field: z.enum(fieldNames),
          })
          .strict(),
      )
      .min(1)
      .max(40),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.purpose === 'salary_batch' && !value.bank) {
      context.addIssue({
        code: 'custom',
        message: 'Select the bank for this template',
      });
    }
    const fields = value.columns.map((column) => column.field);
    const required =
      value.purpose === 'salary_batch'
        ? ['accountNumber', 'netPay', 'reference']
        : ['employeeTpin', 'taxableIncome', 'paye'];
    if (
      new Set(fields).size !== fields.length ||
      new Set(value.columns.map((column) => column.header)).size !==
        fields.length ||
      required.some(
        (field) => !fields.includes(field as (typeof fields)[number]),
      )
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Columns must be unique and include required payment or return fields',
      });
    }
  });

export type ExportTemplate = z.infer<typeof exportTemplateSchema>;
export const exportRowsSchema = z
  .array(z.partialRecord(z.enum(fieldNames), z.string().max(500)))
  .min(1)
  .max(10000);

/** Preview only. Portal acceptance must be checked against the actual bank/ZRA template. */
export function renderExportPreview(
  template: ExportTemplate,
  rows: z.infer<typeof exportRowsSchema>,
): string {
  const parsed = exportTemplateSchema.parse(template);
  const records = exportRowsSchema.parse(rows);
  const references = new Set<string>();
  const lines = records.map((record) => {
    if (parsed.purpose === 'salary_batch') {
      const reference = record.reference;
      if (!reference || references.has(reference))
        throw new Error('Payment references must be present and unique');
      references.add(reference);
      if (!/^[A-Za-z0-9 -]{4,40}$/.test(record.accountNumber ?? ''))
        throw new Error('Account number is missing or invalid');
    }
    return parsed.columns
      .map((column) => {
        const value = record[column.field];
        if (value === undefined || value === '')
          throw new Error(`Missing ${column.field}`);
        if (
          [
            'grossPay',
            'taxableIncome',
            'paye',
            'napsa',
            'nhima',
            'netPay',
          ].includes(column.field)
        ) {
          if (!/^(0|[1-9]\d*)\.\d{2}$/.test(value))
            throw new Error(`Invalid amount for ${column.field}`);
          if (column.field === 'netPay' && value === '0.00')
            throw new Error('Salary payments must be positive');
        }
        if (column.field.endsWith('Tpin') && !/^\d{10}$/.test(value))
          throw new Error('TPIN must contain 10 digits');
        return csvCell(value);
      })
      .join(parsed.delimiter);
  });
  if (parsed.header)
    lines.unshift(
      parsed.columns
        .map((column) => csvCell(column.header))
        .join(parsed.delimiter),
    );
  return lines.join('\r\n') + '\r\n';
}

function csvCell(value: string): string {
  // Reject spreadsheet formulas instead of changing account/TPIN identifiers.
  if (/^[\s]*[=+@-]/u.test(value) || /[\p{Cc}]/u.test(value)) {
    throw new Error('CSV cells cannot contain formulas or control characters');
  }
  return `"${value.replaceAll('"', '""')}"`;
}

export const complianceProfileSchema = z
  .object({
    industry: z.string().trim().min(1).max(120),
    workerCategory: z.string().trim().min(1).max(120),
    agreementReference: z.string().trim().min(1).max(500),
    statutoryConfigurationId: z.string().uuid(),
  })
  .strict();

export const labourRuleSchema = z
  .object({
    industry: z.string().min(1),
    workerCategory: z.string().min(1),
    minimumMonthlyBasicPay: z.string().regex(/^(0|[1-9]\d*)\.\d{2}$/),
  })
  .strict();

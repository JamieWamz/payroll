import { createHash, randomUUID } from 'node:crypto';
import { createEmployee, createEmployment } from '../domain/index.js';
import { createSalary } from '../../compensation/domain/salary.js';
import { employeePayrollDetailsSchema } from '../../../routes/payroll-details.js';
import { ApiError } from '../../../routes/api-error.js';
export const employeeImportColumns = [
  'employeeNumber',
  'givenName',
  'familyName',
  'positionTitle',
  'startsOn',
  'salary',
  'tpin',
  'napsaNumber',
  'nhimaNumber',
  'bankName',
  'accountName',
  'accountNumber',
  'branchCode',
  'bankCode',
] as const;
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  let closed = false;
  const text = input.replace(/^\uFEFF/, '');
  const cell = () => {
    row.push(value.trim());
    value = '';
    closed = false;
  };
  const line = () => {
    cell();
    if (row.some(Boolean)) rows.push(row);
    row = [];
    if (rows.length > 251)
      throw new ApiError(400, 'Import at most 250 employees at a time.');
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else value += c;
      continue;
    }
    if (c === ',') {
      cell();
      continue;
    }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      line();
      continue;
    }
    if (closed && c.trim())
      throw new ApiError(
        400,
        'Invalid CSV: unexpected text after a closing quote.',
      );
    if (c === '"') {
      if (value.trim() || closed)
        throw new ApiError(400, 'Invalid CSV quote. Quote the entire field.');
      quoted = true;
      value = '';
    } else if (!closed) value += c;
  }
  if (quoted)
    throw new ApiError(400, 'Invalid CSV: a quoted field is not closed.');
  if (value || row.length || closed) line();
  return rows;
}
export function prepareEmployeeImport(companyId: string, source: string) {
  const table = parseCsv(source);
  const headers = table.shift();
  if (!headers || !table.length)
    throw new ApiError(
      400,
      'Add a header row and at least one employee. Download the CSV template for the supported columns.',
    );
  if (
    new Set(headers).size !== headers.length ||
    headers.some(
      (h) =>
        !employeeImportColumns.includes(
          h as (typeof employeeImportColumns)[number],
        ),
    )
  )
    throw new ApiError(
      400,
      'CSV headers must be unique and match the template.',
    );
  if (employeeImportColumns.slice(0, 6).some((h) => !headers.includes(h)))
    throw new ApiError(
      400,
      'The employeeNumber, givenName, familyName, positionTitle, startsOn and salary columns are required.',
    );
  const errors: { row: number; message: string }[] = [];
  const seen = new Set<string>();
  const entries = table.flatMap((cells, index) => {
    const rowNumber = index + 2;
    try {
      if (cells.length !== headers.length)
        throw new Error(
          `Expected ${headers.length} columns; found ${cells.length}.`,
        );
      const raw = Object.fromEntries(headers.map((h, i) => [h, cells[i]!]));
      const employee = createEmployee({
        id: randomUUID(),
        companyId,
        employeeNumber: raw['employeeNumber']!,
        givenName: raw['givenName']!,
        familyName: raw['familyName']!,
      });
      if (seen.has(employee.employeeNumber))
        throw new Error('Employee number is repeated in this file.');
      seen.add(employee.employeeNumber);
      const employment = createEmployment(employee, {
        id: randomUUID(),
        positionTitle: raw['positionTitle']!,
        startsOn: raw['startsOn']!,
      });
      const salary = createSalary(employment, {
        id: randomUUID(),
        amount: raw['salary']!,
        startsOn: raw['startsOn']!,
      });
      const parsed = employeePayrollDetailsSchema.safeParse(
        Object.fromEntries(
          employeeImportColumns.slice(6).map((k) => [k, raw[k] ?? '']),
        ),
      );
      if (!parsed.success)
        throw new Error(
          parsed.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; '),
        );
      return [
        { rowNumber, employee, employment, salary, details: parsed.data },
      ];
    } catch (error) {
      errors.push({
        row: rowNumber,
        message:
          error instanceof Error ? error.message : 'Invalid employee record.',
      });
      return [];
    }
  });
  const digest = createHash('sha256')
    .update(companyId)
    .update('\0')
    .update(source)
    .digest('hex');
  return { entries, errors, digest, total: table.length };
}

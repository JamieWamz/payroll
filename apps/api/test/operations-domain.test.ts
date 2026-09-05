import { describe, expect, it } from 'vitest';
import {
  exportTemplateSchema,
  renderExportPreview,
  type ExportTemplate,
} from '../src/modules/operations/contracts.js';

const salary: ExportTemplate = {
  name: 'Operator-supplied layout',
  purpose: 'salary_batch',
  bank: 'Zambia National Commercial Bank',
  sourceReference: 'Test fixture, not a bank-certified format',
  header: true,
  delimiter: ',',
  columns: [
    { header: 'Account', field: 'accountNumber' },
    { header: 'Amount', field: 'netPay' },
    { header: 'Reference', field: 'reference' },
  ],
};
const row = {
  accountNumber: '0012345678',
  netPay: '2000.50',
  reference: 'PAY-001',
};

describe('operator-defined export previews', () => {
  it('preserves identifiers, decimal amounts, column order and CRLF records', () => {
    expect(renderExportPreview(salary, [row])).toBe(
      '"Account","Amount","Reference"\r\n"0012345678","2000.50","PAY-001"\r\n',
    );
  });
  it('supports selected delimiters, omitted headers and quoted text', () => {
    expect(
      renderExportPreview({ ...salary, header: false, delimiter: ';' }, [
        { ...row, reference: 'PAY "A"' },
      ]),
    ).toBe('"0012345678";"2000.50";"PAY ""A"""\r\n');
  });
  it.each([
    '=HYPERLINK("evil")',
    ' +CMD',
    '@SUM(1)',
    '-1',
    'PAY\n001',
    'PAY\t001',
  ])('rejects unsafe spreadsheet cells: %s', (reference) => {
    expect(() =>
      renderExportPreview(salary, [{ ...row, reference }]),
    ).toThrow();
  });
  it.each(['0.00', '-10.00', '1e3', '1,000.00', '1.001', ' 20.00'])(
    'rejects invalid salary amounts: %s',
    (netPay) => {
      expect(() => renderExportPreview(salary, [{ ...row, netPay }])).toThrow();
    },
  );
  it('rejects missing fields, duplicate references and unknown fields', () => {
    expect(() =>
      renderExportPreview(salary, [{ accountNumber: row.accountNumber }]),
    ).toThrow();
    expect(() => renderExportPreview(salary, [row, row])).toThrow(/unique/);
    expect(() =>
      renderExportPreview(salary, [{ ...row, unknown: 'value' } as typeof row]),
    ).toThrow();
  });
  it('rejects incomplete and duplicate template columns', () => {
    expect(
      exportTemplateSchema.safeParse({
        ...salary,
        columns: salary.columns.slice(0, 1),
      }).success,
    ).toBe(false);
    expect(
      exportTemplateSchema.safeParse({
        ...salary,
        columns: [...salary.columns, salary.columns[0]],
      }).success,
    ).toBe(false);
    expect(() =>
      renderExportPreview(
        {
          ...salary,
          columns: salary.columns.map((column) => ({
            ...column,
            header: '=' + column.header,
          })),
        },
        [row],
      ),
    ).toThrow();
  });
  it('renders a configurable PAYE preview without pretending it is a certified TaxOnline layout', () => {
    const template: ExportTemplate = {
      name: 'PAYE review',
      purpose: 'paye_return',
      sourceReference: 'Test only',
      header: true,
      delimiter: ',',
      columns: [
        { header: 'TPIN', field: 'employeeTpin' },
        { header: 'Taxable', field: 'taxableIncome' },
        { header: 'PAYE', field: 'paye' },
      ],
    };
    expect(
      renderExportPreview(template, [
        {
          employeeTpin: '0123456789',
          taxableIncome: '8000.00',
          paye: '930.00',
        },
      ]),
    ).toContain('"0123456789","8000.00","930.00"');
    expect(() =>
      renderExportPreview(template, [
        { employeeTpin: '123', taxableIncome: '0.00', paye: '0.00' },
      ]),
    ).toThrow(/TPIN/);
  });
});

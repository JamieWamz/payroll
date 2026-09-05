import { describe, expect, it } from 'vitest';
import {
  fnbBatchSchema,
  renderFnbZambiaBatch,
  type FnbBatch,
} from '../src/modules/operations/fnb-zambia.js';

const batch: FnbBatch = {
  ownAccount: '62000031451',
  actionDate: '2026-09-05',
  rows: [
    {
      recipientName: 'Jane Banda',
      recipientAccount: '00123456789',
      accountType: '1',
      branchCode: '260006',
      amount: '2500.01',
      ownReference: 'EMP001 SEP26',
      recipientReference: 'SEP26 SALARY',
    },
  ],
};
describe('FNB Zambia documented CSV format', () => {
  it('matches the downloaded template structure and preserves identifier bytes', () => {
    const csv = renderFnbZambiaBatch(batch, '2026-09-05');
    const lines = csv.trimEnd().split('\r\n');
    expect(lines).toHaveLength(5);
    expect(lines.every((line) => line.split(',').length === 36)).toBe(true);
    expect(lines[0]).toBe('BInSol - U ver 1.00' + ','.repeat(35));
    expect(lines[1]).toBe('2026-09-05' + ','.repeat(35));
    expect(lines[2]).toBe('62000031451,062123488240' + ','.repeat(34));
    expect(lines[3]).toBe(
      'RECIPIENT NAME,RECIPIENT ACCOUNT,RECIPIENT ACCOUNT TYPE,BRANCHCODE,AMOUNT,OWN REFERENCE,RECIPIENT REFERENCE,EMAIL 1 NOTIFY,EMAIL 1 ADDRESS,EMAIL 1 SUBJECT,EMAIL 2 NOTIFY,EMAIL 2 ADDRESS,EMAIL 2 SUBJECT,EMAIL 3 NOTIFY,EMAIL 3 ADDRESS,EMAIL 3 SUBJECT,EMAIL 4 NOTIFY,EMAIL 4 ADDRESS,EMAIL 4 SUBJECT,EMAIL 5 NOTIFY,EMAIL 5 ADDRESS,EMAIL 5 SUBJECT,FAX 1 NOTIFY,FAX 1 CODE,FAX 1 NUMBER,FAX 1 SUBJECT,FAX 2 NOTIFY,FAX 2 CODE,FAX 2 NUMBER,FAX 2 SUBJECT,SMS 1 NOTIFY,SMS 1 CODE,SMS 1 NUMBER,SMS 2 NOTIFY,SMS 2 CODE,SMS 2 NUMBER',
    );
    expect(lines[4]).toBe(
      'Jane Banda,00123456789,1,260006,2500.01,EMP001 SEP26,SEP26 SALARY' +
        ','.repeat(29),
    );
    expect(csv.endsWith('\r\n')).toBe(true);
  });
  it('sums whole account numbers exactly, adding own account once, then retaining the last 12 digits', () => {
    const rows = [
      {
        ...batch.rows[0]!,
        recipientAccount: '99999999999999999999',
        ownReference: 'A',
      },
      { ...batch.rows[0]!, recipientAccount: '00000000001', ownReference: 'B' },
    ];
    expect(
      renderFnbZambiaBatch({ ...batch, rows }, '2026-09-05').split('\r\n')[2],
    ).toContain('62000031451,062000031451,');
  });
  it.each(['2026-09-04', '2027-09-06', '2026-02-30', '05/09/2026'])(
    'rejects invalid or unsupported action date %s',
    (actionDate) => {
      expect(() =>
        renderFnbZambiaBatch({ ...batch, actionDate }, '2026-09-05'),
      ).toThrow();
    },
  );
  it('accepts the inclusive 365-day boundary', () => {
    expect(
      renderFnbZambiaBatch(
        { ...batch, actionDate: '2027-09-05' },
        '2026-09-05',
      ),
    ).toContain('2027-09-05');
  });
  it.each([
    { recipientName: '=CMD' },
    { recipientName: 'Name\nInjected' },
    { recipientName: 'A'.repeat(21) },
    { recipientName: 'A,B' },
    { recipientAccount: '1e10' },
    { recipientAccount: '000000' },
    { accountType: 'S' },
    { branchCode: '12345' },
    { branchCode: '000000' },
    { amount: '0.00' },
    { amount: '-1.00' },
    { amount: '10.001' },
    { amount: '100000000.00' },
    { ownReference: '+formula' },
  ])('rejects invalid row %j', (change) => {
    expect(
      fnbBatchSchema.safeParse({
        ...batch,
        rows: [{ ...batch.rows[0], ...change }],
      }).success,
    ).toBe(false);
  });
  it('rejects bad own accounts without throwing from safeParse', () => {
    expect(
      fnbBatchSchema.safeParse({ ...batch, ownAccount: 'notanaccount' })
        .success,
    ).toBe(false);
  });
  it('requires nonempty batches and distinct own references', () => {
    expect(fnbBatchSchema.safeParse({ ...batch, rows: [] }).success).toBe(
      false,
    );
    expect(() =>
      renderFnbZambiaBatch(
        { ...batch, rows: [batch.rows[0]!, batch.rows[0]!] },
        '2026-09-05',
      ),
    ).toThrow(/unique/);
  });
});

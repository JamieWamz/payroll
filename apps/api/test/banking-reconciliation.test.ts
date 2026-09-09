import { describe, expect, it } from 'vitest';
import {
  reconcileStatement,
  type ExpectedPayment,
} from '../src/modules/banking/reconciliation.js';
import {
  bankCatalog,
  bankRequestBrief,
} from '../src/modules/banking/catalog.js';
import { bankNames } from '../src/modules/operations/contracts.js';
const payments: ExpectedPayment[] = [
  {
    employeeNumber: '001',
    employeeName: 'Jane',
    reference: 'ZP0123456789ABCDEF01',
    amount: '10924.00',
    paymentDate: '2026-08-31',
  },
  {
    employeeNumber: '002',
    employeeName: 'John',
    reference: 'ZP0123456789ABCDEF02',
    amount: '5000.00',
    paymentDate: '2026-08-31',
  },
];
const header = 'transactionId,bookingDate,reference,amount,currency\n';
const review = (rows: string, expected = payments) =>
  reconcileStatement(expected, header + rows, '2026-08-01', '2026-09-05');
describe('bank statement reconciliation', () => {
  it('matches only exact referenced ZMW debits and leaves unrelated fees unmatched', () => {
    const result = review(
      '00001,2026-08-31,ZP0123456789ABCDEF01,-10924.00,ZMW\n00002,2026-08-31,BANK FEE,-25.00,ZMW',
    );
    expect(result.summary).toMatchObject({
      matched: 1,
      missing: 1,
      unmatched: 1,
      exceptions: 0,
    });
    expect(result.results[0]?.entries[0]?.transactionId).toBe('00001');
    expect(result.unmatched[0]?.reference).toBe('BANK FEE');
    expect(result.mode).toBe('uploaded_statement_review');
  });
  it.each(['10924.00', '-10923.99'])(
    'flags direction or amount mismatch %s',
    (amount) => {
      expect(
        review(`one,2026-08-31,ZP0123456789ABCDEF01,${amount},ZMW`).results[0]
          ?.status,
      ).toBe('amount_mismatch');
    },
  );
  it('does not call duplicate debits or a debit plus reversal matched', () => {
    const result = review(
      'one,2026-08-31,ZP0123456789ABCDEF01,-10924.00,ZMW\ntwo,2026-09-01,ZP0123456789ABCDEF01,10924.00,ZMW',
    );
    expect(result.summary).toMatchObject({ matched: 0, exceptions: 1 });
    expect(result.results[0]?.status).toBe('multiple_entries');
  });
  it('never guesses employee matches from a consolidated debit or amount alone', () => {
    const result = review(
      'batch,2026-08-31,SALARIES,-15924.00,ZMW\nunknown,2026-08-31,OTHER,-10924.00,ZMW',
    );
    expect(result.summary).toMatchObject({
      matched: 0,
      missing: 2,
      unmatched: 2,
    });
  });
  it.each([
    'same,2026-08-31,R,-1.00,ZMW\nsame,2026-08-31,Q,-2.00,ZMW',
    'one,2026-08-31,R,-1.00,USD',
    'one,2026-02-30,R,-1.00,ZMW',
    'one,2026-09-06,R,-1.00,ZMW',
    'one,2026-08-31,R,1e3,ZMW',
    'one,2026-08-31,R,-1.123,ZMW',
  ])('rejects invalid, duplicate or out-of-period records', (rows) => {
    expect(() => review(rows)).toThrow();
  });
  it('handles zero net pay without reporting an absent debit as a failure', () => {
    const result = review('fee,2026-08-31,FEE,-1.00,ZMW', [
      { ...payments[0]!, amount: '0.00' },
    ]);
    expect(result.summary).toMatchObject({
      noPaymentDue: 1,
      missing: 0,
      matched: 0,
    });
  });
  it('bounds upload size and row count before reviewing payments', () => {
    expect(() => review('x'.repeat(500_001))).toThrow('500 KB');
    const rows = Array.from(
      { length: 5001 },
      (_, index) => `${index},2026-08-31,FEE,-1.00,ZMW`,
    ).join('\n');
    expect(() => review(rows)).toThrow('5,000');
  });
  it('requires unambiguous headers and unique expected references', () => {
    expect(() =>
      reconcileStatement(
        payments,
        'transactionId,bookingDate,reference,amount,amount\nx,2026-08-31,R,1.00,1.00',
        '2026-08-01',
        '2026-08-31',
      ),
    ).toThrow('headers');
    expect(() =>
      review('x,2026-08-31,R,-1.00,ZMW', [payments[0]!, payments[0]!]),
    ).toThrow('ambiguous');
  });
  it('covers the registered banks without claiming any live connection', () => {
    expect(bankCatalog.map((bank) => bank.name)).toEqual([...bankNames]);
    expect(bankCatalog).toHaveLength(15);
    for (const bank of bankCatalog) {
      expect(bank.connectionStatus).toBe('not_connected');
      expect(bank.sources.length).toBeGreaterThan(0);
      expect(bankRequestBrief(bank.name)).toContain(
        'ZamPayroll has not submitted a bank application.',
      );
    }
  });
});

import { describe, expect, it } from 'vitest';
import { csv } from '../src/modules/payroll/application/documents.js';
import {
  encode,
  fingerprint,
} from '../src/modules/payroll/application/preparation.js';

describe('payroll evidence and export boundaries', () => {
  it('compares JSONB snapshots independently of object key order', () => {
    expect(
      fingerprint({
        identity: { name: 'Banda', id: '1' },
        amount: { minorUnits: 12n, currency: 'ZMW' },
      }),
    ).toBe(
      fingerprint({
        amount: { currency: 'ZMW', minorUnits: '12' },
        identity: { id: '1', name: 'Banda' },
      }),
    );
    expect(fingerprint({ amount: 12n })).not.toBe(fingerprint({ amount: 13n }));
    expect(fingerprint({ entries: ['a', 'b'] })).not.toBe(
      fingerprint({ entries: ['b', 'a'] }),
    );
    expect(encode({ minorUnits: -125n })).toBe('{"minorUnits":"-125"}');
  });
  it('preserves account identifiers and signed monetary refunds without enabling spreadsheet formulas', () => {
    expect(
      csv([
        [
          '0012345678',
          { amount: '-125.50' },
          '=HYPERLINK("example")',
          '  +CMD',
          'A "quoted" name',
        ],
      ]),
    ).toBe(
      '"0012345678","-125.50","\'=HYPERLINK(""example"")","\'  +CMD","A ""quoted"" name"\r\n',
    );
  });
});

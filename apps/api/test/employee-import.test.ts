import { describe, expect, it } from 'vitest';
import {
  parseCsv,
  prepareEmployeeImport,
} from '../src/modules/workforce/application/employee-import.js';
const company = '9e9905ab-641a-4b1b-a72c-d623b59d28c0';
const headers =
  'employeeNumber,givenName,familyName,positionTitle,startsOn,salary';
describe('employee CSV validation', () => {
  it('reads BOM, escaped quotes, CRLF and quoted commas without losing identifiers', () => {
    expect(parseCsv('\uFEFFcode,name\r\n00012,"Banda, ""Jane"""\r\n')).toEqual([
      ['code', 'name'],
      ['00012', 'Banda, "Jane"'],
    ]);
    const result = prepareEmployeeImport(
      company,
      headers + '\n00012,Jane,Banda,Accountant,2025-01-01,15000.35',
    );
    expect(result.entries[0]?.salary.amount.minorUnits).toBe(1500035n);
    expect(result.errors).toEqual([]);
  });
  it('reports duplicate numbers and invalid financial/date values at their rows', () => {
    const result = prepareEmployeeImport(
      company,
      headers +
        '\nA,Jane,Banda,Accountant,2025-01-01,1000\nA,John,Banda,Accountant,2025-01-01,1000\nB,John,Banda,Accountant,2025-02-30,1000\nC,John,Banda,Accountant,2025-01-01,-1000',
    );
    expect(result.errors.map((e) => e.row)).toEqual([3, 4, 5]);
    expect(result.entries).toHaveLength(1);
  });
  it('rejects malformed quotes, unknown headers and overlarge row batches', () => {
    expect(() => parseCsv('a\n"unfinished')).toThrow('not closed');
    expect(() => parseCsv('a\n"value"bad')).toThrow('closing quote');
    expect(() =>
      prepareEmployeeImport(
        company,
        headers + ',unknown\nA,Jane,Banda,Accountant,2025-01-01,1,x',
      ),
    ).toThrow('headers');
    expect(() =>
      parseCsv(
        'header\n' + Array.from({ length: 251 }, () => 'value').join('\n'),
      ),
    ).toThrow('250');
  });
});

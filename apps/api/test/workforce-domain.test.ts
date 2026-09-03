import { describe, expect, it } from 'vitest';

import { parseLocalDate } from '../src/shared/domain/local-date.js';
import {
  archiveEmployee,
  assertEmploymentHistory,
  createEmployee,
  createEmployment,
  employmentIsEffectiveOn,
  endEmployment,
} from '../src/modules/workforce/domain/index.js';

const companyId = '71000000-0000-4000-8000-000000000001';
const anotherCompanyId = '71000000-0000-4000-8000-000000000002';
const employeeId = '72000000-0000-4000-8000-000000000001';
const anotherEmployeeId = '72000000-0000-4000-8000-000000000002';
const employmentId = '73000000-0000-4000-8000-000000000001';
const secondEmploymentId = '73000000-0000-4000-8000-000000000002';

function createFixtureEmployee(overrides = {}) {
  return createEmployee({
    companyId,
    employeeNumber: ' emp/0001 ',
    familyName: '  Mwansa ',
    givenName: '  Chanda  ',
    id: employeeId,
    middleName: '  Bwalya  ',
    ...overrides,
  });
}

describe('employees', () => {
  it('normalizes a minimal employee identity and freezes nested names', () => {
    const employee = createFixtureEmployee();

    expect(employee).toEqual({
      companyId,
      employeeNumber: 'EMP/0001',
      id: employeeId,
      name: {
        familyName: 'Mwansa',
        givenName: 'Chanda',
        middleName: 'Bwalya',
      },
      status: 'active',
    });
    expect(Object.isFrozen(employee)).toBe(true);
    expect(Object.isFrozen(employee.name)).toBe(true);
  });

  it('rejects malformed employee numbers, names, and statuses', () => {
    expect(() =>
      createFixtureEmployee({ employeeNumber: 'EMP 0001' }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_DOMAIN_CODE' }));
    expect(() => createFixtureEmployee({ givenName: ' ' })).toThrowError(
      expect.objectContaining({ code: 'INVALID_DOMAIN_NAME' }),
    );
    expect(() =>
      createFixtureEmployee({ middleName: 'Bad\nName' }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_DOMAIN_NAME' }));
    expect(() => createFixtureEmployee({ status: 'deleted' })).toThrowError(
      expect.objectContaining({ code: 'INVALID_ENTITY_STATUS' }),
    );
  });
});

describe('effective-dated employment', () => {
  it('creates and ends an immutable employment period', () => {
    const employee = createFixtureEmployee();
    const active = createEmployment(employee, {
      id: employmentId,
      positionTitle: '  Senior   Payroll Officer ',
      startsOn: '2025-01-01',
    });
    const ended = endEmployment(active, '2026-08-31');

    expect(active).toEqual({
      companyId,
      effectivePeriod: { startsOn: '2025-01-01' },
      employeeId,
      id: employmentId,
      positionTitle: 'Senior Payroll Officer',
    });
    expect(ended.effectivePeriod).toEqual({
      endsOn: '2026-08-31',
      startsOn: '2025-01-01',
    });
    expect(active.effectivePeriod).toEqual({ startsOn: '2025-01-01' });
    expect(Object.isFrozen(active)).toBe(true);
    expect(Object.isFrozen(active.effectivePeriod)).toBe(true);
  });

  it('rejects invalid dates, titles, and repeated termination', () => {
    const employee = createFixtureEmployee();
    const active = createEmployment(employee, {
      id: employmentId,
      positionTitle: 'Officer',
      startsOn: '2026-09-01',
    });

    expect(() => endEmployment(active, '2026-08-31')).toThrowError(
      expect.objectContaining({ code: 'INVALID_DATE_INTERVAL' }),
    );
    const ended = endEmployment(active, '2026-09-01');
    expect(() => endEmployment(ended, '2026-09-02')).toThrowError(
      expect.objectContaining({ code: 'EMPLOYMENT_ALREADY_ENDED' }),
    );
    expect(() =>
      createEmployment(employee, {
        id: employmentId,
        positionTitle: '\n',
        startsOn: '2026-09-01',
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_DOMAIN_NAME' }));
  });

  it('treats date intervals as inclusive and detects overlapping history', () => {
    const employee = createFixtureEmployee();
    const first = createEmployment(employee, {
      endsOn: '2025-12-31',
      id: employmentId,
      positionTitle: 'Officer',
      startsOn: '2025-01-01',
    });
    const overlapping = createEmployment(employee, {
      id: secondEmploymentId,
      positionTitle: 'Manager',
      startsOn: '2025-12-31',
    });

    expect(() =>
      assertEmploymentHistory(employee, [overlapping, first]),
    ).toThrowError(
      expect.objectContaining({ code: 'EMPLOYMENT_HISTORY_OVERLAP' }),
    );
    expect(employmentIsEffectiveOn(first, parseLocalDate('2025-12-31'))).toBe(
      true,
    );
    expect(employmentIsEffectiveOn(first, parseLocalDate('2026-01-01'))).toBe(
      false,
    );
  });

  it('accepts nonoverlapping re-employment and rejects wrong history ownership', () => {
    const employee = createFixtureEmployee();
    const first = createEmployment(employee, {
      endsOn: '2025-12-31',
      id: employmentId,
      positionTitle: 'Officer',
      startsOn: '2025-01-01',
    });
    const second = createEmployment(employee, {
      id: secondEmploymentId,
      positionTitle: 'Manager',
      startsOn: '2026-01-01',
    });
    expect(() =>
      assertEmploymentHistory(employee, [second, first]),
    ).not.toThrow();

    const foreignEmployee = createFixtureEmployee({
      companyId: anotherCompanyId,
      employeeNumber: 'EMP/0002',
      id: anotherEmployeeId,
    });
    const foreignEmployment = createEmployment(foreignEmployee, {
      id: secondEmploymentId,
      positionTitle: 'Manager',
      startsOn: '2026-01-01',
    });
    expect(() =>
      assertEmploymentHistory(employee, [foreignEmployment]),
    ).toThrowError(expect.objectContaining({ code: 'TENANT_SCOPE_MISMATCH' }));
  });

  it('requires every employment to end before archiving an employee', () => {
    const employee = createFixtureEmployee();
    const active = createEmployment(employee, {
      id: employmentId,
      positionTitle: 'Officer',
      startsOn: '2025-01-01',
    });

    expect(() => archiveEmployee(employee, [active])).toThrowError(
      expect.objectContaining({ code: 'EMPLOYEE_HAS_OPEN_EMPLOYMENT' }),
    );

    const archived = archiveEmployee(employee, [
      endEmployment(active, '2026-08-31'),
    ]);
    expect(archived.status).toBe('archived');
    expect(employee.status).toBe('active');
    expect(() => archiveEmployee(archived, [])).toThrowError(
      expect.objectContaining({ code: 'INVALID_ENTITY_STATUS' }),
    );
    expect(() =>
      createEmployment(archived, {
        id: secondEmploymentId,
        positionTitle: 'Manager',
        startsOn: '2026-09-01',
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ENTITY_STATUS' }));
  });
});

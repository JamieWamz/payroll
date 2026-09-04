import { describe, expect, it } from 'vitest';

import { createCompany } from '../src/modules/companies/domain/index.js';
import {
  assertCompensationComponentHistory,
  assertSalaryHistory,
  compensationComponentIsEffectiveOn,
  createCompensationComponent,
  createSalary,
  endCompensationComponent,
  endSalary,
  salaryIsEffectiveOn,
} from '../src/modules/compensation/domain/index.js';
import {
  assertPayrollPeriodSchedule,
  createPayrollPeriod,
} from '../src/modules/payroll/domain/index.js';
import {
  createEmployee,
  createEmployment,
  endEmployment,
} from '../src/modules/workforce/domain/index.js';
import { parseLocalDate } from '../src/shared/domain/local-date.js';

const companyId = '81000000-0000-4000-8000-000000000001';
const anotherCompanyId = '81000000-0000-4000-8000-000000000002';
const employeeId = '82000000-0000-4000-8000-000000000001';
const employmentId = '83000000-0000-4000-8000-000000000001';
const salaryId = '84000000-0000-4000-8000-000000000001';
const secondSalaryId = '84000000-0000-4000-8000-000000000002';
const componentId = '85000000-0000-4000-8000-000000000001';
const secondComponentId = '85000000-0000-4000-8000-000000000002';
const periodId = '86000000-0000-4000-8000-000000000001';
const secondPeriodId = '86000000-0000-4000-8000-000000000002';

function createFixtureEmployment(endsOn?: string) {
  const employee = createEmployee({
    companyId,
    employeeNumber: 'EMP/001',
    familyName: 'Mwansa',
    givenName: 'Chanda',
    id: employeeId,
  });
  const employment = createEmployment(employee, {
    id: employmentId,
    positionTitle: 'Payroll Officer',
    startsOn: '2025-01-01',
  });

  return endsOn === undefined ? employment : endEmployment(employment, endsOn);
}

describe('effective-dated salary', () => {
  it('creates an immutable monthly ZMW salary within employment', () => {
    const salary = createSalary(createFixtureEmployment(), {
      amount: '25000.50',
      id: salaryId,
      startsOn: '2026-01-01',
    });

    expect(salary).toEqual({
      amount: {
        currency: 'ZMW',
        minorUnits: 2_500_050n,
        scale: 2,
      },
      basis: 'monthly',
      companyId,
      effectivePeriod: { startsOn: '2026-01-01' },
      employmentId,
      id: salaryId,
    });
    expect(Object.isFrozen(salary)).toBe(true);
    expect(Object.isFrozen(salary.amount)).toBe(true);
    expect(salaryIsEffectiveOn(salary, parseLocalDate('2026-09-01'))).toBe(
      true,
    );
  });

  it('rejects nonpositive amounts and periods outside employment', () => {
    const employment = createFixtureEmployment('2026-06-30');

    expect(() =>
      createSalary(createFixtureEmployment(), {
        amount: '0.00',
        id: salaryId,
        startsOn: '2026-01-01',
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'INVALID_COMPENSATION_AMOUNT' }),
    );
    expect(() =>
      createSalary(employment, {
        amount: '1000.00',
        endsOn: '2026-07-01',
        id: salaryId,
        startsOn: '2026-01-01',
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'COMPENSATION_OUTSIDE_EMPLOYMENT' }),
    );
  });

  it('accepts adjacent salary history and rejects inclusive overlaps', () => {
    const employment = createFixtureEmployment();
    const first = createSalary(employment, {
      amount: '10000.00',
      endsOn: '2026-06-30',
      id: salaryId,
      startsOn: '2026-01-01',
    });
    const next = createSalary(employment, {
      amount: '12000.00',
      id: secondSalaryId,
      startsOn: '2026-07-01',
    });

    expect(() => assertSalaryHistory(employment, [next, first])).not.toThrow();

    const overlapping = createSalary(employment, {
      amount: '12000.00',
      id: secondSalaryId,
      startsOn: '2026-06-30',
    });
    expect(() =>
      assertSalaryHistory(employment, [first, overlapping]),
    ).toThrowError(
      expect.objectContaining({ code: 'COMPENSATION_HISTORY_OVERLAP' }),
    );
  });

  it('ends an open salary once and keeps it within employment', () => {
    const employment = createFixtureEmployment();
    const salary = createSalary(employment, {
      amount: '10000.00',
      id: salaryId,
      startsOn: '2026-01-01',
    });
    const ended = endSalary(employment, salary, '2026-06-30');
    expect(ended.effectivePeriod.endsOn).toBe('2026-06-30');
    expect(() => endSalary(employment, ended, '2026-07-31')).toThrowError(
      expect.objectContaining({ code: 'COMPENSATION_ALREADY_ENDED' }),
    );
  });
});

describe('allowances and deductions', () => {
  it('normalizes a fixed component without assuming tax treatment', () => {
    const component = createCompensationComponent(createFixtureEmployment(), {
      amount: '750.00',
      code: ' transport_allowance ',
      id: componentId,
      kind: 'allowance',
      name: '  Transport   allowance ',
      startsOn: '2026-01-01',
    });

    expect(component).toMatchObject({
      amount: { currency: 'ZMW', minorUnits: 75_000n, scale: 2 },
      basis: 'fixed_per_period',
      code: 'TRANSPORT_ALLOWANCE',
      companyId,
      employmentId,
      id: componentId,
      kind: 'allowance',
      name: 'Transport allowance',
    });
    expect(
      compensationComponentIsEffectiveOn(
        component,
        parseLocalDate('2026-02-01'),
      ),
    ).toBe(true);
  });

  it('rejects invalid component values and overlapping matching codes', () => {
    const employment = createFixtureEmployment();
    const first = createCompensationComponent(employment, {
      amount: '100.00',
      code: 'LOAN',
      endsOn: '2026-06-30',
      id: componentId,
      kind: 'deduction',
      name: 'Loan repayment',
      startsOn: '2026-01-01',
    });
    const overlapping = createCompensationComponent(employment, {
      amount: '150.00',
      code: 'loan',
      id: secondComponentId,
      kind: 'deduction',
      name: 'Loan repayment',
      startsOn: '2026-06-30',
    });

    expect(() =>
      assertCompensationComponentHistory(employment, [first, overlapping]),
    ).toThrowError(
      expect.objectContaining({ code: 'COMPENSATION_HISTORY_OVERLAP' }),
    );
    expect(() =>
      createCompensationComponent(employment, {
        amount: '-1.00',
        code: 'BAD CODE',
        id: secondComponentId,
        kind: 'earning',
        name: 'Invalid',
        startsOn: '2026-01-01',
      }),
    ).toThrowError();
  });

  it('ends an open component once', () => {
    const employment = createFixtureEmployment();
    const component = createCompensationComponent(employment, {
      amount: '100.00',
      code: 'LOAN',
      id: componentId,
      kind: 'deduction',
      name: 'Loan repayment',
      startsOn: '2026-01-01',
    });
    expect(
      endCompensationComponent(employment, component, '2026-06-30')
        .effectivePeriod.endsOn,
    ).toBe('2026-06-30');
  });
});

describe('payroll periods', () => {
  const company = createCompany({
    code: 'period-company',
    id: companyId,
    name: 'Period Company',
  });

  it('creates regular and off-cycle periods with independent payment dates', () => {
    const period = createPayrollPeriod({
      code: ' sep-2026 ',
      companyId,
      endsOn: '2026-09-30',
      id: periodId,
      paymentDate: '2026-09-25',
      startsOn: '2026-09-01',
    });

    expect(period).toEqual({
      code: 'SEP-2026',
      companyId,
      id: periodId,
      kind: 'regular',
      paymentDate: '2026-09-25',
      period: { endsOn: '2026-09-30', startsOn: '2026-09-01' },
    });
    expect(Object.isFrozen(period)).toBe(true);
  });

  it('rejects overlapping regular schedules but permits off-cycle overlap', () => {
    const regular = createPayrollPeriod({
      code: 'SEP-2026',
      companyId,
      endsOn: '2026-09-30',
      id: periodId,
      paymentDate: '2026-09-25',
      startsOn: '2026-09-01',
    });
    const overlapping = createPayrollPeriod({
      code: 'SEP-OCT-2026',
      companyId,
      endsOn: '2026-10-31',
      id: secondPeriodId,
      paymentDate: '2026-10-25',
      startsOn: '2026-09-30',
    });

    expect(() =>
      assertPayrollPeriodSchedule(company.id, [regular, overlapping]),
    ).toThrowError(
      expect.objectContaining({ code: 'INVALID_PAYROLL_PERIOD_SCHEDULE' }),
    );

    const offCycle = createPayrollPeriod({
      code: 'BONUS-SEP-2026',
      companyId,
      endsOn: '2026-09-30',
      id: secondPeriodId,
      kind: 'off_cycle',
      paymentDate: '2026-09-30',
      startsOn: '2026-09-01',
    });
    expect(() =>
      assertPayrollPeriodSchedule(company.id, [regular, offCycle]),
    ).not.toThrow();
  });

  it('rejects malformed periods, duplicate codes, and cross-company schedules', () => {
    expect(() =>
      createPayrollPeriod({
        code: 'SEP 2026',
        companyId,
        endsOn: '2026-08-31',
        id: periodId,
        paymentDate: '2026-09-25',
        startsOn: '2026-09-01',
      }),
    ).toThrowError();

    const period = createPayrollPeriod({
      code: 'SEP-2026',
      companyId,
      endsOn: '2026-09-30',
      id: periodId,
      paymentDate: '2026-09-25',
      startsOn: '2026-09-01',
    });
    const foreign = createPayrollPeriod({
      code: 'OCT-2026',
      companyId: anotherCompanyId,
      endsOn: '2026-10-31',
      id: secondPeriodId,
      paymentDate: '2026-10-25',
      startsOn: '2026-10-01',
    });
    expect(() =>
      assertPayrollPeriodSchedule(company.id, [period, foreign]),
    ).toThrowError(expect.objectContaining({ code: 'TENANT_SCOPE_MISMATCH' }));
  });
});

import { describe, expect, it } from 'vitest';

import type { PayrollCalculator } from '../src/modules/payroll/calculation/contract.js';
import type {
  CalculationVersion,
  ConfigurationVersion,
  PayrollCalculationInput,
  PayrollCalculationOutcome,
  RoundingPolicyIdentifier,
} from '../src/modules/payroll/calculation/types.js';
import {
  calculatePayrollRun,
  createDraftPayrollRun,
  createPayrollPeriod,
  finalizePayrollRun,
  returnPayrollRunToDraft,
} from '../src/modules/payroll/domain/index.js';
import {
  createDraftStatutoryConfiguration,
  verifyStatutoryConfiguration,
} from '../src/modules/statutory-configuration/domain/index.js';
import {
  moneyFromMinorUnits,
  parseCurrencyCode,
} from '../src/shared/domain/money.js';

const companyId = 'b1000000-0000-4000-8000-000000000001';
const employeeId = 'b2000000-0000-4000-8000-000000000001';
const secondEmployeeId = 'b2000000-0000-4000-8000-000000000002';
const employmentId = 'b3000000-0000-4000-8000-000000000001';
const periodId = 'b4000000-0000-4000-8000-000000000001';
const configurationId = 'b5000000-0000-4000-8000-000000000001';
const membershipId = 'b6000000-0000-4000-8000-000000000001';
const runId = 'b7000000-0000-4000-8000-000000000001';
const calculationVersion = 'ENGINE-0.1.0' as CalculationVersion;
const configurationVersion = 'ZM-2026.1' as ConfigurationVersion;
const roundingPolicy = 'ZMW-2DP-HALF-UP' as RoundingPolicyIdentifier;
const zmw = parseCurrencyCode('ZMW');

const period = createPayrollPeriod({
  code: 'SEP-2026',
  companyId,
  endsOn: '2026-09-30',
  id: periodId,
  paymentDate: '2026-09-25',
  startsOn: '2026-09-01',
});

const verifiedConfiguration = verifyStatutoryConfiguration(
  createDraftStatutoryConfiguration({
    companyId,
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-12-31',
    id: configurationId,
    parameters: {
      nhima: { state: 'evidence-only' },
      napsa: { state: 'evidence-only' },
      paye: { state: 'evidence-only' },
    },
    sources: [
      source('zra', 'https://www.zra.org.zm/evidence'),
      source('napsa', 'https://www.napsa.co.zm/evidence'),
      source('nhima', 'https://www.nhima.co.zm/evidence'),
    ],
    version: configurationVersion,
  }),
  membershipId,
  '2026-09-04T10:00:00.000Z',
);

function createRun(employeeIds = [employeeId]) {
  return createDraftPayrollRun({
    companyId,
    createdAt: '2026-09-04T10:05:00.000Z',
    createdByMembershipId: membershipId,
    employeeIds,
    id: runId,
    payrollPeriod: period,
    statutoryConfiguration: verifiedConfiguration,
  });
}

function createInput(selectedEmployeeId = employeeId): PayrollCalculationInput {
  return {
    calculationVersion,
    compensation: [],
    employee: {
      companyId: companyId as PayrollCalculationInput['employee']['companyId'],
      employeeId:
        selectedEmployeeId as PayrollCalculationInput['employee']['employeeId'],
    },
    employment: {
      effectivePeriod: {
        startsOn:
          '2025-01-01' as PayrollCalculationInput['employment']['effectivePeriod']['startsOn'],
      },
      employeeId:
        selectedEmployeeId as PayrollCalculationInput['employment']['employeeId'],
      employmentId:
        employmentId as PayrollCalculationInput['employment']['employmentId'],
    },
    period: {
      endsOn: period.period.endsOn,
      paymentDate: period.paymentDate,
      periodId: period.id,
      startsOn: period.period.startsOn,
    },
    roundingPolicy,
    statutoryConfiguration: {
      configurationId: verifiedConfiguration.id,
      effectivePeriod: verifiedConfiguration.effectivePeriod,
      parameters: verifiedConfiguration.parameters,
      sources: verifiedConfiguration.sources,
      verificationStatus: 'verified',
      version: configurationVersion,
    },
    statutoryContext: {
      napsaEmployeeContributionBeforePeriod: amount(0n),
      napsaEmployerContributionBeforePeriod: amount(0n),
      napsaEarningsBeforePeriod: amount(0n),
      payeBeforePeriod: amount(0n),
      taxableIncomeBeforePeriod: amount(0n),
    },
  };
}

function createOutcome(
  selectedEmployeeId = employeeId,
): PayrollCalculationOutcome {
  return {
    breakdown: [
      line('BASE', 'earning', 100_000n),
      line('PAYE', 'statutory_deduction', 10_000n),
      line('NAPSA-EMPLOYEE', 'statutory_deduction', 5_000n),
      line('NHIMA-EMPLOYEE', 'statutory_deduction', 1_000n),
      line('LOAN', 'other_deduction', 2_000n),
      line('NAPSA-EMPLOYER', 'employer_contribution', 5_000n),
    ],
    calculationVersion,
    employeeId: selectedEmployeeId as PayrollCalculationOutcome['employeeId'],
    employerContributions: [{ amount: amount(5_000n), code: 'NAPSA-EMPLOYER' }],
    grossPay: amount(100_000n),
    napsa: amount(5_000n),
    netPay: amount(82_000n),
    nhima: amount(1_000n),
    otherDeductions: amount(2_000n),
    paye: amount(10_000n),
    periodId: period.id,
    roundingPolicy,
    statutoryConfigurationId: verifiedConfiguration.id,
    statutoryConfigurationVersion: configurationVersion,
    taxableIncome: amount(100_000n),
  };
}

describe('payroll run lifecycle', () => {
  it('creates a draft pinned to a verified configuration covering the period', () => {
    const run = createRun([secondEmployeeId, employeeId]);

    expect(run).toMatchObject({
      companyId,
      employeeIds: [employeeId, secondEmployeeId],
      id: runId,
      payrollPeriodId: periodId,
      statutoryConfigurationId: configurationId,
      statutoryConfigurationVersion: 'ZM-2026.1',
      status: 'draft',
    });
    expect(Object.isFrozen(run)).toBe(true);
    expect(Object.isFrozen(run.employeeIds)).toBe(true);
  });

  it('rejects empty or duplicate employee selections', () => {
    expect(() => createRun([])).toThrowError(
      expect.objectContaining({ code: 'INVALID_PAYROLL_RUN' }),
    );
    expect(() => createRun([employeeId, employeeId])).toThrowError(
      expect.objectContaining({ code: 'INVALID_PAYROLL_RUN' }),
    );
  });

  it('calculates every selected employee and snapshots mutable calculator output', () => {
    const mutableOutcome = createOutcome();
    const calculator: PayrollCalculator = {
      calculate: () => mutableOutcome,
    };
    const calculated = calculatePayrollRun(
      createRun(),
      [createInput()],
      calculator,
      membershipId,
      '2026-09-04T10:10:00.000Z',
    );

    (
      mutableOutcome.breakdown as Array<
        (typeof mutableOutcome.breakdown)[number]
      >
    )[0] = line('CHANGED', 'earning', 100_000n);
    expect(calculated.status).toBe('calculated');
    expect(calculated.calculation?.entries[0]?.outcome.breakdown[0]?.code).toBe(
      'BASE',
    );
    expect(
      Object.isFrozen(calculated.calculation?.entries[0]?.outcome.breakdown[0]),
    ).toBe(true);
  });

  it('rejects missing employees, mismatched references, and inconsistent totals', () => {
    const run = createRun([employeeId, secondEmployeeId]);
    const validCalculator: PayrollCalculator = {
      calculate: (input) => createOutcome(input.employee.employeeId),
    };
    expect(() =>
      calculatePayrollRun(
        run,
        [createInput()],
        validCalculator,
        membershipId,
        '2026-09-04T10:10:00.000Z',
      ),
    ).toThrowError(
      expect.objectContaining({ code: 'PAYROLL_CALCULATION_MISMATCH' }),
    );

    const alteredPeriodInput = {
      ...createInput(),
      period: { ...createInput().period, paymentDate: period.period.endsOn },
    };
    expect(() =>
      calculatePayrollRun(
        createRun(),
        [alteredPeriodInput],
        validCalculator,
        membershipId,
        '2026-09-04T10:10:00.000Z',
      ),
    ).toThrowError(
      expect.objectContaining({ code: 'PAYROLL_CALCULATION_MISMATCH' }),
    );

    const invalidCalculator: PayrollCalculator = {
      calculate: (input) => ({
        ...createOutcome(input.employee.employeeId),
        netPay: amount(82_001n),
      }),
    };
    expect(() =>
      calculatePayrollRun(
        createRun(),
        [createInput()],
        invalidCalculator,
        membershipId,
        '2026-09-04T10:10:00.000Z',
      ),
    ).toThrowError(
      expect.objectContaining({ code: 'PAYROLL_CALCULATION_MISMATCH' }),
    );
  });

  it('permits review recalculation before finalization', () => {
    const calculator: PayrollCalculator = { calculate: () => createOutcome() };
    const calculated = calculatePayrollRun(
      createRun(),
      [createInput()],
      calculator,
      membershipId,
      '2026-09-04T10:10:00.000Z',
    );
    const draft = returnPayrollRunToDraft(calculated);

    expect(draft.status).toBe('draft');
    expect(draft.calculation).toBeUndefined();
  });

  it('finalizes only a calculated run and makes it immutable', () => {
    const calculator: PayrollCalculator = { calculate: () => createOutcome() };
    const calculated = calculatePayrollRun(
      createRun(),
      [createInput()],
      calculator,
      membershipId,
      '2026-09-04T10:10:00.000Z',
    );
    const finalized = finalizePayrollRun(
      calculated,
      membershipId,
      '2026-09-04T10:15:00.000Z',
    );

    expect(finalized).toMatchObject({
      finalization: {
        finalizedAt: '2026-09-04T10:15:00.000Z',
        finalizedByMembershipId: membershipId,
      },
      status: 'finalized',
    });
    expect(() =>
      calculatePayrollRun(
        finalized,
        [createInput()],
        calculator,
        membershipId,
        '2026-09-04T10:20:00.000Z',
      ),
    ).toThrowError(expect.objectContaining({ code: 'PAYROLL_RUN_IMMUTABLE' }));
  });

  it('rejects a finalization instant before calculation', () => {
    const calculator: PayrollCalculator = { calculate: () => createOutcome() };
    const calculated = calculatePayrollRun(
      createRun(),
      [createInput()],
      calculator,
      membershipId,
      '2026-09-04T10:10:00.000Z',
    );

    expect(() =>
      finalizePayrollRun(calculated, membershipId, '2026-09-04T10:09:59.999Z'),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_PAYROLL_RUN' }));
  });

  it('rejects a calculation instant before run creation', () => {
    const calculator: PayrollCalculator = { calculate: () => createOutcome() };

    expect(() =>
      calculatePayrollRun(
        createRun(),
        [createInput()],
        calculator,
        membershipId,
        '2026-09-04T10:04:59.999Z',
      ),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_PAYROLL_RUN' }));
  });
});

function amount(minorUnits: bigint) {
  return moneyFromMinorUnits(minorUnits, zmw, 2);
}

function line(
  code: string,
  kind: PayrollCalculationOutcome['breakdown'][number]['kind'],
  minorUnits: bigint,
) {
  return { amount: amount(minorUnits), code, kind };
}

function source(authority: string, uri: string) {
  return {
    accessedOn: '2026-09-04',
    authority,
    title: `${authority.toUpperCase()} official evidence`,
    uri,
  };
}

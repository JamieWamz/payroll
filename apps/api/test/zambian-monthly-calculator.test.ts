import { describe, expect, it } from 'vitest';

import type {
  CalculationVersion,
  CompensationComponentSnapshot,
  ConfigurationVersion,
  PayrollCalculationInput,
  RoundingPolicyIdentifier,
} from '../src/modules/payroll/calculation/types.js';
import { zambianMonthlyPayrollCalculator } from '../src/modules/payroll/calculation/zambian-monthly-calculator.js';
import { zraPublishedMonthlyPayeReference } from '../src/modules/payroll/calculation/zra-paye-reference.js';
import {
  parseCurrencyCode,
  parseDecimalMoney,
  serializeMoney,
} from '../src/shared/domain/money.js';
import { parseLocalDate } from '../src/shared/domain/local-date.js';

const companyId = 'd1000000-0000-4000-8000-000000000001';
const employeeId = 'd2000000-0000-4000-8000-000000000001';
const employmentId = 'd3000000-0000-4000-8000-000000000001';
const periodId = 'd4000000-0000-4000-8000-000000000001';
const configurationId = 'd5000000-0000-4000-8000-000000000001';
const zmw = parseCurrencyCode('ZMW');

const referenceParameters = {
  componentTreatments: {
    BASE_SALARY: { napsa: 'included', nhima: 'included', paye: 'taxable' },
    LOAN: { napsa: 'excluded', nhima: 'excluded', paye: 'exempt' },
    TRANSPORT: { napsa: 'included', nhima: 'excluded', paye: 'taxable' },
  },
  napsa: {
    employeeMonthlyCap: '1708.20',
    employeeRatePercent: '5',
    employerMonthlyCap: '1708.20',
    employerRatePercent: '5',
  },
  nhima: {
    employeeMonthlyCap: null,
    employeeRatePercent: '1',
    employerMonthlyCap: null,
    employerRatePercent: '1',
  },
  paye: {
    bands: zraPublishedMonthlyPayeReference.bands,
  },
  schemaVersion: 'ZAMBIA-MONTHLY-1',
} as const;

describe('configurable Zambian monthly payroll calculator', () => {
  it('calculates progressive PAYE and employee/employer contributions', () => {
    const result = zambianMonthlyPayrollCalculator.calculate(createInput());

    expect(serializeMoney(result.grossPay).amount).toBe('16000.00');
    expect(serializeMoney(result.taxableIncome).amount).toBe('16000.00');
    expect(serializeMoney(result.paye).amount).toBe('3546.00');
    expect(serializeMoney(result.napsa).amount).toBe('800.00');
    expect(serializeMoney(result.nhima).amount).toBe('150.00');
    expect(serializeMoney(result.otherDeductions).amount).toBe('500.00');
    expect(serializeMoney(result.netPay).amount).toBe('11004.00');
    expect(
      result.employerContributions.map((contribution) => [
        contribution.code,
        serializeMoney(contribution.amount).amount,
      ]),
    ).toEqual([
      ['NAPSA-EMPLOYER', '800.00'],
      ['NHIMA-EMPLOYER', '150.00'],
    ]);
    expect(result.breakdown).toHaveLength(8);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.breakdown)).toBe(true);
  });

  it('handles zero, low income, tax-band boundaries, and contribution caps', () => {
    const zero = zambianMonthlyPayrollCalculator.calculate(
      createInput({ compensation: [] }),
    );
    expect(serializeMoney(zero.netPay).amount).toBe('0.00');

    const low = zambianMonthlyPayrollCalculator.calculate(
      createInput({ compensation: [earning('BASE_SALARY', '4000')] }),
    );
    expect(serializeMoney(low.paye).amount).toBe('0.00');
    expect(serializeMoney(low.napsa).amount).toBe('200.00');
    expect(serializeMoney(low.nhima).amount).toBe('40.00');
    expect(serializeMoney(low.netPay).amount).toBe('3760.00');

    const boundary = zambianMonthlyPayrollCalculator.calculate(
      createInput({ compensation: [earning('BASE_SALARY', '7100')] }),
    );
    expect(serializeMoney(boundary.paye).amount).toBe('400.00');

    const capped = zambianMonthlyPayrollCalculator.calculate(
      createInput({ compensation: [earning('BASE_SALARY', '50000')] }),
    );
    expect(serializeMoney(capped.napsa).amount).toBe('1708.20');
    expect(serializeMoney(capped.employerContributions[0]!.amount).amount).toBe(
      '1708.20',
    );
  });

  it('uses operator-versioned percentages without changing the engine', () => {
    const adjusted = {
      ...referenceParameters,
      napsa: {
        ...referenceParameters.napsa,
        employeeRatePercent: '4',
        employerRatePercent: '6',
      },
    };
    const result = zambianMonthlyPayrollCalculator.calculate(
      createInput({ parameters: adjusted }),
    );

    expect(serializeMoney(result.napsa).amount).toBe('640.00');
    expect(serializeMoney(result.employerContributions[0]!.amount).amount).toBe(
      '960.00',
    );
  });

  it('uses cumulative ZRA-style PAYE and month-to-date NAPSA context', () => {
    const result = zambianMonthlyPayrollCalculator.calculate(
      createInput({
        compensation: [earning('TRANSPORT', '1000')],
        statutoryContext: {
          napsaEmployeeContributionBeforePeriod: money('750'),
          napsaEmployerContributionBeforePeriod: money('750'),
          napsaEarningsBeforePeriod: money('15000'),
          payeBeforePeriod: money('3176'),
          taxableIncomeBeforePeriod: money('15000'),
        },
      }),
    );

    expect(serializeMoney(result.paye).amount).toBe('370.00');
    expect(serializeMoney(result.napsa).amount).toBe('50.00');
    expect(serializeMoney(result.nhima).amount).toBe('0.00');
    expect(serializeMoney(result.netPay).amount).toBe('580.00');
  });

  it('represents a cumulative PAYE refund without losing its sign', () => {
    const result = zambianMonthlyPayrollCalculator.calculate(
      createInput({
        compensation: [],
        period: { paymentDate: parseLocalDate('2026-12-25') },
        statutoryContext: {
          payeBeforePeriod: money('22448'),
          taxableIncomeBeforePeriod: money('112000'),
        },
      }),
    );

    expect(serializeMoney(result.paye).amount).toBe('-9496.00');
    expect(serializeMoney(result.netPay).amount).toBe('9496.00');
    expect(
      serializeMoney(
        result.breakdown.find((line) => line.code === 'PAYE')!.amount,
      ).amount,
    ).toBe('-9496.00');
  });

  it('never guesses a component treatment or accepts malformed rule data', () => {
    expect(() =>
      zambianMonthlyPayrollCalculator.calculate(
        createInput({ compensation: [earning('UNCLASSIFIED', '100')] }),
      ),
    ).toThrowError(
      expect.objectContaining({ code: 'INVALID_STATUTORY_CONFIGURATION' }),
    );

    const boundedFinalBand = {
      ...referenceParameters,
      paye: {
        bands: [{ ratePercent: '20', upTo: '10000' }],
      },
    };
    expect(() =>
      zambianMonthlyPayrollCalculator.calculate(
        createInput({ parameters: boundedFinalBand }),
      ),
    ).toThrowError(
      expect.objectContaining({ code: 'INVALID_STATUTORY_CONFIGURATION' }),
    );
  });

  it('rejects unsupported calculation versions and negative net pay', () => {
    expect(() =>
      zambianMonthlyPayrollCalculator.calculate(
        createInput({ calculationVersion: 'UNREVIEWED-1' }),
      ),
    ).toThrowError(
      expect.objectContaining({ code: 'PAYROLL_CALCULATION_MISMATCH' }),
    );

    expect(() =>
      zambianMonthlyPayrollCalculator.calculate(
        createInput({
          compensation: [
            earning('BASE_SALARY', '100'),
            deduction('LOAN', '200'),
          ],
        }),
      ),
    ).toThrowError(
      expect.objectContaining({ code: 'PAYROLL_CALCULATION_MISMATCH' }),
    );
  });
});

function createInput(
  overrides: {
    calculationVersion?: string;
    compensation?: readonly CompensationComponentSnapshot[];
    parameters?: Record<string, unknown>;
    period?: Partial<PayrollCalculationInput['period']>;
    statutoryContext?: Partial<PayrollCalculationInput['statutoryContext']>;
  } = {},
): PayrollCalculationInput {
  return {
    calculationVersion: (overrides.calculationVersion ??
      'ZAMBIA-MONTHLY-1') as CalculationVersion,
    compensation: overrides.compensation ?? [
      earning('BASE_SALARY', '15000'),
      earning('TRANSPORT', '1000'),
      deduction('LOAN', '500'),
    ],
    employee: {
      companyId: companyId as PayrollCalculationInput['employee']['companyId'],
      employeeId:
        employeeId as PayrollCalculationInput['employee']['employeeId'],
    },
    employment: {
      effectivePeriod: { startsOn: parseLocalDate('2025-01-01') },
      employeeId:
        employeeId as PayrollCalculationInput['employment']['employeeId'],
      employmentId:
        employmentId as PayrollCalculationInput['employment']['employmentId'],
    },
    period: {
      endsOn: parseLocalDate('2026-01-31'),
      paymentDate: parseLocalDate('2026-01-25'),
      periodId: periodId as PayrollCalculationInput['period']['periodId'],
      startsOn: parseLocalDate('2026-01-01'),
      ...overrides.period,
    },
    roundingPolicy: 'ZMW-2DP-HALF-UP' as RoundingPolicyIdentifier,
    statutoryConfiguration: {
      configurationId:
        configurationId as PayrollCalculationInput['statutoryConfiguration']['configurationId'],
      effectivePeriod: {
        endsOn: parseLocalDate('2026-12-31'),
        startsOn: parseLocalDate('2026-01-01'),
      },
      parameters: overrides.parameters ?? referenceParameters,
      sources: [
        source('zra', 'https://www.zra.org.zm/tax-information/'),
        source('napsa', 'https://www.napsa.co.zm/important-facts/'),
        source('nhima', 'https://www.nhima.co.zm/elementor-1783/'),
      ],
      verificationStatus: 'verified',
      version: 'REFERENCE-2025.1' as ConfigurationVersion,
    },
    statutoryContext: {
      napsaEmployeeContributionBeforePeriod: money('0'),
      napsaEmployerContributionBeforePeriod: money('0'),
      napsaEarningsBeforePeriod: money('0'),
      payeBeforePeriod: money('0'),
      taxableIncomeBeforePeriod: money('0'),
      ...overrides.statutoryContext,
    },
  };
}

function earning(code: string, value: string): CompensationComponentSnapshot {
  return component(code, value, 'earning');
}

function deduction(code: string, value: string): CompensationComponentSnapshot {
  return component(code, value, 'deduction');
}

function component(
  code: string,
  value: string,
  kind: CompensationComponentSnapshot['kind'],
): CompensationComponentSnapshot {
  const sequence = (code.length + value.length).toString().padStart(12, '0');
  return {
    amount: parseDecimalMoney(value, zmw, 2),
    code,
    componentId:
      `d6000000-0000-4000-8000-${sequence}` as CompensationComponentSnapshot['componentId'],
    effectivePeriod: { startsOn: parseLocalDate('2026-01-01') },
    kind,
  };
}

function source(authority: string, uri: string) {
  return {
    accessedOn: parseLocalDate('2026-09-04'),
    authority,
    title: `${authority.toUpperCase()} evidence`,
    uri,
  };
}

function money(value: string) {
  return parseDecimalMoney(value, zmw, 2);
}

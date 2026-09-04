import { DomainError } from '../../../shared/domain/domain-error.js';
import {
  moneyFromMinorUnits,
  parseCurrencyCode,
  parseDecimalMoney,
  type Money,
} from '../../../shared/domain/money.js';
import type { DeepReadonly } from '../../../shared/domain/deep-readonly.js';
import type { PayrollCalculator } from './contract.js';
import type {
  CompensationComponentSnapshot,
  PayrollBreakdownLine,
  PayrollCalculationInput,
  PayrollCalculationOutcome,
} from './types.js';

interface ComponentTreatment {
  readonly napsa: 'excluded' | 'included';
  readonly nhima: 'excluded' | 'included';
  readonly paye: 'exempt' | 'taxable';
}

interface TaxBand {
  readonly rateBasisPoints: bigint;
  readonly upperBoundMinorUnits: bigint | undefined;
}

interface ContributionParameters {
  readonly employeeCapMinorUnits: bigint | undefined;
  readonly employeeRateBasisPoints: bigint;
  readonly employerCapMinorUnits: bigint | undefined;
  readonly employerRateBasisPoints: bigint;
}

interface ParsedParameters {
  readonly componentTreatments: Readonly<Record<string, ComponentTreatment>>;
  readonly napsa: ContributionParameters;
  readonly nhima: ContributionParameters;
  readonly payeBands: readonly TaxBand[];
}

const zmw = parseCurrencyCode('ZMW');
const calculationVersion = 'ZAMBIA-MONTHLY-1';
const roundingPolicy = 'ZMW-2DP-HALF-UP';
const percentagePattern = /^(?:0|[1-9]\d?)(?:\.\d{1,2})?$|^100(?:\.0{1,2})?$/;
const componentCodePattern = /^[A-Z0-9]+(?:[_-][A-Z0-9]+)*$/;

export const zambianMonthlyPayrollCalculator: PayrollCalculator = Object.freeze(
  {
    calculate(
      input: DeepReadonly<PayrollCalculationInput>,
    ): DeepReadonly<PayrollCalculationOutcome> {
      assertCalculationContract(input);
      const parameters = parseParameters(
        input.statutoryConfiguration.parameters,
      );
      const earnings = input.compensation.filter(
        (component) => component.kind === 'earning',
      );
      const deductions = input.compensation.filter(
        (component) => component.kind === 'deduction',
      );
      const treatments = new Map(
        earnings.map((component) => [
          component.componentId,
          requireTreatment(parameters, component),
        ]),
      );

      const grossPay = sum(earnings.map((component) => component.amount));
      const taxableIncome = sum(
        earnings
          .filter(
            (component) =>
              treatments.get(component.componentId)?.paye === 'taxable',
          )
          .map((component) => component.amount),
      );
      const napsaBase = sum(
        earnings
          .filter(
            (component) =>
              treatments.get(component.componentId)?.napsa === 'included',
          )
          .map((component) => component.amount),
      );
      const nhimaBase = sum(
        earnings
          .filter(
            (component) =>
              treatments.get(component.componentId)?.nhima === 'included',
          )
          .map((component) => component.amount),
      );
      const paye = calculateProgressiveTax(
        taxableIncome,
        parameters.payeBands,
        input.statutoryContext,
        Number(input.period.paymentDate.slice(5, 7)),
      );
      const napsaEmployee = calculateCappedContribution(
        napsaBase,
        parameters.napsa.employeeRateBasisPoints,
        parameters.napsa.employeeCapMinorUnits,
        input.statutoryContext.napsaEarningsBeforePeriod,
        input.statutoryContext.napsaEmployeeContributionBeforePeriod,
      );
      const napsaEmployer = calculateCappedContribution(
        napsaBase,
        parameters.napsa.employerRateBasisPoints,
        parameters.napsa.employerCapMinorUnits,
        input.statutoryContext.napsaEarningsBeforePeriod,
        input.statutoryContext.napsaEmployerContributionBeforePeriod,
      );
      const nhimaEmployee = calculateContribution(
        nhimaBase,
        parameters.nhima.employeeRateBasisPoints,
        parameters.nhima.employeeCapMinorUnits,
      );
      const nhimaEmployer = calculateContribution(
        nhimaBase,
        parameters.nhima.employerRateBasisPoints,
        parameters.nhima.employerCapMinorUnits,
      );
      const otherDeductions = sum(
        deductions.map((component) => component.amount),
      );
      const netMinorUnits =
        grossPay.minorUnits -
        paye.minorUnits -
        napsaEmployee.minorUnits -
        nhimaEmployee.minorUnits -
        otherDeductions.minorUnits;
      if (netMinorUnits < 0n) {
        throw invalidCalculation('negative_net_pay');
      }

      const breakdown = [
        ...input.compensation.map(toInputBreakdownLine),
        statutoryLine('PAYE', 'statutory_deduction', paye),
        statutoryLine('NAPSA-EMPLOYEE', 'statutory_deduction', napsaEmployee),
        statutoryLine('NHIMA-EMPLOYEE', 'statutory_deduction', nhimaEmployee),
        statutoryLine('NAPSA-EMPLOYER', 'employer_contribution', napsaEmployer),
        statutoryLine('NHIMA-EMPLOYER', 'employer_contribution', nhimaEmployer),
      ];

      return freezeRecursively({
        breakdown,
        calculationVersion: input.calculationVersion,
        employeeId: input.employee.employeeId,
        employerContributions: [
          { amount: napsaEmployer, code: 'NAPSA-EMPLOYER' },
          { amount: nhimaEmployer, code: 'NHIMA-EMPLOYER' },
        ],
        grossPay,
        napsa: napsaEmployee,
        netPay: amount(netMinorUnits),
        nhima: nhimaEmployee,
        otherDeductions,
        paye,
        periodId: input.period.periodId,
        roundingPolicy: input.roundingPolicy,
        statutoryConfigurationId: input.statutoryConfiguration.configurationId,
        statutoryConfigurationVersion: input.statutoryConfiguration.version,
        taxableIncome,
      });
    },
  },
);

function assertCalculationContract(
  input: DeepReadonly<PayrollCalculationInput>,
): void {
  if (
    input.calculationVersion !== calculationVersion ||
    input.roundingPolicy !== roundingPolicy ||
    input.statutoryConfiguration.verificationStatus !== 'verified'
  ) {
    throw invalidCalculation('unsupported_calculation_contract');
  }
  input.compensation.forEach((component) =>
    assertZambianMoney(component.amount),
  );
  [
    input.statutoryContext.napsaEmployeeContributionBeforePeriod,
    input.statutoryContext.napsaEmployerContributionBeforePeriod,
    input.statutoryContext.napsaEarningsBeforePeriod,
    input.statutoryContext.payeBeforePeriod,
    input.statutoryContext.taxableIncomeBeforePeriod,
  ].forEach(assertZambianMoney);
}

function parseParameters(
  value: DeepReadonly<Record<string, unknown>>,
): ParsedParameters {
  const root = requireRecord(value, 'parameters');
  if (root['schemaVersion'] !== calculationVersion) {
    throw invalidParameters('unsupported_schema_version');
  }
  const treatmentsValue = requireRecord(
    root['componentTreatments'],
    'component_treatments',
  );
  const componentTreatments: Record<string, ComponentTreatment> = {};
  for (const [code, treatmentValue] of Object.entries(treatmentsValue)) {
    if (!componentCodePattern.test(code)) {
      throw invalidParameters('invalid_component_code');
    }
    const treatment = requireRecord(treatmentValue, 'component_treatment');
    componentTreatments[code] = Object.freeze({
      napsa: requireEnum(treatment['napsa'], ['excluded', 'included']),
      nhima: requireEnum(treatment['nhima'], ['excluded', 'included']),
      paye: requireEnum(treatment['paye'], ['exempt', 'taxable']),
    });
  }

  const paye = requireRecord(root['paye'], 'paye');
  const bandsValue = paye['bands'];
  if (
    !Array.isArray(bandsValue) ||
    bandsValue.length === 0 ||
    bandsValue.length > 20
  ) {
    throw invalidParameters('invalid_paye_bands');
  }
  let previousUpperBound = 0n;
  const payeBands = bandsValue.map((bandValue, index): TaxBand => {
    const band = requireRecord(bandValue, 'paye_band');
    const upperBoundValue = band['upTo'];
    const upperBoundMinorUnits =
      upperBoundValue === null
        ? undefined
        : parseNonnegativeAmount(upperBoundValue, 'paye_band_limit');
    if (
      (upperBoundMinorUnits === undefined && index !== bandsValue.length - 1) ||
      (upperBoundMinorUnits !== undefined &&
        upperBoundMinorUnits <= previousUpperBound)
    ) {
      throw invalidParameters('invalid_paye_bands');
    }
    if (upperBoundMinorUnits !== undefined)
      previousUpperBound = upperBoundMinorUnits;
    return Object.freeze({
      rateBasisPoints: parsePercentage(band['ratePercent']),
      upperBoundMinorUnits,
    });
  });
  if (payeBands.at(-1)?.upperBoundMinorUnits !== undefined) {
    throw invalidParameters('paye_bands_must_be_unbounded');
  }

  return Object.freeze({
    componentTreatments: Object.freeze(componentTreatments),
    napsa: parseContributionParameters(root['napsa'], 'napsa'),
    nhima: parseContributionParameters(root['nhima'], 'nhima'),
    payeBands: Object.freeze(payeBands),
  });
}

function parseContributionParameters(
  value: unknown,
  authority: string,
): ContributionParameters {
  const parameters = requireRecord(value, authority);
  return Object.freeze({
    employeeCapMinorUnits: parseOptionalCap(parameters['employeeMonthlyCap']),
    employeeRateBasisPoints: parsePercentage(parameters['employeeRatePercent']),
    employerCapMinorUnits: parseOptionalCap(parameters['employerMonthlyCap']),
    employerRateBasisPoints: parsePercentage(parameters['employerRatePercent']),
  });
}

function calculateProgressiveTax(
  currentTaxableIncome: Readonly<Money>,
  bands: readonly TaxBand[],
  context: DeepReadonly<PayrollCalculationInput['statutoryContext']>,
  taxMonth: number,
): Readonly<Money> {
  const cumulativeTaxableIncome =
    context.taxableIncomeBeforePeriod.minorUnits +
    currentTaxableIncome.minorUnits;
  let lowerBound = 0n;
  let tax = 0n;
  for (const band of bands) {
    const upperBound =
      band.upperBoundMinorUnits === undefined
        ? cumulativeTaxableIncome
        : band.upperBoundMinorUnits * BigInt(taxMonth);
    const taxableInBand =
      cumulativeTaxableIncome <= lowerBound
        ? 0n
        : min(cumulativeTaxableIncome, upperBound) - lowerBound;
    tax += applyRate(taxableInBand, band.rateBasisPoints);
    if (cumulativeTaxableIncome <= upperBound) break;
    lowerBound = upperBound;
  }
  return amount(tax - context.payeBeforePeriod.minorUnits);
}

function calculateCappedContribution(
  currentBase: Readonly<Money>,
  rateBasisPoints: bigint,
  capMinorUnits: bigint | undefined,
  baseBeforePeriod: DeepReadonly<Money>,
  contributionBeforePeriod: DeepReadonly<Money>,
): Readonly<Money> {
  const monthlyTarget = calculateContribution(
    amount(baseBeforePeriod.minorUnits + currentBase.minorUnits),
    rateBasisPoints,
    capMinorUnits,
  );
  if (contributionBeforePeriod.minorUnits > monthlyTarget.minorUnits) {
    throw invalidCalculation('prior_contribution_exceeds_monthly_target');
  }
  return amount(monthlyTarget.minorUnits - contributionBeforePeriod.minorUnits);
}

function calculateContribution(
  base: Readonly<Money>,
  rateBasisPoints: bigint,
  capMinorUnits: bigint | undefined,
): Readonly<Money> {
  const calculated = applyRate(base.minorUnits, rateBasisPoints);
  return amount(
    capMinorUnits === undefined ? calculated : min(calculated, capMinorUnits),
  );
}

function applyRate(minorUnits: bigint, basisPoints: bigint): bigint {
  return (minorUnits * basisPoints + 5_000n) / 10_000n;
}

function requireTreatment(
  parameters: ParsedParameters,
  component: DeepReadonly<CompensationComponentSnapshot>,
): ComponentTreatment {
  const treatment = parameters.componentTreatments[component.code];
  if (treatment === undefined) {
    throw invalidParameters('component_treatment_missing');
  }
  return treatment;
}

function toInputBreakdownLine(
  component: DeepReadonly<CompensationComponentSnapshot>,
): PayrollBreakdownLine {
  return Object.freeze({
    amount: component.amount,
    code: component.code,
    kind: component.kind === 'earning' ? 'earning' : 'other_deduction',
    sourceComponentId: component.componentId,
  });
}

function statutoryLine(
  code: string,
  kind: PayrollBreakdownLine['kind'],
  lineAmount: Readonly<Money>,
): PayrollBreakdownLine {
  return Object.freeze({ amount: lineAmount, code, kind });
}

function parsePercentage(value: unknown): bigint {
  if (typeof value !== 'string' || !percentagePattern.test(value)) {
    throw invalidParameters('invalid_percentage');
  }
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

function parseOptionalCap(value: unknown): bigint | undefined {
  return value === null
    ? undefined
    : parseNonnegativeAmount(value, 'invalid_contribution_cap');
}

function parseNonnegativeAmount(value: unknown, rule: string): bigint {
  if (typeof value !== 'string') throw invalidParameters(rule);
  let parsed: Readonly<Money>;
  try {
    parsed = parseDecimalMoney(value, zmw, 2);
  } catch {
    throw invalidParameters(rule);
  }
  if (parsed.minorUnits < 0n) throw invalidParameters(rule);
  return parsed.minorUnits;
}

function requireRecord(value: unknown, rule: string): Record<string, unknown> {
  const prototype =
    value === null || typeof value !== 'object'
      ? undefined
      : Object.getPrototypeOf(value);
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (prototype !== Object.prototype && prototype !== null)
  ) {
    throw invalidParameters(rule);
  }
  return value as Record<string, unknown>;
}

function requireEnum<const Value extends string>(
  value: unknown,
  options: readonly Value[],
): Value {
  if (typeof value !== 'string' || !options.includes(value as Value)) {
    throw invalidParameters('invalid_component_treatment');
  }
  return value as Value;
}

function assertZambianMoney(value: DeepReadonly<Money>): void {
  if (
    value.currency !== zmw ||
    value.scale !== 2 ||
    typeof value.minorUnits !== 'bigint' ||
    value.minorUnits < 0n
  ) {
    throw invalidCalculation('invalid_money');
  }
}

function sum(values: readonly DeepReadonly<Money>[]): Readonly<Money> {
  values.forEach(assertZambianMoney);
  return amount(values.reduce((total, value) => total + value.minorUnits, 0n));
}

function amount(minorUnits: bigint): Readonly<Money> {
  return moneyFromMinorUnits(minorUnits, zmw, 2);
}

function min(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}

function freezeRecursively<Value>(value: Value): DeepReadonly<Value> {
  if (value !== null && typeof value === 'object') {
    for (const nested of Object.values(value)) freezeRecursively(nested);
    Object.freeze(value);
  }
  return value as DeepReadonly<Value>;
}

function invalidParameters(rule: string): DomainError {
  return new DomainError(
    'INVALID_STATUTORY_CONFIGURATION',
    'Statutory configuration is not valid for the Zambian monthly calculator',
    { entity: 'StatutoryConfiguration', rule },
  );
}

function invalidCalculation(rule: string): DomainError {
  return new DomainError(
    'PAYROLL_CALCULATION_MISMATCH',
    'Payroll calculation input is not valid for the Zambian monthly calculator',
    { entity: 'PayrollCalculation', rule },
  );
}

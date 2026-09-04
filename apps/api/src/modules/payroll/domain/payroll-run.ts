import type { CompanyId } from '../../companies/domain/company.js';
import type { EmployeeId } from '../../workforce/domain/employee.js';
import type { StatutoryConfiguration } from '../../statutory-configuration/domain/statutory-configuration.js';
import { DomainError } from '../../../shared/domain/domain-error.js';
import type { DeepReadonly } from '../../../shared/domain/deep-readonly.js';
import {
  parseEntityId,
  type EntityId,
} from '../../../shared/domain/entity-id.js';
import { parseInstant, type Instant } from '../../../shared/domain/instant.js';
import type { Money } from '../../../shared/domain/money.js';
import type { PayrollCalculator } from '../calculation/contract.js';
import type {
  PayrollCalculationInput,
  PayrollCalculationOutcome,
} from '../calculation/types.js';
import type { PayrollPeriod, PayrollPeriodId } from './payroll-period.js';

export type PayrollRunId = EntityId<'PayrollRun'>;
export type MembershipId = EntityId<'CompanyMembership'>;
export type PayrollRunStatus = 'calculated' | 'draft' | 'finalized';

export interface PayrollRunCalculation {
  readonly calculatedAt: Instant;
  readonly calculatedByMembershipId: MembershipId;
  readonly entries: readonly Readonly<PayrollRunCalculationEntry>[];
}

export interface PayrollRunCalculationEntry {
  readonly input: DeepReadonly<PayrollCalculationInput>;
  readonly outcome: DeepReadonly<PayrollCalculationOutcome>;
}

export interface PayrollRunFinalization {
  readonly finalizedAt: Instant;
  readonly finalizedByMembershipId: MembershipId;
}

export interface PayrollRun {
  readonly calculation: Readonly<PayrollRunCalculation> | undefined;
  readonly companyId: CompanyId;
  readonly createdAt: Instant;
  readonly createdByMembershipId: MembershipId;
  readonly employeeIds: readonly EmployeeId[];
  readonly finalization: Readonly<PayrollRunFinalization> | undefined;
  readonly id: PayrollRunId;
  readonly payrollPeriod: DeepReadonly<PayrollPeriod>;
  readonly payrollPeriodId: PayrollPeriodId;
  readonly statutoryConfiguration: DeepReadonly<StatutoryConfiguration>;
  readonly statutoryConfigurationId: EntityId<'StatutoryConfiguration'>;
  readonly statutoryConfigurationVersion: string;
  readonly status: PayrollRunStatus;
}

export interface CreateDraftPayrollRunInput {
  readonly companyId: string;
  readonly createdAt: string;
  readonly createdByMembershipId: string;
  readonly employeeIds: readonly string[];
  readonly id: string;
  readonly payrollPeriod: Readonly<PayrollPeriod>;
  readonly statutoryConfiguration: Readonly<StatutoryConfiguration>;
}

const maximumEmployeesPerRun = 10_000;

export function createDraftPayrollRun(
  input: CreateDraftPayrollRunInput,
): Readonly<PayrollRun> {
  const companyId = parseEntityId(input.companyId, 'Company');
  assertRunReferences(
    companyId,
    input.payrollPeriod,
    input.statutoryConfiguration,
  );
  const employeeIds = normalizeEmployeeIds(input.employeeIds);

  return Object.freeze({
    calculation: undefined,
    companyId,
    createdAt: parseInstant(input.createdAt),
    createdByMembershipId: parseEntityId(
      input.createdByMembershipId,
      'CompanyMembership',
    ),
    employeeIds,
    finalization: undefined,
    id: parseEntityId(input.id, 'PayrollRun'),
    payrollPeriod: snapshot(input.payrollPeriod),
    payrollPeriodId: input.payrollPeriod.id,
    statutoryConfiguration: snapshot(input.statutoryConfiguration),
    statutoryConfigurationId: input.statutoryConfiguration.id,
    statutoryConfigurationVersion: input.statutoryConfiguration.version,
    status: 'draft',
  });
}

export function calculatePayrollRun(
  run: Readonly<PayrollRun>,
  inputs: readonly DeepReadonly<PayrollCalculationInput>[],
  calculator: PayrollCalculator,
  calculatedByMembershipId: string,
  calculatedAt: string,
): Readonly<PayrollRun> {
  if (run.status === 'finalized') {
    throw immutableRun();
  }

  const calculationInstant = parseInstant(calculatedAt);
  const calculatorMembershipId = parseEntityId(
    calculatedByMembershipId,
    'CompanyMembership',
  );
  if (calculationInstant < run.createdAt) {
    throw invalidRun('calculated_before_creation');
  }

  assertCalculationInputs(run, inputs);
  const entries = inputs.map((input) => {
    const outcome = calculator.calculate(input);
    assertCalculationOutcome(run, input, outcome);
    return snapshot({ input, outcome });
  });

  return Object.freeze({
    ...run,
    calculation: Object.freeze({
      calculatedAt: calculationInstant,
      calculatedByMembershipId: calculatorMembershipId,
      entries: Object.freeze(entries),
    }),
    finalization: undefined,
    status: 'calculated',
  });
}

export function returnPayrollRunToDraft(
  run: Readonly<PayrollRun>,
): Readonly<PayrollRun> {
  if (run.status !== 'calculated') {
    throw invalidRun('only_calculated_run_can_return_to_draft');
  }

  return Object.freeze({
    ...run,
    calculation: undefined,
    finalization: undefined,
    status: 'draft',
  });
}

export function finalizePayrollRun(
  run: Readonly<PayrollRun>,
  finalizedByMembershipId: string,
  finalizedAt: string,
): Readonly<PayrollRun> {
  if (run.status !== 'calculated' || run.calculation === undefined) {
    throw invalidRun('only_calculated_run_can_be_finalized');
  }

  const finalization = Object.freeze({
    finalizedAt: parseInstant(finalizedAt),
    finalizedByMembershipId: parseEntityId(
      finalizedByMembershipId,
      'CompanyMembership',
    ),
  });

  if (finalization.finalizedAt < run.calculation.calculatedAt) {
    throw invalidRun('finalized_before_calculation');
  }

  return Object.freeze({ ...run, finalization, status: 'finalized' });
}

function assertRunReferences(
  companyId: CompanyId,
  payrollPeriod: Readonly<PayrollPeriod>,
  statutoryConfiguration: Readonly<StatutoryConfiguration>,
): void {
  if (
    payrollPeriod.companyId !== companyId ||
    statutoryConfiguration.companyId !== companyId
  ) {
    throw new DomainError(
      'TENANT_SCOPE_MISMATCH',
      'Payroll run references must belong to the same company',
      { entity: 'PayrollRun' },
    );
  }
  if (statutoryConfiguration.status !== 'verified') {
    throw invalidRun('statutory_configuration_must_be_verified');
  }

  const configurationEndsOn =
    statutoryConfiguration.effectivePeriod.endsOn ?? '9999-12-31';
  if (
    statutoryConfiguration.effectivePeriod.startsOn >
      payrollPeriod.period.startsOn ||
    configurationEndsOn < payrollPeriod.period.endsOn
  ) {
    throw invalidRun('statutory_configuration_must_cover_period');
  }
}

function normalizeEmployeeIds(
  values: readonly string[],
): readonly EmployeeId[] {
  if (values.length === 0 || values.length > maximumEmployeesPerRun) {
    throw invalidRun('invalid_employee_count');
  }

  const employeeIds = values.map((value) => parseEntityId(value, 'Employee'));
  if (new Set(employeeIds).size !== employeeIds.length) {
    throw invalidRun('duplicate_employee');
  }

  return Object.freeze(employeeIds.toSorted());
}

function assertCalculationInputs(
  run: Readonly<PayrollRun>,
  inputs: readonly DeepReadonly<PayrollCalculationInput>[],
): void {
  if (inputs.length !== run.employeeIds.length) {
    throw calculationMismatch('employee_count');
  }

  const employeeIds = new Set<EmployeeId>();
  for (const input of inputs) {
    if (
      input.employee.companyId !== run.companyId ||
      input.employee.employeeId !== input.employment.employeeId ||
      input.period.periodId !== run.payrollPeriodId ||
      input.period.startsOn !== run.payrollPeriod.period.startsOn ||
      input.period.endsOn !== run.payrollPeriod.period.endsOn ||
      input.period.paymentDate !== run.payrollPeriod.paymentDate ||
      input.statutoryConfiguration.configurationId !==
        run.statutoryConfigurationId ||
      input.statutoryConfiguration.version !==
        run.statutoryConfigurationVersion ||
      input.statutoryConfiguration.verificationStatus !== 'verified'
    ) {
      throw calculationMismatch('input_reference');
    }
    if (
      input.statutoryConfiguration.effectivePeriod.startsOn !==
        run.statutoryConfiguration.effectivePeriod.startsOn ||
      input.statutoryConfiguration.effectivePeriod.endsOn !==
        run.statutoryConfiguration.effectivePeriod.endsOn ||
      !sameJsonSnapshot(
        input.statutoryConfiguration.parameters,
        run.statutoryConfiguration.parameters,
      ) ||
      !sameJsonSnapshot(
        input.statutoryConfiguration.sources,
        run.statutoryConfiguration.sources,
      )
    ) {
      throw calculationMismatch('statutory_snapshot');
    }
    if (
      !run.employeeIds.includes(input.employee.employeeId) ||
      employeeIds.has(input.employee.employeeId)
    ) {
      throw calculationMismatch('employee_selection');
    }
    employeeIds.add(input.employee.employeeId);
  }
}

function assertCalculationOutcome(
  run: Readonly<PayrollRun>,
  input: DeepReadonly<PayrollCalculationInput>,
  outcome: DeepReadonly<PayrollCalculationOutcome>,
): void {
  if (
    outcome.employeeId !== input.employee.employeeId ||
    outcome.periodId !== run.payrollPeriodId ||
    outcome.statutoryConfigurationId !== run.statutoryConfigurationId ||
    outcome.statutoryConfigurationVersion !==
      run.statutoryConfigurationVersion ||
    outcome.calculationVersion !== input.calculationVersion ||
    outcome.roundingPolicy !== input.roundingPolicy
  ) {
    throw calculationMismatch('outcome_reference');
  }

  const directAmounts = [
    outcome.grossPay,
    outcome.taxableIncome,
    outcome.paye,
    outcome.napsa,
    outcome.nhima,
    outcome.otherDeductions,
    outcome.netPay,
    ...outcome.breakdown.map((line) => line.amount),
    ...outcome.employerContributions.map((item) => item.amount),
  ];
  directAmounts.forEach(assertZambianNonnegativeMoney);

  const earnings = sumMinorUnits(
    outcome.breakdown
      .filter((line) => line.kind === 'earning')
      .map((line) => line.amount),
  );
  const statutoryDeductions = sumMinorUnits(
    outcome.breakdown
      .filter((line) => line.kind === 'statutory_deduction')
      .map((line) => line.amount),
  );
  const otherDeductions = sumMinorUnits(
    outcome.breakdown
      .filter((line) => line.kind === 'other_deduction')
      .map((line) => line.amount),
  );
  const employerBreakdown = sumMinorUnits(
    outcome.breakdown
      .filter((line) => line.kind === 'employer_contribution')
      .map((line) => line.amount),
  );
  const employerContributions = sumMinorUnits(
    outcome.employerContributions.map((item) => item.amount),
  );
  const expectedStatutory =
    outcome.paye.minorUnits +
    outcome.napsa.minorUnits +
    outcome.nhima.minorUnits;
  const expectedNet =
    outcome.grossPay.minorUnits -
    expectedStatutory -
    outcome.otherDeductions.minorUnits;

  if (
    earnings !== outcome.grossPay.minorUnits ||
    statutoryDeductions !== expectedStatutory ||
    otherDeductions !== outcome.otherDeductions.minorUnits ||
    employerBreakdown !== employerContributions ||
    expectedNet !== outcome.netPay.minorUnits
  ) {
    throw calculationMismatch('outcome_totals');
  }
}

function assertZambianNonnegativeMoney(money: DeepReadonly<Money>): void {
  if (
    money.currency !== 'ZMW' ||
    money.scale !== 2 ||
    typeof money.minorUnits !== 'bigint' ||
    money.minorUnits < 0n
  ) {
    throw calculationMismatch('invalid_money');
  }
}

function sumMinorUnits(values: readonly DeepReadonly<Money>[]): bigint {
  return values.reduce((total, money) => total + money.minorUnits, 0n);
}

function sameJsonSnapshot(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function snapshot<Value>(value: Value): DeepReadonly<Value> {
  return freezeRecursively(structuredClone(value)) as DeepReadonly<Value>;
}

function freezeRecursively(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  for (const nested of Object.values(value)) {
    freezeRecursively(nested);
  }
  return Object.freeze(value);
}

function invalidRun(rule: string): DomainError {
  return new DomainError(
    'INVALID_PAYROLL_RUN',
    'Payroll run state or references are invalid',
    { entity: 'PayrollRun', rule },
  );
}

function immutableRun(): DomainError {
  return new DomainError(
    'PAYROLL_RUN_IMMUTABLE',
    'A finalized payroll run cannot be recalculated or rewritten',
    { entity: 'PayrollRun' },
  );
}

function calculationMismatch(rule: string): DomainError {
  return new DomainError(
    'PAYROLL_CALCULATION_MISMATCH',
    'Payroll calculation input or output does not match the run',
    { entity: 'PayrollRun', rule },
  );
}

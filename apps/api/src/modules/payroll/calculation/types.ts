import type { DeepReadonly } from '../../../shared/domain/deep-readonly.js';
import type { EntityId } from '../../../shared/domain/entity-id.js';
import type {
  DateInterval,
  LocalDate,
} from '../../../shared/domain/local-date.js';
import type { Money } from '../../../shared/domain/money.js';

export type CompanyId = EntityId<'Company'>;
export type CompensationComponentId = EntityId<'CompensationComponent'>;
export type EmployeeId = EntityId<'Employee'>;
export type EmploymentId = EntityId<'Employment'>;
export type PayrollPeriodId = EntityId<'PayrollPeriod'>;
export type StatutoryConfigurationId = EntityId<'StatutoryConfiguration'>;

declare const calculationVersionBrand: unique symbol;
declare const configurationVersionBrand: unique symbol;
declare const roundingPolicyBrand: unique symbol;

export type CalculationVersion = string & {
  readonly [calculationVersionBrand]: 'CalculationVersion';
};
export type ConfigurationVersion = string & {
  readonly [configurationVersionBrand]: 'ConfigurationVersion';
};
export type RoundingPolicyIdentifier = string & {
  readonly [roundingPolicyBrand]: 'RoundingPolicyIdentifier';
};

export interface StatutorySourceReference {
  readonly accessedOn: LocalDate;
  readonly authority: string;
  readonly title: string;
  readonly uri: string;
}

export interface VerifiedStatutoryConfigurationSnapshot {
  readonly configurationId: StatutoryConfigurationId;
  readonly effectivePeriod: Readonly<DateInterval>;
  readonly parameters: DeepReadonly<Record<string, unknown>>;
  readonly sources: readonly StatutorySourceReference[];
  readonly verificationStatus: 'verified';
  readonly version: ConfigurationVersion;
}

export interface EmployeeCalculationSnapshot {
  readonly companyId: CompanyId;
  readonly employeeId: EmployeeId;
}

export interface EmploymentCalculationSnapshot {
  readonly effectivePeriod: Readonly<DateInterval>;
  readonly employeeId: EmployeeId;
  readonly employmentId: EmploymentId;
}

export interface CompensationComponentSnapshot {
  readonly amount: Readonly<Money>;
  readonly code: string;
  readonly componentId: CompensationComponentId;
  readonly effectivePeriod: Readonly<DateInterval>;
  readonly kind: 'deduction' | 'earning';
}

export interface PayrollPeriodSnapshot {
  readonly endsOn: LocalDate;
  readonly paymentDate: LocalDate;
  readonly periodId: PayrollPeriodId;
  readonly startsOn: LocalDate;
}

export interface PayrollCalculationInput {
  readonly calculationVersion: CalculationVersion;
  readonly compensation: readonly CompensationComponentSnapshot[];
  readonly employee: EmployeeCalculationSnapshot;
  readonly employment: EmploymentCalculationSnapshot;
  readonly period: PayrollPeriodSnapshot;
  readonly roundingPolicy: RoundingPolicyIdentifier;
  readonly statutoryConfiguration: VerifiedStatutoryConfigurationSnapshot;
}

export interface PayrollBreakdownLine {
  readonly amount: Readonly<Money>;
  readonly code: string;
  readonly kind:
    | 'employer_contribution'
    | 'earning'
    | 'other_deduction'
    | 'statutory_deduction';
  readonly sourceComponentId?: CompensationComponentId;
}

export interface EmployerContributionResult {
  readonly amount: Readonly<Money>;
  readonly code: string;
}

export interface PayrollCalculationOutcome {
  readonly breakdown: readonly PayrollBreakdownLine[];
  readonly calculationVersion: CalculationVersion;
  readonly employeeId: EmployeeId;
  readonly employerContributions: readonly EmployerContributionResult[];
  readonly grossPay: Readonly<Money>;
  readonly napsa: Readonly<Money>;
  readonly netPay: Readonly<Money>;
  readonly nhima: Readonly<Money>;
  readonly otherDeductions: Readonly<Money>;
  readonly paye: Readonly<Money>;
  readonly periodId: PayrollPeriodId;
  readonly roundingPolicy: RoundingPolicyIdentifier;
  readonly statutoryConfigurationId: StatutoryConfigurationId;
  readonly statutoryConfigurationVersion: ConfigurationVersion;
  readonly taxableIncome: Readonly<Money>;
}

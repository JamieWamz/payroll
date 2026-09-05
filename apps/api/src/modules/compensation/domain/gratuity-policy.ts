import type { CompanyId } from '../../companies/domain/company.js';
import { DomainError } from '../../../shared/domain/domain-error.js';
import {
  parseEntityId,
  type EntityId,
} from '../../../shared/domain/entity-id.js';
import {
  createDateInterval,
  intervalContains,
  parseLocalDate,
  type DateInterval,
} from '../../../shared/domain/local-date.js';
import {
  moneyFromMinorUnits,
  type Money,
} from '../../../shared/domain/money.js';
import { periodsOverlap } from './effective-period.js';
import { parsePositiveZambianAmount } from './zambian-money.js';

export type GratuityPolicyId = EntityId<'GratuityPolicy'>;

export interface GratuityPolicy {
  readonly companyId: CompanyId;
  readonly effectivePeriod: Readonly<DateInterval>;
  readonly id: GratuityPolicyId;
  readonly name: string;
  readonly policyReference: string;
  readonly rateBasisPoints: number;
  readonly ratePercent: string;
}

export interface CreateGratuityPolicyInput {
  readonly companyId: string;
  readonly endsOn?: string;
  readonly id: string;
  readonly name: string;
  readonly policyReference: string;
  readonly ratePercent: string;
  readonly startsOn: string;
}

export interface CalculateContractGratuityInput {
  readonly basicPayEarned: string;
  readonly contractEndsOn: string;
  readonly policy: Readonly<GratuityPolicy>;
  readonly settlementDate: string;
  readonly statutoryMinimumRatePercent: string;
}

export interface ContractGratuityCalculation {
  readonly amount: Readonly<Money>;
  readonly basis: 'basic_pay_earned_during_contract';
  readonly basicPayEarned: Readonly<Money>;
  readonly contractEndsOn: string;
  readonly policyId: GratuityPolicyId;
  readonly policyRatePercent: string;
  readonly settlementDate: string;
  readonly settlementReason: 'contract_expiry';
  readonly statutoryMinimumRatePercent: string;
}

const percentagePattern = /^(?:0|[1-9]\d?)(?:\.\d{1,2})?$|^100(?:\.0{1,2})?$/;
const nameMaximumLength = 80;
const policyReferenceMaximumLength = 240;
const controlCharacterPattern = /\p{Cc}/u;

export function createGratuityPolicy(
  input: CreateGratuityPolicyInput,
): Readonly<GratuityPolicy> {
  const rate = parsePercentage(input.ratePercent);
  if (rate.basisPoints === 0) throw invalidPolicy('zero_rate');
  return Object.freeze({
    companyId: parseEntityId(input.companyId, 'Company'),
    effectivePeriod: createDateInterval(
      parseLocalDate(input.startsOn),
      input.endsOn === undefined ? undefined : parseLocalDate(input.endsOn),
    ),
    id: parseEntityId(input.id, 'GratuityPolicy'),
    name: normalizeName(input.name),
    policyReference: normalizePolicyReference(input.policyReference),
    rateBasisPoints: rate.basisPoints,
    ratePercent: rate.percent,
  });
}

export function calculateContractGratuity(
  input: CalculateContractGratuityInput,
): Readonly<ContractGratuityCalculation> {
  const contractEndsOn = parseLocalDate(input.contractEndsOn);
  const settlementDate = parseLocalDate(input.settlementDate);
  if (settlementDate < contractEndsOn) {
    throw invalidCalculation('settlement_before_contract_end');
  }
  if (!intervalContains(input.policy.effectivePeriod, contractEndsOn)) {
    throw invalidCalculation('policy_not_effective_at_contract_end');
  }
  const statutoryMinimum = parsePercentage(input.statutoryMinimumRatePercent);
  if (
    statutoryMinimum.basisPoints === 0 ||
    input.policy.rateBasisPoints < statutoryMinimum.basisPoints
  ) {
    throw invalidCalculation('policy_below_statutory_minimum');
  }
  const basicPayEarned = parsePositiveZambianAmount(input.basicPayEarned);
  const amount = moneyFromMinorUnits(
    applyPercentage(basicPayEarned.minorUnits, input.policy.rateBasisPoints),
    basicPayEarned.currency,
    basicPayEarned.scale,
  );
  return Object.freeze({
    amount,
    basis: 'basic_pay_earned_during_contract',
    basicPayEarned,
    contractEndsOn,
    policyId: input.policy.id,
    policyRatePercent: input.policy.ratePercent,
    settlementDate,
    settlementReason: 'contract_expiry',
    statutoryMinimumRatePercent: statutoryMinimum.percent,
  });
}

export function assertGratuityPolicySchedule(
  companyId: CompanyId,
  policies: readonly Readonly<GratuityPolicy>[],
): void {
  const identifiers = new Set<GratuityPolicyId>();
  const ordered = policies.toSorted((left, right) =>
    left.effectivePeriod.startsOn.localeCompare(right.effectivePeriod.startsOn),
  );
  for (const policy of ordered) {
    if (policy.companyId !== companyId) {
      throw new DomainError(
        'TENANT_SCOPE_MISMATCH',
        'Gratuity policies must belong to the supplied company',
        { entity: 'GratuityPolicy' },
      );
    }
    if (identifiers.has(policy.id)) throw invalidHistory('duplicate_policy');
    identifiers.add(policy.id);
  }
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (
      previous !== undefined &&
      current !== undefined &&
      periodsOverlap(previous.effectivePeriod, current.effectivePeriod)
    ) {
      throw invalidHistory('overlapping_policy');
    }
  }
}

export function endGratuityPolicy(
  policy: Readonly<GratuityPolicy>,
  endsOn: string,
): Readonly<GratuityPolicy> {
  if (policy.effectivePeriod.endsOn !== undefined) {
    throw new DomainError(
      'GRATUITY_POLICY_ALREADY_ENDED',
      'An ended gratuity policy cannot be ended again',
      { entity: 'GratuityPolicy' },
    );
  }
  return Object.freeze({
    ...policy,
    effectivePeriod: createDateInterval(
      policy.effectivePeriod.startsOn,
      parseLocalDate(endsOn),
    ),
  });
}

function parsePercentage(value: string): {
  basisPoints: number;
  percent: string;
} {
  if (!percentagePattern.test(value)) throw invalidPolicy('invalid_rate');
  const [whole = '0', fraction = ''] = value.split('.');
  return {
    basisPoints: Number(whole) * 100 + Number(fraction.padEnd(2, '0')),
    percent: `${whole}.${fraction.padEnd(2, '0')}`,
  };
}

function applyPercentage(minorUnits: bigint, rateBasisPoints: number): bigint {
  return (minorUnits * BigInt(rateBasisPoints) + 5_000n) / 10_000n;
}

function normalizeName(value: string): string {
  const normalized = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (
    normalized.length === 0 ||
    [...normalized].length > nameMaximumLength ||
    controlCharacterPattern.test(value)
  ) {
    throw invalidPolicy('invalid_name');
  }
  return normalized;
}

function normalizePolicyReference(value: string): string {
  const normalized = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (
    normalized.length === 0 ||
    [...normalized].length > policyReferenceMaximumLength ||
    controlCharacterPattern.test(value)
  ) {
    throw invalidPolicy('invalid_policy_reference');
  }
  return normalized;
}

function invalidPolicy(rule: string): DomainError {
  return new DomainError(
    'INVALID_GRATUITY_POLICY',
    'Gratuity policy is invalid',
    {
      entity: 'GratuityPolicy',
      rule,
    },
  );
}

function invalidHistory(rule: string): DomainError {
  return new DomainError(
    'GRATUITY_POLICY_HISTORY_OVERLAP',
    'Gratuity policy periods cannot overlap',
    { entity: 'GratuityPolicy', rule },
  );
}

function invalidCalculation(rule: string): DomainError {
  return new DomainError(
    'INVALID_TERMINAL_BENEFIT_CALCULATION',
    'Terminal benefit calculation is invalid',
    { entity: 'ContractGratuity', rule },
  );
}

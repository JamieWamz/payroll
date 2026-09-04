import { DomainError } from '../../../shared/domain/domain-error.js';
import {
  createDateInterval,
  intervalContains,
  parseLocalDate,
  type DateInterval,
  type LocalDate,
} from '../../../shared/domain/local-date.js';
import type { Money } from '../../../shared/domain/money.js';
import {
  parseEntityId,
  type EntityId,
} from '../../../shared/domain/entity-id.js';
import type { Employment } from '../../workforce/domain/employment.js';
import {
  assertPeriodWithinEmployment,
  periodsOverlap,
} from './effective-period.js';
import { parsePositiveZambianAmount } from './zambian-money.js';

export type CompensationComponentId = EntityId<'CompensationComponent'>;
export type CompensationComponentKind = 'allowance' | 'deduction';

export interface CompensationComponent {
  readonly amount: Readonly<Money>;
  readonly basis: 'fixed_per_period';
  readonly code: string;
  readonly companyId: Employment['companyId'];
  readonly effectivePeriod: Readonly<DateInterval>;
  readonly employmentId: Employment['id'];
  readonly id: CompensationComponentId;
  readonly kind: CompensationComponentKind;
  readonly name: string;
}

export interface CreateCompensationComponentInput {
  readonly amount: string;
  readonly code: string;
  readonly endsOn?: string;
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly startsOn: string;
}

const codePattern = /^[A-Z0-9]+(?:[_-][A-Z0-9]+)*$/;
const codeMaximumLength = 32;
const nameMaximumLength = 80;
const controlCharacterPattern = /\p{Cc}/u;

export function createCompensationComponent(
  employment: Readonly<Employment>,
  input: CreateCompensationComponentInput,
): Readonly<CompensationComponent> {
  const startsOn = parseLocalDate(input.startsOn);
  const endsOn =
    input.endsOn === undefined ? undefined : parseLocalDate(input.endsOn);
  const effectivePeriod = createDateInterval(startsOn, endsOn);

  assertPeriodWithinEmployment(employment, effectivePeriod);

  return Object.freeze({
    amount: parsePositiveZambianAmount(input.amount),
    basis: 'fixed_per_period',
    code: normalizeComponentCode(input.code),
    companyId: employment.companyId,
    effectivePeriod,
    employmentId: employment.id,
    id: parseEntityId(input.id, 'CompensationComponent'),
    kind: parseComponentKind(input.kind),
    name: normalizeComponentName(input.name),
  });
}

export function assertCompensationComponentHistory(
  employment: Readonly<Employment>,
  components: readonly Readonly<CompensationComponent>[],
): void {
  const identifiers = new Set<CompensationComponentId>();
  const ordered = components.toSorted((left, right) => {
    const keyComparison = `${left.kind}:${left.code}`.localeCompare(
      `${right.kind}:${right.code}`,
    );
    return keyComparison === 0
      ? left.effectivePeriod.startsOn.localeCompare(
          right.effectivePeriod.startsOn,
        )
      : keyComparison;
  });

  for (const component of ordered) {
    if (
      component.companyId !== employment.companyId ||
      component.employmentId !== employment.id
    ) {
      throw new DomainError(
        'TENANT_SCOPE_MISMATCH',
        'Compensation history must belong to the supplied employment',
        { entity: 'CompensationComponent' },
      );
    }
    if (identifiers.has(component.id)) {
      throw invalidComponentHistory('duplicate_component');
    }
    identifiers.add(component.id);
    assertPeriodWithinEmployment(employment, component.effectivePeriod);
  }

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];

    if (
      previous !== undefined &&
      current !== undefined &&
      previous.kind === current.kind &&
      previous.code === current.code &&
      periodsOverlap(previous.effectivePeriod, current.effectivePeriod)
    ) {
      throw invalidComponentHistory('overlapping_component');
    }
  }
}

export function compensationComponentIsEffectiveOn(
  component: Readonly<CompensationComponent>,
  date: LocalDate,
): boolean {
  return intervalContains(component.effectivePeriod, date);
}

export function endCompensationComponent(
  employment: Readonly<Employment>,
  component: Readonly<CompensationComponent>,
  endsOn: string,
): Readonly<CompensationComponent> {
  if (component.effectivePeriod.endsOn !== undefined) {
    throw new DomainError(
      'COMPENSATION_ALREADY_ENDED',
      'An ended compensation component cannot be ended again',
      { entity: 'CompensationComponent' },
    );
  }
  const effectivePeriod = createDateInterval(
    component.effectivePeriod.startsOn,
    parseLocalDate(endsOn),
  );
  assertPeriodWithinEmployment(employment, effectivePeriod);
  return Object.freeze({ ...component, effectivePeriod });
}

export function normalizeComponentCode(value: string): string {
  const normalized = value.normalize('NFKC').trim().toUpperCase();

  if (normalized.length > codeMaximumLength || !codePattern.test(normalized)) {
    throw new DomainError(
      'INVALID_DOMAIN_CODE',
      'Compensation code must use letters, numbers, underscores, or hyphens',
      { entity: 'CompensationComponent', maximumLength: codeMaximumLength },
    );
  }

  return normalized;
}

function normalizeComponentName(value: string): string {
  const normalized = value.normalize('NFC').trim().replace(/\s+/gu, ' ');

  if (
    controlCharacterPattern.test(value) ||
    normalized.length === 0 ||
    [...normalized].length > nameMaximumLength
  ) {
    throw new DomainError(
      'INVALID_DOMAIN_NAME',
      'Compensation name must be nonblank and within the supported length',
      { entity: 'CompensationComponent', maximumLength: nameMaximumLength },
    );
  }

  return normalized;
}

function parseComponentKind(value: string): CompensationComponentKind {
  if (value !== 'allowance' && value !== 'deduction') {
    throw new DomainError(
      'INVALID_ENTITY_STATUS',
      'Compensation component kind is not supported',
      { entity: 'CompensationComponent' },
    );
  }

  return value;
}

function invalidComponentHistory(rule: string): DomainError {
  return new DomainError(
    'COMPENSATION_HISTORY_OVERLAP',
    'Matching compensation component periods cannot overlap',
    { entity: 'CompensationComponent', rule },
  );
}

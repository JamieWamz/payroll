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

export type SalaryId = EntityId<'Salary'>;

export interface Salary {
  readonly amount: Readonly<Money>;
  readonly basis: 'monthly';
  readonly companyId: Employment['companyId'];
  readonly effectivePeriod: Readonly<DateInterval>;
  readonly employmentId: Employment['id'];
  readonly id: SalaryId;
}

export interface CreateSalaryInput {
  readonly amount: string;
  readonly endsOn?: string;
  readonly id: string;
  readonly startsOn: string;
}

export function createSalary(
  employment: Readonly<Employment>,
  input: CreateSalaryInput,
): Readonly<Salary> {
  const startsOn = parseLocalDate(input.startsOn);
  const endsOn =
    input.endsOn === undefined ? undefined : parseLocalDate(input.endsOn);
  const effectivePeriod = createDateInterval(startsOn, endsOn);

  assertPeriodWithinEmployment(employment, effectivePeriod);

  return Object.freeze({
    amount: parsePositiveZambianAmount(input.amount),
    basis: 'monthly',
    companyId: employment.companyId,
    effectivePeriod,
    employmentId: employment.id,
    id: parseEntityId(input.id, 'Salary'),
  });
}

export function assertSalaryHistory(
  employment: Readonly<Employment>,
  salaries: readonly Readonly<Salary>[],
): void {
  const identifiers = new Set<SalaryId>();

  for (const salary of salaries) {
    if (
      salary.companyId !== employment.companyId ||
      salary.employmentId !== employment.id
    ) {
      throw new DomainError(
        'TENANT_SCOPE_MISMATCH',
        'Salary history must belong to the supplied employment',
        { entity: 'Salary' },
      );
    }
    if (identifiers.has(salary.id)) {
      throw invalidSalaryHistory('duplicate_salary');
    }
    identifiers.add(salary.id);
    assertPeriodWithinEmployment(employment, salary.effectivePeriod);
  }

  const ordered = salaries.toSorted((left, right) =>
    left.effectivePeriod.startsOn.localeCompare(right.effectivePeriod.startsOn),
  );

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];

    if (
      previous !== undefined &&
      current !== undefined &&
      periodsOverlap(previous.effectivePeriod, current.effectivePeriod)
    ) {
      throw new DomainError(
        'COMPENSATION_HISTORY_OVERLAP',
        'Salary periods for one employment cannot overlap',
        { entity: 'Salary' },
      );
    }
  }
}

export function salaryIsEffectiveOn(
  salary: Readonly<Salary>,
  date: LocalDate,
): boolean {
  return intervalContains(salary.effectivePeriod, date);
}

export function endSalary(
  employment: Readonly<Employment>,
  salary: Readonly<Salary>,
  endsOn: string,
): Readonly<Salary> {
  if (salary.effectivePeriod.endsOn !== undefined) {
    throw new DomainError(
      'COMPENSATION_ALREADY_ENDED',
      'An ended salary cannot be ended again',
      { entity: 'Salary' },
    );
  }
  const effectivePeriod = createDateInterval(
    salary.effectivePeriod.startsOn,
    parseLocalDate(endsOn),
  );
  assertPeriodWithinEmployment(employment, effectivePeriod);
  return Object.freeze({ ...salary, effectivePeriod });
}

function invalidSalaryHistory(rule: string): DomainError {
  return new DomainError(
    'COMPENSATION_HISTORY_OVERLAP',
    'Salary history is invalid',
    { entity: 'Salary', rule },
  );
}

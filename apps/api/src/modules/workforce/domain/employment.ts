import { DomainError } from '../../../shared/domain/domain-error.js';
import {
  parseEntityId,
  type EntityId,
} from '../../../shared/domain/entity-id.js';
import {
  compareLocalDates,
  createDateInterval,
  parseLocalDate,
  type DateInterval,
  type LocalDate,
} from '../../../shared/domain/local-date.js';
import type { Employee, EmployeeId } from './employee.js';

export type EmploymentId = EntityId<'Employment'>;

export interface Employment {
  readonly companyId: Employee['companyId'];
  readonly effectivePeriod: Readonly<DateInterval>;
  readonly employeeId: EmployeeId;
  readonly id: EmploymentId;
  readonly positionTitle: string;
}

export interface CreateEmploymentInput {
  readonly endsOn?: string;
  readonly id: string;
  readonly positionTitle: string;
  readonly startsOn: string;
}

const positionTitleMaximumLength = 120;
const controlCharacterPattern = /\p{Cc}/u;

export function normalizePositionTitle(value: string): string {
  const normalized = value.normalize('NFC').trim().replace(/\s+/gu, ' ');

  if (
    controlCharacterPattern.test(value) ||
    normalized.length === 0 ||
    [...normalized].length > positionTitleMaximumLength
  ) {
    throw new DomainError(
      'INVALID_DOMAIN_NAME',
      'Position title must be nonblank and within the supported length',
      { entity: 'Employment', maximumLength: positionTitleMaximumLength },
    );
  }

  return normalized;
}

export function createEmployment(
  employee: Readonly<Employee>,
  input: CreateEmploymentInput,
): Readonly<Employment> {
  if (employee.status !== 'active') {
    throw new DomainError(
      'INVALID_ENTITY_STATUS',
      'A new employment requires an active employee',
      { entity: 'Employee' },
    );
  }

  const startsOn = parseLocalDate(input.startsOn);
  const endsOn =
    input.endsOn === undefined ? undefined : parseLocalDate(input.endsOn);

  return Object.freeze({
    companyId: employee.companyId,
    effectivePeriod: createDateInterval(startsOn, endsOn),
    employeeId: employee.id,
    id: parseEntityId(input.id, 'Employment'),
    positionTitle: normalizePositionTitle(input.positionTitle),
  });
}

export function endEmployment(
  employment: Readonly<Employment>,
  endsOn: string,
): Readonly<Employment> {
  if (employment.effectivePeriod.endsOn !== undefined) {
    throw new DomainError(
      'EMPLOYMENT_ALREADY_ENDED',
      'An ended employment cannot be ended again',
      { entity: 'Employment' },
    );
  }

  return Object.freeze({
    ...employment,
    effectivePeriod: createDateInterval(
      employment.effectivePeriod.startsOn,
      parseLocalDate(endsOn),
    ),
  });
}

export function assertEmploymentHistory(
  employee: Readonly<Employee>,
  employments: readonly Readonly<Employment>[],
): void {
  const employmentIds = new Set<EmploymentId>();
  const ordered = employments.toSorted((left, right) =>
    compareLocalDates(
      left.effectivePeriod.startsOn,
      right.effectivePeriod.startsOn,
    ),
  );

  for (const employment of ordered) {
    if (employment.companyId !== employee.companyId) {
      throw new DomainError(
        'TENANT_SCOPE_MISMATCH',
        'Employment and employee must belong to the same company',
        { entity: 'Employment' },
      );
    }
    if (employment.employeeId !== employee.id) {
      throw invalidEmploymentHistory('employee_mismatch');
    }
    if (employmentIds.has(employment.id)) {
      throw invalidEmploymentHistory('duplicate_employment');
    }
    employmentIds.add(employment.id);
  }

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];

    if (
      previous !== undefined &&
      current !== undefined &&
      (previous.effectivePeriod.endsOn === undefined ||
        compareLocalDates(
          current.effectivePeriod.startsOn,
          previous.effectivePeriod.endsOn,
        ) <= 0)
    ) {
      throw new DomainError(
        'EMPLOYMENT_HISTORY_OVERLAP',
        'Employment periods for one employee cannot overlap',
        { entity: 'Employment' },
      );
    }
  }
}

export function archiveEmployee(
  employee: Readonly<Employee>,
  employments: readonly Readonly<Employment>[],
): Readonly<Employee> {
  if (employee.status !== 'active') {
    throw new DomainError(
      'INVALID_ENTITY_STATUS',
      'Only an active employee can be archived',
      { entity: 'Employee' },
    );
  }

  assertEmploymentHistory(employee, employments);

  if (
    employments.some(
      (employment) => employment.effectivePeriod.endsOn === undefined,
    )
  ) {
    throw new DomainError(
      'EMPLOYEE_HAS_OPEN_EMPLOYMENT',
      'An employee with an open employment period cannot be archived',
      { entity: 'Employee' },
    );
  }

  return Object.freeze({ ...employee, status: 'archived' });
}

export function employmentIsEffectiveOn(
  employment: Readonly<Employment>,
  date: LocalDate,
): boolean {
  return (
    compareLocalDates(date, employment.effectivePeriod.startsOn) >= 0 &&
    (employment.effectivePeriod.endsOn === undefined ||
      compareLocalDates(date, employment.effectivePeriod.endsOn) <= 0)
  );
}

function invalidEmploymentHistory(rule: string): DomainError {
  return new DomainError(
    'INVALID_EMPLOYMENT_HISTORY',
    'Employment history does not belong to the supplied employee',
    { entity: 'Employment', rule },
  );
}

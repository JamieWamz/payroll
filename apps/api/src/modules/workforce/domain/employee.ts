import type { CompanyId } from '../../companies/domain/company.js';
import { DomainError } from '../../../shared/domain/domain-error.js';
import {
  parseEntityId,
  type EntityId,
} from '../../../shared/domain/entity-id.js';

declare const employeeNumberBrand: unique symbol;

export type EmployeeId = EntityId<'Employee'>;
export type EmployeeNumber = string & {
  readonly [employeeNumberBrand]: 'EmployeeNumber';
};
export type EmployeeStatus = 'active' | 'archived';

export interface EmployeeName {
  readonly familyName: string;
  readonly givenName: string;
  readonly middleName: string | undefined;
}

export interface Employee {
  readonly companyId: CompanyId;
  readonly employeeNumber: EmployeeNumber;
  readonly id: EmployeeId;
  readonly name: Readonly<EmployeeName>;
  readonly status: EmployeeStatus;
}

export interface CreateEmployeeInput {
  readonly companyId: string;
  readonly employeeNumber: string;
  readonly familyName: string;
  readonly givenName: string;
  readonly id: string;
  readonly middleName?: string;
  readonly status?: string;
}

const employeeNumberMaximumLength = 64;
const employeeNumberPattern = /^[A-Z0-9]+(?:[./-][A-Z0-9]+)*$/;
const namePartMaximumLength = 80;
const controlCharacterPattern = /\p{Cc}/u;
const employeeStatuses: readonly EmployeeStatus[] = Object.freeze([
  'active',
  'archived',
]);

export function normalizeEmployeeNumber(value: string): EmployeeNumber {
  const normalized = value.normalize('NFKC').trim().toUpperCase();

  if (
    normalized.length > employeeNumberMaximumLength ||
    !employeeNumberPattern.test(normalized)
  ) {
    throw new DomainError(
      'INVALID_DOMAIN_CODE',
      'Employee number must use letters, numbers, and single dot, slash, or hyphen separators',
      { entity: 'Employee', maximumLength: employeeNumberMaximumLength },
    );
  }

  return normalized as EmployeeNumber;
}

export function normalizeEmployeeNamePart(
  value: string,
  field: 'familyName' | 'givenName' | 'middleName',
): string {
  const normalized = value.normalize('NFC').trim().replace(/\s+/gu, ' ');

  if (
    controlCharacterPattern.test(value) ||
    normalized.length === 0 ||
    [...normalized].length > namePartMaximumLength
  ) {
    throw new DomainError(
      'INVALID_DOMAIN_NAME',
      'Employee name parts must be nonblank and within the supported length',
      { entity: 'Employee', field, maximumLength: namePartMaximumLength },
    );
  }

  return normalized;
}

export function parseEmployeeStatus(value: string): EmployeeStatus {
  if (!employeeStatuses.includes(value as EmployeeStatus)) {
    throw new DomainError(
      'INVALID_ENTITY_STATUS',
      'Employee status is not supported',
      { entity: 'Employee' },
    );
  }

  return value as EmployeeStatus;
}

export function createEmployee(input: CreateEmployeeInput): Readonly<Employee> {
  const name = Object.freeze({
    familyName: normalizeEmployeeNamePart(input.familyName, 'familyName'),
    givenName: normalizeEmployeeNamePart(input.givenName, 'givenName'),
    middleName:
      input.middleName === undefined
        ? undefined
        : normalizeEmployeeNamePart(input.middleName, 'middleName'),
  });

  return Object.freeze({
    companyId: parseEntityId(input.companyId, 'Company'),
    employeeNumber: normalizeEmployeeNumber(input.employeeNumber),
    id: parseEntityId(input.id, 'Employee'),
    name,
    status: parseEmployeeStatus(input.status ?? 'active'),
  });
}

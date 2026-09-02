import { DomainError } from '../../../shared/domain/domain-error.js';
import {
  parseEntityId,
  type EntityId,
} from '../../../shared/domain/entity-id.js';

declare const companyCodeBrand: unique symbol;

export type CompanyId = EntityId<'Company'>;
export type CompanyCode = string & {
  readonly [companyCodeBrand]: 'CompanyCode';
};
export type CompanyStatus = 'active' | 'archived' | 'suspended';

export interface Company {
  readonly code: CompanyCode;
  readonly id: CompanyId;
  readonly name: string;
  readonly status: CompanyStatus;
}

export interface CreateCompanyInput {
  readonly code: string;
  readonly id: string;
  readonly name: string;
  readonly status?: string;
}

const companyCodePattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const companyCodeMaximumLength = 64;
const companyNameMaximumLength = 160;
const companyNameControlCharacterPattern = /\p{Cc}/u;
const companyStatuses: readonly CompanyStatus[] = Object.freeze([
  'active',
  'archived',
  'suspended',
]);

export function normalizeCompanyCode(value: string): CompanyCode {
  const normalized = value
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/gu, '-')
    .replace(/-+/g, '-');

  if (
    normalized.length > companyCodeMaximumLength ||
    !companyCodePattern.test(normalized)
  ) {
    throw new DomainError(
      'INVALID_DOMAIN_CODE',
      'Company code must contain only lower-case letters, numbers, and single hyphens',
      { entity: 'Company', maximumLength: companyCodeMaximumLength },
    );
  }

  return normalized as CompanyCode;
}

export function normalizeCompanyName(value: string): string {
  const normalized = value.normalize('NFC').trim().replace(/\s+/gu, ' ');

  if (
    companyNameControlCharacterPattern.test(value) ||
    normalized.length === 0 ||
    [...normalized].length > companyNameMaximumLength
  ) {
    throw new DomainError(
      'INVALID_DOMAIN_NAME',
      'Company name must be nonblank and within the supported length',
      { entity: 'Company', maximumLength: companyNameMaximumLength },
    );
  }

  return normalized;
}

export function parseCompanyStatus(value: string): CompanyStatus {
  if (!companyStatuses.includes(value as CompanyStatus)) {
    throw new DomainError(
      'INVALID_ENTITY_STATUS',
      'Company status is not supported',
      { entity: 'Company' },
    );
  }

  return value as CompanyStatus;
}

export function createCompany(input: CreateCompanyInput): Readonly<Company> {
  return Object.freeze({
    code: normalizeCompanyCode(input.code),
    id: parseEntityId(input.id, 'Company'),
    name: normalizeCompanyName(input.name),
    status: parseCompanyStatus(input.status ?? 'active'),
  });
}

export function changeCompanyStatus(
  company: Readonly<Company>,
  status: string,
): Readonly<Company> {
  return Object.freeze({ ...company, status: parseCompanyStatus(status) });
}

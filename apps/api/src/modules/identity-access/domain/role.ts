import type { CompanyId } from '../../companies/domain/company.js';
import { DomainError } from '../../../shared/domain/domain-error.js';
import {
  parseEntityId,
  type EntityId,
} from '../../../shared/domain/entity-id.js';
import {
  normalizePermissionIdentifiers,
  type PermissionIdentifier,
} from './permission.js';

declare const roleCodeBrand: unique symbol;

export type RoleId = EntityId<'Role'>;
export type RoleCode = string & {
  readonly [roleCodeBrand]: 'RoleCode';
};
export type RoleStatus = 'active' | 'inactive';

export interface Role {
  readonly code: RoleCode;
  readonly companyId: CompanyId;
  readonly id: RoleId;
  readonly name: string;
  readonly permissionIdentifiers: readonly PermissionIdentifier[];
  readonly status: RoleStatus;
}

export interface CreateRoleInput {
  readonly code: string;
  readonly companyId: string;
  readonly id: string;
  readonly name: string;
  readonly permissionIdentifiers?: readonly string[];
  readonly status?: string;
}

const roleCodeMaximumLength = 64;
const roleCodePattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const roleNameMaximumLength = 80;
const roleNameControlCharacterPattern = /\p{Cc}/u;
const roleStatuses: readonly RoleStatus[] = Object.freeze([
  'active',
  'inactive',
]);

export function normalizeRoleCode(value: string): RoleCode {
  const normalized = value
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/gu, '-')
    .replace(/-+/g, '-');

  if (
    normalized.length > roleCodeMaximumLength ||
    !roleCodePattern.test(normalized)
  ) {
    throw new DomainError(
      'INVALID_DOMAIN_CODE',
      'Role code must contain only lower-case letters, numbers, and single hyphens',
      { entity: 'Role', maximumLength: roleCodeMaximumLength },
    );
  }

  return normalized as RoleCode;
}

export function normalizeRoleName(value: string): string {
  const normalized = value.normalize('NFC').trim().replace(/\s+/gu, ' ');

  if (
    roleNameControlCharacterPattern.test(value) ||
    normalized.length === 0 ||
    [...normalized].length > roleNameMaximumLength
  ) {
    throw new DomainError(
      'INVALID_DOMAIN_NAME',
      'Role name must be nonblank and within the supported length',
      { entity: 'Role', maximumLength: roleNameMaximumLength },
    );
  }

  return normalized;
}

export function parseRoleStatus(value: string): RoleStatus {
  if (!roleStatuses.includes(value as RoleStatus)) {
    throw new DomainError(
      'INVALID_ENTITY_STATUS',
      'Role status is not supported',
      { entity: 'Role' },
    );
  }

  return value as RoleStatus;
}

export function createRole(input: CreateRoleInput): Readonly<Role> {
  return Object.freeze({
    code: normalizeRoleCode(input.code),
    companyId: parseEntityId(input.companyId, 'Company'),
    id: parseEntityId(input.id, 'Role'),
    name: normalizeRoleName(input.name),
    permissionIdentifiers: normalizePermissionIdentifiers(
      input.permissionIdentifiers ?? [],
    ),
    status: parseRoleStatus(input.status ?? 'active'),
  });
}

export function changeRoleStatus(
  role: Readonly<Role>,
  status: string,
): Readonly<Role> {
  return Object.freeze({ ...role, status: parseRoleStatus(status) });
}

export function replaceRolePermissions(
  role: Readonly<Role>,
  permissionIdentifiers: readonly string[],
): Readonly<Role> {
  return Object.freeze({
    ...role,
    permissionIdentifiers: normalizePermissionIdentifiers(
      permissionIdentifiers,
    ),
  });
}

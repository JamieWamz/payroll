import type { CompanyId } from '../../companies/domain/company.js';
import { DomainError } from '../../../shared/domain/domain-error.js';
import {
  parseEntityId,
  type EntityId,
} from '../../../shared/domain/entity-id.js';
import {
  parseLocalDate,
  type LocalDate,
} from '../../../shared/domain/local-date.js';
import type { Role, RoleId } from './role.js';
import type { UserAccountId } from './user-account.js';

export type CompanyMembershipId = EntityId<'CompanyMembership'>;
export type CompanyMembershipStatus = 'active' | 'revoked' | 'suspended';

export interface RoleAssignment {
  readonly assignedOn: LocalDate;
  readonly companyId: CompanyId;
  readonly roleId: RoleId;
}

export interface RoleAssignmentInput {
  readonly assignedOn: string;
  readonly companyId: string;
  readonly roleId: string;
}

export interface CompanyMembership {
  readonly companyId: CompanyId;
  readonly id: CompanyMembershipId;
  readonly roleAssignments: readonly Readonly<RoleAssignment>[];
  readonly status: CompanyMembershipStatus;
  readonly userAccountId: UserAccountId;
}

export interface CreateCompanyMembershipInput {
  readonly companyId: string;
  readonly id: string;
  readonly roleAssignments?: readonly RoleAssignmentInput[];
  readonly status?: string;
  readonly userAccountId: string;
}

const companyMembershipStatuses: readonly CompanyMembershipStatus[] =
  Object.freeze(['active', 'revoked', 'suspended']);

export function parseCompanyMembershipStatus(
  value: string,
): CompanyMembershipStatus {
  if (!companyMembershipStatuses.includes(value as CompanyMembershipStatus)) {
    throw new DomainError(
      'INVALID_ENTITY_STATUS',
      'Company membership status is not supported',
      { entity: 'CompanyMembership' },
    );
  }

  return value as CompanyMembershipStatus;
}

export function createRoleAssignment(
  role: Readonly<Role>,
  assignedOn: string,
): Readonly<RoleAssignment> {
  return Object.freeze({
    assignedOn: parseLocalDate(assignedOn),
    companyId: role.companyId,
    roleId: role.id,
  });
}

export function createCompanyMembership(
  input: CreateCompanyMembershipInput,
): Readonly<CompanyMembership> {
  const companyId = parseEntityId(input.companyId, 'Company');
  const roleAssignments = normalizeRoleAssignments(
    companyId,
    input.roleAssignments ?? [],
  );

  return Object.freeze({
    companyId,
    id: parseEntityId(input.id, 'CompanyMembership'),
    roleAssignments,
    status: parseCompanyMembershipStatus(input.status ?? 'active'),
    userAccountId: parseEntityId(input.userAccountId, 'UserAccount'),
  });
}

export function changeCompanyMembershipStatus(
  membership: Readonly<CompanyMembership>,
  status: string,
): Readonly<CompanyMembership> {
  return Object.freeze({
    ...membership,
    status: parseCompanyMembershipStatus(status),
  });
}

export function assignRole(
  membership: Readonly<CompanyMembership>,
  role: Readonly<Role>,
  assignedOn: string,
): Readonly<CompanyMembership> {
  assertSameCompany(membership.companyId, role.companyId);

  if (
    membership.roleAssignments.some(
      (assignment) => assignment.roleId === role.id,
    )
  ) {
    throw new DomainError(
      'DUPLICATE_ROLE_ASSIGNMENT',
      'Role is already assigned to this company membership',
      { entity: 'CompanyMembership' },
    );
  }

  const roleAssignments = Object.freeze([
    ...membership.roleAssignments,
    createRoleAssignment(role, assignedOn),
  ]);

  return Object.freeze({ ...membership, roleAssignments });
}

function normalizeRoleAssignments(
  companyId: CompanyId,
  inputs: readonly RoleAssignmentInput[],
): readonly Readonly<RoleAssignment>[] {
  const roleIds = new Set<RoleId>();
  const assignments = inputs.map((input) => {
    const assignment = Object.freeze({
      assignedOn: parseLocalDate(input.assignedOn),
      companyId: parseEntityId(input.companyId, 'Company'),
      roleId: parseEntityId(input.roleId, 'Role'),
    });

    assertSameCompany(companyId, assignment.companyId);

    if (roleIds.has(assignment.roleId)) {
      throw new DomainError(
        'DUPLICATE_ROLE_ASSIGNMENT',
        'Role is already assigned to this company membership',
        { entity: 'CompanyMembership' },
      );
    }

    roleIds.add(assignment.roleId);
    return assignment;
  });

  return Object.freeze(assignments);
}

function assertSameCompany(expected: CompanyId, actual: CompanyId): void {
  if (actual !== expected) {
    throw new DomainError(
      'TENANT_SCOPE_MISMATCH',
      'Role and company membership must belong to the same company',
      { entity: 'RoleAssignment' },
    );
  }
}

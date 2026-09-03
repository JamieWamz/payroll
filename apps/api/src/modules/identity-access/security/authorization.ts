import type { CompanyId } from '../../companies/domain/company.js';
import { DomainError } from '../../../shared/domain/domain-error.js';
import {
  parseEntityId,
  type EntityId,
} from '../../../shared/domain/entity-id.js';
import type { CompanyMembershipId } from '../domain/company-membership.js';
import {
  normalizePermissionIdentifier,
  normalizePermissionIdentifiers,
  type PermissionIdentifier,
} from '../domain/permission.js';
import type { UserAccountId } from '../domain/user-account.js';

export type SessionId = EntityId<'Session'>;

export interface AuthorizationPrincipal {
  readonly companyId: CompanyId;
  readonly membershipId: CompanyMembershipId;
  readonly permissionIdentifiers: readonly PermissionIdentifier[];
  readonly sessionId: SessionId;
  readonly userAccountId: UserAccountId;
}

export interface CreateAuthorizationPrincipalInput {
  readonly companyId: string;
  readonly membershipId: string;
  readonly permissionIdentifiers: readonly string[];
  readonly sessionId: string;
  readonly userAccountId: string;
}

export function createAuthorizationPrincipal(
  input: CreateAuthorizationPrincipalInput,
): Readonly<AuthorizationPrincipal> {
  return Object.freeze({
    companyId: parseEntityId(input.companyId, 'Company'),
    membershipId: parseEntityId(input.membershipId, 'CompanyMembership'),
    permissionIdentifiers: normalizePermissionIdentifiers(
      input.permissionIdentifiers,
    ),
    sessionId: parseEntityId(input.sessionId, 'Session'),
    userAccountId: parseEntityId(input.userAccountId, 'UserAccount'),
  });
}

export function requirePermission(
  principal: Readonly<AuthorizationPrincipal>,
  permissionIdentifier: string,
): void {
  const permission = normalizePermissionIdentifier(permissionIdentifier);

  if (!principal.permissionIdentifiers.includes(permission)) {
    throw new DomainError(
      'FORBIDDEN_OPERATION',
      'Authenticated principal does not have the required permission',
      { permission },
    );
  }
}

export function requireCompanyScope(
  principal: Readonly<AuthorizationPrincipal>,
  companyId: string,
): void {
  if (principal.companyId !== parseEntityId(companyId, 'Company')) {
    throw new DomainError(
      'TENANT_SCOPE_MISMATCH',
      'Authenticated principal does not belong to the requested company scope',
      { entity: 'AuthorizationPrincipal' },
    );
  }
}

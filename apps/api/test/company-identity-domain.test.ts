import { describe, expect, it } from 'vitest';

import {
  changeCompanyStatus,
  createCompany,
} from '../src/modules/companies/domain/index.js';
import {
  assignRole,
  changeCompanyMembershipStatus,
  changeRoleStatus,
  changeUserAccountStatus,
  createCompanyMembership,
  createRole,
  createUserAccount,
  replaceRolePermissions,
} from '../src/modules/identity-access/domain/index.js';

const companyOneId = '10000000-0000-4000-8000-000000000001';
const companyTwoId = '10000000-0000-4000-8000-000000000002';
const userAccountId = '20000000-0000-4000-8000-000000000001';
const roleOneId = '30000000-0000-4000-8000-000000000001';
const roleTwoId = '30000000-0000-4000-8000-000000000002';
const membershipOneId = '40000000-0000-4000-8000-000000000001';
const membershipTwoId = '40000000-0000-4000-8000-000000000002';

describe('companies', () => {
  it('normalizes company identity values and returns immutable records', () => {
    const company = createCompany({
      code: '  Copperbelt__Services  ',
      id: companyOneId,
      name: '  Copperbelt   Services Limited  ',
    });

    expect(company).toEqual({
      code: 'copperbelt-services',
      id: companyOneId,
      name: 'Copperbelt Services Limited',
      status: 'active',
    });
    expect(Object.isFrozen(company)).toBe(true);
  });

  it('enforces code and name bounds', () => {
    expect(() =>
      createCompany({
        code: 'not/a/code',
        id: companyOneId,
        name: 'Valid name',
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_DOMAIN_CODE' }));
    expect(() =>
      createCompany({ code: 'valid', id: companyOneId, name: '   ' }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_DOMAIN_NAME' }));
    expect(() =>
      createCompany({
        code: 'valid',
        id: companyOneId,
        name: 'a'.repeat(161),
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_DOMAIN_NAME' }));
    expect(() =>
      createCompany({ code: 'valid', id: companyOneId, name: 'Bad\0Name' }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_DOMAIN_NAME' }));
  });

  it('changes status immutably and rejects unsupported statuses', () => {
    const active = createCompany({
      code: 'company-one',
      id: companyOneId,
      name: 'Company One',
    });
    const archived = changeCompanyStatus(active, 'archived');

    expect(active.status).toBe('active');
    expect(archived.status).toBe('archived');
    expect(Object.isFrozen(archived)).toBe(true);
    expect(() => changeCompanyStatus(active, 'deleted')).toThrowError(
      expect.objectContaining({ code: 'INVALID_ENTITY_STATUS' }),
    );
  });
});

describe('global user accounts', () => {
  it('normalizes email and display name without embedding a company', () => {
    const account = createUserAccount({
      displayName: '  Jamie   Wamz  ',
      email: '  JAMIE@Example.COM  ',
      id: userAccountId,
    });

    expect(account).toEqual({
      displayName: 'Jamie Wamz',
      email: 'jamie@example.com',
      id: userAccountId,
      status: 'active',
    });
    expect(account).not.toHaveProperty('companyId');
    expect(Object.isFrozen(account)).toBe(true);
  });

  it('enforces email, name, and status validation', () => {
    expect(() =>
      createUserAccount({
        displayName: 'Jamie',
        email: 'not-an-email',
        id: userAccountId,
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_EMAIL_ADDRESS' }));
    expect(() =>
      createUserAccount({
        displayName: 'Jamie',
        email: 'jamie@-example.com',
        id: userAccountId,
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_EMAIL_ADDRESS' }));
    expect(() =>
      createUserAccount({
        displayName: 'a'.repeat(121),
        email: 'jamie@example.com',
        id: userAccountId,
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_DOMAIN_NAME' }));

    const account = createUserAccount({
      displayName: 'Jamie',
      email: 'jamie@example.com',
      id: userAccountId,
    });
    expect(changeUserAccountStatus(account, 'suspended').status).toBe(
      'suspended',
    );
    expect(() => changeUserAccountStatus(account, 'deleted')).toThrowError(
      expect.objectContaining({ code: 'INVALID_ENTITY_STATUS' }),
    );
  });
});

describe('company-scoped roles and permissions', () => {
  it('normalizes a role and keeps an open validated permission vocabulary', () => {
    const role = createRole({
      code: '  Payroll__Reviewer ',
      companyId: companyOneId,
      id: roleOneId,
      name: '  Payroll   Reviewer ',
      permissionIdentifiers: [
        ' Reports.Export ',
        'records.view',
        'records.view',
      ],
    });

    expect(role.code).toBe('payroll-reviewer');
    expect(role.name).toBe('Payroll Reviewer');
    expect(role.permissionIdentifiers).toEqual([
      'records.view',
      'reports.export',
    ]);
    expect(Object.isFrozen(role)).toBe(true);
    expect(Object.isFrozen(role.permissionIdentifiers)).toBe(true);
  });

  it('validates names, identifiers, and role status', () => {
    expect(() =>
      createRole({
        code: 'reviewer',
        companyId: companyOneId,
        id: roleOneId,
        name: ' ',
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_DOMAIN_NAME' }));
    expect(() =>
      createRole({
        code: 'reviewer',
        companyId: companyOneId,
        id: roleOneId,
        name: 'Reviewer',
        permissionIdentifiers: ['unscoped'],
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'INVALID_PERMISSION_IDENTIFIER' }),
    );

    const role = createRole({
      code: 'reviewer',
      companyId: companyOneId,
      id: roleOneId,
      name: 'Reviewer',
    });
    expect(changeRoleStatus(role, 'inactive').status).toBe('inactive');
    expect(() => changeRoleStatus(role, 'deleted')).toThrowError(
      expect.objectContaining({ code: 'INVALID_ENTITY_STATUS' }),
    );
    expect(
      replaceRolePermissions(role, ['reports.view']).permissionIdentifiers,
    ).toEqual(['reports.view']);
  });
});

describe('company memberships and role assignments', () => {
  it('supports one global account holding memberships in multiple companies', () => {
    const firstMembership = createCompanyMembership({
      companyId: companyOneId,
      id: membershipOneId,
      userAccountId,
    });
    const secondMembership = createCompanyMembership({
      companyId: companyTwoId,
      id: membershipTwoId,
      userAccountId,
    });

    expect(firstMembership.userAccountId).toBe(userAccountId);
    expect(secondMembership.userAccountId).toBe(userAccountId);
    expect(firstMembership.companyId).not.toBe(secondMembership.companyId);
  });

  it('assigns a same-company role and freezes every returned value', () => {
    const membership = createCompanyMembership({
      companyId: companyOneId,
      id: membershipOneId,
      userAccountId,
    });
    const role = createRole({
      code: 'reviewer',
      companyId: companyOneId,
      id: roleOneId,
      name: 'Reviewer',
    });
    const assigned = assignRole(membership, role, '2026-09-02');

    expect(membership.roleAssignments).toEqual([]);
    expect(assigned.roleAssignments).toEqual([
      {
        assignedOn: '2026-09-02',
        companyId: companyOneId,
        roleId: roleOneId,
      },
    ]);
    expect(Object.isFrozen(assigned)).toBe(true);
    expect(Object.isFrozen(assigned.roleAssignments)).toBe(true);
    expect(Object.isFrozen(assigned.roleAssignments[0])).toBe(true);
    expect(changeCompanyMembershipStatus(assigned, 'revoked').status).toBe(
      'revoked',
    );
  });

  it('rejects tenant mismatches and duplicate assignments', () => {
    const membership = createCompanyMembership({
      companyId: companyOneId,
      id: membershipOneId,
      userAccountId,
    });
    const foreignRole = createRole({
      code: 'foreign-reviewer',
      companyId: companyTwoId,
      id: roleTwoId,
      name: 'Foreign Reviewer',
    });

    expect(() =>
      assignRole(membership, foreignRole, '2026-09-02'),
    ).toThrowError(expect.objectContaining({ code: 'TENANT_SCOPE_MISMATCH' }));

    const localRole = createRole({
      code: 'reviewer',
      companyId: companyOneId,
      id: roleOneId,
      name: 'Reviewer',
    });
    const assigned = assignRole(membership, localRole, '2026-09-02');
    expect(() => assignRole(assigned, localRole, '2026-09-03')).toThrowError(
      expect.objectContaining({ code: 'DUPLICATE_ROLE_ASSIGNMENT' }),
    );
  });

  it('validates reconstituted assignment tenant and dates', () => {
    expect(() =>
      createCompanyMembership({
        companyId: companyOneId,
        id: membershipOneId,
        roleAssignments: [
          {
            assignedOn: '2026-09-02',
            companyId: companyTwoId,
            roleId: roleTwoId,
          },
        ],
        userAccountId,
      }),
    ).toThrowError(expect.objectContaining({ code: 'TENANT_SCOPE_MISMATCH' }));
    expect(() =>
      createCompanyMembership({
        companyId: companyOneId,
        id: membershipOneId,
        roleAssignments: [
          {
            assignedOn: '2026-02-30',
            companyId: companyOneId,
            roleId: roleOneId,
          },
        ],
        userAccountId,
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_LOCAL_DATE' }));
  });
});

import { describe, expect, it } from 'vitest';

import {
  assertGratuityPolicySchedule,
  calculateContractGratuity,
  createGratuityPolicy,
  endGratuityPolicy,
} from '../src/modules/compensation/domain/index.js';
import { serializeMoney } from '../src/shared/domain/money.js';

const companyId = 'aa000000-0000-4000-8000-000000000001';
const secondCompanyId = 'aa000000-0000-4000-8000-000000000002';
const policyId = 'ab000000-0000-4000-8000-000000000001';
const secondPolicyId = 'ab000000-0000-4000-8000-000000000002';

describe('contract gratuity company policy', () => {
  it('calculates the operator policy rate on basic pay earned', () => {
    const policy = createGratuityPolicy({
      companyId,
      id: policyId,
      name: 'Standard contract gratuity',
      policyReference: 'HR Policy 2026, clause 8',
      ratePercent: '30',
      startsOn: '2026-01-01',
    });
    const result = calculateContractGratuity({
      basicPayEarned: '240000.00',
      contractEndsOn: '2026-12-31',
      policy,
      settlementDate: '2026-12-31',
      statutoryMinimumRatePercent: '25',
    });

    expect(policy.ratePercent).toBe('30.00');
    expect(serializeMoney(result.amount).amount).toBe('72000.00');
    expect(result).toMatchObject({
      basis: 'basic_pay_earned_during_contract',
      policyRatePercent: '30.00',
      settlementReason: 'contract_expiry',
      statutoryMinimumRatePercent: '25.00',
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.amount)).toBe(true);
  });

  it('rejects a company policy below the supplied statutory floor', () => {
    const policy = createGratuityPolicy({
      companyId,
      id: policyId,
      name: 'Under-minimum policy',
      policyReference: 'Draft policy',
      ratePercent: '20',
      startsOn: '2026-01-01',
    });
    expect(() =>
      calculateContractGratuity({
        basicPayEarned: '120000',
        contractEndsOn: '2026-12-31',
        policy,
        settlementDate: '2026-12-31',
        statutoryMinimumRatePercent: '25',
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'INVALID_TERMINAL_BENEFIT_CALCULATION',
        details: expect.objectContaining({
          rule: 'policy_below_statutory_minimum',
        }),
      }),
    );
  });

  it('requires contract completion and a policy effective at expiry', () => {
    const policy = createGratuityPolicy({
      companyId,
      endsOn: '2026-06-30',
      id: policyId,
      name: 'First-half policy',
      policyReference: 'HR Policy 2026 H1',
      ratePercent: '25',
      startsOn: '2026-01-01',
    });
    expect(() =>
      calculateContractGratuity({
        basicPayEarned: '120000',
        contractEndsOn: '2026-12-31',
        policy,
        settlementDate: '2026-12-30',
        statutoryMinimumRatePercent: '25',
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'INVALID_TERMINAL_BENEFIT_CALCULATION',
      }),
    );
    expect(() =>
      calculateContractGratuity({
        basicPayEarned: '120000',
        contractEndsOn: '2026-12-31',
        policy,
        settlementDate: '2027-01-02',
        statutoryMinimumRatePercent: '25',
      }),
    ).toThrowError(
      expect.objectContaining({
        details: expect.objectContaining({
          rule: 'policy_not_effective_at_contract_end',
        }),
      }),
    );
  });

  it('allows adjacent policy versions and rejects overlap or tenant mixing', () => {
    const first = createGratuityPolicy({
      companyId,
      endsOn: '2026-06-30',
      id: policyId,
      name: 'Policy 2026 H1',
      policyReference: 'HR Policy 2026 H1',
      ratePercent: '25',
      startsOn: '2026-01-01',
    });
    const next = createGratuityPolicy({
      companyId,
      id: secondPolicyId,
      name: 'Policy 2026 H2',
      policyReference: 'HR Policy 2026 H2',
      ratePercent: '30',
      startsOn: '2026-07-01',
    });
    expect(() =>
      assertGratuityPolicySchedule(first.companyId, [next, first]),
    ).not.toThrow();

    const overlapping = createGratuityPolicy({
      companyId,
      id: secondPolicyId,
      name: 'Overlapping policy',
      policyReference: 'Overlapping draft',
      ratePercent: '30',
      startsOn: '2026-06-30',
    });
    expect(() =>
      assertGratuityPolicySchedule(first.companyId, [first, overlapping]),
    ).toThrowError(
      expect.objectContaining({ code: 'GRATUITY_POLICY_HISTORY_OVERLAP' }),
    );

    const foreign = createGratuityPolicy({
      companyId: secondCompanyId,
      id: secondPolicyId,
      name: 'Foreign policy',
      policyReference: 'Foreign policy',
      ratePercent: '25',
      startsOn: '2026-07-01',
    });
    expect(() =>
      assertGratuityPolicySchedule(first.companyId, [first, foreign]),
    ).toThrowError(expect.objectContaining({ code: 'TENANT_SCOPE_MISMATCH' }));
  });

  it('ends an open policy once and validates operator-entered rates', () => {
    const policy = createGratuityPolicy({
      companyId,
      id: policyId,
      name: 'Contract gratuity',
      policyReference: 'HR Policy 2026',
      ratePercent: '25.5',
      startsOn: '2026-01-01',
    });
    const ended = endGratuityPolicy(policy, '2026-12-31');
    expect(ended.effectivePeriod.endsOn).toBe('2026-12-31');
    expect(() => endGratuityPolicy(ended, '2027-01-01')).toThrowError(
      expect.objectContaining({ code: 'GRATUITY_POLICY_ALREADY_ENDED' }),
    );
    expect(() =>
      createGratuityPolicy({
        companyId,
        id: secondPolicyId,
        name: 'Invalid policy',
        policyReference: 'Invalid policy',
        ratePercent: '100.01',
        startsOn: '2027-01-01',
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'INVALID_GRATUITY_POLICY' }),
    );
  });
});

import { describe, expect, it } from 'vitest';

import { createCompany } from '../src/modules/companies/domain/index.js';
import {
  assertStatutoryConfigurationSchedule,
  createDraftStatutoryConfiguration,
  retireStatutoryConfiguration,
  verifyStatutoryConfiguration,
} from '../src/modules/statutory-configuration/domain/index.js';

const companyId = '91000000-0000-4000-8000-000000000001';
const anotherCompanyId = '91000000-0000-4000-8000-000000000002';
const configurationId = '92000000-0000-4000-8000-000000000001';
const secondConfigurationId = '92000000-0000-4000-8000-000000000002';
const membershipId = '93000000-0000-4000-8000-000000000001';

const sourceInputs = [
  {
    accessedOn: '2026-09-04',
    authority: 'zra',
    title: '  ZRA   PAYE evidence ',
    uri: 'https://www.zra.org.zm/tax-information/',
  },
  {
    accessedOn: '2026-09-04',
    authority: 'napsa',
    title: 'NAPSA contribution evidence',
    uri: 'https://www.napsa.co.zm/important-facts/',
  },
  {
    accessedOn: '2026-09-04',
    authority: 'nhima',
    title: 'NHIMA contribution evidence',
    uri: 'https://www.nhima.co.zm/',
  },
] as const;

function createDraft(overrides = {}) {
  return createDraftStatutoryConfiguration({
    companyId,
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-12-31',
    id: configurationId,
    parameters: {
      nhima: { evidenceState: 'awaiting_rule_parser' },
      napsa: { evidenceState: 'awaiting_rule_parser' },
      paye: { evidenceState: 'awaiting_rule_parser' },
    },
    sources: sourceInputs,
    version: ' zm-2026.1 ',
    ...overrides,
  });
}

describe('statutory configuration evidence', () => {
  it('creates a deeply immutable draft with normalized evidence', () => {
    const parameters = {
      nhima: { notes: ['official evidence required'] },
      napsa: { notes: ['annual ceiling required'] },
      paye: { notes: ['effective bands required'] },
    };
    const draft = createDraft({ parameters });

    expect(draft).toMatchObject({
      companyId,
      effectivePeriod: {
        endsOn: '2026-12-31',
        startsOn: '2026-01-01',
      },
      id: configurationId,
      status: 'draft',
      verification: undefined,
      version: 'ZM-2026.1',
    });
    expect(draft.sources[0]).toEqual({
      accessedOn: '2026-09-04',
      authority: 'zra',
      publishedOn: undefined,
      title: 'ZRA PAYE evidence',
      uri: 'https://www.zra.org.zm/tax-information/',
    });
    expect(Object.isFrozen(draft)).toBe(true);
    expect(Object.isFrozen(draft.parameters)).toBe(true);
    expect(Object.isFrozen(draft.parameters['paye'])).toBe(true);

    parameters.paye.notes.push('caller mutation');
    expect(draft.parameters['paye']).toEqual({
      notes: ['effective bands required'],
    });
  });

  it('requires evidence for all three authorities before verification', () => {
    const incomplete = createDraft({ sources: sourceInputs.slice(0, 2) });

    expect(() =>
      verifyStatutoryConfiguration(
        incomplete,
        membershipId,
        '2026-09-04T10:30:00.000Z',
      ),
    ).toThrowError(
      expect.objectContaining({ code: 'INVALID_STATUTORY_CONFIGURATION' }),
    );
  });

  it('records human verification and permits retirement without rewriting evidence', () => {
    const draft = createDraft();
    const verified = verifyStatutoryConfiguration(
      draft,
      membershipId,
      '2026-09-04T10:30:00.000Z',
    );
    const retired = retireStatutoryConfiguration(verified);

    expect(verified.status).toBe('verified');
    expect(verified.verification).toEqual({
      verifiedAt: '2026-09-04T10:30:00.000Z',
      verifiedByMembershipId: membershipId,
    });
    expect(retired.status).toBe('retired');
    expect(retired.parameters).toBe(verified.parameters);
    expect(() =>
      verifyStatutoryConfiguration(
        verified,
        membershipId,
        '2026-09-04T11:00:00.000Z',
      ),
    ).toThrowError(
      expect.objectContaining({ code: 'STATUTORY_CONFIGURATION_IMMUTABLE' }),
    );
  });

  it('rejects unsafe sources and non-JSON parameters', () => {
    expect(() =>
      createDraft({
        sources: [
          ...sourceInputs.slice(0, 2),
          {
            ...sourceInputs[2],
            uri: 'http://user:password@nhima.example.test/rates',
          },
        ],
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'INVALID_STATUTORY_CONFIGURATION' }),
    );
    expect(() =>
      createDraft({ parameters: { paye: Number.POSITIVE_INFINITY } }),
    ).toThrowError(
      expect.objectContaining({ code: 'INVALID_STATUTORY_CONFIGURATION' }),
    );
    expect(() =>
      createDraft({
        sources: [
          ...sourceInputs.slice(0, 2),
          {
            ...sourceInputs[2],
            publishedOn: '2026-09-05',
          },
        ],
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'INVALID_STATUTORY_CONFIGURATION' }),
    );
  });

  it('rejects overlapping applicable configurations and cross-company schedules', () => {
    const company = createCompany({
      code: 'statutory-company',
      id: companyId,
      name: 'Statutory Company',
    });
    const first = verifyStatutoryConfiguration(
      createDraft(),
      membershipId,
      '2026-09-04T10:30:00.000Z',
    );
    const overlapping = verifyStatutoryConfiguration(
      createDraft({
        effectiveFrom: '2026-12-31',
        effectiveTo: '2027-12-31',
        id: secondConfigurationId,
        version: 'ZM-2027.1',
      }),
      membershipId,
      '2026-09-04T10:31:00.000Z',
    );

    expect(() =>
      assertStatutoryConfigurationSchedule(company.id, [first, overlapping]),
    ).toThrowError(
      expect.objectContaining({ code: 'INVALID_STATUTORY_CONFIGURATION' }),
    );

    const foreign = createDraft({
      companyId: anotherCompanyId,
      id: secondConfigurationId,
      version: 'ZM-2027.1',
    });
    expect(() =>
      assertStatutoryConfigurationSchedule(company.id, [first, foreign]),
    ).toThrowError(expect.objectContaining({ code: 'TENANT_SCOPE_MISMATCH' }));
  });
});

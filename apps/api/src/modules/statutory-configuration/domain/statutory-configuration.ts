import type { CompanyId } from '../../companies/domain/company.js';
import { DomainError } from '../../../shared/domain/domain-error.js';
import {
  parseEntityId,
  type EntityId,
} from '../../../shared/domain/entity-id.js';
import { parseInstant, type Instant } from '../../../shared/domain/instant.js';
import {
  createDateInterval,
  parseLocalDate,
  type DateInterval,
  type LocalDate,
} from '../../../shared/domain/local-date.js';

export type StatutoryConfigurationId = EntityId<'StatutoryConfiguration'>;
export type MembershipId = EntityId<'CompanyMembership'>;
export type StatutoryAuthority = 'nhima' | 'napsa' | 'zra';
export type StatutoryConfigurationStatus = 'draft' | 'retired' | 'verified';
export type JsonPrimitive = boolean | null | number | string;
export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface StatutorySource {
  readonly accessedOn: LocalDate;
  readonly authority: StatutoryAuthority;
  readonly publishedOn: LocalDate | undefined;
  readonly title: string;
  readonly uri: string;
}

export interface VerificationEvidence {
  readonly verifiedAt: Instant;
  readonly verifiedByMembershipId: MembershipId;
}

export interface StatutoryConfiguration {
  readonly companyId: CompanyId;
  readonly effectivePeriod: Readonly<DateInterval>;
  readonly id: StatutoryConfigurationId;
  readonly parameters: Readonly<Record<string, JsonValue>>;
  readonly sources: readonly Readonly<StatutorySource>[];
  readonly status: StatutoryConfigurationStatus;
  readonly verification: Readonly<VerificationEvidence> | undefined;
  readonly version: string;
}

export interface CreateStatutoryConfigurationInput {
  readonly companyId: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly id: string;
  readonly parameters: unknown;
  readonly sources?: readonly CreateStatutorySourceInput[];
  readonly version: string;
}

export interface CreateStatutorySourceInput {
  readonly accessedOn: string;
  readonly authority: string;
  readonly publishedOn?: string;
  readonly title: string;
  readonly uri: string;
}

const authorities: readonly StatutoryAuthority[] = Object.freeze([
  'nhima',
  'napsa',
  'zra',
]);
const versionPattern = /^[A-Z0-9]+(?:[._-][A-Z0-9]+)*$/;
const versionMaximumLength = 64;
const titleMaximumLength = 240;
const uriMaximumLength = 2_048;
const parameterMaximumDepth = 12;
const parameterMaximumNodes = 4_096;
const parameterMaximumBytes = 65_536;
const forbiddenObjectKeys = new Set(['__proto__', 'constructor', 'prototype']);
const controlCharacterPattern = /\p{Cc}/u;

export function createDraftStatutoryConfiguration(
  input: CreateStatutoryConfigurationInput,
): Readonly<StatutoryConfiguration> {
  const effectiveFrom = parseLocalDate(input.effectiveFrom);
  const effectiveTo =
    input.effectiveTo === undefined
      ? undefined
      : parseLocalDate(input.effectiveTo);

  return Object.freeze({
    companyId: parseEntityId(input.companyId, 'Company'),
    effectivePeriod: createDateInterval(effectiveFrom, effectiveTo),
    id: parseEntityId(input.id, 'StatutoryConfiguration'),
    parameters: cloneAndFreezeParameters(input.parameters),
    sources: Object.freeze((input.sources ?? []).map(createStatutorySource)),
    status: 'draft',
    verification: undefined,
    version: normalizeConfigurationVersion(input.version),
  });
}

export function verifyStatutoryConfiguration(
  configuration: Readonly<StatutoryConfiguration>,
  verifiedByMembershipId: string,
  verifiedAt: string,
): Readonly<StatutoryConfiguration> {
  if (configuration.status !== 'draft') {
    throw immutableConfiguration();
  }

  assertCompleteEvidence(configuration);

  return Object.freeze({
    ...configuration,
    status: 'verified',
    verification: Object.freeze({
      verifiedAt: parseInstant(verifiedAt),
      verifiedByMembershipId: parseEntityId(
        verifiedByMembershipId,
        'CompanyMembership',
      ),
    }),
  });
}

export function retireStatutoryConfiguration(
  configuration: Readonly<StatutoryConfiguration>,
): Readonly<StatutoryConfiguration> {
  if (configuration.status !== 'verified') {
    throw immutableConfiguration();
  }

  return Object.freeze({ ...configuration, status: 'retired' });
}

export function assertStatutoryConfigurationSchedule(
  companyId: CompanyId,
  configurations: readonly Readonly<StatutoryConfiguration>[],
): void {
  const identifiers = new Set<StatutoryConfigurationId>();
  const versions = new Set<string>();

  for (const configuration of configurations) {
    if (configuration.companyId !== companyId) {
      throw new DomainError(
        'TENANT_SCOPE_MISMATCH',
        'Statutory configurations must belong to the supplied company',
        { entity: 'StatutoryConfiguration' },
      );
    }
    if (
      identifiers.has(configuration.id) ||
      versions.has(configuration.version)
    ) {
      throw invalidConfiguration('duplicate_configuration');
    }
    identifiers.add(configuration.id);
    versions.add(configuration.version);
  }

  const applicable = configurations
    .filter((configuration) => configuration.status !== 'draft')
    .toSorted((left, right) =>
      left.effectivePeriod.startsOn.localeCompare(
        right.effectivePeriod.startsOn,
      ),
    );

  for (let index = 1; index < applicable.length; index += 1) {
    const previous = applicable[index - 1];
    const current = applicable[index];

    if (
      previous !== undefined &&
      current !== undefined &&
      (previous.effectivePeriod.endsOn === undefined ||
        current.effectivePeriod.startsOn <= previous.effectivePeriod.endsOn)
    ) {
      throw invalidConfiguration('overlapping_verified_configuration');
    }
  }
}

export function createStatutorySource(
  input: CreateStatutorySourceInput,
): Readonly<StatutorySource> {
  const accessedOn = parseLocalDate(input.accessedOn);
  const publishedOn =
    input.publishedOn === undefined
      ? undefined
      : parseLocalDate(input.publishedOn);
  let uri: URL;
  try {
    uri = new URL(input.uri);
  } catch {
    throw invalidConfiguration('invalid_source_uri');
  }

  if (
    uri.protocol !== 'https:' ||
    uri.username !== '' ||
    uri.password !== '' ||
    input.uri.length > uriMaximumLength
  ) {
    throw invalidConfiguration('invalid_source_uri');
  }

  if (publishedOn !== undefined && publishedOn > accessedOn) {
    throw invalidConfiguration('source_published_after_access');
  }

  return Object.freeze({
    accessedOn,
    authority: parseAuthority(input.authority),
    publishedOn,
    title: normalizeSourceTitle(input.title),
    uri: uri.toString(),
  });
}

export function normalizeConfigurationVersion(value: string): string {
  const normalized = value.normalize('NFKC').trim().toUpperCase();
  if (
    normalized.length > versionMaximumLength ||
    !versionPattern.test(normalized)
  ) {
    throw invalidConfiguration('invalid_version');
  }
  return normalized;
}

function assertCompleteEvidence(
  configuration: Readonly<StatutoryConfiguration>,
): void {
  const sourceAuthorities = new Set(
    configuration.sources.map((source) => source.authority),
  );
  const parameterKeys = Object.keys(configuration.parameters);

  if (
    parameterKeys.length === 0 ||
    !['nhima', 'napsa', 'paye'].every((key) => parameterKeys.includes(key)) ||
    !authorities.every((authority) => sourceAuthorities.has(authority))
  ) {
    throw invalidConfiguration('incomplete_verification_evidence');
  }
}

function cloneAndFreezeParameters(
  value: unknown,
): Readonly<Record<string, JsonValue>> {
  let nodeCount = 0;

  function clone(node: unknown, depth: number): JsonValue {
    nodeCount += 1;
    if (depth > parameterMaximumDepth || nodeCount > parameterMaximumNodes) {
      throw invalidConfiguration('parameters_too_complex');
    }
    if (
      node === null ||
      typeof node === 'string' ||
      typeof node === 'boolean'
    ) {
      return node;
    }
    if (typeof node === 'number' && Number.isFinite(node)) {
      return node;
    }
    if (Array.isArray(node)) {
      return Object.freeze(node.map((item) => clone(item, depth + 1)));
    }
    if (
      typeof node === 'object' &&
      Object.getPrototypeOf(node) === Object.prototype
    ) {
      const result: Record<string, JsonValue> = Object.create(null) as Record<
        string,
        JsonValue
      >;
      for (const [key, item] of Object.entries(node)) {
        if (forbiddenObjectKeys.has(key)) {
          throw invalidConfiguration('invalid_parameter_key');
        }
        result[key] = clone(item, depth + 1);
      }
      return Object.freeze(result);
    }
    throw invalidConfiguration('parameters_must_be_json');
  }

  const cloned = clone(value, 0);
  if (!isJsonRecord(cloned)) {
    throw invalidConfiguration('parameters_must_be_object');
  }
  if (
    new TextEncoder().encode(JSON.stringify(cloned)).length >
    parameterMaximumBytes
  ) {
    throw invalidConfiguration('parameters_too_large');
  }

  return cloned;
}

function isJsonRecord(
  value: JsonValue,
): value is { readonly [key: string]: JsonValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseAuthority(value: string): StatutoryAuthority {
  if (!authorities.includes(value as StatutoryAuthority)) {
    throw invalidConfiguration('invalid_authority');
  }
  return value as StatutoryAuthority;
}

function normalizeSourceTitle(value: string): string {
  const normalized = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (
    normalized.length === 0 ||
    [...normalized].length > titleMaximumLength ||
    controlCharacterPattern.test(value)
  ) {
    throw invalidConfiguration('invalid_source_title');
  }
  return normalized;
}

function immutableConfiguration(): DomainError {
  return new DomainError(
    'STATUTORY_CONFIGURATION_IMMUTABLE',
    'Only a draft statutory configuration can be verified, and verified evidence cannot be rewritten',
    { entity: 'StatutoryConfiguration' },
  );
}

function invalidConfiguration(rule: string): DomainError {
  return new DomainError(
    'INVALID_STATUTORY_CONFIGURATION',
    'Statutory configuration evidence is invalid',
    { entity: 'StatutoryConfiguration', rule },
  );
}

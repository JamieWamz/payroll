import type { CompanyId } from '../../companies/domain/company.js';
import { DomainError } from '../../../shared/domain/domain-error.js';
import {
  parseEntityId,
  type EntityId,
} from '../../../shared/domain/entity-id.js';
import type { UserAccountId } from '../domain/user-account.js';

declare const auditEventTypeBrand: unique symbol;
declare const auditTargetTypeBrand: unique symbol;
declare const sourceIpFingerprintBrand: unique symbol;

export type AuditEventId = EntityId<'AuditEvent'>;
export type AuditEventType = string & {
  readonly [auditEventTypeBrand]: 'AuditEventType';
};
export type AuditTargetType = string & {
  readonly [auditTargetTypeBrand]: 'AuditTargetType';
};
export type SourceIpFingerprint = string & {
  readonly [sourceIpFingerprintBrand]: 'SourceIpFingerprint';
};
export type AuditOutcome = 'denied' | 'failed' | 'succeeded';
export type AuditMetadataValue = boolean | number | string | null;
export type AuditMetadata = Readonly<Record<string, AuditMetadataValue>>;

export interface AuditEventDraft {
  readonly actorUserAccountId: UserAccountId | undefined;
  readonly companyId: CompanyId | undefined;
  readonly eventType: AuditEventType;
  readonly id: AuditEventId;
  readonly metadata: AuditMetadata;
  readonly outcome: AuditOutcome;
  readonly requestId: string;
  readonly sourceIpFingerprint: SourceIpFingerprint | undefined;
  readonly targetId: EntityId<'AuditTarget'> | undefined;
  readonly targetType: AuditTargetType | undefined;
}

export interface CreateAuditEventDraftInput {
  readonly actorUserAccountId?: string;
  readonly companyId?: string;
  readonly eventType: string;
  readonly id: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly outcome: string;
  readonly requestId: string;
  readonly sourceIpFingerprint?: string;
  readonly targetId?: string;
  readonly targetType?: string;
}

const eventTypeMaximumLength = 128;
const eventTypePattern =
  /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/;
const metadataKeyMaximumLength = 64;
const metadataKeyPattern = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const metadataMaximumBytes = 8192;
const metadataStringMaximumLength = 512;
const prohibitedMetadataKeyPattern =
  /(?:authorization|cookie|credential|hash|password|secret|session|token)/u;
const requestIdMaximumLength = 128;
const sourceIpFingerprintPattern = /^[0-9a-f]{64}$/;
const targetTypeMaximumLength = 64;
const targetTypePattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const controlCharacterPattern = /\p{Cc}/u;
const outcomes: readonly AuditOutcome[] = Object.freeze([
  'denied',
  'failed',
  'succeeded',
]);

export function createAuditEventDraft(
  input: CreateAuditEventDraftInput,
): Readonly<AuditEventDraft> {
  const hasTargetId = input.targetId !== undefined;
  const hasTargetType = input.targetType !== undefined;

  if (hasTargetId !== hasTargetType) {
    throw invalidAuditEvent('target_pair_required');
  }

  return Object.freeze({
    actorUserAccountId:
      input.actorUserAccountId === undefined
        ? undefined
        : parseEntityId(input.actorUserAccountId, 'UserAccount'),
    companyId:
      input.companyId === undefined
        ? undefined
        : parseEntityId(input.companyId, 'Company'),
    eventType: parseAuditEventType(input.eventType),
    id: parseEntityId(input.id, 'AuditEvent'),
    metadata: parseAuditMetadata(input.metadata ?? {}),
    outcome: parseAuditOutcome(input.outcome),
    requestId: parseRequestId(input.requestId),
    sourceIpFingerprint:
      input.sourceIpFingerprint === undefined
        ? undefined
        : parseSourceIpFingerprint(input.sourceIpFingerprint),
    targetId:
      input.targetId === undefined
        ? undefined
        : parseEntityId(input.targetId, 'AuditTarget'),
    targetType:
      input.targetType === undefined
        ? undefined
        : parseAuditTargetType(input.targetType),
  });
}

export function parseAuditEventType(value: string): AuditEventType {
  if (
    value.length > eventTypeMaximumLength ||
    value !== value.trim().toLowerCase() ||
    !eventTypePattern.test(value)
  ) {
    throw invalidAuditEvent('invalid_event_type');
  }

  return value as AuditEventType;
}

export function parseAuditTargetType(value: string): AuditTargetType {
  if (
    value.length > targetTypeMaximumLength ||
    value !== value.trim().toLowerCase() ||
    !targetTypePattern.test(value)
  ) {
    throw invalidAuditEvent('invalid_target_type');
  }

  return value as AuditTargetType;
}

export function parseAuditOutcome(value: string): AuditOutcome {
  if (!outcomes.includes(value as AuditOutcome)) {
    throw invalidAuditEvent('invalid_outcome');
  }

  return value as AuditOutcome;
}

export function parseSourceIpFingerprint(value: string): SourceIpFingerprint {
  if (!sourceIpFingerprintPattern.test(value)) {
    throw invalidAuditEvent('invalid_source_ip_fingerprint');
  }

  return value as SourceIpFingerprint;
}

function parseRequestId(value: string): string {
  if (
    value.length === 0 ||
    value.length > requestIdMaximumLength ||
    value !== value.trim() ||
    controlCharacterPattern.test(value)
  ) {
    throw invalidAuditEvent('invalid_request_id');
  }

  return value;
}

function parseAuditMetadata(
  input: Readonly<Record<string, unknown>>,
): AuditMetadata {
  const metadata: Record<string, AuditMetadataValue> = {};

  for (const [key, value] of Object.entries(input)) {
    if (
      key.length > metadataKeyMaximumLength ||
      !metadataKeyPattern.test(key) ||
      prohibitedMetadataKeyPattern.test(key)
    ) {
      throw invalidAuditEvent('unsafe_metadata_key');
    }

    if (
      value !== null &&
      typeof value !== 'boolean' &&
      typeof value !== 'number' &&
      typeof value !== 'string'
    ) {
      throw invalidAuditEvent('invalid_metadata_value');
    }

    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw invalidAuditEvent('invalid_metadata_value');
    }

    if (
      typeof value === 'string' &&
      ([...value].length > metadataStringMaximumLength ||
        controlCharacterPattern.test(value))
    ) {
      throw invalidAuditEvent('invalid_metadata_value');
    }

    metadata[key] = value;
  }

  if (
    Buffer.byteLength(JSON.stringify(metadata), 'utf8') > metadataMaximumBytes
  ) {
    throw invalidAuditEvent('metadata_too_large');
  }

  return Object.freeze(metadata);
}

function invalidAuditEvent(rule: string): DomainError {
  return new DomainError(
    'INVALID_AUDIT_EVENT',
    'Audit event does not satisfy the safe append-only event contract',
    { rule },
  );
}

import { DomainError } from '../../../shared/domain/domain-error.js';
import {
  parseEntityId,
  type EntityId,
} from '../../../shared/domain/entity-id.js';

declare const emailAddressBrand: unique symbol;

export type UserAccountId = EntityId<'UserAccount'>;
export type EmailAddress = string & {
  readonly [emailAddressBrand]: 'EmailAddress';
};
export type UserAccountStatus = 'active' | 'deactivated' | 'suspended';

export interface UserAccount {
  readonly displayName: string;
  readonly email: EmailAddress;
  readonly id: UserAccountId;
  readonly status: UserAccountStatus;
}

export interface CreateUserAccountInput {
  readonly displayName: string;
  readonly email: string;
  readonly id: string;
  readonly status?: string;
}

const displayNameMaximumLength = 120;
const emailAddressMaximumLength = 254;
const emailDomainLabelPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const emailLocalPartMaximumLength = 64;
const emailLocalPartPattern =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const displayNameControlCharacterPattern = /\p{Cc}/u;
const userAccountStatuses: readonly UserAccountStatus[] = Object.freeze([
  'active',
  'deactivated',
  'suspended',
]);

export function normalizeEmailAddress(value: string): EmailAddress {
  const normalized = value.normalize('NFKC').trim().toLowerCase();
  const separatorIndex = normalized.indexOf('@');
  const localPart = normalized.slice(0, separatorIndex);
  const domain = normalized.slice(separatorIndex + 1);
  const domainLabels = domain.split('.');

  if (
    normalized.length > emailAddressMaximumLength ||
    separatorIndex <= 0 ||
    separatorIndex !== normalized.lastIndexOf('@') ||
    localPart.length > emailLocalPartMaximumLength ||
    !emailLocalPartPattern.test(localPart) ||
    domainLabels.length < 2 ||
    !domainLabels.every((label) => emailDomainLabelPattern.test(label))
  ) {
    throw new DomainError(
      'INVALID_EMAIL_ADDRESS',
      'Email address must have a valid local part and domain',
      {
        localPartMaximumLength: emailLocalPartMaximumLength,
        maximumLength: emailAddressMaximumLength,
      },
    );
  }

  return normalized as EmailAddress;
}

export function normalizeDisplayName(value: string): string {
  const normalized = value.normalize('NFC').trim().replace(/\s+/gu, ' ');

  if (
    displayNameControlCharacterPattern.test(value) ||
    normalized.length === 0 ||
    [...normalized].length > displayNameMaximumLength
  ) {
    throw new DomainError(
      'INVALID_DOMAIN_NAME',
      'User display name must be nonblank and within the supported length',
      { entity: 'UserAccount', maximumLength: displayNameMaximumLength },
    );
  }

  return normalized;
}

export function parseUserAccountStatus(value: string): UserAccountStatus {
  if (!userAccountStatuses.includes(value as UserAccountStatus)) {
    throw new DomainError(
      'INVALID_ENTITY_STATUS',
      'User account status is not supported',
      { entity: 'UserAccount' },
    );
  }

  return value as UserAccountStatus;
}

export function createUserAccount(
  input: CreateUserAccountInput,
): Readonly<UserAccount> {
  return Object.freeze({
    displayName: normalizeDisplayName(input.displayName),
    email: normalizeEmailAddress(input.email),
    id: parseEntityId(input.id, 'UserAccount'),
    status: parseUserAccountStatus(input.status ?? 'active'),
  });
}

export function changeUserAccountStatus(
  account: Readonly<UserAccount>,
  status: string,
): Readonly<UserAccount> {
  return Object.freeze({
    ...account,
    status: parseUserAccountStatus(status),
  });
}

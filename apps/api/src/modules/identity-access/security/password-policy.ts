import { DomainError } from '../../../shared/domain/domain-error.js';

declare const validatedPasswordBrand: unique symbol;

export type ValidatedPassword = string & {
  readonly [validatedPasswordBrand]: 'ValidatedPassword';
};

export interface PasswordBlocklist {
  contains(password: string): Promise<boolean>;
}

const passwordMinimumLength = 15;
const passwordMaximumLength = 128;
const controlCharacterPattern = /\p{Cc}/u;

export async function validateNewPassword(
  value: string,
  blocklist: PasswordBlocklist,
): Promise<ValidatedPassword> {
  const normalized = normalizePassword(value);
  const length = [...normalized].length;

  if (
    length < passwordMinimumLength ||
    length > passwordMaximumLength ||
    controlCharacterPattern.test(normalized)
  ) {
    throw new DomainError(
      'INVALID_PASSWORD',
      'Password must meet the supported length and character policy',
      {
        maximumLength: passwordMaximumLength,
        minimumLength: passwordMinimumLength,
      },
    );
  }

  if (await blocklist.contains(normalized)) {
    throw new DomainError(
      'BLOCKED_PASSWORD',
      'Password appears in the prohibited password blocklist',
    );
  }

  return normalized as ValidatedPassword;
}

export function normalizePresentedPassword(value: string): string {
  const normalized = normalizePassword(value);

  if (
    [...normalized].length > passwordMaximumLength ||
    controlCharacterPattern.test(normalized)
  ) {
    throw new DomainError(
      'INVALID_PASSWORD',
      'Presented password exceeds the supported verification boundary',
      { maximumLength: passwordMaximumLength },
    );
  }

  return normalized;
}

function normalizePassword(value: string): string {
  return value.normalize('NFC');
}

import { hash, parseOptions, verify } from '@node-rs/argon2';

import { DomainError } from '../../../shared/domain/domain-error.js';
import {
  normalizePresentedPassword,
  type ValidatedPassword,
} from './password-policy.js';

declare const passwordHashBrand: unique symbol;

export type PasswordHash = string & {
  readonly [passwordHashBrand]: 'PasswordHash';
};

const argon2idPolicy = Object.freeze({
  algorithm: 2 as const,
  memoryCost: 19_456,
  outputLen: 32,
  parallelism: 1,
  timeCost: 2,
  version: 1 as const,
});
const encodedHashMaximumLength = 512;
const encodedHashPattern = /^\$argon2id\$v=19\$/;

export async function hashPassword(
  password: ValidatedPassword,
): Promise<PasswordHash> {
  return (await hash(password, argon2idPolicy)) as PasswordHash;
}

export async function verifyPassword(
  passwordHash: PasswordHash,
  presentedPassword: string,
): Promise<boolean> {
  let normalized: string;

  try {
    normalized = normalizePresentedPassword(presentedPassword);
  } catch {
    return false;
  }

  try {
    return await verify(passwordHash, normalized);
  } catch {
    return false;
  }
}

export function parsePasswordHash(value: string): PasswordHash {
  if (
    value.length === 0 ||
    value.length > encodedHashMaximumLength ||
    !encodedHashPattern.test(value)
  ) {
    throw new DomainError(
      'INVALID_PASSWORD',
      'Stored password hash must be an encoded Argon2id verifier',
      { maximumLength: encodedHashMaximumLength },
    );
  }

  try {
    parseOptions(value);
  } catch {
    throw new DomainError(
      'INVALID_PASSWORD',
      'Stored password hash must be an encoded Argon2id verifier',
      { maximumLength: encodedHashMaximumLength },
    );
  }

  return value as PasswordHash;
}

export function needsPasswordRehash(passwordHash: PasswordHash): boolean {
  try {
    const options = parseOptions(passwordHash);

    return (
      options.algorithm !== argon2idPolicy.algorithm ||
      options.version !== argon2idPolicy.version ||
      options.memoryCost !== argon2idPolicy.memoryCost ||
      options.timeCost !== argon2idPolicy.timeCost ||
      options.parallelism !== argon2idPolicy.parallelism ||
      options.outputLen !== argon2idPolicy.outputLen ||
      options.saltLen < 16
    );
  } catch {
    return true;
  }
}

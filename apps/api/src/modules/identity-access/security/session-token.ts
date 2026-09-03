import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { DomainError } from '../../../shared/domain/domain-error.js';

declare const opaqueTokenBrand: unique symbol;
declare const tokenDigestBrand: unique symbol;

export type OpaqueSecurityToken = string & {
  readonly [opaqueTokenBrand]: 'OpaqueSecurityToken';
};
export type SecurityTokenDigest = string & {
  readonly [tokenDigestBrand]: 'SecurityTokenDigest';
};

export interface SessionSecrets {
  readonly csrfToken: OpaqueSecurityToken;
  readonly csrfTokenDigest: SecurityTokenDigest;
  readonly sessionToken: OpaqueSecurityToken;
  readonly sessionTokenDigest: SecurityTokenDigest;
}

const tokenByteLength = 32;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const digestPattern = /^[0-9a-f]{64}$/;

export function createSessionSecrets(): Readonly<SessionSecrets> {
  const sessionToken = createOpaqueSecurityToken();
  const csrfToken = createOpaqueSecurityToken();

  return Object.freeze({
    csrfToken,
    csrfTokenDigest: digestSecurityToken(csrfToken),
    sessionToken,
    sessionTokenDigest: digestSecurityToken(sessionToken),
  });
}

export function createOpaqueSecurityToken(): OpaqueSecurityToken {
  return randomBytes(tokenByteLength).toString(
    'base64url',
  ) as OpaqueSecurityToken;
}

export function parseOpaqueSecurityToken(value: string): OpaqueSecurityToken {
  if (!tokenPattern.test(value)) {
    throw new DomainError(
      'INVALID_SECURITY_TOKEN',
      'Security token is not in the expected opaque format',
    );
  }

  return value as OpaqueSecurityToken;
}

export function parseSecurityTokenDigest(value: string): SecurityTokenDigest {
  if (!digestPattern.test(value)) {
    throw new DomainError(
      'INVALID_SECURITY_TOKEN',
      'Security token digest is not in the expected format',
    );
  }

  return value as SecurityTokenDigest;
}

export function digestSecurityToken(
  token: OpaqueSecurityToken,
): SecurityTokenDigest {
  return createHash('sha256')
    .update(token, 'utf8')
    .digest('hex') as SecurityTokenDigest;
}

export function securityTokenMatchesDigest(
  presentedToken: string,
  expectedDigest: SecurityTokenDigest,
): boolean {
  let token: OpaqueSecurityToken;

  try {
    token = parseOpaqueSecurityToken(presentedToken);
  } catch {
    return false;
  }

  const actual = Buffer.from(digestSecurityToken(token), 'hex');
  const expected = Buffer.from(expectedDigest, 'hex');

  return timingSafeEqual(actual, expected);
}

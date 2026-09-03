import { hash as createArgon2Hash } from '@node-rs/argon2';
import { describe, expect, it } from 'vitest';

import {
  createAuditEventDraft,
  createAuthorizationPrincipal,
  createSessionSecrets,
  hashPassword,
  needsPasswordRehash,
  parseOpaqueSecurityToken,
  parsePasswordHash,
  parseSecurityTokenDigest,
  parseSourceIpFingerprint,
  requireCompanyScope,
  requirePermission,
  securityTokenMatchesDigest,
  validateNewPassword,
  verifyPassword,
  type PasswordBlocklist,
} from '../src/modules/identity-access/security/index.js';

const companyId = '10000000-0000-4000-8000-000000000001';
const anotherCompanyId = '10000000-0000-4000-8000-000000000002';
const membershipId = '40000000-0000-4000-8000-000000000001';
const sessionId = '50000000-0000-4000-8000-000000000001';
const userAccountId = '20000000-0000-4000-8000-000000000001';
const auditEventId = '60000000-0000-4000-8000-000000000001';

function createBlocklist(...blockedPasswords: string[]): PasswordBlocklist {
  const blocked = new Set(blockedPasswords);

  return {
    contains(password) {
      return Promise.resolve(blocked.has(password));
    },
  };
}

describe('password security', () => {
  it('accepts long passphrases without arbitrary composition requirements', async () => {
    const password = await validateNewPassword(
      'a calm payroll passphrase',
      createBlocklist(),
    );

    expect(password).toBe('a calm payroll passphrase');
  });

  it('normalizes Unicode before blocklist evaluation and hashing', async () => {
    const decomposed = 'se\u0301cure payroll phrase';
    const normalized = decomposed.normalize('NFC');

    await expect(
      validateNewPassword(decomposed, createBlocklist(normalized)),
    ).rejects.toMatchObject({ code: 'BLOCKED_PASSWORD' });
  });

  it('rejects short, oversized, and control-character passwords', async () => {
    const blocklist = createBlocklist();

    await expect(
      validateNewPassword('too short', blocklist),
    ).rejects.toMatchObject({ code: 'INVALID_PASSWORD' });
    await expect(
      validateNewPassword('x'.repeat(129), blocklist),
    ).rejects.toMatchObject({ code: 'INVALID_PASSWORD' });
    await expect(
      validateNewPassword('valid length but\nunsafe', blocklist),
    ).rejects.toMatchObject({ code: 'INVALID_PASSWORD' });
  });

  it('hashes and verifies with the current Argon2id policy', async () => {
    const password = await validateNewPassword(
      'a strong payroll passphrase',
      createBlocklist(),
    );
    const passwordHash = await hashPassword(password);

    expect(passwordHash).toMatch(/^\$argon2id\$v=19\$/);
    await expect(verifyPassword(passwordHash, password)).resolves.toBe(true);
    await expect(
      verifyPassword(passwordHash, 'a different payroll passphrase'),
    ).resolves.toBe(false);
    expect(needsPasswordRehash(passwordHash)).toBe(false);
  });

  it('recognizes weaker or malformed stored verifiers', async () => {
    const weakerHash = parsePasswordHash(
      await createArgon2Hash('a strong payroll passphrase', {
        algorithm: 2,
        memoryCost: 12_288,
        outputLen: 32,
        parallelism: 1,
        timeCost: 3,
        version: 1,
      }),
    );

    expect(needsPasswordRehash(weakerHash)).toBe(true);
    expect(() => parsePasswordHash('not-a-password-hash')).toThrowError(
      expect.objectContaining({ code: 'INVALID_PASSWORD' }),
    );
  });
});

describe('opaque session and CSRF tokens', () => {
  it('creates independent 256-bit opaque tokens and stores only their digests', () => {
    const secrets = createSessionSecrets();

    expect(secrets.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(secrets.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(secrets.sessionToken).not.toBe(secrets.csrfToken);
    expect(secrets.sessionTokenDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(secrets.csrfTokenDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(secrets.sessionTokenDigest).not.toContain(secrets.sessionToken);
    expect(Object.isFrozen(secrets)).toBe(true);
  });

  it('uses format validation and constant-length digest comparison', () => {
    const secrets = createSessionSecrets();
    const otherSecrets = createSessionSecrets();

    expect(
      securityTokenMatchesDigest(secrets.csrfToken, secrets.csrfTokenDigest),
    ).toBe(true);
    expect(
      securityTokenMatchesDigest(
        otherSecrets.csrfToken,
        secrets.csrfTokenDigest,
      ),
    ).toBe(false);
    expect(
      securityTokenMatchesDigest('malformed', secrets.csrfTokenDigest),
    ).toBe(false);
    expect(() => parseOpaqueSecurityToken('malformed')).toThrowError(
      expect.objectContaining({ code: 'INVALID_SECURITY_TOKEN' }),
    );
    expect(() => parseSecurityTokenDigest('malformed')).toThrowError(
      expect.objectContaining({ code: 'INVALID_SECURITY_TOKEN' }),
    );
  });
});

describe('authorization principal', () => {
  it('normalizes permissions and enforces permission and company scope', () => {
    const principal = createAuthorizationPrincipal({
      companyId,
      membershipId,
      permissionIdentifiers: [
        'Payroll.Review',
        'reports.export',
        'payroll.review',
      ],
      sessionId,
      userAccountId,
    });

    expect(principal.permissionIdentifiers).toEqual([
      'payroll.review',
      'reports.export',
    ]);
    expect(Object.isFrozen(principal)).toBe(true);
    expect(Object.isFrozen(principal.permissionIdentifiers)).toBe(true);
    expect(() => requirePermission(principal, 'payroll.review')).not.toThrow();
    expect(() => requireCompanyScope(principal, companyId)).not.toThrow();
    expect(() => requirePermission(principal, 'payroll.finalize')).toThrowError(
      expect.objectContaining({ code: 'FORBIDDEN_OPERATION' }),
    );
    expect(() => requireCompanyScope(principal, anotherCompanyId)).toThrowError(
      expect.objectContaining({ code: 'TENANT_SCOPE_MISMATCH' }),
    );
  });
});

describe('append-only audit event contract', () => {
  it('creates a bounded immutable event without secrets or raw source IPs', () => {
    const event = createAuditEventDraft({
      actorUserAccountId: userAccountId,
      companyId,
      eventType: 'auth.login.succeeded',
      id: auditEventId,
      metadata: { active_login_count: 1, authentication_method: 'password' },
      outcome: 'succeeded',
      requestId: 'request-123',
      sourceIpFingerprint: 'a'.repeat(64),
      targetId: userAccountId,
      targetType: 'user-account',
    });

    expect(event.eventType).toBe('auth.login.succeeded');
    expect(event.metadata).toEqual({
      active_login_count: 1,
      authentication_method: 'password',
    });
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.metadata)).toBe(true);
    expect(() => parseSourceIpFingerprint('192.0.2.1')).toThrowError(
      expect.objectContaining({ code: 'INVALID_AUDIT_EVENT' }),
    );
  });

  it('rejects incomplete targets, secret-bearing keys, and nested metadata', () => {
    const base = {
      eventType: 'auth.login.failed',
      id: auditEventId,
      outcome: 'failed',
      requestId: 'request-123',
    } as const;

    expect(() =>
      createAuditEventDraft({ ...base, targetType: 'user-account' }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_AUDIT_EVENT' }));
    expect(() =>
      createAuditEventDraft({
        ...base,
        metadata: { session_token: 'must-not-be-logged' },
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_AUDIT_EVENT' }));
    expect(() =>
      createAuditEventDraft({
        ...base,
        metadata: { request: { email: 'user@example.com' } },
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_AUDIT_EVENT' }));
  });
});

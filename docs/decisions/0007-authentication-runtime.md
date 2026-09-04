# ADR 0007: Cookie session authentication runtime

- Status: Accepted
- Date: 2026-09-04

## Context

Business workflows cannot safely open until the API can establish a user
identity without trusting client-supplied identity or tenant headers. Global
account, credential, and session tables are intentionally hidden from normal
runtime SQL, so authentication needs a narrow database boundary as well as
HTTP controls.

## Decision

- Expose registration, login, session restoration, and logout under
  `/api/auth`.
- Validate and normalize account and company inputs through the domain layer,
  require a minimum-length non-blocklisted password, and store only an Argon2id
  verifier.
- Create a company's first user, owner membership, owner role, and fixed MVP
  permission set atomically through a security-definer database function.
- Store opaque session and CSRF token digests only. Send the session token in an
  HttpOnly, SameSite=Strict cookie and the independently generated CSRF token in
  a readable SameSite=Strict cookie and response body.
- Require both the CSRF cookie and matching `X-CSRF-Token` header for logout.
  The same check will be required for later state-changing business routes.
- Apply separate idle and absolute session expiration, bounded by validated
  environment settings. Sliding activity can extend only the idle boundary and
  never the absolute boundary.
- Return one generic response for unknown accounts, bad passwords, locked
  accounts, and inactive accounts. Verify a dummy Argon2id hash for unknown
  accounts to reduce a simple timing distinction.
- Lock a known credential for fifteen minutes after five consecutive failures,
  rate-limit public registration and login endpoints, and audit successful
  registration/login/logout plus denied login attempts.
- Keep direct runtime access to credential, session, and audit tables revoked.
  Grant only the reviewed security-definer functions needed by the API.
- Do not infer tenant authorization from the session alone. Session restoration
  returns only active company memberships; later tenant routes must resolve the
  requested company to one of those memberships and load permissions inside
  the tenant transaction.

## Consequences

- Authentication requests now exist, but company, workforce, compensation,
  payroll, and reporting commands remain closed until authorization and audit
  middleware are complete.
- Password-reset tokens, email delivery, session management screens, MFA, and
  account invitations remain later authentication work.
- `SESSION_COOKIE_SECURE` is false for loopback HTTP development. It must be set
  to true behind production HTTPS; the repository still does not provide TLS
  termination.
- The built-in blocklist is a small local baseline. A maintained compromised-
  password source can be injected through the existing `PasswordBlocklist`
  contract without changing route behavior.

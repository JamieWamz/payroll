# ADR 0002: Authentication Security Foundation

- Status: Accepted
- Date: 2026-09-03

## Context

ZamPayroll needs password authentication, revocable server-side sessions,
company-scoped authorization, CSRF protection, and reliable security audit
records before any business CRUD route can be exposed. The current API has no
registration or login route, and introducing temporary bearer tokens or
client-selected identity headers would undermine that boundary.

## Decision

1. New single-factor passwords are NFC-normalized and must contain 15 through
   128 Unicode code points. No character-class composition rule is imposed.
   Password creation requires an injected blocklist implementation; a route
   cannot bypass that dependency.
2. Password verifiers use Argon2id version 19 with 19,456 KiB of memory, two
   iterations, one lane, a 32-byte output, and a fresh library-generated salt.
   Encoded verifiers retain their parameters and are checked for rehashing when
   policy changes.
3. Session and CSRF tokens are separate 32-byte CSPRNG values encoded as
   base64url. Only SHA-256 digests are persisted. Presented CSRF values are
   format-checked and compared as fixed-length digests.
4. Sessions are opaque and server-side, with both idle and absolute expiry plus
   explicit revocation. They do not embed user, company, role, or permission
   data on the client.
5. Credentials and sessions use forced RLS and grant the runtime role no direct
   table privileges. Narrow database functions and application adapters must be
   added before authentication routes can use them.
6. Audit records are append-only to the runtime role. A security-definer append
   function sets the occurrence time in PostgreSQL and rejects a company ID that
   differs from transaction-local tenant context. Runtime cannot read, update,
   or delete the audit table.
7. Audit metadata is a small flat scalar map. The application contract rejects
   control characters, nested data, oversized values, and keys associated with
   passwords, tokens, cookies, credentials, hashes, sessions, or secrets.
8. An optional source-IP fingerprint is a lowercase 64-character hexadecimal
   value, distinct from security-token digests. The future HTTP adapter must
   derive it with keyed HMAC using a separately managed secret; a plain hash of
   the low-entropy IP address is not acceptable.
9. Authentication HTTP routes remain closed until exact-origin CORS, secure
   cookie delivery, synchronizer-token verification, account and network
   throttling, uniform login failures, live membership resolution, and audit
   emission are implemented and tested together.

## Consequences

The repository can test cryptographic and persistence boundaries without
pretending login is available. A production-grade password blocklist is still a
required dependency for registration and password changes. Local HTTP cannot
exercise production `Secure` cookies; production authentication will require
HTTPS for the entire session.

The runtime database credential cannot query password hashes or session token
digests directly. That deliberately requires a subsequent, reviewed access
layer rather than broad global-table grants.

## References

- [NIST SP 800-63B password requirements](https://pages.nist.gov/800-63-4/sp800-63b.html#passwordver)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)

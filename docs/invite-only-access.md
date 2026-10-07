# Account and invitation access

Customers can create their company workspace and its first owner account from
the sign-in page. This creation flow uses the same atomic, audited ownership
provisioning as the assisted invitation flow. It is throttled, validates an
Argon2id-protected passphrase, and rejects duplicate email addresses or company
codes.

Company owners invite staff into their existing company from Team. An operator
may still issue a workspace invitation for assisted onboarding, for example
when the company details and owner email must be pre-agreed.

## Optional assisted workspace invitation

After reviewing the customer and commercial agreement, run this from a trusted
operator checkout with `DATABASE_MIGRATION_URL` set to the migration connection
and `WEB_ORIGIN` set to the exact application origin. Keep those credentials out
of the API container, browser, repository and support messages.

```sh
npm run access:workspace -- create \
  --email owner@example.com \
  --company-code example-company \
  --company-name 'Example Company' \
  --operator 'Your operator name' \
  --out /absolute/private/path/company-invitation.txt
```

The command writes the link to a new file with owner-only permissions. It never
prints the token and never sends email. Share the file's link privately with the
intended owner. The link binds the company name, code and account email, expires
after seven days, and can be accepted only once. Treat it as a credential.

For a compiled production checkout, run `node apps/api/dist/scripts/workspace-access.js`
with the same arguments and operator environment. The command is available in
the API image at `dist/scripts/workspace-access.js`, but execute it as a separate
one-off operator process with migration credentials, never through a public route.

```sh
npm run access:workspace -- list
npm run access:workspace -- revoke --id INVITATION_UUID --operator 'Your operator name'
```

Revoke an expired or unwanted pending invitation before issuing a replacement
for the same company code. Listing shows at most the latest 100 invitations and
contains customer contact information. Accepted invitations cannot be revoked;
review the existing company's access instead. Issuance, revocation and acceptance
have dedicated audit events. Only token digests are stored in the database.

## Acceptance and account protection

The owner opens `/#workspace-invite=…`, verifies the company and email displayed,
and enters their name and password. New users choose a passphrase of at least
15 characters; existing users must use their current password. An invitation
cannot reset or take over an existing account. Existing memberships are retained.
Successful acceptance signs in the owner and opens Setup.

`/api/auth/register` provisions a new account/company owner when no invitation
token is supplied. When a valid workspace invitation is supplied, acceptance
locks the invitation row and creates the account, company, permissions and
acceptance event in one transaction. Staff invitations continue to use
`/#invite=…` and the company's authorized Team flow.

Apply all versioned migrations before starting the API. Use reviewed forward
migrations for recovery. Existing accounts continue to sign in.

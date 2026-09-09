# Branches and production preparation

The repository uses `feature/*` → `develop` → `main`. `develop` is the working
integration branch; `main` is the production branch. Fix urgent production issues
on `hotfix/*` from `main`, then bring the fix into `develop` as well.

CI runs formatting, lint, types, unit tests, builds, fresh PostgreSQL migrations,
the complete API integration suite, container readiness checks and the browser
workflow, including operator-issued invitations. Core browser tests exercise
the CDN failure fallback; `E2E_LIVE_CDN=1` adds a separate internet availability
check. Local Docker uses development mode. CI runs built images on isolated
HTTP test transport; production configuration rejects HTTP and insecure cookies.

## Repository administration still required

Branch names and workflow files do not enforce GitHub protection. A repository
administrator must apply `.github/branch-protection.json` to both `develop` and
`main`, using GitHub settings or an authenticated GitHub CLI:

```sh
gh api --method PUT repos/JamieWamz/payroll/branches/develop/protection \
  --input .github/branch-protection.json
gh api --method PUT repos/JamieWamz/payroll/branches/main/protection \
  --input .github/branch-protection.json
```

The proposed policy requires the unique `Verify and smoke test` status, a fresh
review from another collaborator, resolved conversations, linear history, and
blocks force pushes/deletion, including administrator bypass. A sole maintainer
needs another reviewer to use that policy. These commands have not been applied
by this change; SSH push access alone does not provide repository administration.

Create `staging` and `production` GitHub environments before enabling releases.
Restrict staging to `develop` and production to `main`, and configure production
reviewers. A workflow referencing a missing environment can create it without
protection, so the workflow name alone is not an approval gate.

## Release artifacts

After merging and passing CI, dispatch **Release images** on `develop` or `main`.
It reruns CI for the selected commit before publishing API, migration and web
images to GHCR. Tags use the full commit SHA; the job summary records immutable
SHA-256 image digests. Deploy using those digests. Publication does not deploy a
server. Configure GHCR package access for the intended deployment operator.

## Remaining live deployment work

Hosting and domain have not been selected, and no production credentials have
been provided. Deployment automation must target that actual environment before
this system can be called production-ready. Required commissioning work:

- Configure HTTPS ingress, secure cookies and the exact HTTPS `WEB_ORIGIN`.
  Keep PostgreSQL and the API private. Trust forwarded client addresses only
  behind an ingress that overwrites untrusted headers. Nginx's per-client limit
  uses the trusted upstream `X-Forwarded-For`; do not expose it directly to public
  clients without configuring that boundary. Fastify authentication limits remain active.
- Use separately managed application, migration and database administrator
  secrets. Issue initial company invitations through the operator command.
- Configure encrypted backups, off-site retention and an isolated restore drill
  with measured recovery time before real payroll data is accepted.
- Configure external readiness monitoring and a responsible incident contact.
  Document credential recovery, access revocation and release ownership.
- Back up before migrations, allow for a maintenance window, and deploy the API
  version matching the migrated schema. Production database recovery uses a
  reviewed forward fix; image rollback requires compatible schema.
- Review the supported payroll scope in `payroll-workflows.md`. Direct bank and
  authority access still require their approval, credentials and certification.

Operational logs retain route templates, status, timing and safe error categories
without raw request URLs, cookies or PostgreSQL record details. The production
host must also configure its own proxy and retention policy consistently.

References: [protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches),
[GitHub environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments),
[publishing container images](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images).

# Security Policy

ZamPayroll is currently a Phase 1 foundation. It does not yet process payroll,
employee records, statutory calculations, or authentication, and it has not
been declared production-ready. Security reports about the foundation are
still important.

## Supported versions

During pre-release development, security fixes are made only on the latest
`main` branch.

| Version                                        | Supported      |
| ---------------------------------------------- | -------------- |
| Latest `main`                                  | Yes            |
| Older commits, forks, and unreleased snapshots | No             |
| Production releases                            | None exist yet |

This table will be revised when versioned releases are published.

## Report a vulnerability privately

Do not disclose a suspected vulnerability in a public issue, discussion, pull
request, commit message, screenshot, or social-media post.

Use the repository's
[private vulnerability reporting form](https://github.com/JamieWamz/payroll/security/advisories/new)
when it is available. It creates a private draft security advisory visible to
the repository's security maintainers. If GitHub does not offer the form, use a
private channel you already have with the repository owner to request a secure
reporting route **without including vulnerability details publicly**.

Include, where safe and relevant:

- the affected commit, component, route, or configuration;
- the vulnerability class and practical impact;
- minimal reproducible steps or a proof of concept using synthetic data;
- required privileges and deployment assumptions;
- whether exploitation may have exposed secrets or personal/payroll data;
- suggested mitigations, if known; and
- how you would like to be credited.

Do not include live credentials, access tokens, real employee information,
production database contents, or more data than is necessary to validate the
report. Encrypt sensitive supporting material using a method agreed with the
maintainer before sending it.

The maintainer will assess scope and coordinate validation, remediation, and
disclosure through the private report. Please allow time for a safe fix and
dependency or deployment coordination before publishing details. Do not test a
suspected issue against systems or data you do not own or have explicit
permission to assess.

## Data and credential handling

- Never use real payroll, employee, bank, tax, national-identifier, company, or
  customer data in development, tests, fixtures, logs, screenshots, issues, or
  pull requests.
- Never commit `.env`, credentials, tokens, private keys, certificates,
  database dumps, or production configuration. `.env.example` contains local
  placeholders only.
- Treat database connection URLs as secrets because they contain passwords.
- Minimize log fields and diagnostic exports. Do not log authentication secrets
  or complete payroll/request payloads.
- If a secret is exposed, revoke or rotate it at its source; deleting Git
  history or closing an issue is not sufficient.
- If personal or payroll data may be exposed, stop further disclosure,
  preserve minimal incident evidence, and escalate privately for legal and
  incident-response assessment.

## Deployment responsibility

The Compose files are a local and foundation deployment baseline. Example
passwords are unsafe, PostgreSQL passwords stored in an initialized named
volume do not change merely because `.env` changes, and the repository does not
provide production TLS termination, external secret management, backup and
restore operations, monitoring/alerting, rate limiting, authentication,
tenant authorization, or compliance certification.

Anyone deploying the software is responsible for threat modeling the target
environment, replacing all credentials, restricting ingress, configuring TLS
and trusted proxies, managing secrets and keys, patching dependencies and base
images, backing up and testing recovery, monitoring security events, and
meeting applicable Zambian legal and regulatory obligations. Enabling
`TRUST_PROXY` without a known trusted proxy boundary can make forwarded client
metadata untrustworthy.

An application's use of this repository or successful test results must not be
represented as proof of payroll correctness, statutory compliance, or security
certification.

## Dependency reports

Reports for a vulnerability that affects an upstream package or container
image are welcome when they explain whether ZamPayroll's pinned version and
reachable code or image path are affected. Prefer coordinated disclosure with
the upstream project when the flaw is not specific to this repository.

Copyright 2026 Wamz Wamu. This policy is documentation, not a guarantee of
service or a waiver of legal rights.

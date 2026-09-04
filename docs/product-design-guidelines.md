# ZamPayroll Product Design Guidelines

## Purpose

These guidelines translate public payroll-product workflows and published UX
case studies into a Zambia-focused design direction. They guide information
architecture and interaction design; they do not import another product's
branding, proprietary interface, or non-Zambian payroll rules.

Research was reviewed on 2026-09-04. Product pages can change, so durable
payroll behavior remains defined by ZamPayroll domain rules and authoritative
Zambian sources rather than competitor copy.

## Evidence reviewed

- [Gusto's product refresh](https://gusto.com/about/news/corporate/gusto-brand-refresh)
  emphasizes visual hierarchy, obvious actions, standardized presentation,
  accessibility, and usability for busy small-business operators.
- [Gusto's external-payroll flow case study](https://embedded.gusto.com/blog/external-payroll-flow/)
  describes problems caused by ambiguous actions and long single-column forms.
- [Gusto's regular payroll workflow](https://support.gusto.com/article/999754831000000/run-a-regular-payroll-for-admins)
  ties scheduled payroll to pay periods, deadlines, administrator permissions,
  employee inputs, review, and submission.
- [QuickBooks' payroll workflow](https://quickbooks.intuit.com/learn-support/en-us/help-article/payroll-processes/create-paycheck-employee/L5JFzGwNu_US_en_US)
  follows pay schedule, period and pay date, employee selection, pay details,
  preview, and explicit submission.
- [QuickBooks' payroll permission model](https://quickbooks.intuit.com/learn-support/en-ca/help-article/access-permissions/understand-payroll-roles-permissions/L8PyFQxfg_CA_en_CA)
  separates payroll operation, authorization, reporting, and ordinary account
  access.
- The independent [OneScreen Payroll readiness case study](https://davedoesdesigns.com/case-studies/onescreen-payroll/index.html)
  argues for surfacing unresolved payroll blockers in one place before a user
  submits a run.
- A designer's [Xero RITE case study](https://www.markopland.com/projects/xero)
  describes rapid iterative testing and alignment with a shared design system.
  Its reported efficiency result is self-published and is not treated as an
  independently verified benchmark.
- [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/)
  supplies the security-control verification baseline for the web product.

## Information architecture

Use a stable application shell with five primary areas:

1. **Overview** — deadlines, setup readiness, unresolved exceptions, recent
   finalized runs, and statutory actions requiring attention.
2. **People** — employees, employment history, salaries, allowances, and
   deductions.
3. **Payroll** — periods, draft and finalized runs, corrections, and payroll
   history.
4. **Reports** — payslips, PAYE, NAPSA, NHIMA, P9, bank exports, and audit
   evidence.
5. **Settings** — company profile, statutory identifiers, pay schedules,
   users, roles, permissions, and configuration sources.

Accounting-firm users need a persistent company switcher that clearly names
the active tenant. A tenant switch must be server-authorized and must reset
company-specific page state.

## Payroll-run interaction

Present a run as a short, stateful workflow:

1. Select the pay schedule or off-cycle purpose, period, and payment date.
2. Show eligible employees and explain every exclusion.
3. Collect or review variable inputs while loading effective-dated recurring
   compensation.
4. Calculate and surface blocking errors, warnings, and changes from the prior
   run in a single readiness view.
5. Preview each employee's gross pay, taxable income, statutory deductions,
   other deductions, employer contributions, and net pay, with expandable
   calculation evidence.
6. Require an explicit, permission-checked finalization action that explains
   immutability and records the actor and time.
7. Show a confirmation page with payslips, statutory schedules, bank export,
   and audit reference.

The readiness indicator must be derived from real checks. Never use an
arbitrary percentage that can imply correctness. Blocking items must identify
the affected employee or configuration and offer a direct path to resolve it.

## Visual and content principles

- Optimize for calm confidence rather than decoration: clear totals, strong
  hierarchy, restrained color, and generous space around irreversible actions.
- Keep the main workflow compact. Use tables for cross-employee review and
  drawers or detail pages for an individual calculation breakdown.
- Use plain payroll language, show ZMW amounts consistently, and pair every
  status with text or an icon rather than relying on color.
- Keep primary actions in predictable locations and name them by consequence:
  **Calculate draft**, **Review payroll**, and **Finalize payroll**.
- Separate errors that block finalization from warnings that require an
  acknowledged decision.
- Display statutory configuration version, effective date, and source near
  calculated liabilities without overwhelming the default view.
- Design responsive web screens for phone and tablet access. A native mobile
  application remains outside the MVP.
- Build every reusable control to one shared design system and test critical
  flows with keyboard navigation, screen readers, zoom, and reduced motion.

## Validation plan

Before treating the operational UI as complete, test the workflow with SME
owners, payroll administrators, and accounting-firm processors in Zambia.
Measure setup completion, time to resolve a blocked run, calculation-review
accuracy, accidental finalization attempts, and users' ability to explain a
net-pay result from the evidence shown.

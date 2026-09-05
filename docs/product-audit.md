# Product audit and implementation scope — 5 September 2026

The initial checkout was clean. The application is a TypeScript npm workspace,
React 19/Vite frontend and Fastify 5 API backed by PostgreSQL. Authentication uses
Argon2id, opaque server sessions, CSRF tokens and transactional company permissions.
Database tables enforce tenant RLS and finalized payroll immutability. Preserve these.

Existing HTTP workflows: registration/session/logout, company identity, employee and
employment history, effective-dated salaries/allowances/deductions, periods, sourced
statutory configuration verification, gratuity previews, industry checks and export
mapping. The monthly calculator uses bigint monetary values, cumulative PAYE and
configurable contribution bases/caps. There were no payroll run HTTP routes,
payslips, finalized-payroll reports or persisted filing history. The frontend only
exposed a subset of the APIs and its overview was static instructional copy.

Identified risks and gaps:

- Signed PAYE refunds were accepted by the calculator but rejected by component SQL.
- No orchestration assembled effective compensation and historical tax context.
- Starting cumulative payroll during a tax year requires explicit opening balances;
  missing history must never silently become zero.
- Finalization must detect changed compensation/history after review.
- Statutory identifiers and banking details were absent from employee records.
- Export previews used manually entered figures and did not represent filed returns.
- No approved 2026 statutory configuration or authenticated ZRA upload specification
  is present. Published NAPSA pages still show inconsistent/dated ceilings. Keep
  evidence and reviewer verification mandatory; do not activate guessed rates.
- Existing frontend navigation lacked URL history, profile editing, compensation
  maintenance, real payroll totals and reports.

Implementation follows existing domain, transaction, authorization and audit
boundaries. Ordinary monthly payroll is supported first; partial-month salary,
off-cycle remuneration and corrections need explicit allocation rules and are
blocked with actionable messages rather than calculated speculatively. Existing
period and preview capabilities remain available.

Primary sources reviewed: [ZRA PAYE](https://www.zra.org.zm/paye-calculator/),
[NAPSA contributions](https://napsa.co.zm/self-service/contributions),
[NAPSA dated 2025 notice](https://www.napsa.co.zm/revision-in-contribution-ceiling-for-the-year-2025/),
[NHIMA contribution notice](https://www.nhima.co.zm/download/document/0e98ec61c02019110104d23eb0.pdf).
These are evidence references, not an approved 2026 configuration.

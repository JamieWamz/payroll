import { createHash } from 'node:crypto';
import type { TenantTransaction } from '../../../infrastructure/database.js';
import { ApiError } from '../../../routes/api-error.js';
import {
  employeePayrollDetailsSchema,
  type EmployeePayrollDetails,
} from '../../../routes/payroll-details.js';
import { parseEntityId } from '../../../shared/domain/entity-id.js';
import { parseLocalDate } from '../../../shared/domain/local-date.js';
import {
  moneyFromMinorUnits,
  parseCurrencyCode,
  parseDecimalMoney,
  type Money,
} from '../../../shared/domain/money.js';
import type { PayrollRun } from '../domain/payroll-run.js';
import type {
  PayrollCalculationInput,
  PayrollCalculationOutcome,
  CalculationVersion,
  ConfigurationVersion,
  RoundingPolicyIdentifier,
} from '../calculation/types.js';

export const money = (value: bigint): Money =>
  moneyFromMinorUnits(value, parseCurrencyCode('ZMW'), 2);
export function encode(value: unknown): string {
  return JSON.stringify(value, (_, nested: unknown) =>
    typeof nested === 'bigint' ? nested.toString() : nested,
  );
}
export function decode<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value), (key, nested: unknown) =>
    key === 'minorUnits' && typeof nested === 'string'
      ? BigInt(nested)
      : nested,
  ) as T;
}
export function fingerprint(value: unknown) {
  const canonical = JSON.stringify(
    JSON.parse(encode(value)),
    (_, nested: unknown) =>
      nested && typeof nested === 'object' && !Array.isArray(nested)
        ? Object.fromEntries(
            Object.entries(nested).sort(([a], [b]) => a.localeCompare(b)),
          )
        : nested,
  );
  return createHash('sha256').update(canonical).digest('hex');
}
export interface PreparedInput extends PayrollCalculationInput {
  identity: {
    employeeNumber: string;
    name: string;
    positionTitle: string;
    details: EmployeePayrollDetails;
    companyName: string;
    employerDetails: Record<string, string>;
  };
}
interface EmploymentRow {
  id: string;
  employeeId: string;
  employeeNumber: string;
  name: string;
  positionTitle: string;
  startsOn: string;
  endsOn: string | null;
  status: string;
}
interface CompensationRow {
  id: string;
  code: string;
  kind: 'earning' | 'deduction';
  amount: string;
  startsOn: string;
  endsOn: string | null;
}
interface HistoryRow {
  input: unknown;
  outcome: unknown;
  paymentDate: string;
  startsOn: string;
  endsOn: string;
  runId: string;
}

export function assertMonthlyPeriod(run: Pick<PayrollRun, 'payrollPeriod'>) {
  const p = run.payrollPeriod;
  const [year, month] = p.period.startsOn.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year!, month!, 0))
    .toISOString()
    .slice(0, 10);
  if (
    p.kind !== 'regular' ||
    !p.period.startsOn.endsWith('-01') ||
    p.period.endsOn !== lastDay ||
    p.paymentDate.slice(0, 7) !== p.period.startsOn.slice(0, 7)
  )
    throw new ApiError(
      400,
      'Select a regular, full calendar month with a payment date in that month. Partial-month and off-cycle payroll need an explicit allocation policy.',
    );
}

export async function prepareInputs(
  tx: TenantTransaction,
  run: Readonly<PayrollRun>,
): Promise<PreparedInput[]> {
  assertMonthlyPeriod(run);
  const p = run.payrollPeriod;
  const year = p.paymentDate.slice(0, 4);
  const company = (
    await tx.query<{ name: string; details: Record<string, string> | null }>(
      `SELECT c.name, s.details FROM app.companies c LEFT JOIN app.company_payroll_settings s ON s.company_id = c.id WHERE c.id = app.current_company_id()`,
    )
  ).rows[0]!;
  const inputs: PreparedInput[] = [];
  for (const employeeId of run.employeeIds) {
    const employments = (
      await tx.query<EmploymentRow>(
        `SELECT j.id, e.id AS "employeeId", e.employee_number AS "employeeNumber", e.given_name || ' ' || e.family_name AS name, e.status, j.position_title AS "positionTitle", j.starts_on::text AS "startsOn", j.ends_on::text AS "endsOn" FROM app.employees e JOIN app.employments j ON j.company_id = e.company_id AND j.employee_id = e.id WHERE e.company_id = app.current_company_id() AND e.id = $1 AND j.starts_on <= $3::date AND (j.ends_on IS NULL OR j.ends_on >= $2::date) ORDER BY j.starts_on`,
        [employeeId, p.period.startsOn, p.period.endsOn],
      )
    ).rows;
    const e = employments[0];
    const label = e?.employeeNumber ?? employeeId;
    if (
      employments.length !== 1 ||
      !e ||
      e.status !== 'active' ||
      e.startsOn > p.period.startsOn ||
      (e.endsOn && e.endsOn < p.period.endsOn)
    )
      throw new ApiError(
        400,
        `${label}: an active employment must cover the entire month. Review employment dates; partial-month pay needs an allocation policy.`,
      );
    const salaries = (
      await tx.query<CompensationRow>(
        `SELECT id, 'BASE_SALARY' AS code, 'earning' AS kind, amount_minor_units::text AS amount, starts_on::text AS "startsOn", ends_on::text AS "endsOn" FROM app.salaries WHERE company_id = app.current_company_id() AND employment_id = $1 AND starts_on <= $3::date AND (ends_on IS NULL OR ends_on >= $2::date) ORDER BY starts_on`,
        [e.id, p.period.startsOn, p.period.endsOn],
      )
    ).rows;
    if (
      salaries.length !== 1 ||
      salaries[0]!.startsOn > p.period.startsOn ||
      (salaries[0]!.endsOn && salaries[0]!.endsOn! < p.period.endsOn)
    )
      throw new ApiError(
        400,
        `${label}: add one monthly salary covering this period. Mid-month salary changes require allocation.`,
      );
    const components = (
      await tx.query<CompensationRow>(
        `SELECT id, code, CASE WHEN kind = 'allowance' THEN 'earning' ELSE 'deduction' END AS kind, amount_minor_units::text AS amount, starts_on::text AS "startsOn", ends_on::text AS "endsOn" FROM app.compensation_components WHERE company_id = app.current_company_id() AND employment_id = $1 AND starts_on <= $3::date AND (ends_on IS NULL OR ends_on >= $2::date) ORDER BY code, starts_on`,
        [e.id, p.period.startsOn, p.period.endsOn],
      )
    ).rows;
    if (
      components.some(
        (c) =>
          c.startsOn > p.period.startsOn ||
          (c.endsOn && c.endsOn < p.period.endsOn),
      )
    )
      throw new ApiError(
        400,
        `${label}: an allowance or deduction changes during this month. Review the effective dates before calculation.`,
      );
    const all = [...salaries, ...components];
    const codes = all.map((c) => c.code);
    if (
      new Set(codes).size !== codes.length ||
      components.some((c) =>
        [
          'PAYE',
          'NAPSA-EMPLOYEE',
          'NAPSA-EMPLOYER',
          'NHIMA-EMPLOYEE',
          'NHIMA-EMPLOYER',
          'BASE_SALARY',
        ].includes(c.code),
      )
    )
      throw new ApiError(
        400,
        `${label}: compensation codes must be unique and must not reuse statutory codes.`,
      );
    const stored = (
      await tx.query<{ details: unknown }>(
        'SELECT details FROM app.employee_payroll_details WHERE company_id = app.current_company_id() AND employee_id = $1',
        [employeeId],
      )
    ).rows[0];
    const details = employeePayrollDetailsSchema.parse(stored?.details ?? {});
    const history = (
      await tx.query<HistoryRow>(
        `SELECT re.input_snapshot AS input, re.result_snapshot AS outcome, p.payment_date::text AS "paymentDate", p.starts_on::text AS "startsOn", p.ends_on::text AS "endsOn", r.id AS "runId" FROM app.payroll_run_employees re JOIN app.payroll_runs r ON r.company_id = re.company_id AND r.id = re.payroll_run_id JOIN app.payroll_periods p ON p.company_id = r.company_id AND p.id = r.payroll_period_id WHERE re.company_id = app.current_company_id() AND re.employee_id = $1 AND r.status = 'finalized' AND p.payment_date >= $2::date AND p.payment_date < $3::date ORDER BY p.payment_date, r.id`,
        [employeeId, `${year}-01-01`, `${Number(year) + 1}-01-01`],
      )
    ).rows;
    if (history.some((h) => h.paymentDate >= p.paymentDate))
      throw new ApiError(
        409,
        `${label}: later payroll is already finalized. A correction workflow is required; historical tax cannot be silently rewritten.`,
      );
    let taxable = 0n;
    let paye = 0n;
    let contextStart = `${year}-01-01`;
    if (details.openingAsOf) {
      const d = parseLocalDate(details.openingAsOf);
      if (d >= p.period.startsOn)
        throw new ApiError(
          400,
          `${label}: opening balances must end before this payroll month.`,
        );
      if (d.slice(0, 4) === year) {
        const next = new Date(`${d}T00:00:00Z`);
        next.setUTCDate(next.getUTCDate() + 1);
        contextStart = next.toISOString().slice(0, 10);
        if (!contextStart.endsWith('-01'))
          throw new ApiError(
            400,
            `${label}: opening balances must be dated at a month end.`,
          );
        taxable = parseDecimalMoney(
          details.openingTaxableIncome,
          parseCurrencyCode('ZMW'),
          2,
        ).minorUnits;
        paye = parseDecimalMoney(
          details.openingPaye,
          parseCurrencyCode('ZMW'),
          2,
        ).minorUnits;
      }
    }
    // Require a complete record since the opening boundary, including zero-income months.
    // No previous employment or imported earnings are silently assumed to be zero.
    const expectedMonths: string[] = [];
    for (
      let month = Number(contextStart.slice(5, 7));
      month < Number(p.paymentDate.slice(5, 7));
      month++
    )
      expectedMonths.push(`${year}-${String(month).padStart(2, '0')}`);
    const applicableHistory = history.filter(
      (h) => h.paymentDate >= contextStart,
    );
    if (history.some((h) => h.paymentDate < contextStart))
      throw new ApiError(
        400,
        `${label}: opening balances overlap finalized payroll. Keep the original opening boundary.`,
      );
    if (
      expectedMonths.some(
        (month) => !applicableHistory.some((h) => h.startsOn === `${month}-01`),
      )
    )
      throw new ApiError(
        400,
        `${label}: tax history is incomplete. Record reviewed opening taxable income and PAYE through the preceding month in the employee profile, or finalize the missing payroll months.`,
      );
    for (const h of applicableHistory) {
      const previous = decode<PayrollCalculationOutcome>(h.outcome);
      taxable += previous.taxableIncome.minorUnits;
      paye += previous.paye.minorUnits;
    }
    if (paye < 0n)
      throw new ApiError(
        400,
        `${label}: cumulative PAYE is negative; review imported tax balances.`,
      );
    inputs.push({
      calculationVersion: 'ZAMBIA-MONTHLY-1' as CalculationVersion,
      roundingPolicy: 'ZMW-2DP-HALF-UP' as RoundingPolicyIdentifier,
      employee: { companyId: run.companyId, employeeId },
      employment: {
        employmentId: parseEntityId(e.id, 'Employment'),
        employeeId,
        effectivePeriod: {
          startsOn: parseLocalDate(e.startsOn),
          ...(e.endsOn ? { endsOn: parseLocalDate(e.endsOn) } : {}),
        },
      },
      period: {
        periodId: p.id,
        startsOn: p.period.startsOn,
        endsOn: p.period.endsOn,
        paymentDate: p.paymentDate,
      },
      statutoryConfiguration: {
        configurationId: run.statutoryConfigurationId,
        effectivePeriod: run.statutoryConfiguration.effectivePeriod,
        parameters: run.statutoryConfiguration.parameters,
        sources: run.statutoryConfiguration.sources,
        verificationStatus: 'verified',
        version: run.statutoryConfigurationVersion as ConfigurationVersion,
      },
      statutoryContext: {
        taxableIncomeBeforePeriod: money(taxable),
        payeBeforePeriod: money(paye),
        napsaEmployeeContributionBeforePeriod: money(0n),
        napsaEmployerContributionBeforePeriod: money(0n),
        napsaEarningsBeforePeriod: money(0n),
      },
      compensation: all.map((c) => ({
        componentId: parseEntityId(c.id, 'CompensationComponent'),
        code: c.code,
        kind: c.kind,
        amount: money(BigInt(c.amount)),
        effectivePeriod: {
          startsOn: parseLocalDate(c.startsOn),
          ...(c.endsOn ? { endsOn: parseLocalDate(c.endsOn) } : {}),
        },
      })),
      identity: {
        employeeNumber: e.employeeNumber,
        name: e.name,
        positionTitle: e.positionTitle,
        details,
        companyName: company.name,
        employerDetails: company.details ?? {},
      },
    });
  }
  return inputs;
}

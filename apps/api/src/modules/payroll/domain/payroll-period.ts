import type { CompanyId } from '../../companies/domain/company.js';
import { DomainError } from '../../../shared/domain/domain-error.js';
import {
  createDateInterval,
  parseLocalDate,
  type DateInterval,
  type LocalDate,
} from '../../../shared/domain/local-date.js';
import {
  parseEntityId,
  type EntityId,
} from '../../../shared/domain/entity-id.js';

export type PayrollPeriodId = EntityId<'PayrollPeriod'>;
export type PayrollPeriodKind = 'off_cycle' | 'regular';

export interface PayrollPeriod {
  readonly code: string;
  readonly companyId: CompanyId;
  readonly id: PayrollPeriodId;
  readonly kind: PayrollPeriodKind;
  readonly paymentDate: LocalDate;
  readonly period: Required<Readonly<DateInterval>>;
}

export interface CreatePayrollPeriodInput {
  readonly code: string;
  readonly companyId: string;
  readonly endsOn: string;
  readonly id: string;
  readonly kind?: string;
  readonly paymentDate: string;
  readonly startsOn: string;
}

const periodCodePattern = /^[A-Z0-9]+(?:[./_-][A-Z0-9]+)*$/;
const periodCodeMaximumLength = 32;

export function createPayrollPeriod(
  input: CreatePayrollPeriodInput,
): Readonly<PayrollPeriod> {
  const period = createDateInterval(
    parseLocalDate(input.startsOn),
    parseLocalDate(input.endsOn),
  );

  return Object.freeze({
    code: normalizePayrollPeriodCode(input.code),
    companyId: parseEntityId(input.companyId, 'Company'),
    id: parseEntityId(input.id, 'PayrollPeriod'),
    kind: parsePayrollPeriodKind(input.kind ?? 'regular'),
    paymentDate: parseLocalDate(input.paymentDate),
    period: period as Required<Readonly<DateInterval>>,
  });
}

export function assertPayrollPeriodSchedule(
  companyId: CompanyId,
  periods: readonly Readonly<PayrollPeriod>[],
): void {
  const identifiers = new Set<PayrollPeriodId>();
  const codes = new Set<string>();

  for (const period of periods) {
    if (period.companyId !== companyId) {
      throw new DomainError(
        'TENANT_SCOPE_MISMATCH',
        'Payroll periods must belong to the supplied company',
        { entity: 'PayrollPeriod' },
      );
    }
    if (identifiers.has(period.id) || codes.has(period.code)) {
      throw invalidSchedule('duplicate_period');
    }
    identifiers.add(period.id);
    codes.add(period.code);
  }

  const regularPeriods = periods
    .filter((period) => period.kind === 'regular')
    .toSorted((left, right) =>
      left.period.startsOn.localeCompare(right.period.startsOn),
    );

  for (let index = 1; index < regularPeriods.length; index += 1) {
    const previous = regularPeriods[index - 1];
    const current = regularPeriods[index];

    if (
      previous !== undefined &&
      current !== undefined &&
      current.period.startsOn <= previous.period.endsOn
    ) {
      throw invalidSchedule('overlapping_regular_period');
    }
  }
}

export function normalizePayrollPeriodCode(value: string): string {
  const normalized = value.normalize('NFKC').trim().toUpperCase();

  if (
    normalized.length > periodCodeMaximumLength ||
    !periodCodePattern.test(normalized)
  ) {
    throw new DomainError(
      'INVALID_DOMAIN_CODE',
      'Payroll period code must use letters, numbers, and supported separators',
      { entity: 'PayrollPeriod', maximumLength: periodCodeMaximumLength },
    );
  }

  return normalized;
}

function parsePayrollPeriodKind(value: string): PayrollPeriodKind {
  if (value !== 'regular' && value !== 'off_cycle') {
    throw new DomainError(
      'INVALID_ENTITY_STATUS',
      'Payroll period kind is not supported',
      { entity: 'PayrollPeriod' },
    );
  }

  return value;
}

function invalidSchedule(rule: string): DomainError {
  return new DomainError(
    'INVALID_PAYROLL_PERIOD_SCHEDULE',
    'Regular payroll periods cannot overlap or reuse identifiers',
    { entity: 'PayrollPeriod', rule },
  );
}

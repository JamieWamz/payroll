import { DomainError } from '../../../shared/domain/domain-error.js';
import {
  compareLocalDates,
  type DateInterval,
} from '../../../shared/domain/local-date.js';
import type { Employment } from '../../workforce/domain/employment.js';

export function assertPeriodWithinEmployment(
  employment: Readonly<Employment>,
  period: Readonly<DateInterval>,
): void {
  const employmentEnd = employment.effectivePeriod.endsOn;
  const periodEnd = period.endsOn;

  if (
    compareLocalDates(period.startsOn, employment.effectivePeriod.startsOn) <
      0 ||
    (employmentEnd !== undefined &&
      (periodEnd === undefined ||
        compareLocalDates(periodEnd, employmentEnd) > 0))
  ) {
    throw new DomainError(
      'COMPENSATION_OUTSIDE_EMPLOYMENT',
      'Compensation must be effective entirely within its employment period',
      { entity: 'Employment' },
    );
  }
}

export function periodsOverlap(
  left: Readonly<DateInterval>,
  right: Readonly<DateInterval>,
): boolean {
  return (
    (left.endsOn === undefined ||
      compareLocalDates(right.startsOn, left.endsOn) <= 0) &&
    (right.endsOn === undefined ||
      compareLocalDates(left.startsOn, right.endsOn) <= 0)
  );
}

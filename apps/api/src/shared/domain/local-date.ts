import { DomainError } from './domain-error.js';

declare const localDateBrand: unique symbol;

export type LocalDate = string & {
  readonly [localDateBrand]: 'LocalDate';
};

export interface DateInterval {
  readonly startsOn: LocalDate;
  readonly endsOn?: LocalDate;
}

const localDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseLocalDate(value: string): LocalDate {
  const match = localDatePattern.exec(value);

  if (match === null) {
    throw invalidLocalDate();
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (
    year === 0 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month)
  ) {
    throw invalidLocalDate();
  }

  return value as LocalDate;
}

export function compareLocalDates(left: LocalDate, right: LocalDate): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function createDateInterval(
  startsOn: LocalDate,
  endsOn?: LocalDate,
): Readonly<DateInterval> {
  if (endsOn !== undefined && compareLocalDates(endsOn, startsOn) < 0) {
    throw new DomainError(
      'INVALID_DATE_INTERVAL',
      'Date interval end cannot be before its start',
      { rule: 'end_not_before_start' },
    );
  }

  return Object.freeze(
    endsOn === undefined ? { startsOn } : { endsOn, startsOn },
  );
}

export function intervalContains(
  interval: Readonly<DateInterval>,
  date: LocalDate,
): boolean {
  return (
    compareLocalDates(date, interval.startsOn) >= 0 &&
    (interval.endsOn === undefined ||
      compareLocalDates(date, interval.endsOn) <= 0)
  );
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }

  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function invalidLocalDate(): DomainError {
  return new DomainError(
    'INVALID_LOCAL_DATE',
    'Local date must be a real calendar date in YYYY-MM-DD format',
    { format: 'YYYY-MM-DD' },
  );
}

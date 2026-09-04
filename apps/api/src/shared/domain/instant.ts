import { DomainError } from './domain-error.js';

declare const instantBrand: unique symbol;

export type Instant = string & {
  readonly [instantBrand]: 'Instant';
};

const instantPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function parseInstant(value: string): Instant {
  if (!instantPattern.test(value)) {
    throw invalidInstant();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw invalidInstant();
  }

  return value as Instant;
}

function invalidInstant(): DomainError {
  return new DomainError(
    'INVALID_INSTANT',
    'Instant must be a real UTC timestamp with millisecond precision',
    { format: 'YYYY-MM-DDTHH:mm:ss.sssZ' },
  );
}

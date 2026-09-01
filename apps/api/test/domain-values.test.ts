import { describe, expect, it } from 'vitest';

import { DomainError } from '../src/shared/domain/domain-error.js';
import { parseEntityId } from '../src/shared/domain/entity-id.js';
import {
  createDateInterval,
  intervalContains,
  parseLocalDate,
} from '../src/shared/domain/local-date.js';
import {
  addMoney,
  formatMoney,
  moneyFromMinorUnits,
  parseCurrencyCode,
  parseDecimalMoney,
  serializeMoney,
} from '../src/shared/domain/money.js';

describe('entity identifiers', () => {
  it('normalizes a valid UUID to its canonical lower-case representation', () => {
    expect(
      parseEntityId('9F4BF634-AD66-4F1C-9A68-03047F364645', 'Employee'),
    ).toBe('9f4bf634-ad66-4f1c-9a68-03047f364645');
  });

  it.each([
    '',
    ' 9f4bf634-ad66-4f1c-9a68-03047f364645',
    '00000000-0000-0000-0000-000000000000',
    'not-a-uuid',
  ])('rejects the non-canonical identifier %j', (value) => {
    expect(() => parseEntityId(value, 'Employee')).toThrowError(
      expect.objectContaining({ code: 'INVALID_ENTITY_ID' }),
    );
  });
});

describe('local dates and inclusive intervals', () => {
  it('accepts real leap days and inclusive boundaries', () => {
    const startsOn = parseLocalDate('2024-02-29');
    const endsOn = parseLocalDate('2024-03-31');
    const interval = createDateInterval(startsOn, endsOn);

    expect(intervalContains(interval, startsOn)).toBe(true);
    expect(intervalContains(interval, endsOn)).toBe(true);
    expect(intervalContains(interval, parseLocalDate('2024-04-01'))).toBe(
      false,
    );
    expect(Object.isFrozen(interval)).toBe(true);
  });

  it.each(['2023-02-29', '2024-13-01', '2024-04-31', '01-01-2024'])(
    'rejects the invalid calendar date %s',
    (value) => {
      expect(() => parseLocalDate(value)).toThrowError(
        expect.objectContaining({ code: 'INVALID_LOCAL_DATE' }),
      );
    },
  );

  it('rejects an interval whose end precedes its start', () => {
    expect(() =>
      createDateInterval(
        parseLocalDate('2026-09-02'),
        parseLocalDate('2026-09-01'),
      ),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_DATE_INTERVAL' }));
  });
});

describe('exact money values', () => {
  const zmw = parseCurrencyCode('ZMW');

  it('parses and serializes decimals without floating point or hidden rounding', () => {
    const money = parseDecimalMoney('1234567890123456.7', zmw, 2);

    expect(money.minorUnits).toBe(123_456_789_012_345_670n);
    expect(formatMoney(money)).toBe('1234567890123456.70');
    expect(serializeMoney(money)).toEqual({
      amount: '1234567890123456.70',
      currency: 'ZMW',
      scale: 2,
    });
    expect(Object.isFrozen(money)).toBe(true);
  });

  it('preserves signed minor units exactly', () => {
    expect(parseDecimalMoney('-0.01', zmw, 2).minorUnits).toBe(-1n);
    expect(formatMoney(moneyFromMinorUnits(-1n, zmw, 2))).toBe('-0.01');
  });

  it.each(['1.001', '1e3', '+1.00', '01.00', ' 1.00'])(
    'rejects imprecise or non-canonical decimal input %j',
    (amount) => {
      expect(() => parseDecimalMoney(amount, zmw, 2)).toThrowError(
        expect.objectContaining({ code: 'INVALID_MONEY_AMOUNT' }),
      );
    },
  );

  it.each(['zmw', 'ZM', 'ZMWK', '12A'])(
    'rejects the invalid currency code %j',
    (currency) => {
      expect(() => parseCurrencyCode(currency)).toThrowError(
        expect.objectContaining({ code: 'INVALID_CURRENCY_CODE' }),
      );
    },
  );

  it.each([-1, 1.5, 10])('rejects the invalid scale %s', (scale) => {
    expect(() => moneyFromMinorUnits(1n, zmw, scale)).toThrowError(
      expect.objectContaining({ code: 'INVALID_MONEY_SCALE' }),
    );
  });

  it('adds only values with identical currency and scale', () => {
    const total = addMoney(
      parseDecimalMoney('10.25', zmw, 2),
      parseDecimalMoney('2.75', zmw, 2),
    );

    expect(formatMoney(total)).toBe('13.00');
    expect(() =>
      addMoney(total, parseDecimalMoney('1.000', zmw, 3)),
    ).toThrowError(expect.objectContaining({ code: 'MONEY_UNIT_MISMATCH' }));
    expect(() =>
      addMoney(total, parseDecimalMoney('1.00', parseCurrencyCode('USD'), 2)),
    ).toThrowError(expect.objectContaining({ code: 'MONEY_UNIT_MISMATCH' }));
  });

  it('uses a tagged error type with frozen safe details', () => {
    try {
      parseDecimalMoney('1.001', zmw, 2);
      expect.fail('Expected parsing to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect(error).toMatchObject({ code: 'INVALID_MONEY_AMOUNT' });
      expect(Object.isFrozen((error as DomainError).details)).toBe(true);
    }
  });
});

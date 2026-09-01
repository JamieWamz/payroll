import { DomainError } from './domain-error.js';

declare const currencyCodeBrand: unique symbol;
declare const moneyBrand: unique symbol;

export type CurrencyCode = string & {
  readonly [currencyCodeBrand]: 'CurrencyCode';
};

export type Money = Readonly<{
  readonly currency: CurrencyCode;
  readonly minorUnits: bigint;
  readonly scale: number;
  readonly [moneyBrand]: 'Money';
}>;

export interface SerializedMoney {
  readonly amount: string;
  readonly currency: CurrencyCode;
  readonly scale: number;
}

const currencyCodePattern = /^[A-Z]{3}$/;
const decimalAmountPattern = /^-?(?:0|[1-9]\d*)(?:\.(\d+))?$/;
const maximumScale = 9;

export function parseCurrencyCode(value: string): CurrencyCode {
  if (!currencyCodePattern.test(value)) {
    throw new DomainError(
      'INVALID_CURRENCY_CODE',
      'Currency must be a three-letter uppercase code',
      { value },
    );
  }

  return value as CurrencyCode;
}

export function moneyFromMinorUnits(
  minorUnits: bigint,
  currency: CurrencyCode,
  scale: number,
): Readonly<Money> {
  validateScale(scale);

  return Object.freeze({ currency, minorUnits, scale }) as Money;
}

export function parseDecimalMoney(
  amount: string,
  currency: CurrencyCode,
  scale: number,
): Readonly<Money> {
  validateScale(scale);

  const match = decimalAmountPattern.exec(amount);
  if (match === null) {
    throw invalidMoneyAmount(scale);
  }

  const fraction = match[1] ?? '';
  if (fraction.length > scale) {
    throw invalidMoneyAmount(scale);
  }

  const negative = amount.startsWith('-');
  const unsignedAmount = negative ? amount.slice(1) : amount;
  const [whole = '0', providedFraction = ''] = unsignedAmount.split('.');
  const multiplier = 10n ** BigInt(scale);
  const fractionalMinorUnits =
    scale === 0 ? 0n : BigInt(providedFraction.padEnd(scale, '0'));
  const absoluteMinorUnits = BigInt(whole) * multiplier + fractionalMinorUnits;
  const minorUnits = negative ? -absoluteMinorUnits : absoluteMinorUnits;

  return moneyFromMinorUnits(minorUnits, currency, scale);
}

export function formatMoney(money: Readonly<Money>): string {
  const negative = money.minorUnits < 0n;
  const absoluteMinorUnits = negative ? -money.minorUnits : money.minorUnits;

  if (money.scale === 0) {
    return `${negative ? '-' : ''}${absoluteMinorUnits}`;
  }

  const digits = absoluteMinorUnits.toString().padStart(money.scale + 1, '0');
  const splitAt = digits.length - money.scale;

  return `${negative ? '-' : ''}${digits.slice(0, splitAt)}.${digits.slice(splitAt)}`;
}

export function serializeMoney(money: Readonly<Money>): SerializedMoney {
  return Object.freeze({
    amount: formatMoney(money),
    currency: money.currency,
    scale: money.scale,
  });
}

export function addMoney(
  left: Readonly<Money>,
  right: Readonly<Money>,
): Readonly<Money> {
  if (left.currency !== right.currency || left.scale !== right.scale) {
    throw new DomainError(
      'MONEY_UNIT_MISMATCH',
      'Money values must use the same currency and scale',
      {
        leftCurrency: left.currency,
        leftScale: left.scale,
        rightCurrency: right.currency,
        rightScale: right.scale,
      },
    );
  }

  return moneyFromMinorUnits(
    left.minorUnits + right.minorUnits,
    left.currency,
    left.scale,
  );
}

function validateScale(scale: number): void {
  if (!Number.isInteger(scale) || scale < 0 || scale > maximumScale) {
    throw new DomainError(
      'INVALID_MONEY_SCALE',
      `Money scale must be an integer from 0 to ${maximumScale}`,
      { scale },
    );
  }
}

function invalidMoneyAmount(scale: number): DomainError {
  return new DomainError(
    'INVALID_MONEY_AMOUNT',
    'Money amount must be a canonical decimal string within the selected scale',
    { scale },
  );
}

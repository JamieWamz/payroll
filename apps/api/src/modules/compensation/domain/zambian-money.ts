import { DomainError } from '../../../shared/domain/domain-error.js';
import {
  parseCurrencyCode,
  parseDecimalMoney,
  type Money,
} from '../../../shared/domain/money.js';

const zambianKwacha = parseCurrencyCode('ZMW');
const currencyScale = 2;

export function parsePositiveZambianAmount(value: string): Readonly<Money> {
  const amount = parseDecimalMoney(value, zambianKwacha, currencyScale);

  if (amount.minorUnits <= 0n) {
    throw new DomainError(
      'INVALID_COMPENSATION_AMOUNT',
      'Compensation amounts must be greater than zero',
      { currency: zambianKwacha },
    );
  }

  return amount;
}

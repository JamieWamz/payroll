export type DomainErrorCode =
  | 'INVALID_CURRENCY_CODE'
  | 'INVALID_DATE_INTERVAL'
  | 'INVALID_ENTITY_ID'
  | 'INVALID_LOCAL_DATE'
  | 'INVALID_MONEY_AMOUNT'
  | 'INVALID_MONEY_SCALE'
  | 'MONEY_UNIT_MISMATCH';

export type DomainErrorDetails = Readonly<
  Record<string, boolean | number | string>
>;

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details: DomainErrorDetails | undefined;

  constructor(
    code: DomainErrorCode,
    message: string,
    details?: DomainErrorDetails,
  ) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details === undefined ? undefined : Object.freeze(details);
  }
}

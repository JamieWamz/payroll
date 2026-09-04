export type DomainErrorCode =
  | 'BLOCKED_PASSWORD'
  | 'COMPENSATION_HISTORY_OVERLAP'
  | 'COMPENSATION_OUTSIDE_EMPLOYMENT'
  | 'DUPLICATE_ROLE_ASSIGNMENT'
  | 'EMPLOYEE_HAS_OPEN_EMPLOYMENT'
  | 'EMPLOYMENT_ALREADY_ENDED'
  | 'EMPLOYMENT_HISTORY_OVERLAP'
  | 'FORBIDDEN_OPERATION'
  | 'INVALID_CURRENCY_CODE'
  | 'INVALID_COMPENSATION_AMOUNT'
  | 'INVALID_DATE_INTERVAL'
  | 'INVALID_AUDIT_EVENT'
  | 'INVALID_DOMAIN_CODE'
  | 'INVALID_DOMAIN_NAME'
  | 'INVALID_EMAIL_ADDRESS'
  | 'INVALID_EMPLOYMENT_HISTORY'
  | 'INVALID_ENTITY_ID'
  | 'INVALID_ENTITY_STATUS'
  | 'INVALID_LOCAL_DATE'
  | 'INVALID_MONEY_AMOUNT'
  | 'INVALID_MONEY_SCALE'
  | 'INVALID_PERMISSION_IDENTIFIER'
  | 'INVALID_PASSWORD'
  | 'INVALID_PAYROLL_PERIOD_SCHEDULE'
  | 'INVALID_SECURITY_TOKEN'
  | 'MONEY_UNIT_MISMATCH'
  | 'TENANT_SCOPE_MISMATCH';

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

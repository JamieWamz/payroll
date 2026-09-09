import { createHash } from 'node:crypto';
import type { PayrollCalculationInput } from '../payroll/calculation/types.js';

/** Stable across re-downloads, with no employee names or account numbers. */
export function paymentReference(input: PayrollCalculationInput): string {
  return `ZP${createHash('sha256')
    .update(
      `${input.employee.companyId}:${input.period.periodId}:${input.employee.employeeId}`,
    )
    .digest('hex')
    .slice(0, 18)
    .toUpperCase()}`;
}

import type { DeepReadonly } from '../../../shared/domain/deep-readonly.js';
import type {
  PayrollCalculationInput,
  PayrollCalculationOutcome,
} from './types.js';

/**
 * Pure calculation boundary. Phase 2 intentionally provides no implementation
 * until statutory configuration and rounding behavior are authoritatively
 * verified and independently reviewed.
 */
export interface PayrollCalculator {
  calculate(
    input: DeepReadonly<PayrollCalculationInput>,
  ): DeepReadonly<PayrollCalculationOutcome>;
}

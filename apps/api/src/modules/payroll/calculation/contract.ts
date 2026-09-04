import type { DeepReadonly } from '../../../shared/domain/deep-readonly.js';
import type {
  PayrollCalculationInput,
  PayrollCalculationOutcome,
} from './types.js';

/** Pure calculation boundary used by versioned, evidence-backed calculators. */
export interface PayrollCalculator {
  calculate(
    input: DeepReadonly<PayrollCalculationInput>,
  ): DeepReadonly<PayrollCalculationOutcome>;
}

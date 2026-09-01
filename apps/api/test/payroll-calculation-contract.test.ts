import { describe, expectTypeOf, it } from 'vitest';

import type { PayrollCalculator } from '../src/modules/payroll/calculation/contract.js';
import type {
  PayrollCalculationInput,
  PayrollCalculationOutcome,
  VerifiedStatutoryConfigurationSnapshot,
} from '../src/modules/payroll/calculation/types.js';
import type { DeepReadonly } from '../src/shared/domain/deep-readonly.js';

describe('payroll calculation contract', () => {
  it('requires deeply immutable input and output snapshots', () => {
    expectTypeOf<PayrollCalculator['calculate']>()
      .parameter(0)
      .toEqualTypeOf<DeepReadonly<PayrollCalculationInput>>();
    expectTypeOf<ReturnType<PayrollCalculator['calculate']>>().toEqualTypeOf<
      DeepReadonly<PayrollCalculationOutcome>
    >();
  });

  it('requires an explicitly verified statutory configuration snapshot', () => {
    expectTypeOf<
      PayrollCalculationInput['statutoryConfiguration']
    >().toEqualTypeOf<VerifiedStatutoryConfigurationSnapshot>();
    expectTypeOf<
      VerifiedStatutoryConfigurationSnapshot['verificationStatus']
    >().toEqualTypeOf<'verified'>();
  });
});

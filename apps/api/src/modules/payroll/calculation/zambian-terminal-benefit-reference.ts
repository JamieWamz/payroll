/**
 * Evidence reference for operator configuration. It is not an active rule and
 * is never selected automatically by a payroll calculation.
 */
export const zambianPublishedTerminalBenefitReference = Object.freeze({
  gratuity: Object.freeze({
    applicability:
      'Covered long-term contracts under section 73; review classification, exemptions and contractual rights before use.',
    basis: 'basic_pay_earned_during_contract',
    minimumRatePercent: '25',
    payeTreatment: 'exempt_qualifying_gratuity',
    settlementReason: 'contract_expiry',
    sources: Object.freeze([
      Object.freeze({
        authority: 'national_assembly_of_zambia',
        title: 'Employment Code Act No. 3 of 2019, sections 54 and 73',
        uri: 'https://www.parliament.gov.zm/sites/default/files/documents/acts/The%20Employment%20Code%20Act%20No.%203%20of%202019.pdf',
      }),
      Object.freeze({
        authority: 'zra',
        title: 'ZRA PAYE Refunds — payments on cessation of employment',
        uri: 'https://www.zra.org.zm/wp-content/uploads/2023/06/Pay-As-You-Earn-PAYE-Refunds.pdf',
      }),
    ]),
  }),
});

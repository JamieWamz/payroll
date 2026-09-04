/**
 * Evidence references for statutory-configuration tooling. These values are
 * never selected by the calculator automatically. An operator must create and
 * verify an effective-dated configuration before a payroll run can use them.
 */
export const zambianPublishedContributionReference = Object.freeze({
  napsa: Object.freeze({
    employeeRatePercent: '5',
    employerRatePercent: '5',
    monthlyCeiling: Object.freeze({
      status: 'requires-current-dated-notice',
    }),
    sourceTitle: 'NAPSA National Pension Scheme Act 2026 FAQs',
    sourceUri:
      'https://www.napsa.co.zm/download/publication/NAPSA_Pension_reforms_FAQs_V04',
    totalRatePercent: '10',
  }),
  nhima: Object.freeze({
    contributionBase: 'basic_salary',
    employeeRatePercent: '1',
    employerRatePercent: '1',
    sourceTitle: 'NHIMA Frequently Asked Questions',
    sourceUri: 'https://www.nhima.co.zm/elementor-1783/',
    totalRatePercent: '2',
  }),
});

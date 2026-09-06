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
      status: 'dated-reference',
      confirmedYear: 2026,
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-12-31',
      earningsCeiling: '37236.00',
      employeeContributionCap: '1861.80',
      employerContributionCap: '1861.80',
      sourceTitle: 'NAPSA notice, 5 January 2026 (copy hosted by CRS)',
      sourceUri:
        'https://www.crs.co.za/wp-content/uploads/2026/01/NAPSA_Revision_of_Contribution_Ceiling_2026.pdf',
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

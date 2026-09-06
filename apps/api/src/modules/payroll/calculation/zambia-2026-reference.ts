import { zraPublishedMonthlyPayeReference } from './zra-paye-reference.js';

/** A dated, reviewable starting point. Never used as a calculator fallback. */
export const zambia2026MonthlyReference = {
  version: 'ZM-2026-MONTHLY-1',
  effectiveFrom: '2026-01-01',
  effectiveTo: '2026-12-31',
  reviewedOn: '2026-09-06',
  parameters: {
    schemaVersion: 'ZAMBIA-MONTHLY-1',
    paye: { bands: zraPublishedMonthlyPayeReference.bands },
    napsa: {
      employeeRatePercent: '5',
      employerRatePercent: '5',
      employeeMonthlyCap: '1861.80',
      employerMonthlyCap: '1861.80',
    },
    nhima: {
      employeeRatePercent: '1',
      employerRatePercent: '1',
      employeeMonthlyCap: null,
      employerMonthlyCap: null,
    },
    componentTreatments: {
      BASE_SALARY: { paye: 'taxable', napsa: 'included', nhima: 'included' },
    },
  },
  sources: [
    {
      authority: 'zra',
      title:
        'PwC Zambia: 2026 personal income tax rates (reviewed 24 July 2026)',
      uri: 'https://taxsummaries.pwc.com/zambia/individual/taxes-on-personal-income',
      accessedOn: '2026-09-06',
    },
    {
      authority: 'napsa',
      title:
        'NAPSA notice, 5 January 2026: revised contribution ceiling (copy hosted by CRS)',
      uri: 'https://www.crs.co.za/wp-content/uploads/2026/01/NAPSA_Revision_of_Contribution_Ceiling_2026.pdf',
      accessedOn: '2026-09-06',
    },
    {
      authority: 'nhima',
      title:
        'National Health Insurance (General) Regulations 2019, Third Schedule',
      uri: 'https://www.nhima.co.zm/download/document/813df761802019102159cc9cc7.pdf',
      accessedOn: '2026-09-06',
    },
  ],
  notes:
    'PAYE bands and percentage rates carry forward from 2025. The 2026 NAPSA earnings ceiling is K37,236; the contribution cap increases from K1,708.20 to K1,861.80 for each side. The 2026 PAYE bands are corroborated by PwC and the NAPSA cap by its dated notice; review source evidence and any company allowances before verification. NHIMA is 1% each of basic salary.',
};

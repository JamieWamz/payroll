/** Public evidence, not credentials, bank acceptance or live connections. */
export const integrationResources = [
  {
    id: 'fnb-zambia-csv',
    purpose: 'salary_batch',
    title: 'FNB Zambia payment CSV',
    status: 'documented_format_bank_validation_required',
    sourceUri:
      'https://www.online.fnb.co.za/rhelp_0_81/OBE_ZAMBIA_Downloads/Downloads/Payments/Payment_CSV_Template_All.csv',
    guideUri:
      'https://www.online.fnb.co.za/rhelp_0_81/OBE_ZAMBIA_Downloads/Downloads/Payments/Payment_CSV_Imports_Help_Guide_Zambia.pdf',
    accessedOn: '2026-09-05',
    sourceSha256:
      '1830438c325b3969774fb287209cc1cd69718969de5a51580d40f71b91a17088',
  },
  {
    id: 'zra-paye-form',
    purpose: 'paye_return',
    title: 'ZRA official PAYE return form (PDF reference)',
    status: 'reference_only_not_bulk_upload_schema',
    sourceUri:
      'https://www.zra.org.zm/wp-content/uploads/2022/11/PAYE-Return.pdf',
    guideUri:
      'https://www.zra.org.zm/wp-content/uploads/2025/08/Return-filing-steps.pdf',
    accessedOn: '2026-09-05',
  },
  {
    id: 'zra-taxonline',
    purpose: 'paye_return',
    title: 'ZRA TaxOnline portal',
    status: 'authenticated_template_required',
    sourceUri: 'https://portal.zra.org.zm/',
    accessedOn: '2026-09-05',
  },
] as const;

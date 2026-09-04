/**
 * Evidence reference for configuration tooling. These values are not read by
 * the calculator directly; a verified, effective-dated statutory
 * configuration must contain the rates used for a payroll run.
 */
export const zraPublishedMonthlyPayeReference = Object.freeze({
  bands: Object.freeze([
    Object.freeze({ ratePercent: '0', upTo: '5100.00' }),
    Object.freeze({ ratePercent: '20', upTo: '7100.00' }),
    Object.freeze({ ratePercent: '30', upTo: '9200.00' }),
    Object.freeze({ ratePercent: '37', upTo: null }),
  ]),
  confirmedChargeYear: 2025,
  sourceTitle: 'ZRA Tax Tables for Charge Year 2025',
  sourceUri:
    'https://www.zra.org.zm/wp-content/uploads/2025/12/TAX-TABLES-FOR-CHARGE-YEAR-2025.pdf',
});

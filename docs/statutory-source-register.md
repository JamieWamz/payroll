# Zambia Statutory Source Register

## Purpose

This register tracks authority evidence considered for ZamPayroll statutory
rules. It is a research and verification record, not tax advice. A linked page
does not become an implemented rule until its exact parameters, applicability,
calculation base, caps, and rounding behavior have been independently reviewed
and recorded in a verified configuration.

Last reviewed: 2026-09-04.

## Current evidence status

| Area  | Primary authority evidence                                                                                                                                                                                                                                                                                                                 | Current decision                                                                                                                                                                                                                                                                                                                                                               |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PAYE  | [ZRA 2025 tax tables](https://www.zra.org.zm/wp-content/uploads/2025/12/TAX-TABLES-FOR-CHARGE-YEAR-2025.pdf), [ZRA employer PAYE guide](https://www.zra.org.zm/wp-content/uploads/2020/07/EMPLOYERS-GUIDE-TO-PAY-AS-YOU-EARN-2020.pdf), and [ZRA Practice Note No. 1 of 2026](https://www.zra.org.zm/download/practice-note-no-1-of-2026/) | The ZRA tables support cumulative progressive PAYE and the monthly K5,100/0%, K7,100/20%, K9,200/30%, then 37% structure. The 2020 guide confirms approved pension contributions no longer reduce chargeable pay. The bands are implemented as an operator configuration reference, not an automatically active 2026 version; special cases and rounding still require review. |
| NAPSA | [NAPSA 2026 Act FAQ](https://www.napsa.co.zm/download/publication/NAPSA_Pension_reforms_FAQs_V04) and [NAPSA 2025 contribution-ceiling notice](https://www.napsa.co.zm/news/details?id=df81c3bb-5416-4a43-b521-73923e0ccf93)                                                                                                               | The 2026 FAQ confirms a 10% contribution split equally between employer and employee. The ceiling is revised annually; the dated 2025 ceiling must not be presented as a 2026 ceiling. Current NAPSA pages display conflicting ceiling figures, so an operator must supply and verify the applicable cap before activation.                                                    |
| NHIMA | [NHIMA employer/employee contribution press release](https://www.nhima.co.zm/download/document/0e98ec61c02019110104d23eb0.pdf) and [NHIMA FAQ](https://nhima.co.zm/elementor-1783/)                                                                                                                                                        | NHIMA material describes 1% employee plus 1% employer on basic salary, but current legal/effective-date verification, exception review, and rounding confirmation remain required before a 2026 configuration is activated.                                                                                                                                                    |

The [2026 National Budget](https://www.mofnp.gov.zm/?wpdmpro=2026-national-budget)
is useful corroborating context, but the implementation must trace each
payroll parameter to the administering authority or controlling legislation.
Third-party summaries may help locate an issue; they are not sufficient
verification evidence.

## Approval checklist for a rule version

A statutory configuration can move from draft to verified only after the
reviewer has confirmed:

1. the source belongs to the responsible authority and is served over HTTPS;
2. the publication or commencement date and the affected payroll dates;
3. every rate or band, threshold, ceiling, minimum, maximum, and relief;
4. which earnings and benefits are included in each calculation base;
5. employee and employer portions, where applicable;
6. currency precision, intermediate rounding, and final rounding;
7. boundary examples at every band or cap; and
8. the superseded version and treatment of corrections or late payrolls.

Verification must record the reviewer membership and UTC instant. After that
point, parameters and sources are immutable. A correction is a new version
with its own effective period and evidence.

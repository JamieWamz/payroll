# Bank and TaxOnline integration source register

Reviewed 2026-09-05. Public documentation is not bank onboarding, live-service
acceptance, or permission to transfer funds. No credentials were requested,
used, stored or embedded in the implementation.

## FNB Zambia: documented CSV generator implemented

The bank's [Zambia payment help](https://www.online.fnb.co.za/rhelp_0_81/OBE_ZAMBIA_Downloads/Payments.htm)
links a public
[payment CSV template](https://www.online.fnb.co.za/rhelp_0_81/OBE_ZAMBIA_Downloads/Downloads/Payments/Payment_CSV_Template_All.csv).
The Zambia
[template support centre](https://www.online.fnb.co.za/rhelp_0_81/OBE_ZAMBIA_Downloads/Downloads/Templates_and_Form_Support_Centre.htm)
also links the
[September 2020 Zambia import guide](https://www.online.fnb.co.za/rhelp_0_81/OBE_ZAMBIA_Downloads/Downloads/Payments/Payment_CSV_Imports_Help_Guide_Zambia.pdf).
The payment-help page links a newer
[April 2024 multi-country guide](https://www.online.fnb.co.za/rhelp_0_81/OBE_ZAMBIA_Downloads/Downloads/Payments/Payment_CSV_Import_Guide_Int.pdf)
whose footer says South Africa but includes Zambia-specific entries. We use
only the ordinary bank-account subset common to both guides. We do not infer
that a South African service is available in Zambia.

Downloaded template: 683 bytes, SHA-256
`1830438c325b3969774fb287209cc1cd69718969de5a51580d40f71b91a17088`.
The bank's example account/date/hash are not installed as customer defaults.

Implemented `POST /api/companies/:companyId/operations/fnb-zambia-preview`:

- Four structural rows followed by recipients; exactly 36 columns, CRLF.
- Bank template marker, action date, debit account, calculated control total,
  and the bank's exact column headings.
- Control total: sum whole recipient account numbers, add own account once,
  retain the last 12 digits, left-pad with zeros. Uses BigInt throughout.
- Action date validated against today's Lusaka date, inclusive through 365
  days ahead. Bank business-day/cut-off validation remains with FNB.
- Numeric 11-digit own account; numeric recipient accounts up to 20 digits.
  Current, savings and transmission accounts only (types 1, 2, 3).
- Six-digit branch codes supplied by the operator, never guessed from names.
  The format check does not verify ownership or bank routing existence.
- Exact two-decimal positive amounts, maximum 11 characters. Names and
  references up to 20 supported ASCII characters; unsupported characters or
  lengths fail rather than silently truncating or changing a payee.
- Unique own references within each batch, no paid notifications. All 29
  notification cells are blank. ZMW salary preparation only; no public
  recipients, foreign currency, eWallet or other undocumented extensions.
- Authenticated company scope, payroll-read permission, CSRF and transactional
  audit. Raw account/amount rows are not persisted or put in audit metadata.
- Response marks `x-export-status: bank-validation-required`; the UI requires
  acknowledgment of review and makes no live-payment or bank-acceptance claim.

This is a **file-format implementation**, not an automated bank connector.
Inputs are operator-entered, not drawn from immutable finalized payroll.
Actual bank import testing and approval remain outstanding. Hash totals are
bank control totals, not cryptographic tamper-proof signatures. Production
execution still needs immutable batches, maker/checker approval, duplicate
protection across batches, final payroll linkage, bank acceptance and payment
status reconciliation. Never submit test fixtures as live bank instructions.

## ZRA TaxOnline PAYE: official reference found, upload schema blocked

ZRA's [official form index](https://www.zra.org.zm/tax-information/tax-information-details/)
links [PAYE Return Form IT 71 V001](https://www.zra.org.zm/wp-content/uploads/2022/11/PAYE-Return.pdf).
This is a PDF return reference, **not** an authenticated TaxOnline CSV/XLSX
bulk-import template. The
[2025 filing instructions](https://www.zra.org.zm/wp-content/uploads/2025/08/Return-filing-steps.pdf)
describe PAYE filing with employee TPIN, chargeable income, tax deducted,
credits and adjustments. They do not specify a machine-readable column layout.

The [TaxOnline portal](https://portal.zra.org.zm/) redirects to login and
requires TPIN, password and CAPTCHA. No current public machine-readable PAYE
upload file was verified. Direct PDF download also failed local TLS issuer
validation; TLS verification was not bypassed. Indexed official document text
was available through search. The UI now links the original official resources
instead of pretending that a generic CSV is an accepted return file.

Next dependency: an authorized operator downloads the current PAYE bulk-upload
file from their own TaxOnline session and provides the **blank template**, with
the tax period/version and portal instructions. Do not provide the password,
session cookies, CAPTCHA response, filled employee returns or other secrets.
Then implement against the exact workbook/CSV structure and verify in an
authorized validation workflow. Filing remains a separate, explicit action.

## Other banks: no invented adapters

| Bank/channel          | Public evidence                                                                                                                                                          | Remaining dependency                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Zanaco                | [Bulk CSV and host-to-host capabilities](https://www.zanaco.co.zm/new-internet-banking-faqs/), [PayFlexi](https://www.zanaco.co.zm/business-banking/electronic-banking/) | Exact bank/profile-specific layout or API contract, onboarding and acceptance                             |
| Absa                  | [Official developer portal](https://developer.absa.africa/) describes OAuth2 and mutual TLS                                                                              | Confirm Zambia payment-product availability; subscription, certificates, sandbox credentials and contract |
| Stanbic Zambia        | [Bank application form](https://ebanking.stanbicbank.co.zm/assets/Documents/ZMW/online-banking-application-form.pdf) includes file-upload approval mandates              | Current upload schema and customer mandate                                                                |
| Ecobank               | [Omni custom interface guide](https://omniplus.ecobank.com/GCPCW/static/en_US_WebHelpNONUS/WebHelpClient/specifying_interface_details_and_format_details.htm)            | Zambia/customer product configuration and exact approved mapping                                          |
| UBA                   | [Bank-published file-upload guide](https://www.ubagroup.com/wp-content/uploads/sites/14/2020/09/Internet-Banking-Manual_final.pdf)                                       | Zambia-specific schema and onboarding; group documents alone do not establish compatibility               |
| Other directory banks | Bank directory only                                                                                                                                                      | Obtain applicable bank-issued documentation and onboarding                                                |

We have not sent requests to a payment-execution endpoint, registered with a
bank, filed a return, contacted third parties or disabled TLS verification.

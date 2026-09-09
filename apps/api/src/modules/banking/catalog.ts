import { bankNames } from '../operations/contracts.js';

interface BankEvidence {
  channel: string;
  finding: string;
  nextStep: string;
  sources: { title: string; uri: string }[];
}
const evidence: BankEvidence[] = [
  {
    channel: 'Business internet banking',
    finding:
      'AB Bank describes online account access and transfers. A public payroll API specification was not found.',
    nextStep:
      'Ask Business Banking for salary upload layouts, statement exports and partner integration eligibility.',
    sources: [
      {
        title: 'AB Bank annual report: digital services',
        uri: 'https://www.abbank.co.zm/wp-content/uploads/2025/07/2024-AB-Bank-Zambia-Annual-Report-comp.pdf',
      },
    ],
  },
  {
    channel: 'Absa Integrator',
    finding:
      'The Zambia business site links Integrator. Its merchant host-to-host offering is a separate card service, not evidence of a payroll API.',
    nextStep:
      'Ask the Zambia cash-management team for Integrator payroll, reporting and integration specifications.',
    sources: [
      {
        title: 'Absa Zambia transactional solutions',
        uri: 'https://www.absa.co.zm/business/transactional-solutions/',
      },
    ],
  },
  {
    channel: 'Business and corporate digital banking',
    finding:
      'Access Zambia offers digital payment and cash-management services. Group PrimusPlus documentation does not establish Zambia API eligibility.',
    nextStep:
      'Ask the local relationship manager which business channel supports ZMW bulk payments and statements.',
    sources: [
      {
        title: 'Access Zambia business banking',
        uri: 'https://zambia.accessbankplc.com/corporate-investment-banking/business-commercial-banking',
      },
    ],
  },
  {
    channel: 'Corporate Online Banking',
    finding:
      'Bank of China Zambia publishes a corporate online-banking application and service information.',
    nextStep:
      'Request Zambia-specific bulk salary layouts, statement formats and host-to-host availability.',
    sources: [
      {
        title: 'Bank of China Zambia corporate services',
        uri: 'https://www.boc.cn/zm/custserv/',
      },
    ],
  },
  {
    channel: 'CitiDirect / CitiConnect eligibility review',
    finding:
      'Citi Zambia offers CitiDirect for payments and reporting. Group CitiConnect has public account-reporting API documentation; local product access must be confirmed.',
    nextStep:
      'Ask Zambia electronic-banking support for CitiConnect entitlement, sandbox access, client credentials and certificate requirements.',
    sources: [
      {
        title: 'Citi Zambia electronic banking',
        uri: 'https://www.citigroup.com/global/about-us/global-presence/zambia',
      },
      {
        title: 'Citi account-reporting API',
        uri: 'https://developer.citi.com/apidocs/account-reporting/statements/statements-api-reference/',
      },
    ],
  },
  {
    channel: 'Omni / group API eligibility review',
    finding:
      'Ecobank Omni documents payroll, interbank bulk files and ERP integration. The group developer portal has sandbox onboarding; Zambia services require confirmation.',
    nextStep:
      'Request Zambia account entitlements, API subscription credentials, sandbox data and production approval requirements.',
    sources: [
      {
        title: 'Ecobank Omni capabilities',
        uri: 'https://ecobank.com/commercial-banking/omni-faq',
      },
      {
        title: 'Ecobank developer onboarding',
        uri: 'https://apimuat-developer.ecobank.com/documentation/getting-started',
      },
    ],
  },
  {
    channel: 'Business internet banking',
    finding:
      'First Alliance Bank publishes an internet-banking channel. A public payroll API specification was not found.',
    nextStep:
      'Request the corporate salary-upload guide, statement formats and integration contact.',
    sources: [
      {
        title: 'First Alliance Bank Zambia',
        uri: 'https://firstalliancebankzambia.com/',
      },
    ],
  },
  {
    channel: 'Internet banking bulk payments',
    finding:
      'First Capital Zambia documents bulk beneficiary payments and statement downloads in Excel, PDF and CSV.',
    nextStep:
      'Obtain the current corporate payment template, sample statement CSV and any host-to-host options.',
    sources: [
      {
        title: 'First Capital Zambia internet banking',
        uri: 'https://www.firstcapitalbank.co.zm/personal/digital-banking/internet-banking/',
      },
    ],
  },
  {
    channel: 'Online Banking Enterprise / Integration Channel',
    finding:
      'A Zambia payment CSV layout is published. The Integration Channel advertises API and host-to-host services but includes regional content; Zambia eligibility needs written confirmation.',
    nextStep:
      'Ask the Zambia relationship manager for local API/H2H availability, an implementation contact and file certification.',
    sources: [
      {
        title: 'FNB Integration Channel',
        uri: 'https://www.online.fnbzambia.co.zm/integration-channel/index.html',
      },
      {
        title: 'FNB Zambia payment CSV guide',
        uri: 'https://www.online.fnb.co.za/rhelp_0_81/OBE_ZAMBIA_Downloads/Downloads/Payments/Payment_CSV_Imports_Help_Guide_Zambia.pdf',
      },
    ],
  },
  {
    channel: 'Indo NXT Corporate Banking',
    finding:
      'Indo-Zambia Bank documents corporate transfers, account monitoring and electronic statements.',
    nextStep:
      'Request current bulk salary files, statement exports, approval rules and integration options.',
    sources: [
      {
        title: 'Indo NXT Corporate Banking',
        uri: 'https://www.izb.co.zm/NetBanking',
      },
    ],
  },
  {
    channel: 'Business Online / bank-led integration',
    finding:
      'Stanbic Zambia documents accounting-system integration, payments, reporting and multiple transaction authentication.',
    nextStep:
      'Ask Business Online support for Zambia ERP/host-to-host specifications, test access and account entitlements.',
    sources: [
      {
        title: 'Stanbic Zambia Business Online',
        uri: 'https://www.stanbicbank.co.zm/zambia/business/ways-to-bank/business-online',
      },
    ],
  },
  {
    channel: 'Straight2Bank',
    finding:
      'Standard Chartered Zambia documents payroll file mapping, bulk debits, reporting and multi-tier authorisation.',
    nextStep:
      'Request Straight2Bank Connect/API eligibility for Zambia, agreed file schemas, statement feeds and testing requirements.',
    sources: [
      {
        title: 'Straight2Bank Zambia',
        uri: 'https://www.sc.com/zm/business/straight2bank/',
      },
    ],
  },
  {
    channel: 'UBA Business Direct',
    finding:
      'UBA Zambia describes corporate cash-management access, account monitoring and transfers to other banks.',
    nextStep:
      'Ask the local corporate-banking team for salary batch specifications, statement exports and integration eligibility.',
    sources: [
      {
        title: 'UBA Zambia internet banking',
        uri: 'https://www.ubazambia.com/personal-banking/digital-banking/internet-banking/',
      },
    ],
  },
  {
    channel: 'Corporate Internet Banking',
    finding:
      'ZICB documents salary processing, batch supplier payments, domestic interbank transfers and multi-level authorisation.',
    nextStep:
      'Request the corporate salary template, statement format and any direct integration specifications.',
    sources: [
      {
        title: 'ZICB corporate internet banking',
        uri: 'https://www.zicb.co.zm/corporate-internet-banking/',
      },
    ],
  },
  {
    channel: 'Internet Banking / PayFlexi / host-to-host',
    finding:
      'Zanaco documents host-to-host ERP payments. PayFlexi supports bulk salaries to accounts across Zambia.',
    nextStep:
      'Ask the business-banking team for H2H onboarding, PayFlexi schemas, statement delivery and sandbox/certification requirements.',
    sources: [
      {
        title: 'Zanaco Internet Banking',
        uri: 'https://www.zanaco.co.zm/ways-to-bank/internet-banking/',
      },
      {
        title: 'Zanaco electronic banking and PayFlexi',
        uri: 'https://www.zanaco.co.zm/business-banking/electronic-banking/',
      },
    ],
  },
];

export const bankCatalog = bankNames.map((name, index) => ({
  name,
  ...evidence[index]!,
  connectionStatus: 'not_connected',
  reviewedOn: '2026-09-07',
}));
export const bankRegisterSource =
  'https://www.boz.zm/Public_Notice_Deposit_Insurance_Scheme.pdf';
export const bankOnboardingRequirements = [
  'A business funding account and the bank’s mandate for each employer using ZamPayroll.',
  'The bank’s application, business verification documents, authorised signatories and payment approval limits.',
  'Written Zambia/ZMW eligibility for salary payments, interbank transfers, account feeds and third-party payroll software.',
  'Approved API or host-to-host specifications, test access, payment schemas and itemised statement samples.',
  'The bank’s required authentication and secure exchange of credentials or certificates, kept on the server.',
  'Agreed fees, transaction limits, cut-off times, settlement windows, returns and support contacts.',
  'Bank testing and production approval, including duplicate requests, partial failures and reconciliation.',
];
export function bankRequestBrief(name: string) {
  const bank = bankCatalog.find((item) => item.name === name);
  if (!bank) throw new Error('Unknown bank');
  return `ZamPayroll — banking integration request\nBank: ${name}\nPrepared: 7 September 2026\n\nCompany legal name: [complete]\nRelationship manager / application reference: [complete]\n\nWe are implementing a multi-company payroll application for Zambian employers. Each employer will use its own authorised funding account. Please confirm access for salary payments to accounts at your bank and other Zambian banks, and account statements for reconciliation.\n\nChannel to discuss: ${bank.channel}\n${bank.nextStep}\n\nPlease provide:\n${bankOnboardingRequirements.map((line, index) => `${index + 1}. ${line}`).join('\n')}\n\nTechnical questions:\n- API, host-to-host/SFTP or approved file-upload options available specifically in Zambia.\n- Per-employer mandates and account-level permissions; third-party software/vendor onboarding and any applicable regulatory requirements.\n- Sandbox endpoints, current API/schema versions, sample request/response and bank file layouts.\n- Authentication, signing/encryption, certificates, IP allowlists and credential rotation as applicable to your channel.\n- Payment idempotency and status lookup; a timed-out submission must be queried before any retry.\n- Bulk debit itemisation, stable end-to-end references, returned/reversed payments and partial batch results.\n- Statement formats (CSV, MT940, camt.053 or others), supported versions, balance/transaction feeds and callback verification.\n- Maker/checker approval, corporate mandates, daily limits, cut-offs, fees and production acceptance.\n\nWe will complete bank certification before enabling live initiation. Please share technical access through your approved secure channel, not by sending internet-banking passwords.\n\nPublic references reviewed:\n${bank.sources.map((source) => `${source.title}: ${source.uri}`).join('\n')}\n\nThis is a request brief for the company to send. ZamPayroll has not submitted a bank application.\n`;
}

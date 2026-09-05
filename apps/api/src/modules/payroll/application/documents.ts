import { fileURLToPath } from 'node:url';
import type { PreparedInput } from './preparation.js';
import { money } from './preparation.js';
import type { PayrollCalculationOutcome } from '../calculation/types.js';
import { formatMoney } from '../../../shared/domain/money.js';

export interface DocumentEntry {
  input: PreparedInput;
  outcome: PayrollCalculationOutcome;
}
export type DocumentKind =
  'register' | 'paye' | 'napsa' | 'nhima' | 'payments' | 'payslips';
export function csv(rows: (string | { amount: string })[][]): string {
  return (
    rows
      .map((row) =>
        row
          .map((value) => {
            const numeric = typeof value !== 'string';
            let text = numeric ? value.amount : value;
            if (!numeric && /^[\s]*[=+@-]/u.test(text)) text = `'${text}`;
            return `"${text.replaceAll('"', '""')}"`;
          })
          .join(','),
      )
      .join('\r\n') + '\r\n'
  );
}
export function reportCsv(kind: DocumentKind, entries: DocumentEntry[]) {
  const base = ['Employee number', 'Employee name'];
  const headers =
    kind === 'paye'
      ? [...base, 'TPIN', 'Taxable income (ZMW)', 'PAYE (ZMW)']
      : kind === 'napsa' || kind === 'nhima'
        ? [
            ...base,
            `${kind.toUpperCase()} number`,
            'Employee contribution (ZMW)',
            'Employer contribution (ZMW)',
          ]
        : kind === 'payments'
          ? [
              ...base,
              'Bank',
              'Account name',
              'Account number',
              'Branch code',
              'Payment date',
              'Net pay (ZMW)',
            ]
          : [
              ...base,
              'Gross (ZMW)',
              'Taxable (ZMW)',
              'PAYE (ZMW)',
              'NAPSA (ZMW)',
              'NHIMA (ZMW)',
              'Other deductions (ZMW)',
              'Net pay (ZMW)',
              'Employer contributions (ZMW)',
              'Employer cost (ZMW)',
            ];
  const rows = entries.map(({ input: i, outcome: o }) => {
    const identity = [i.identity.employeeNumber, i.identity.name];
    const amount = (minor: bigint) => ({ amount: formatMoney(money(minor)) });
    const employer = o.employerContributions.reduce(
      (s, c) => s + c.amount.minorUnits,
      0n,
    );
    if (kind === 'paye')
      return [
        ...identity,
        i.identity.details.tpin,
        amount(o.taxableIncome.minorUnits),
        amount(o.paye.minorUnits),
      ];
    if (kind === 'napsa' || kind === 'nhima')
      return [
        ...identity,
        i.identity.details[kind === 'napsa' ? 'napsaNumber' : 'nhimaNumber'],
        amount(o[kind].minorUnits),
        amount(
          o.employerContributions.find(
            (c) => c.code === `${kind.toUpperCase()}-EMPLOYER`,
          )?.amount.minorUnits ?? 0n,
        ),
      ];
    if (kind === 'payments')
      return [
        ...identity,
        i.identity.details.bankName,
        i.identity.details.accountName,
        i.identity.details.accountNumber,
        i.identity.details.branchCode,
        i.period.paymentDate,
        amount(o.netPay.minorUnits),
      ];
    return [
      ...identity,
      ...(
        [
          'grossPay',
          'taxableIncome',
          'paye',
          'napsa',
          'nhima',
          'otherDeductions',
          'netPay',
        ] as const
      ).map((k) => amount(o[k].minorUnits)),
      amount(employer),
      amount(employer + o.grossPay.minorUnits),
    ];
  });
  return csv([headers, ...rows]);
}
export async function payrollPdf(
  kind: 'payslips' | 'register',
  entries: DocumentEntry[],
  code: string,
): Promise<Buffer> {
  const { default: PDFDocument } = await import('pdfkit');
  const doc = new PDFDocument({
    size: 'A4',
    margin: 48,
    autoFirstPage: false,
    info: {
      Title: `${kind === 'payslips' ? 'Payslips' : 'Payroll register'} — ${code}`,
      Author: 'ZamPayroll',
    },
  });
  doc.registerFont(
    'Payroll',
    fileURLToPath(
      new URL('../../../../assets/fonts/DejaVuSans.ttf', import.meta.url),
    ),
  );
  doc.registerFont(
    'Payroll-Bold',
    fileURLToPath(
      new URL('../../../../assets/fonts/DejaVuSans-Bold.ttf', import.meta.url),
    ),
  );
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  for (const { input: i, outcome: o } of entries) {
    doc.addPage();
    doc
      .fillColor('#193b34')
      .font('Payroll-Bold')
      .fontSize(19)
      .text(i.identity.companyName);
    doc
      .fillColor('#53615c')
      .font('Payroll')
      .fontSize(10)
      .text(i.identity.employerDetails.address ?? '');
    doc
      .moveDown()
      .fontSize(10)
      .text(
        kind === 'payslips'
          ? 'CONFIDENTIAL · EMPLOYEE PAYSLIP'
          : 'PAYROLL REGISTER · EMPLOYEE DETAIL',
      );
    doc.fillColor('#182924').fontSize(16).text(code).moveDown();
    doc.fontSize(11).font('Payroll-Bold').text(i.identity.name).font('Payroll');
    doc.text(`${i.identity.employeeNumber} · ${i.identity.positionTitle}`);
    doc.text(
      `Period: ${i.period.startsOn} to ${i.period.endsOn}    Pay date: ${i.period.paymentDate}`,
    );
    doc
      .fontSize(9)
      .text(
        `TPIN: ${i.identity.details.tpin || 'Not recorded'}   NAPSA: ${i.identity.details.napsaNumber || 'Not recorded'}   NHIMA: ${i.identity.details.nhimaNumber || 'Not recorded'}`,
      );
    doc.moveDown();
    for (const group of [
      'earning',
      'statutory_deduction',
      'other_deduction',
      'employer_contribution',
    ] as const) {
      const lines = o.breakdown.filter((line) => line.kind === group);
      doc.x = 48;
      if (!lines.length) continue;
      if (doc.y > 650) doc.addPage();
      doc
        .font('Payroll-Bold')
        .fontSize(10)
        .text(
          {
            earning: 'EARNINGS',
            statutory_deduction: 'STATUTORY DEDUCTIONS',
            other_deduction: 'OTHER DEDUCTIONS',
            employer_contribution: 'EMPLOYER CONTRIBUTIONS',
          }[group],
        )
        .moveDown(0.35);
      for (const line of lines) {
        if (doc.y > 710) doc.addPage();
        const y = doc.y;
        doc
          .font('Payroll')
          .text(line.code.replaceAll('_', ' ').replaceAll('-', ' '), 48, y, {
            width: 350,
          });
        doc.text(`ZMW ${formatMoney(line.amount)}`, 400, y, {
          width: 145,
          align: 'right',
        });
        doc.y = Math.max(doc.y, y + 18);
      }
      doc.moveDown(0.5);
    }
    if (doc.y > 630) doc.addPage();
    doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#cbd4ce').stroke();
    doc.moveDown();
    doc.x = 48;
    doc
      .font('Payroll-Bold')
      .fontSize(12)
      .text(`Gross pay: ZMW ${formatMoney(o.grossPay)}`);
    doc.fontSize(17).text(`Net pay: ZMW ${formatMoney(o.netPay)}`);
    doc
      .moveDown()
      .font('Payroll')
      .fontSize(8)
      .fillColor('#53615c')
      .text(
        `Finalized payroll record · Rules ${o.statutoryConfigurationVersion} · ${o.calculationVersion}. This document records payroll calculations; it is not proof of payment or statutory submission.`,
      );
  }
  doc.end();
  return result;
}

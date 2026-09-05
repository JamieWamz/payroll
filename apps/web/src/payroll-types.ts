export interface Money {
  amount: string;
  currency: string;
  scale: number;
}
export interface Run {
  id: string;
  code: string;
  status: 'draft' | 'calculated' | 'finalized';
  startsOn: string;
  endsOn: string;
  paymentDate: string;
  version: number;
  configurationVersion: string;
  finalizedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  calculatedAt: string | null;
  createdAt: string;
}
export interface Outcome {
  grossPay: Money;
  taxableIncome: Money;
  paye: Money;
  napsa: Money;
  nhima: Money;
  otherDeductions: Money;
  netPay: Money;
  employerContributions: { code: string; amount: Money }[];
  breakdown: { code: string; kind: string; amount: Money }[];
}
export interface RunDetail extends Run {
  employees: {
    id: string;
    identity: {
      name: string;
      employeeNumber: string;
      details?: Record<string, string>;
    } | null;
    outcome: Outcome | null;
  }[];
  totals: Record<string, Money>;
}
export interface Employee {
  id: string;
  employeeNumber: string;
  givenName: string;
  familyName: string;
  status: string;
  version: number;
  employments: Employment[];
}
export interface Employment {
  id: string;
  positionTitle: string;
  startsOn: string;
  endsOn: string | null;
  version: number;
}
export function currency(value: Money | undefined) {
  if (!value) return '—';
  const [whole, fraction = '00'] = value.amount.split('.');
  return `ZMW ${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
}
export function date(value: string) {
  return new Intl.DateTimeFormat('en-ZM', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Africa/Lusaka',
  }).format(new Date(value.length === 10 ? `${value}T12:00:00Z` : value));
}

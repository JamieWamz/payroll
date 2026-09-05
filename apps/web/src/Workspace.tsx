import { useEffect, useState } from 'react';
import { message, request, type Session } from './api';
import { DataTable, EntryForm, Loading, type Field } from './components';
import { useRemote } from './useRemote';
import { ExportWorkspace } from './exports';
import { Employees } from './Employees';
import { Payroll } from './Payroll';
import { Dashboard } from './Dashboard';
import { Reports, Filings } from './Reports';
import { Settings, StatutoryRules } from './Settings';

const pages = [
  'Overview',
  'People',
  'Payroll',
  'Payroll periods',
  'Gratuity',
  'Compliance',
  'Bank batches',
  'ZRA returns',
  'Reports',
  'Statutory rules',
  'Settings',
] as const;
export type Page = (typeof pages)[number];
interface Policy {
  id: string;
  name: string;
  policyReference: string;
  ratePercent: string;
  startsOn: string;
  endsOn: string | null;
  rowVersion: number;
}
export interface Configuration {
  id: string;
  version: string;
  status: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}
export interface Operation {
  id: string;
  kind: string;
  settings: Record<string, unknown>;
}
export interface Operations {
  resources?: {
    id: string;
    purpose: string;
    title: string;
    status: string;
    sourceUri: string;
    guideUri?: string;
  }[];
  items: Operation[];
  banks: { name: string; connectionStatus: string }[];
}
export interface CompanyProps {
  base: string;
  csrf: string;
}

export function Workspace({
  session,
  onLogout,
}: {
  session: Session;
  onLogout: () => void;
}) {
  const [companyId, setCompanyId] = useState(session.companies[0]?.id ?? '');
  const [page, setPage] = useState<Page>(() => readPage());
  useEffect(() => {
    const changed = () => setPage(readPage());
    window.addEventListener('hashchange', changed);
    window.addEventListener('popstate', changed);
    return () => {
      window.removeEventListener('hashchange', changed);
      window.removeEventListener('popstate', changed);
    };
  }, []);
  const navigate = (next: Page) => {
    window.history.pushState(null, '', `#${encodeURIComponent(next)}`);
    setPage(next);
  };
  const [error, setError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const company = session.companies.find((item) => item.id === companyId);
  return (
    <div className="workspace">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">Z</span>ZamPayroll
        </div>
        <label className="company-switch">
          COMPANY
          <select
            value={companyId}
            onChange={(event) => setCompanyId(event.target.value)}
          >
            {session.companies.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <p className="nav-label">WORKSPACE</p>
        <nav aria-label="Main navigation">
          {pages.map((item, index) => (
            <button
              key={item}
              aria-current={page === item ? 'page' : undefined}
              onClick={() => navigate(item)}
            >
              <span aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              {item}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <strong>{session.user.displayName}</strong>
          <small>{session.user.email}</small>
          <button
            className="secondary"
            disabled={loggingOut}
            onClick={() => {
              setLoggingOut(true);
              void request('/auth/logout', {
                method: 'POST',
                csrf: session.csrfToken,
              })
                .then(onLogout)
                .catch((failure: unknown) => setError(message(failure)))
                .finally(() => setLoggingOut(false));
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <main id="main" className="main-content">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">{company?.name ?? 'No active company'}</p>
            <h1>{page}</h1>
          </div>
          <span className="badge">ZMW · Zambia</span>
        </header>
        <p className="development-banner">
          Bank payments and direct statutory submission are not connected.
          Finalized payroll records and external filing statuses are tracked
          separately.
        </p>
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        {company ? (
          <CompanyPage
            key={`${company.id}:${page}`}
            page={page}
            base={`/companies/${company.id}`}
            csrf={session.csrfToken}
            navigate={navigate}
          />
        ) : (
          <p className="empty">
            Your account has no active company membership.
          </p>
        )}
      </main>
    </div>
  );
}

function readPage(): Page {
  let value: string;
  try {
    value = decodeURIComponent(window.location.hash.slice(1));
  } catch {
    return 'Overview';
  }
  return pages.includes(value as Page) ? (value as Page) : 'Overview';
}

function CompanyPage({
  page,
  navigate,
  ...props
}: CompanyProps & { page: Page; navigate: (page: Page) => void }) {
  if (page === 'People') return <Employees {...props} />;
  if (page === 'Payroll') return <Payroll {...props} />;
  if (page === 'Reports') return <Reports {...props} />;
  if (page === 'Settings') return <Settings {...props} />;
  if (page === 'Statutory rules') return <StatutoryRules {...props} />;
  if (page === 'Payroll periods') return <Periods {...props} />;
  if (page === 'Gratuity') return <Gratuity {...props} />;
  if (page === 'Compliance') return <Compliance {...props} />;
  if (page === 'ZRA returns')
    return (
      <>
        <Filings {...props} />
        <details className="advanced-section">
          <summary>PAYE export templates & reference guides</summary>
          <ExportWorkspace {...props} purpose="paye_return" />
        </details>
      </>
    );
  if (page === 'Bank batches')
    return <ExportWorkspace {...props} purpose="salary_batch" />;
  return <Dashboard {...props} navigate={navigate} />;
}

function Periods({ base, csrf }: CompanyProps) {
  const [revision, setRevision] = useState(0);
  const { data, error } = useRemote<{
    items: {
      code: string;
      kind: string;
      startsOn: string;
      endsOn: string;
      paymentDate: string;
    }[];
  }>(`${base}/payroll-periods?limit=100`, revision);
  return (
    <>
      <section className="card">
        <h2>Pay schedule</h2>
        <p className="muted">
          Latest 100 periods. Creating a period does not calculate or pay
          salaries.
        </p>
        {data ? (
          <DataTable
            columns={['Period', 'Type', 'Start', 'End', 'Pay date']}
            rows={data.items.map((item) => [
              item.code,
              item.kind === 'regular' ? 'Regular' : 'Off-cycle',
              item.startsOn,
              item.endsOn,
              item.paymentDate,
            ])}
          />
        ) : (
          <Loading error={error} />
        )}
      </section>
      <EntryForm
        title="Create a pay period"
        submit="Save pay period"
        fields={[
          { name: 'code', label: 'Period code', hint: 'For example: 2026-09' },
          {
            name: 'kind',
            label: 'Period type',
            options: [
              { value: 'regular', label: 'Regular' },
              { value: 'off_cycle', label: 'Off-cycle' },
            ],
          },
          { name: 'startsOn', label: 'Start date', type: 'date' },
          { name: 'endsOn', label: 'End date', type: 'date' },
          { name: 'paymentDate', label: 'Payment date', type: 'date' },
        ]}
        action={async (values) => {
          await request(`${base}/payroll-periods`, { csrf, body: values });
          setRevision((value) => value + 1);
          return 'Pay period saved.';
        }}
      />
    </>
  );
}

function Gratuity({ base, csrf }: CompanyProps) {
  const [revision, setRevision] = useState(0);
  const policies = useRemote<{ items: Policy[] }>(
    `${base}/gratuity-policies?limit=100`,
    revision,
  );
  const configurations = useRemote<{ items: Configuration[] }>(
    `${base}/statutory-configurations?status=verified&limit=100`,
  );
  const options = (policies.data?.items ?? []).map((item) => ({
    value: item.id,
    label: `${item.name} · ${item.ratePercent}% · ${item.startsOn}`,
  }));
  return (
    <>
      <p className="notice">
        Contract-expiry preview only. Confirm legal coverage, contract terms and
        applicable exemptions. Enter total basic pay actually earned during the
        contract—not the final month's salary. This preview does not post a
        benefit into payroll.
      </p>
      <section className="card">
        <h2>Company gratuity policies</h2>
        {policies.data ? (
          <DataTable
            columns={['Policy', 'Rate', 'From', 'To', 'Reference']}
            rows={policies.data.items.map((item) => [
              item.name,
              `${item.ratePercent}%`,
              item.startsOn,
              item.endsOn ?? 'Open-ended',
              item.policyReference,
            ])}
          />
        ) : (
          <Loading error={policies.error} />
        )}
      </section>
      <EntryForm
        title="Create a policy version"
        submit="Save gratuity policy"
        fields={[
          { name: 'name', label: 'Policy name', maxLength: 80 },
          {
            name: 'policyReference',
            label: 'Company policy / agreement reference',
          },
          {
            name: 'ratePercent',
            label: 'Gratuity rate (%)',
            hint: 'Up to two decimal places. Must meet the applicable minimum when previewed.',
          },
          { name: 'startsOn', label: 'Effective from', type: 'date' },
          {
            name: 'endsOn',
            label: 'Effective to (optional)',
            type: 'date',
            optional: true,
          },
        ]}
        action={async (values) => {
          await request(`${base}/gratuity-policies`, { csrf, body: values });
          setRevision((value) => value + 1);
          return 'Gratuity policy saved.';
        }}
      />
      <EntryForm
        title="End an existing policy"
        submit="End policy version"
        fields={[
          {
            name: 'policyId',
            label: 'Open policy',
            options: options.filter(
              (option) =>
                !policies.data?.items.find((item) => item.id === option.value)
                  ?.endsOn,
            ),
          },
          { name: 'endsOn', label: 'Last effective date', type: 'date' },
        ]}
        action={async (values) => {
          const policy = policies.data?.items.find(
            (item) => item.id === values['policyId'],
          );
          if (!policy) throw new Error('Select a policy.');
          await request(`${base}/gratuity-policies/${policy.id}/end`, {
            method: 'PATCH',
            csrf,
            body: {
              endsOn: values['endsOn'],
              expectedRowVersion: policy.rowVersion,
            },
          });
          setRevision((value) => value + 1);
          return 'Policy ended. A replacement must start after this date.';
        }}
      />
      {configurations.error && <Loading error={configurations.error} />}
      <EntryForm
        title="Preview contract-expiry gratuity"
        submit="Calculate preview"
        fields={[
          { name: 'policyId', label: 'Policy', options },
          configurationField(configurations.data?.items),
          { name: 'basicPayEarned', label: 'Total basic pay earned (ZMW)' },
          { name: 'contractEndsOn', label: 'Contract end', type: 'date' },
          { name: 'settlementDate', label: 'Settlement date', type: 'date' },
        ]}
        action={async ({ policyId, ...values }) => {
          const result = await request<{ amount: { amount: string } }>(
            `${base}/gratuity-policies/${policyId}/preview`,
            { csrf, body: values },
          );
          return `Preview gratuity: ZMW ${result.amount.amount}. No payment has been created.`;
        }}
      />
    </>
  );
}

function configurationField(items: Configuration[] | undefined): Field {
  return {
    name: 'statutoryConfigurationId',
    label: 'Verified statutory configuration',
    hint: 'Must include applicable labour evidence and rules.',
    options: (items ?? []).map((item) => ({
      value: item.id,
      label: `${item.version} · ${item.effectiveFrom}`,
    })),
  };
}

function Compliance({ base, csrf }: CompanyProps) {
  const [revision, setRevision] = useState(0);
  const operations = useRemote<Operations>(`${base}/operations`, revision);
  const configurations = useRemote<{ items: Configuration[] }>(
    `${base}/statutory-configurations?status=verified&limit=100`,
  );
  const profiles =
    operations.data?.items.filter(
      (item) => item.kind === 'compliance_profile',
    ) ?? [];
  return (
    <>
      <p className="notice">
        This check covers configured monthly basic-pay minimums only. It does
        not certify working hours, overtime, leave, notice, redundancy, contract
        classification or collective-agreement compliance. Industry orders and
        exemptions require an authorized review.
      </p>
      <section className="card">
        <h2>Industry & agreement profiles</h2>
        {operations.data ? (
          <DataTable
            columns={['Industry', 'Worker category', 'Agreement reference']}
            rows={profiles.map((item) => [
              String(item.settings['industry']),
              String(item.settings['workerCategory']),
              String(item.settings['agreementReference']),
            ])}
          />
        ) : (
          <Loading error={operations.error} />
        )}
      </section>
      {configurations.error && <Loading error={configurations.error} />}
      <EntryForm
        title="Save an industry profile"
        submit="Save profile"
        fields={[
          {
            name: 'industry',
            label: 'Industry',
            hint: 'Must match the reviewed rule exactly.',
          },
          { name: 'workerCategory', label: 'Worker category' },
          {
            name: 'agreementReference',
            label: 'Wage order / collective agreement reference',
          },
          configurationField(configurations.data?.items),
        ]}
        action={async (values) => {
          await request(`${base}/operations`, {
            csrf,
            body: { kind: 'compliance_profile', settings: values },
          });
          setRevision((value) => value + 1);
          return 'New profile version saved.';
        }}
      />
      <EntryForm
        title="Check monthly basic pay"
        submit="Check configured minimum"
        fields={[
          {
            name: 'profileId',
            label: 'Industry profile',
            options: profiles.map((item) => ({
              value: item.id,
              label: `${String(item.settings['industry'])} · ${String(item.settings['workerCategory'])}`,
            })),
          },
          { name: 'date', label: 'Assessment date', type: 'date' },
          {
            name: 'monthlyBasicPay',
            label: 'Monthly basic pay (ZMW)',
            hint: 'Use two decimal places, for example 5000.00.',
          },
        ]}
        action={async (values) => {
          const result = await request<{
            result: string;
            minimumMonthlyBasicPay: string;
          }>(`${base}/operations/compliance-preview`, { csrf, body: values });
          return `${result.result === 'meets_configured_minimum' ? 'Meets' : 'Below'} the configured monthly basic-pay minimum of ZMW ${result.minimumMonthlyBasicPay}. Other legal requirements have not been assessed.`;
        }}
      />
    </>
  );
}

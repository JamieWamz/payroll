import { useState } from 'react';
import { download, request, saveFile } from './api';
import { ActionButton, DataTable, EntryForm, Loading } from './components';
import { useRemote } from './useRemote';
import type { CompanyProps } from './Workspace';
import { currency, date, type Run, type RunDetail } from './payroll-types';

export function Reports({ base }: CompanyProps) {
  const { data, error } = useRemote<{ items: Run[] }>(
    `${base}/payroll-runs?limit=100`,
  );
  const [runId, setRunId] = useState('');
  const selected =
    runId || (data?.items.find((r) => r.status === 'finalized')?.id ?? '');
  return (
    <>
      <p className="page-description">
        Reports reconcile to finalized payroll. All values are in Zambian
        kwacha.
      </p>
      <section className="card">
        <label>
          Payroll period
          <select value={selected} onChange={(e) => setRunId(e.target.value)}>
            <option value="">Select finalized payroll</option>
            {data?.items
              .filter((r) => r.status === 'finalized')
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code} · {date(r.paymentDate)}
                </option>
              ))}
          </select>
        </label>
        {!data && <Loading error={error} />}
      </section>
      {selected ? (
        <ReportDetail key={selected} base={base} runId={selected} />
      ) : (
        <p className="empty">
          Finalize a payroll run to generate payslips, payroll registers and
          statutory schedules.
        </p>
      )}
      <EntryForm
        title="Annual employee tax summary"
        submit="Download annual CSV"
        fields={[
          {
            name: 'year',
            label: 'Tax year',
            defaultValue: String(new Date().getFullYear()),
          },
        ]}
        action={async (values) => {
          await download(
            `${base}/annual-tax?year=${encodeURIComponent(values.year!)}`,
            `annual-tax-${values.year}.csv`,
          );
          return 'Annual summary downloaded.';
        }}
      >
        <p className="muted">
          P9 reconciliation support: includes finalized payroll in this system,
          with period counts. Opening balances are excluded. This is an annual
          working paper, not an official P9 form.
        </p>
      </EntryForm>
    </>
  );
}
function ReportDetail({ base, runId }: { base: string; runId: string }) {
  const { data, error } = useRemote<RunDetail>(`${base}/payroll-runs/${runId}`);
  if (!data) return <Loading error={error} />;
  return (
    <>
      <div className="metrics">
        {[
          ['Gross', 'grossPay'],
          ['Net pay', 'netPay'],
          ['Employer contributions', 'employerContributions'],
          ['Employer cost', 'employerCost'],
        ].map(([label, key]) => (
          <div key={key}>
            <span>{label}</span>
            <strong>{currency(data.totals[key!])}</strong>
          </div>
        ))}
      </div>
      <section className="card">
        <h2>Available documents · {data.code}</h2>
        <DataTable
          columns={['Report', 'Purpose', 'Download']}
          rows={[
            [
              'Payroll register',
              'Employee earnings, deductions and employer costs',
              <div className="inline-actions">
                <ActionButton
                  action={() =>
                    download(
                      `${base}/payroll-runs/${runId}/documents/register`,
                      'payroll-register.csv',
                    )
                  }
                >
                  CSV
                </ActionButton>
                <ActionButton
                  action={() =>
                    download(
                      `${base}/payroll-runs/${runId}/documents/register?format=pdf`,
                      'payroll-register.pdf',
                    )
                  }
                >
                  PDF
                </ActionButton>
              </div>,
            ],
            [
              'Employee payslips',
              'Confidential individual pages for each employee',
              <ActionButton
                action={() =>
                  download(
                    `${base}/payroll-runs/${runId}/documents/payslips`,
                    'payslips.pdf',
                  )
                }
              >
                PDF
              </ActionButton>,
            ],
            ...(['paye', 'napsa', 'nhima', 'payments'] as const).map((kind) => [
              kind === 'payments'
                ? 'Payment instructions'
                : `${kind.toUpperCase()} schedule`,
              kind === 'payments'
                ? 'Review net amounts and bank instructions; not a certified bank upload'
                : 'Reconciliation schedule; confirm the authority’s upload layout',
              <ActionButton
                action={() =>
                  download(
                    `${base}/payroll-runs/${runId}/documents/${kind}`,
                    `${kind}-schedule.csv`,
                  )
                }
              >
                CSV
              </ActionButton>,
            ]),
          ]}
        />
      </section>
      <section className="card">
        <h2>Payroll register preview</h2>
        <DataTable
          columns={['Employee', 'Gross', 'PAYE', 'NAPSA', 'NHIMA', 'Net pay']}
          rows={data.employees.map((e) => [
            e.identity?.name,
            currency(e.outcome?.grossPay),
            currency(e.outcome?.paye),
            currency(e.outcome?.napsa),
            currency(e.outcome?.nhima),
            currency(e.outcome?.netPay),
          ])}
        />
      </section>
    </>
  );
}
interface FilingEvent {
  id: string;
  authority: string;
  status: string;
  reference: string | null;
  notes: string;
  createdAt: string;
  recordedBy: string;
}
export function Filings({ base, csrf }: CompanyProps) {
  const runs = useRemote<{ items: Run[] }>(`${base}/payroll-runs?limit=100`);
  const [selected, setSelected] = useState('');
  const id =
    selected ||
    (runs.data?.items.find((r) => r.status === 'finalized')?.id ?? '');
  return (
    <>
      <section className="card">
        <div className="section-heading">
          <div>
            <h2>Statutory filing register</h2>
            <p>
              Generate a review schedule, submit through the authority’s portal,
              then record its reference and response.
            </p>
          </div>
          <span className="badge">Manual submission</span>
        </div>
        <p className="notice">
          Direct submission is not connected. Generated files are reconciliation
          schedules; the TaxOnline upload format has not been certified. A
          recorded submission or acceptance is an operator attestation of an
          external action.
        </p>
        <label>
          Finalized payroll
          <select value={id} onChange={(e) => setSelected(e.target.value)}>
            <option value="">Select payroll</option>
            {runs.data?.items
              .filter((r) => r.status === 'finalized')
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code}
                </option>
              ))}
          </select>
        </label>
      </section>
      {!runs.data && <Loading error={runs.error} />}{' '}
      {id ? (
        <FilingDetail key={id} base={base} csrf={csrf} runId={id} />
      ) : (
        <p className="empty">
          Finalize payroll to prepare statutory schedules and track filing
          history.
        </p>
      )}
    </>
  );
}
function FilingDetail({ base, csrf, runId }: CompanyProps & { runId: string }) {
  const [revision, setRevision] = useState(0);
  const [authority, setAuthority] = useState('zra');
  const path = `${base}/payroll-runs/${runId}/filings`;
  const { data, error } = useRemote<{
    items: FilingEvent[];
    readiness: Record<string, string[]>;
  }>(path, revision);
  if (!data) return <Loading error={error} />;
  const latest = data.items.find((e) => e.authority === authority);
  return (
    <>
      <section className="card">
        <DataTable
          columns={['Authority', 'Readiness', 'Filing status', '']}
          rows={['zra', 'napsa', 'nhima'].map((a) => {
            const event = data.items.find((e) => e.authority === a);
            const missing = data.readiness[a] ?? [];
            return [
              a === 'zra' ? 'ZRA · PAYE' : a.toUpperCase(),
              missing.length
                ? missing.join('; ')
                : 'Required identifiers recorded',
              <span className={`badge ${event?.status ?? 'draft'}`}>
                {event?.status ??
                  (missing.length ? 'Requires attention' : 'Ready')}
              </span>,
              <ActionButton
                disabled={
                  !!missing.length ||
                  event?.status === 'accepted' ||
                  event?.status === 'submitted'
                }
                action={async () => {
                  const result = await request<{ file: string }>(
                    `${path}/${a}`,
                    {
                      csrf,
                      body: {
                        status: 'generated',
                        attestation: true,
                        expectedEventId: event?.id ?? null,
                      },
                    },
                  );
                  saveFile(result.file, `${a}-review-schedule.csv`);
                  setRevision((v) => v + 1);
                }}
              >
                Generate schedule
              </ActionButton>,
            ];
          })}
        />
      </section>
      <label className="section-selector">
        Record an external filing update for
        <select
          value={authority}
          onChange={(e) => setAuthority(e.target.value)}
        >
          <option value="zra">ZRA · PAYE</option>
          <option value="napsa">NAPSA</option>
          <option value="nhima">NHIMA</option>
        </select>
      </label>
      <EntryForm
        key={`${authority}:${revision}`}
        title="Record portal reference or response"
        submit="Save filing record"
        fields={[
          {
            name: 'status',
            label: 'External status',
            options: [
              { value: 'submitted', label: 'Submitted externally' },
              { value: 'accepted', label: 'Accepted by authority' },
              { value: 'rejected', label: 'Rejected by authority' },
              { value: 'failed', label: 'Submission failed' },
              { value: 'requires_attention', label: 'Requires attention' },
            ],
          },
          {
            name: 'reference',
            label: 'External reference number',
            hint: 'Required for submitted, accepted and rejected records.',
            optional: true,
          },
          {
            name: 'notes',
            label: 'Notes / response details',
            optional: true,
            rows: 3,
            maxLength: 1000,
          },
        ]}
        action={async (values) => {
          await request(`${path}/${authority}`, {
            csrf,
            body: {
              ...values,
              expectedEventId: latest?.id ?? null,
              attestation: true,
            },
          });
          setRevision((v) => v + 1);
          return 'External filing record saved.';
        }}
      >
        <label className="review-confirmation">
          <input type="checkbox" required />I confirm this status matches the
          external portal or authority response.
        </label>
      </EntryForm>
      <section className="card">
        <h2>Filing history</h2>
        <DataTable
          columns={[
            'Recorded',
            'Authority',
            'Status',
            'Reference',
            'Notes',
            'Recorded by',
          ]}
          rows={data.items.map((e) => [
            date(e.createdAt),
            e.authority.toUpperCase(),
            e.status,
            e.reference ?? '—',
            e.notes || '—',
            <span title={e.recordedBy}>
              Membership {e.recordedBy.slice(0, 8)}
            </span>,
          ])}
          empty="No files generated or external submissions recorded for this payroll."
        />
      </section>
    </>
  );
}

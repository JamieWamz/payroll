import { useState } from 'react';
import { download, request } from './api';
import { ActionButton, DataTable, EntryForm, Loading } from './components';
import { useRemote } from './useRemote';
import type { CompanyProps, Configuration } from './Workspace';
import {
  currency,
  date,
  type Employee,
  type Run,
  type RunDetail,
} from './payroll-types';

export function Payroll({ base, csrf }: CompanyProps) {
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState('');
  const [create, setCreate] = useState(false);
  const { data, error } = useRemote<{ items: Run[] }>(
    `${base}/payroll-runs?limit=100`,
    revision,
  );
  if (selected)
    return (
      <PayrollReview
        key={selected}
        base={base}
        csrf={csrf}
        runId={selected}
        back={() => {
          setSelected('');
          setRevision((v) => v + 1);
        }}
      />
    );
  return (
    <>
      <div className="page-intro">
        <p>
          Prepare monthly pay, review each deduction and finalize a permanent
          payroll record.
        </p>
        <button onClick={() => setCreate(!create)}>
          {create ? 'Close preparation' : 'Prepare payroll'}
        </button>
      </div>
      {create && <PreparePayroll base={base} csrf={csrf} done={setSelected} />}
      <section className="card">
        <div className="section-heading">
          <h2>Payroll runs</h2>
          <span className="muted">Latest 100 periods · ZMW</span>
        </div>
        {data ? (
          <DataTable
            columns={[
              'Payroll period',
              'Pay date',
              'Status',
              'Last action',
              '',
            ]}
            rows={data.items.map((r) => [
              <strong>{r.code}</strong>,
              date(r.paymentDate),
              <span className={`badge ${r.status}`}>
                {r.cancelledAt
                  ? 'Cancelled'
                  : r.status === 'calculated'
                    ? 'Ready for review'
                    : r.status}
              </span>,
              date(r.finalizedAt ?? r.calculatedAt ?? r.createdAt),
              <button className="text-button" onClick={() => setSelected(r.id)}>
                {r.status === 'finalized' ? 'View payroll' : 'Review payroll'} →
              </button>,
            ])}
            empty="Your first payroll starts here. Set up employees, monthly salaries and verified statutory rules, then choose Prepare payroll."
          />
        ) : (
          <Loading error={error} />
        )}
      </section>
    </>
  );
}
function PreparePayroll({
  base,
  csrf,
  done,
}: CompanyProps & { done: (id: string) => void }) {
  const periods = useRemote<{ items: (Run & { kind: string })[] }>(
    `${base}/payroll-periods?limit=100`,
  );
  const configurations = useRemote<{ items: Configuration[] }>(
    `${base}/statutory-configurations?status=verified&limit=100`,
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [employeePage, setEmployeePage] = useState(0);
  const people = useRemote<{ items: Employee[] }>(
    `${base}/employees?status=active&limit=100&offset=${employeePage * 100}`,
  );
  return (
    <EntryForm
      title="1. Choose period and employees"
      submit={`Create draft · ${selected.length} employees`}
      fields={[
        {
          name: 'payrollPeriodId',
          label: 'Payroll period',
          options: (periods.data?.items ?? [])
            .filter((p) => p.kind === 'regular')
            .map((p) => ({
              value: p.id,
              label: `${p.code} · ${p.startsOn} to ${p.endsOn}`,
            })),
        },
        {
          name: 'statutoryConfigurationId',
          label: 'Verified statutory rules',
          options: (configurations.data?.items ?? []).map((c) => ({
            value: c.id,
            label: `${c.version} · from ${c.effectiveFrom}`,
          })),
        },
      ]}
      action={async (values) => {
        if (!selected.length) throw new Error('Select at least one employee.');
        const run = await request<{ id: string }>(`${base}/payroll-runs`, {
          csrf,
          body: { ...values, employeeIds: selected },
        });
        done(run.id);
        return 'Draft created.';
      }}
    >
      <div className="full-width">
        <p className="muted">
          The period must be a full calendar month. Set up missing periods under
          Payroll periods and verify rules under Statutory rules.
        </p>
        {periods.error && <Loading error={periods.error} />}{' '}
        {configurations.error && <Loading error={configurations.error} />}{' '}
        {configurations.data && !configurations.data.items.length && (
          <p className="notice">
            No verified rules available. Add sourced rules and record reviewer
            verification before creating a payroll run.
          </p>
        )}
        <div className="section-heading">
          <h3>Employees included</h3>
          <button
            className="text-button"
            type="button"
            onClick={() =>
              setSelected((current) => [
                ...new Set([
                  ...current,
                  ...(people.data?.items ?? []).map((e) => e.id),
                ]),
              ])
            }
          >
            Select this page
          </button>
        </div>
        {people.data ? (
          <>
            <div className="selection-list">
              {people.data.items.map((e) => (
                <label className="selection-row" key={e.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(e.id)}
                    onChange={(event) =>
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, e.id]
                          : current.filter((id) => id !== e.id),
                      )
                    }
                  />
                  <span>
                    <strong>
                      {e.givenName} {e.familyName}
                    </strong>
                    <small>{e.employeeNumber}</small>
                  </span>
                </label>
              ))}
            </div>
            <div className="pagination">
              <button
                type="button"
                className="secondary"
                disabled={!employeePage}
                onClick={() => setEmployeePage((v) => v - 1)}
              >
                Previous employees
              </button>
              <button
                type="button"
                className="secondary"
                disabled={people.data.items.length < 100}
                onClick={() => setEmployeePage((v) => v + 1)}
              >
                More employees
              </button>
              <span>{selected.length} selected across pages</span>
            </div>
          </>
        ) : (
          <Loading error={people.error} />
        )}
      </div>
    </EntryForm>
  );
}
function PayrollReview({
  base,
  csrf,
  runId,
  back,
}: CompanyProps & { runId: string; back: () => void }) {
  const [revision, setRevision] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [employee, setEmployee] = useState('');
  const path = `${base}/payroll-runs/${runId}`;
  const { data, error } = useRemote<RunDetail>(path, revision);
  if (!data) return <Loading error={error} />;
  const finalized = data.status === 'finalized';
  const cancelled = !!data.cancelledAt;
  const calculated = data.status === 'calculated' && !cancelled;
  const detail = data.employees.find((e) => e.id === employee);
  return (
    <>
      <button className="text-button" onClick={back}>
        ← Payroll runs
      </button>
      <div className="page-intro">
        <div>
          <h2>{data.code}</h2>
          <p>
            {date(data.startsOn)} – {date(data.endsOn)} · Pay date{' '}
            {date(data.paymentDate)}
          </p>
        </div>
        <span className={`badge ${data.status}`}>
          {cancelled
            ? 'Cancelled'
            : finalized
              ? 'Finalized'
              : calculated
                ? 'Ready for review'
                : 'Draft'}
        </span>
      </div>
      <ol className="workflow-steps">
        <li className="done">1. Prepare</li>
        <li className={calculated || finalized ? 'done' : ''}>
          2. Calculate & review
        </li>
        <li className={finalized ? 'done' : ''}>3. Finalize</li>
        <li>4. Documents & filing</li>
      </ol>
      {data.status !== 'draft' && (
        <div className="metrics">
          {[
            ['Net payroll', 'netPay'],
            ['Gross earnings', 'grossPay'],
            ['PAYE liability', 'paye'],
            ['Total employer cost', 'employerCost'],
          ].map(([label, key]) => (
            <div key={key}>
              <span>{label}</span>
              <strong>{currency(data.totals[key!])}</strong>
            </div>
          ))}
        </div>
      )}
      <section className="card">
        <div className="section-heading">
          <div>
            <h2>
              {data.employees.length}{' '}
              {data.employees.length === 1 ? 'employee' : 'employees'} included
            </h2>
            <p className="muted">
              Rules: {data.configurationVersion}. Amounts are calculated by the
              payroll engine.
            </p>
          </div>
          {!finalized && !cancelled && (
            <ActionButton
              className="primary"
              action={async () => {
                await request(`${path}/calculate`, {
                  csrf,
                  body: { expectedVersion: data.version },
                });
                setConfirmed(false);
                setRevision((v) => v + 1);
              }}
            >
              {calculated ? 'Recalculate payroll' : 'Calculate payroll'}
            </ActionButton>
          )}
        </div>
        <DataTable
          columns={[
            'Employee',
            'Gross',
            'PAYE',
            'NAPSA',
            'NHIMA',
            'Other',
            'Net pay',
            '',
          ]}
          rows={data.employees.map((e) => [
            <div>
              <strong>{e.identity?.name ?? e.id}</strong>
              <small>{e.identity?.employeeNumber}</small>
            </div>,
            currency(e.outcome?.grossPay),
            currency(e.outcome?.paye),
            currency(e.outcome?.napsa),
            currency(e.outcome?.nhima),
            currency(e.outcome?.otherDeductions),
            <strong>{currency(e.outcome?.netPay)}</strong>,
            <button
              className="text-button"
              disabled={!e.outcome}
              onClick={() => setEmployee(employee === e.id ? '' : e.id)}
            >
              Breakdown
            </button>,
          ])}
        />
        {detail?.outcome && (
          <div className="breakdown">
            <div className="section-heading">
              <h3>{detail.identity?.name} · Calculation detail</h3>
              <button className="text-button" onClick={() => setEmployee('')}>
                Close breakdown
              </button>
            </div>
            <DataTable
              columns={['Component', 'Treatment', 'Amount']}
              rows={detail.outcome.breakdown.map((line) => [
                line.code,
                line.kind.replaceAll('_', ' '),
                currency(line.amount),
              ])}
            />
          </div>
        )}
      </section>
      {data.status === 'draft' && !cancelled && (
        <p className="notice">
          Calculate payroll to check salary coverage, component treatments and
          cumulative tax history. Resolve any employee issues in People, then
          calculate again.
        </p>
      )}
      {calculated && (
        <section className="review-panel">
          <div>
            <h2>Approve this payroll record</h2>
            <p>
              Review earnings, deductions, opening tax balances and employee
              identifiers. Finalization locks these amounts and enables payslips
              and reports.
            </p>
            <label className="review-confirmation">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I have reviewed this payroll and its statutory deductions.
            </label>
          </div>
          <ActionButton
            disabled={!confirmed}
            className="primary"
            action={async () => {
              await request(`${path}/finalize`, {
                csrf,
                body: { expectedVersion: data.version, confirmed: true },
              });
              setRevision((v) => v + 1);
            }}
          >
            Finalize payroll
          </ActionButton>
        </section>
      )}
      {cancelled && (
        <p className="notice">
          Cancelled payroll: {data.cancellationReason}. Its evidence is
          retained. Prepare a replacement run for the same period.
        </p>
      )}
      {!finalized && !cancelled && (
        <details className="advanced-section">
          <summary>Cancel and prepare a replacement</summary>
          <EntryForm
            title="Cancel this payroll"
            submit="Cancel payroll run"
            fields={[
              {
                name: 'reason',
                label: 'Reason for cancellation',
                maxLength: 500,
              },
            ]}
            action={async (values) => {
              await request(`${path}/cancel`, {
                csrf,
                body: { reason: values.reason, expectedVersion: data.version },
              });
              setRevision((v) => v + 1);
              return 'Payroll cancelled.';
            }}
          >
            <p className="muted">
              Use this to change employee selection or statutory configuration.
              Existing calculation evidence is retained; you can create a new
              run for this period.
            </p>
          </EntryForm>
        </details>
      )}
      {finalized && (
        <>
          <p className="notice success">
            Payroll finalized {date(data.finalizedAt!)}. Payment and statutory
            submission are separate steps.
          </p>
          <div className="button-row">
            <ActionButton
              action={() =>
                download(`${path}/documents/payslips`, 'payslips.pdf')
              }
            >
              Download payslips
            </ActionButton>
            <ActionButton
              action={() =>
                download(`${path}/documents/register`, 'payroll-register.csv')
              }
            >
              Payroll register CSV
            </ActionButton>
            <ActionButton
              action={() =>
                download(
                  `${path}/documents/payments`,
                  'payment-instructions.csv',
                )
              }
            >
              Payment instructions
            </ActionButton>
          </div>
          <p className="muted">
            Open Reports for statutory schedules, and ZRA returns to record
            external filing references.
          </p>
        </>
      )}
    </>
  );
}

import { useState } from 'react';
import { request, download } from './api';
import { ActionButton, DataTable, EntryForm, Loading } from './components';
import { useRemote } from './useRemote';
import type { CompanyProps } from './Workspace';
import {
  currency,
  date,
  type Employee,
  type Employment,
  type Money,
  type Run,
} from './payroll-types';

export function Employees({ base, csrf }: CompanyProps) {
  const [revision, setRevision] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('active');
  const [sort, setSort] = useState('name');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState('');
  const [adding, setAdding] = useState(false);
  const { data, error } = useRemote<{ items: Employee[] }>(
    `${base}/employees?limit=25&offset=${offset}&search=${encodeURIComponent(search)}&sort=${sort}${status ? `&status=${status}` : ''}`,
    revision,
  );
  if (selected)
    return (
      <EmployeeProfile
        key={selected}
        base={base}
        csrf={csrf}
        employeeId={selected}
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
          Employee records, employment history and payroll details in one place.
        </p>
        <button onClick={() => setAdding(!adding)}>
          {adding ? 'Close employee form' : 'Add employee'}
        </button>
      </div>
      {adding && (
        <EntryForm
          title="Add an employee"
          submit="Save employee"
          fields={[
            { name: 'employeeNumber', label: 'Employee number' },
            { name: 'givenName', label: 'First name' },
            { name: 'familyName', label: 'Last name' },
            { name: 'positionTitle', label: 'Job title' },
            { name: 'startsOn', label: 'Employment start', type: 'date' },
            {
              name: 'endsOn',
              label: 'Contract end (optional)',
              type: 'date',
              optional: true,
            },
          ]}
          action={async ({ positionTitle, startsOn, endsOn, ...values }) => {
            const employee = await request<{ id: string }>(
              `${base}/employees`,
              {
                csrf,
                body: {
                  ...values,
                  employment: {
                    positionTitle,
                    startsOn,
                    ...(endsOn ? { endsOn } : {}),
                  },
                },
              },
            );
            setSelected(employee.id);
            return 'Employee saved.';
          }}
        />
      )}
      <section className="card directory">
        <div className="toolbar">
          <label className="search-field">
            Search employees
            <input
              type="search"
              placeholder="Name or employee number"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setOffset(0);
              }}
            />
          </label>
          <label>
            Status
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setOffset(0);
              }}
            >
              <option value="active">Active</option>
              <option value="archived">Archived</option>
              <option value="">All employees</option>
            </select>
          </label>
          <label>
            Sort by
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value);
                setOffset(0);
              }}
            >
              <option value="name">Name</option>
              <option value="number">Employee number</option>
            </select>
          </label>
        </div>
        {data ? (
          <>
            <DataTable
              columns={['Employee', 'Employee number', 'Status', '']}
              rows={data.items.map((e) => [
                <button
                  className="employee-link"
                  onClick={() => setSelected(e.id)}
                >
                  <span className="avatar">
                    {e.givenName[0]}
                    {e.familyName[0]}
                  </span>
                  <strong>
                    {e.givenName} {e.familyName}
                  </strong>
                </button>,
                e.employeeNumber,
                <span className={`badge ${e.status}`}>{e.status}</span>,
                <button
                  className="text-button"
                  onClick={() => setSelected(e.id)}
                >
                  View profile →
                </button>,
              ])}
              empty={
                search
                  ? 'No employees match this search. Change the name or filters.'
                  : 'No employees in this view. Add an employee to prepare payroll.'
              }
            />
            <div className="pagination">
              <span>
                {data.items.length
                  ? `${offset + 1}–${offset + data.items.length}`
                  : '0'}{' '}
                employees shown
              </span>
              <button
                className="secondary"
                disabled={offset === 0}
                onClick={() => setOffset((v) => Math.max(0, v - 25))}
              >
                Previous
              </button>
              <button
                className="secondary"
                disabled={data.items.length < 25}
                onClick={() => setOffset((v) => v + 25)}
              >
                Next
              </button>
            </div>
          </>
        ) : (
          <Loading error={error} />
        )}
      </section>
    </>
  );
}
function EmployeeProfile({
  base,
  csrf,
  employeeId,
  back,
}: CompanyProps & { employeeId: string; back: () => void }) {
  const [revision, setRevision] = useState(0);
  const [tab, setTab] = useState('Personal');
  const employee = useRemote<Employee>(
    `${base}/employees/${employeeId}`,
    revision,
  );
  const reload = () => setRevision((v) => v + 1);
  if (!employee.data) return <Loading error={employee.error} />;
  const e = employee.data;
  return (
    <>
      <button className="text-button" onClick={back}>
        ← Employee directory
      </button>
      <section className="profile-heading">
        <span className="avatar large">
          {e.givenName[0]}
          {e.familyName[0]}
        </span>
        <div>
          <h2>
            {e.givenName} {e.familyName}
          </h2>
          <p>
            {e.employeeNumber} ·{' '}
            {e.employments[0]?.positionTitle ?? 'No employment recorded'}
          </p>
        </div>
        <span className={`badge ${e.status}`}>{e.status}</span>
      </section>
      <div className="tabs" role="tablist" aria-label="Employee sections">
        {[
          'Personal',
          'Employment',
          'Compensation',
          'Tax & banking',
          'Payroll history',
        ].map((t) => (
          <button
            role="tab"
            aria-selected={tab === t}
            key={t}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === 'Personal' && (
        <EntryForm
          key={revision}
          title="Personal information"
          submit="Save changes"
          fields={[
            {
              name: 'employeeNumber',
              label: 'Employee number',
              defaultValue: e.employeeNumber,
            },
            {
              name: 'givenName',
              label: 'First name',
              defaultValue: e.givenName,
            },
            {
              name: 'familyName',
              label: 'Last name',
              defaultValue: e.familyName,
            },
          ]}
          action={async (values) => {
            await request(`${base}/employees/${e.id}`, {
              csrf,
              method: 'PATCH',
              body: { ...values, expectedVersion: e.version },
            });
            reload();
            return 'Employee details saved.';
          }}
        />
      )}
      {tab === 'Employment' && (
        <>
          <section className="card">
            <h2>Employment history</h2>
            <DataTable
              columns={['Position', 'Start', 'End']}
              rows={e.employments.map((j) => [
                j.positionTitle,
                date(j.startsOn),
                j.endsOn ? date(j.endsOn) : 'Ongoing',
              ])}
            />
          </section>
          {e.employments
            .filter((j) => !j.endsOn)
            .map((j) => (
              <EntryForm
                key={j.id}
                title={`End employment · ${j.positionTitle}`}
                submit="Record employment end"
                fields={[
                  {
                    name: 'endsOn',
                    label: 'Last day of employment',
                    type: 'date',
                  },
                ]}
                action={async (values) => {
                  await request(
                    `${base}/employees/${e.id}/employments/${j.id}`,
                    {
                      csrf,
                      method: 'PATCH',
                      body: { ...values, expectedVersion: j.version },
                    },
                  );
                  reload();
                  return 'Employment end recorded.';
                }}
              >
                <p className="muted">
                  End salary and component histories first. Previous finalized
                  payroll remains available.
                </p>
              </EntryForm>
            ))}
          {e.status === 'active' && (
            <EntryForm
              title="Add employment"
              submit="Save employment"
              fields={[
                { name: 'positionTitle', label: 'Job title' },
                { name: 'startsOn', label: 'Start date', type: 'date' },
                {
                  name: 'endsOn',
                  label: 'Contract end',
                  type: 'date',
                  optional: true,
                },
              ]}
              action={async (values) => {
                await request(`${base}/employees/${e.id}/employments`, {
                  csrf,
                  body: values,
                });
                reload();
                return 'Employment saved.';
              }}
            />
          )}
          <ActionButton
            disabled={
              e.status === 'archived' || e.employments.some((j) => !j.endsOn)
            }
            action={async () => {
              await request(`${base}/employees/${e.id}`, {
                csrf,
                method: 'PATCH',
                body: { status: 'archived', expectedVersion: e.version },
              });
              reload();
            }}
          >
            Archive employee
          </ActionButton>
          <p className="muted">
            Archiving requires all employment records to have an end date.
          </p>
        </>
      )}
      {tab === 'Compensation' && (
        <>
          {e.employments.length ? (
            e.employments.map((j) => (
              <Compensation key={j.id} base={base} csrf={csrf} employment={j} />
            ))
          ) : (
            <p className="empty">Add employment before setting a salary.</p>
          )}
        </>
      )}
      {tab === 'Tax & banking' && (
        <EmployeeDetails base={base} csrf={csrf} employeeId={e.id} />
      )}
      {tab === 'Payroll history' && (
        <EmployeeHistory base={base} employeeId={e.id} />
      )}
    </>
  );
}
interface CompensationItem {
  id: string;
  amount: Money;
  startsOn: string;
  endsOn: string | null;
  version: number;
  code?: string;
  kind?: string;
  name?: string;
}
function Compensation({
  base,
  csrf,
  employment,
}: CompanyProps & { employment: Employment }) {
  const [revision, setRevision] = useState(0);
  const [ending, setEnding] = useState<{
    item: CompensationItem;
    kind: string;
  } | null>(null);
  const path = `${base}/employments/${employment.id}`;
  const { data, error } = useRemote<{
    salaries: CompensationItem[];
    components: CompensationItem[];
  }>(`${path}/compensation`, revision);
  const reload = () => setRevision((v) => v + 1);
  if (!data) return <Loading error={error} />;
  return (
    <>
      <section className="card">
        <h2>{employment.positionTitle} · Compensation</h2>
        <p className="muted">
          Effective dates preserve salary history. End an existing salary before
          adding a replacement.
        </p>
        <DataTable
          columns={[
            'Component',
            'Amount / month',
            'Effective from',
            'Until',
            '',
          ]}
          rows={[
            ...data.salaries.map((i) => ({ item: i, kind: 'salaries' })),
            ...data.components.map((i) => ({ item: i, kind: 'components' })),
          ].map(({ item: i, kind }) => [
            i.name ?? 'Basic salary',
            currency(i.amount),
            date(i.startsOn),
            i.endsOn ? date(i.endsOn) : 'Ongoing',
            <button
              className="text-button"
              disabled={!!i.endsOn}
              onClick={() => setEnding({ item: i, kind })}
            >
              End / replace
            </button>,
          ])}
          empty="No salary set. Add basic pay below so this employee can be included in payroll."
        />
      </section>
      {ending && (
        <EntryForm
          key={ending.item.id}
          title="End compensation period"
          submit="Save end date"
          fields={[
            { name: 'endsOn', label: 'Last applicable date', type: 'date' },
          ]}
          action={async (values) => {
            await request(`${path}/${ending.kind}/${ending.item.id}/end`, {
              csrf,
              body: { ...values, expectedVersion: ending.item.version },
            });
            setEnding(null);
            reload();
            return 'End date saved.';
          }}
        >
          <button
            className="secondary"
            type="button"
            onClick={() => setEnding(null)}
          >
            Cancel
          </button>
        </EntryForm>
      )}
      <div className="split-grid">
        <EntryForm
          title="Set monthly basic salary"
          submit="Save salary"
          fields={[
            {
              name: 'amount',
              label: 'Monthly basic pay (ZMW)',
              hint: 'Use a decimal amount, for example 8500.00.',
            },
            {
              name: 'startsOn',
              label: 'Effective from',
              type: 'date',
              defaultValue: employment.startsOn,
            },
            {
              name: 'endsOn',
              label: 'Effective until (optional)',
              type: 'date',
              optional: true,
            },
          ]}
          action={async (values) => {
            await request(`${path}/salaries`, { csrf, body: values });
            reload();
            return 'Salary saved.';
          }}
        />
        <EntryForm
          title="Add allowance or deduction"
          submit="Save component"
          fields={[
            {
              name: 'kind',
              label: 'Type',
              options: [
                { value: 'allowance', label: 'Allowance' },
                { value: 'deduction', label: 'Deduction' },
              ],
            },
            {
              name: 'code',
              label: 'Code',
              hint: 'Allowances need a matching treatment in statutory rules.',
            },
            { name: 'name', label: 'Description' },
            { name: 'amount', label: 'Amount per period (ZMW)' },
            { name: 'startsOn', label: 'Effective from', type: 'date' },
            {
              name: 'endsOn',
              label: 'Effective until (optional)',
              type: 'date',
              optional: true,
            },
          ]}
          action={async (values) => {
            await request(`${path}/components`, { csrf, body: values });
            reload();
            return 'Component saved.';
          }}
        />
      </div>
    </>
  );
}
function EmployeeDetails({
  base,
  csrf,
  employeeId,
}: CompanyProps & { employeeId: string }) {
  const [revision, setRevision] = useState(0);
  const path = `${base}/employees/${employeeId}/payroll-details`;
  const { data, error } = useRemote<{
    details: Record<string, string>;
    version: number;
  }>(path, revision);
  if (!data) return <Loading error={error} />;
  const groups = [
    {
      title: 'Tax & statutory identifiers',
      fields: [
        ['tpin', 'Employee TPIN'],
        ['napsaNumber', 'NAPSA number'],
        ['nhimaNumber', 'NHIMA number'],
        ['nrc', 'NRC / identity reference'],
        ['email', 'Email'],
      ],
    },
    {
      title: 'Banking instructions',
      fields: [
        ['bankName', 'Bank name'],
        ['accountName', 'Account holder'],
        ['accountNumber', 'Account number'],
        ['branchCode', 'Branch code'],
        ['bankCode', 'Bank routing code'],
      ],
    },
    {
      title: 'Opening tax balances',
      fields: [
        ['openingAsOf', 'Balances through'],
        ['openingTaxableIncome', 'Taxable income to date (ZMW)'],
        ['openingPaye', 'PAYE deducted to date (ZMW)'],
      ],
    },
  ];
  return (
    <>
      {groups.map((group) => (
        <EntryForm
          key={`${group.title}:${revision}`}
          title={group.title}
          submit="Save details"
          fields={group.fields.map(([name, label]) => ({
            name: name!,
            label: label!,
            optional: name !== 'openingTaxableIncome' && name !== 'openingPaye',
            defaultValue: data.details[name!] ?? '',
            ...(name === 'openingAsOf'
              ? {
                  type: 'date',
                  hint: 'Month-end date before the first payroll in this system. Enter reviewed zero balances explicitly when applicable.',
                }
              : name === 'email'
                ? { type: 'email' }
                : {}),
          }))}
          action={async (values) => {
            const next = { ...data.details };
            for (const [name] of group.fields)
              next[name!] = values[name!] ?? '';
            await request(path, {
              csrf,
              method: 'PUT',
              body: { expectedVersion: data.version, details: next },
            });
            setRevision((v) => v + 1);
            return 'Payroll details saved.';
          }}
        >
          {group.title === 'Opening tax balances' && (
            <p className="notice">
              Confirm these cumulative amounts against prior payroll records for
              the same tax year. They are used in PAYE calculations. Do not
              include payroll already finalized here.
            </p>
          )}
        </EntryForm>
      ))}
    </>
  );
}
function EmployeeHistory({
  base,
  employeeId,
}: {
  base: string;
  employeeId: string;
}) {
  const { data, error } = useRemote<{ items: Run[] }>(
    `${base}/payroll-runs?employeeId=${employeeId}&limit=100`,
  );
  return (
    <section className="card">
      <h2>Payroll history & payslips</h2>
      {data ? (
        <DataTable
          columns={['Period', 'Pay date', 'Status', 'Payslip']}
          rows={data.items.map((r) => [
            r.code,
            date(r.paymentDate),
            <span className={`badge ${r.status}`}>
              {r.cancelledAt ? 'cancelled' : r.status}
            </span>,
            <ActionButton
              disabled={r.status !== 'finalized'}
              action={() =>
                download(
                  `${base}/payroll-runs/${r.id}/documents/payslips?employeeId=${employeeId}`,
                  `payslip-${r.code}.pdf`,
                )
              }
            >
              Download PDF
            </ActionButton>,
          ])}
          empty="No payroll includes this employee yet. Prepare a payroll run after setting their salary."
        />
      ) : (
        <Loading error={error} />
      )}
    </section>
  );
}

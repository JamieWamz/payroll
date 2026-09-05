import { useRemote } from './useRemote';
import { DataTable, Loading } from './components';
import { currency, date, type Run, type RunDetail } from './payroll-types';
import type { CompanyProps, Page } from './Workspace';
interface Overview {
  counts: {
    employees: number;
    missingSalaries: number;
    verifiedRules: number;
    periods: number;
  };
  runs: Run[];
  latest: RunDetail | null;
}
export function Dashboard({
  base,
  navigate,
}: CompanyProps & { navigate: (page: Page) => void }) {
  const { data, error } = useRemote<Overview>(`${base}/payroll-overview`);
  if (!data) return <Loading error={error} />;
  const { counts, latest, runs } = data;
  const tasks: { title: string; description: string; page: Page }[] = [];
  if (!counts.employees)
    tasks.push({
      title: 'Add your employees',
      description:
        'Create employee records, employment dates and monthly salaries.',
      page: 'People',
    });
  if (counts.missingSalaries)
    tasks.push({
      title: `${counts.missingSalaries} employees need salary review`,
      description:
        'An active monthly salary is missing as of today. Review employment and compensation.',
      page: 'People',
    });
  if (!counts.verifiedRules)
    tasks.push({
      title: 'Verify statutory rules',
      description:
        'No verified configuration covers today. Review PAYE, NAPSA and NHIMA source evidence.',
      page: 'Statutory rules',
    });
  if (!counts.periods)
    tasks.push({
      title: 'Set your first pay period',
      description: 'Choose the month and date employees will be paid.',
      page: 'Payroll periods',
    });
  if (latest?.status === 'calculated')
    tasks.push({
      title: `Review ${latest.code} payroll`,
      description:
        'Check calculated earnings and deductions before finalizing.',
      page: 'Payroll',
    });
  if (latest?.status === 'finalized')
    tasks.push({
      title: 'Review statutory filing status',
      description:
        'Generate schedules and record external submission references.',
      page: 'ZRA returns',
    });
  return (
    <>
      <div className="page-intro">
        <p>
          {new Intl.DateTimeFormat('en-ZM', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            timeZone: 'Africa/Lusaka',
          }).format(new Date())}
        </p>
        <button onClick={() => navigate('Payroll')}>
          {latest && latest.status !== 'finalized'
            ? 'Review payroll'
            : 'Prepare payroll'}
        </button>
      </div>
      <div className="dashboard-grid">
        <section className="payroll-spotlight">
          <div className="section-heading">
            <span className="eyebrow">LATEST PAYROLL</span>
            <span className={`badge ${latest?.status ?? 'draft'}`}>
              {latest?.status === 'calculated'
                ? 'Ready for review'
                : (latest?.status ?? 'Not started')}
            </span>
          </div>
          <h2>{latest?.code ?? 'Your next payroll starts here'}</h2>
          <p>
            {latest
              ? `${date(latest.startsOn)} – ${date(latest.endsOn)} · Pay date ${date(latest.paymentDate)}`
              : 'Bring your people, pay schedule and statutory rules together.'}
          </p>
          <div className="spotlight-total">
            <span>Net payroll</span>
            <strong>
              {latest && latest.status !== 'draft'
                ? currency(latest.totals.netPay)
                : 'Awaiting calculation'}
            </strong>
          </div>
          <div className="spotlight-footer">
            <span>
              {latest
                ? `${latest.employees.length} employee${latest.employees.length === 1 ? '' : 's'} included`
                : 'Set up your first payroll run'}
            </span>
            <button className="secondary" onClick={() => navigate('Payroll')}>
              Open payroll →
            </button>
          </div>
        </section>
        <section className="attention-panel">
          <div className="section-heading">
            <h2>Needs attention</h2>
            <span className="badge">{tasks.length}</span>
          </div>
          {tasks.length ? (
            tasks.slice(0, 4).map((task) => (
              <button
                className="task-row"
                key={task.title}
                onClick={() => navigate(task.page)}
              >
                <span>
                  <strong>{task.title}</strong>
                  <small>{task.description}</small>
                </span>
                <span aria-hidden="true">→</span>
              </button>
            ))
          ) : (
            <div className="empty">
              <strong>Preparation records are in place.</strong>
              <p>
                Open payroll to validate employee inputs and calculate the next
                run.
              </p>
            </div>
          )}
        </section>
      </div>
      <div className="metrics">
        <div>
          <span>Active employees</span>
          <strong>{counts.employees}</strong>
          <button className="text-button" onClick={() => navigate('People')}>
            Employee directory →
          </button>
        </div>
        <div>
          <span>Gross payroll</span>
          <strong>
            {latest && latest.status !== 'draft'
              ? currency(latest.totals.grossPay)
              : '—'}
          </strong>
          <small>Latest payroll run</small>
        </div>
        <div>
          <span>Employer cost</span>
          <strong>
            {latest && latest.status !== 'draft'
              ? currency(latest.totals.employerCost)
              : '—'}
          </strong>
          <small>Gross pay + employer contributions</small>
        </div>
        <div>
          <span>Rules covering today</span>
          <strong>
            {counts.verifiedRules ? 'Verified' : 'Review required'}
          </strong>
          <button
            className="text-button"
            onClick={() => navigate('Statutory rules')}
          >
            View source evidence →
          </button>
        </div>
      </div>
      <section className="card">
        <div className="section-heading">
          <h2>Recent payroll runs</h2>
          <button className="text-button" onClick={() => navigate('Payroll')}>
            View payroll history →
          </button>
        </div>
        <DataTable
          columns={['Period', 'Pay date', 'Status', 'Last activity']}
          rows={runs.map((r) => [
            <strong>{r.code}</strong>,
            date(r.paymentDate),
            <span className={`badge ${r.status}`}>{r.status}</span>,
            `${r.finalizedAt ? 'Finalized' : r.calculatedAt ? 'Calculated' : 'Created'} ${date(r.finalizedAt ?? r.calculatedAt ?? r.createdAt)}`,
          ])}
          empty="No payroll runs yet. Complete the preparation steps above, then prepare your first payroll."
        />
      </section>
      <section className="next-actions">
        <div>
          <h2>Keep the next step close</h2>
          <p>Common tasks for your payroll workspace.</p>
        </div>
        <button className="secondary" onClick={() => navigate('People')}>
          Manage employees
        </button>
        <button className="secondary" onClick={() => navigate('Reports')}>
          Download reports
        </button>
        <button className="secondary" onClick={() => navigate('ZRA returns')}>
          Review filings
        </button>
      </section>
    </>
  );
}

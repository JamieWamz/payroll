import { useState } from 'react';
import { request } from './api';
import { ActionButton, Loading } from './components';
import { useRemote } from './useRemote';
import { Settings, StatutoryRules } from './Settings';
import { Employees } from './Employees';
import { Payroll } from './Payroll';
import { Periods, type CompanyProps, type Page } from './Workspace';
interface SetupStatus {
  steps: {
    id: string;
    title: string;
    description: string;
    complete: boolean;
  }[];
  completed: number;
  total: number;
  counts: { employees: number; salaries: number };
}
export function Setup({
  navigate,
  ...props
}: CompanyProps & { navigate: (page: Page) => void }) {
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string>();
  const { data, error } = useRemote<SetupStatus>(
    `${props.base}/setup`,
    revision,
  );
  if (!data) return <Loading error={error} />;
  const active =
    selected ?? data.steps.find((step) => !step.complete)?.id ?? 'payroll';
  const index = data.steps.findIndex((step) => step.id === active);
  const current = data.steps[index]!;
  return (
    <>
      <section className="setup-heading">
        <div>
          <p className="eyebrow">A CLEAR START</p>
          <h2>Your first pay day starts here.</h2>
          <p>
            Work through the essentials in your own time. Progress reflects the
            records saved in your company.
          </p>
        </div>
        <div className="setup-completion">
          <strong>
            {data.completed}
            <span> / {data.total}</span>
          </strong>
          <span>steps complete</span>
          <progress
            value={data.completed}
            max={data.total}
            aria-label="Company setup completion"
          />
        </div>
      </section>
      <ol className="setup-steps" aria-label="Company setup steps">
        {data.steps.map((step, i) => (
          <li key={step.id}>
            <button
              className={active === step.id ? 'selected' : ''}
              aria-current={active === step.id ? 'step' : undefined}
              onClick={() => setSelected(step.id)}
            >
              <span
                className={
                  step.complete ? 'step-number complete' : 'step-number'
                }
              >
                {step.complete ? '✓' : i + 1}
              </span>
              <strong>{step.title}</strong>
              <small>{step.complete ? 'Records saved' : 'To complete'}</small>
            </button>
          </li>
        ))}
      </ol>
      <div className="setup-workspace">
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              STEP {index + 1} OF {data.total}
            </p>
            <h2>{current.title}</h2>
            <p>{current.description}</p>
          </div>
          <ActionButton
            action={async () => {
              await request(`${props.base}/setup`);
              setRevision((v) => v + 1);
            }}
          >
            Refresh progress
          </ActionButton>
        </div>
        {active === 'business' && <Settings {...props} />}
        {active === 'people' && (
          <>
            <p className="notice">
              {data.counts.salaries} of {data.counts.employees} active employees
              have open employment and salary records. Payroll validates the
              exact effective dates and statutory details when you calculate.
            </p>
            <Employees {...props} />
          </>
        )}
        {active === 'period' && <Periods {...props} />}
        {active === 'rules' && <StatutoryRules {...props} />}
        {active === 'payroll' && <Payroll {...props} />}
      </div>
      <div className="setup-controls">
        <button className="text-button" onClick={() => navigate('Overview')}>
          Return to overview
        </button>
        <ActionButton
          className="primary"
          action={async () => {
            const latest = await request<SetupStatus>(`${props.base}/setup`);
            setRevision((v) => v + 1);
            if (!latest.steps[index]?.complete)
              throw new Error(
                'This step still needs the records described above. Save them, then continue, or select another step.',
              );
            if (index < data.steps.length - 1)
              setSelected(data.steps[index + 1]!.id);
            else navigate('Overview');
          }}
        >
          {index === data.steps.length - 1
            ? 'Finish setup'
            : 'Save progress & continue →'}
        </ActionButton>
      </div>
    </>
  );
}

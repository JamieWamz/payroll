import { useEffect, useState } from 'react';
import { message, request, RequestError, type Session } from './api';
import { EntryForm } from './components';
import { Workspace } from './Workspace';
import './styles.css';
export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState('');
  const [register, setRegister] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void request<Session>('/auth/session', { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setSession(value);
      })
      .catch((failure: unknown) => {
        if (
          !controller.signal.aborted &&
          !(failure instanceof RequestError && failure.status === 401)
        )
          setError(message(failure));
      })
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false);
      });
    const expired = () => {
      setSession(null);
      setError('Your session has expired. Sign in again.');
    };
    window.addEventListener('payroll-session-expired', expired);
    return () => {
      controller.abort();
      window.removeEventListener('payroll-session-expired', expired);
    };
  }, []);
  if (checking)
    return (
      <main className="boot" role="status">
        Opening ZamPayroll…
      </main>
    );
  if (session)
    return <Workspace session={session} onLogout={() => setSession(null)} />;
  return (
    <main className="auth-shell">
      <section className="auth-story">
        <div className="brand">
          <span className="brand-mark">Z</span>ZamPayroll
        </div>
        <div>
          <p className="eyebrow">THE PAYROLL WORKSPACE · ZAMBIA</p>
          <h1>
            Your people.
            <br />
            Your policies.
            <br />
            <span>Every detail accounted for.</span>
          </h1>
          <p>
            One focused workspace for employee records, payroll preparation and
            evidence-backed company policies.
          </p>
        </div>
        <p className="auth-footnote">
          Development build · Not approved for live payroll
        </p>
      </section>
      <section className="auth-panel">
        <p className="eyebrow">WELCOME TO ZAMPAYROLL</p>
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        <EntryForm
          key={String(register)}
          title={
            register ? 'Create your workspace' : 'Sign in to your workspace'
          }
          submit={register ? 'Create company account' : 'Sign in'}
          fields={[
            ...(register
              ? [
                  { name: 'displayName', label: 'Your name' },
                  { name: 'companyName', label: 'Company name' },
                  {
                    name: 'companyCode',
                    label: 'Company code',
                    hint: 'A unique short code, such as acme-zm.',
                  },
                ]
              : []),
            {
              name: 'email',
              label: 'Email address',
              type: 'email',
              maxLength: 320,
            },
            {
              name: 'password',
              label: 'Password',
              type: 'password',
              maxLength: 256,
              ...(register
                ? { hint: 'Use a strong passphrase of at least 15 characters.' }
                : {}),
            },
          ]}
          action={async (values) => {
            const value = await request<Session>(
              register ? '/auth/register' : '/auth/login',
              { body: values },
            );
            setError('');
            setSession(value);
            return '';
          }}
        />
        <button className="text-button" onClick={() => setRegister(!register)}>
          {register
            ? 'Already have an account? Sign in'
            : 'New company? Create a workspace'}
        </button>
        <p className="muted">
          Session-protected access. Company data stays within your authorized
          workspace.
        </p>
      </section>
    </main>
  );
}

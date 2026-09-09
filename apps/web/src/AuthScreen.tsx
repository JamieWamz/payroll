import { Brand } from './Brand';
import { useState, type FormEvent } from 'react';
import { WorkspaceImage } from './WorkspaceImage';
import { message, request, type Session } from './api';
export function AuthScreen({
  error,
  onAuthenticated,
}: {
  error: string;
  onAuthenticated: (session: Session) => void;
}) {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [values, setValues] = useState({ email: '', password: '' });
  const update = (key: keyof typeof values, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setFailure('');
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFailure('');
    try {
      onAuthenticated(await request<Session>('/auth/login', { body: values }));
    } catch (e) {
      setFailure(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="access-shell">
      <section className="access-panel">
        <Brand />
        <div className="access-content">
          <p className="eyebrow">YOUR PAYROLL WORKSPACE</p>
          <h1>Welcome back.</h1>
          <p className="access-description">
            Sign in to take care of your people and payroll.
          </p>
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          <form onSubmit={(event) => void submit(event)}>
            <fieldset disabled={busy}>
              <div className="form-field">
                <label htmlFor="email">Email address</label>
                <input
                  id="email"
                  type="email"
                  autoComplete="username"
                  placeholder="you@company.com"
                  value={values.email}
                  onChange={(e) => update('email', e.target.value)}
                  required
                  maxLength={320}
                />
              </div>
              <div className="form-field">
                <label htmlFor="password">Password</label>
                <div className="password-input">
                  <input
                    id="password"
                    type={visible ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={values.password}
                    onChange={(e) => update('password', e.target.value)}
                    required
                    maxLength={256}
                  />
                  <button
                    type="button"
                    className="text-button"
                    aria-label={visible ? 'Hide password' : 'Show password'}
                    aria-pressed={visible}
                    onClick={() => setVisible(!visible)}
                  >
                    {visible ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
              {failure && (
                <p className="notice error" role="alert">
                  {failure}
                </p>
              )}
              <button type="submit" className="access-submit">
                {busy ? 'Please wait…' : 'Sign in'}
                <span aria-hidden="true">→</span>
              </button>
            </fieldset>
          </form>
          <div className="access-alternative">
            <p>
              Access is by invitation only. Open your invitation link to get
              started, or ask your company owner for team access.
            </p>
          </div>
        </div>
        <footer className="access-footer">
          <span>Zambia · ZMW</span>
          <span>Secure company access</span>
        </footer>
      </section>
      <aside className="access-story" aria-label="About ZamPayroll">
        <div>
          <p className="eyebrow">MADE FOR WORKING LIFE IN ZAMBIA</p>
          <h2>
            Good payroll.
            <br />
            <em>Peace of mind.</em>
          </h2>
          <p>
            From your first employee to your next pay day. Keep every record,
            review and payslip in one place.
          </p>
        </div>
        <div className="access-visual">
          <WorkspaceImage scene="office" className="access-photo" priority />
          <div className="access-photo-caption">
            <span>ROOM TO DO YOUR BEST WORK</span>
            <a href="https://unsplash.com" target="_blank" rel="noreferrer">
              Photography / Unsplash ↗
            </a>
          </div>
        </div>
        <ol className="access-path" aria-label="Your payroll workflow">
          {['People', 'Payroll', 'Reports'].map((area, index) => (
            <li key={area}>
              <span>0{index + 1}</span>
              <strong>{area}</strong>
            </li>
          ))}
        </ol>
        <div>
          <div className="access-obligations">
            <span>PAYE</span>
            <span>NAPSA</span>
            <span>NHIMA</span>
            <span>PAYSLIPS</span>
          </div>
          <p className="access-disclosure">
            Payroll uses your reviewed statutory rules. Authority submissions
            and bank payments are managed externally.
          </p>
        </div>
      </aside>
    </main>
  );
}

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
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [step, setStep] = useState(1);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [values, setValues] = useState({
    displayName: '',
    email: '',
    password: '',
    companyName: '',
    companyCode: '',
  });
  const registration = mode === 'register';
  const update = (key: keyof typeof values, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setFailure('');
  };
  const switchMode = () => {
    setMode(registration ? 'login' : 'register');
    setStep(1);
    setFailure('');
    setVisible(false);
    setValues((current) => ({ ...current, password: '' }));
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (registration && step === 1) {
      setStep(2);
      return;
    }
    setBusy(true);
    setFailure('');
    try {
      const session = await request<Session>(
        registration ? '/auth/register' : '/auth/login',
        {
          body: registration
            ? values
            : { email: values.email, password: values.password },
        },
      );
      if (registration) window.history.replaceState(null, '', '#Setup');
      onAuthenticated(session);
    } catch (e) {
      setFailure(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="access-shell">
      <section className="access-panel">
        <div className="brand">
          <span className="brand-mark">Z</span>ZamPayroll
        </div>
        <div className="access-content">
          <p className="eyebrow">YOUR PAYROLL WORKSPACE</p>
          <h1>
            {registration
              ? step === 1
                ? 'Start with you.'
                : 'Make it your workspace.'
              : 'Welcome back.'}
          </h1>
          <p className="access-description">
            {registration
              ? step === 1
                ? 'Create your account. We’ll help you set up payroll next.'
                : 'Tell us about the business you’ll be running payroll for.'
              : 'Sign in to take care of your people and payroll.'}
          </p>
          {registration && (
            <ol
              className="registration-progress"
              aria-label="Account setup progress"
            >
              <li aria-current={step === 1 ? 'step' : undefined}>
                <span>{step > 1 ? '✓' : '1'}</span>Your account
              </li>
              <li aria-current={step === 2 ? 'step' : undefined}>
                <span>2</span>Your business
              </li>
            </ol>
          )}
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          <form onSubmit={(event) => void submit(event)}>
            <fieldset disabled={busy}>
              {!registration || step === 1 ? (
                <>
                  {registration && (
                    <div className="form-field">
                      <label htmlFor="displayName">Your name</label>
                      <input
                        id="displayName"
                        autoComplete="name"
                        value={values.displayName}
                        onChange={(e) => update('displayName', e.target.value)}
                        required
                        maxLength={160}
                      />
                    </div>
                  )}
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
                        autoComplete={
                          registration ? 'new-password' : 'current-password'
                        }
                        value={values.password}
                        onChange={(e) => update('password', e.target.value)}
                        required
                        minLength={registration ? 15 : undefined}
                        maxLength={256}
                        aria-describedby={
                          registration ? 'password-hint' : undefined
                        }
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
                    {registration && (
                      <small id="password-hint">
                        Use a passphrase of at least 15 characters.
                      </small>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="account-summary">
                    <span className="user-avatar">
                      {values.displayName.slice(0, 1).toUpperCase()}
                    </span>
                    <div>
                      <strong>{values.displayName}</strong>
                      <small>{values.email}</small>
                    </div>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setStep(1)}
                    >
                      Edit
                    </button>
                  </div>
                  <div className="form-field">
                    <label htmlFor="companyName">Company name</label>
                    <input
                      id="companyName"
                      autoComplete="organization"
                      value={values.companyName}
                      onChange={(e) => update('companyName', e.target.value)}
                      required
                      maxLength={320}
                    />
                  </div>
                  <div className="form-field">
                    <label htmlFor="companyCode">Company code</label>
                    <input
                      id="companyCode"
                      value={values.companyCode}
                      onChange={(e) => update('companyCode', e.target.value)}
                      required
                      maxLength={64}
                      aria-describedby="company-code-hint"
                      placeholder="e.g. copperline-zm"
                    />
                    <small id="company-code-hint">
                      A unique short code for this workspace. Use letters,
                      numbers and hyphens.
                    </small>
                  </div>
                  <p className="setup-note">
                    Next, add statutory registrations, employees and your pay
                    schedule. Your setup progress is saved as you go.
                  </p>
                </>
              )}
              {failure && (
                <p className="notice error" role="alert">
                  {failure}
                </p>
              )}
              <button type="submit" className="access-submit">
                {busy
                  ? 'Please wait…'
                  : registration
                    ? step === 1
                      ? 'Continue to business details'
                      : 'Create company account'
                    : 'Sign in'}
                <span aria-hidden="true">→</span>
              </button>
              {registration && step === 2 && (
                <button
                  type="button"
                  className="text-button access-back"
                  onClick={() => setStep(1)}
                >
                  ← Back to your account
                </button>
              )}
            </fieldset>
          </form>
          <div className="access-alternative">
            <span>
              {registration
                ? 'Already have a workspace?'
                : 'New to ZamPayroll?'}
            </span>
            <button
              className="text-button"
              disabled={busy}
              onClick={switchMode}
            >
              {registration ? 'Sign in' : 'Create a workspace'}
            </button>
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

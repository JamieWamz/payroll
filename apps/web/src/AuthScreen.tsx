import { useState, type FormEvent } from 'react';

import { Brand } from './Brand';
import { message, request, type Session } from './api';
import type { Theme } from './ThemeToggle';
import { ThemeToggle } from './ThemeToggle';
import { WorkspaceImage } from './WorkspaceImage';

type AccessMode = 'register' | 'sign-in';

function companyCodeFrom(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[^\w\s-]/gu, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 64);
}

export function AuthScreen({
  error,
  onAuthenticated,
  theme,
  toggleTheme,
}: {
  error: string;
  onAuthenticated: (session: Session) => void;
  theme: Theme;
  toggleTheme: () => void;
}) {
  const [mode, setMode] = useState<AccessMode>('sign-in');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [values, setValues] = useState({
    companyCode: '',
    companyName: '',
    confirmPassword: '',
    displayName: '',
    email: '',
    password: '',
  });
  const update = (key: keyof typeof values, value: string) => {
    setValues((current) => ({
      ...current,
      [key]: value,
      ...(key === 'companyName' && !current.companyCode
        ? { companyCode: companyCodeFrom(value) }
        : {}),
    }));
    setFailure('');
  };
  const switchMode = (next: AccessMode) => {
    setMode(next);
    setFailure('');
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (mode === 'register' && values.password !== values.confirmPassword) {
      setFailure('Passwords do not match.');
      return;
    }
    setBusy(true);
    setFailure('');
    try {
      if (mode === 'sign-in') {
        onAuthenticated(
          await request<Session>('/auth/login', {
            body: { email: values.email, password: values.password },
          }),
        );
      } else {
        const session = await request<Session>('/auth/register', {
          body: {
            companyCode: values.companyCode,
            companyName: values.companyName,
            displayName: values.displayName,
            email: values.email,
            password: values.password,
          },
        });
        window.history.replaceState(null, '', '#Setup');
        onAuthenticated(session);
      }
    } catch (e) {
      setFailure(message(e));
    } finally {
      setBusy(false);
    }
  };

  const isRegistration = mode === 'register';
  return (
    <main className="access-shell">
      <section className="access-panel">
        <div className="access-topline">
          <Brand />
          <ThemeToggle theme={theme} toggle={toggleTheme} />
        </div>
        <div className="access-content">
          <p className="eyebrow">ZAMPAYROLL</p>
          <h1>{isRegistration ? 'Create your workspace.' : 'Welcome back.'}</h1>
          <p className="access-description">
            {isRegistration
              ? 'Start with your company and owner account. You can complete payroll setup next.'
              : 'Sign in to manage your people and payroll.'}
          </p>
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          <form onSubmit={(event) => void submit(event)}>
            <fieldset disabled={busy}>
              {isRegistration && (
                <>
                  <div className="form-field">
                    <label htmlFor="display-name">Your name</label>
                    <input
                      id="display-name"
                      autoComplete="name"
                      value={values.displayName}
                      onChange={(e) => update('displayName', e.target.value)}
                      required
                      maxLength={120}
                    />
                  </div>
                  <div className="form-field">
                    <label htmlFor="company-name">Company name</label>
                    <input
                      id="company-name"
                      autoComplete="organization"
                      value={values.companyName}
                      onChange={(e) => update('companyName', e.target.value)}
                      required
                      maxLength={160}
                    />
                  </div>
                  <div className="form-field">
                    <label htmlFor="company-code">Company code</label>
                    <input
                      id="company-code"
                      value={values.companyCode}
                      onChange={(e) => update('companyCode', e.target.value)}
                      pattern="[a-z][a-z0-9]*(?:-[a-z0-9]+)*"
                      placeholder="your-company"
                      required
                      maxLength={64}
                    />
                    <small>
                      Used in your workspace address and must be unique.
                    </small>
                  </div>
                </>
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
                  maxLength={254}
                />
              </div>
              <div className="form-field">
                <label htmlFor="password">Password</label>
                <div className="password-input">
                  <input
                    id="password"
                    type={visible ? 'text' : 'password'}
                    autoComplete={
                      isRegistration ? 'new-password' : 'current-password'
                    }
                    value={values.password}
                    onChange={(e) => update('password', e.target.value)}
                    required
                    maxLength={128}
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
                {isRegistration && (
                  <small>
                    Use a unique passphrase of at least 15 characters.
                  </small>
                )}
              </div>
              {isRegistration && (
                <div className="form-field">
                  <label htmlFor="confirm-password">Confirm password</label>
                  <input
                    id="confirm-password"
                    type={visible ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={values.confirmPassword}
                    onChange={(e) => update('confirmPassword', e.target.value)}
                    required
                    maxLength={128}
                  />
                </div>
              )}
              {failure && (
                <p className="notice error" role="alert">
                  {failure}
                </p>
              )}
              <button type="submit" className="access-submit">
                {busy
                  ? 'Please wait…'
                  : isRegistration
                    ? 'Create workspace'
                    : 'Sign in'}
                <span aria-hidden="true">→</span>
              </button>
            </fieldset>
          </form>
          <div className="access-alternative">
            {isRegistration ? (
              <p>
                Already have an account?{' '}
                <button
                  className="text-button"
                  type="button"
                  onClick={() => switchMode('sign-in')}
                >
                  Sign in
                </button>
              </p>
            ) : (
              <p>
                New to ZamPayroll?{' '}
                <button
                  className="text-button"
                  type="button"
                  onClick={() => switchMode('register')}
                >
                  Create your workspace
                </button>
              </p>
            )}
          </div>
        </div>
        <footer className="access-footer">
          <span>Zambia · ZMW</span>
          <span>Secure payroll workspace</span>
        </footer>
      </section>
      <aside className="access-story" aria-label="About ZamPayroll">
        <div>
          <p className="eyebrow">PAYROLL, MADE SIMPLE</p>
          <h2>
            People first.
            <br />
            <em>Payroll ready.</em>
          </h2>
          <p>Keep your people, pay runs, and reports in one place.</p>
        </div>
        <div className="access-visual">
          <WorkspaceImage scene="office" className="access-photo" priority />
        </div>
      </aside>
    </main>
  );
}

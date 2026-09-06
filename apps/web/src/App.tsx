import { useEffect, useState } from 'react';
import { message, request, RequestError, type Session } from './api';
import { JoinCompany } from './JoinCompany';
import { AuthScreen } from './AuthScreen';
import { Workspace } from './Workspace';
import './styles.css';
import './product.css';
export function App() {
  const [inviteToken, setInviteToken] = useState(
    () => /^#invite=([A-Za-z0-9_-]{43})$/.exec(window.location.hash)?.[1] ?? '',
  );
  useEffect(() => {
    const readInvitation = () => {
      const token = /^#invite=([A-Za-z0-9_-]{43})$/.exec(
        window.location.hash,
      )?.[1];
      if (token) setInviteToken(token);
    };
    window.addEventListener('hashchange', readInvitation);
    return () => window.removeEventListener('hashchange', readInvitation);
  }, []);
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState('');
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
  if (inviteToken && !checking)
    return (
      <JoinCompany
        token={inviteToken}
        done={(value) => {
          window.history.replaceState(null, '', '#Overview');
          setInviteToken('');
          setSession(value);
          setError('');
        }}
        cancel={() => {
          window.history.replaceState(null, '', '/');
          setInviteToken('');
        }}
      />
    );
  if (checking)
    return (
      <main className="boot" role="status">
        Opening ZamPayroll…
      </main>
    );
  if (session)
    return <Workspace session={session} onLogout={() => setSession(null)} />;
  return (
    <AuthScreen
      error={error}
      onAuthenticated={(value) => {
        setError('');
        setSession(value);
      }}
    />
  );
}

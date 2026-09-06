import { useEffect, useState } from 'react';
import { message, request, type Session } from './api';
import { EntryForm, Loading } from './components';
export function JoinCompany({
  token,
  done,
  cancel,
}: {
  token: string;
  done: (session: Session) => void;
  cancel: () => void;
}) {
  const [invitation, setInvitation] = useState<{
    companyName: string;
    email: string;
    role: string;
  }>();
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void request<{ companyName: string; email: string; role: string }>(
      '/auth/invitation',
      { body: { token }, signal: controller.signal },
    )
      .then((value) => {
        if (!controller.signal.aborted) setInvitation(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      });
    return () => controller.abort();
  }, [token]);
  return (
    <main className="join-shell">
      <div className="brand">
        <span className="brand-mark">Z</span>ZamPayroll
      </div>
      <section className="join-panel">
        <p className="eyebrow">YOUR TEAM IS EXPECTING YOU</p>
        <h1>Join your company.</h1>
        {invitation ? (
          <>
            <p>
              You’ve been invited to <strong>{invitation.companyName}</strong>{' '}
              as a <strong>{invitation.role.replaceAll('-', ' ')}</strong>.
            </p>
            <p className="notice">
              This invitation is for {invitation.email}. If you already use
              ZamPayroll, enter your existing password. Otherwise choose a
              passphrase of at least 15 characters.
            </p>
            <EntryForm
              title="Your account"
              submit="Accept invitation & sign in"
              fields={[
                { name: 'displayName', label: 'Your name', maxLength: 120 },
                {
                  name: 'password',
                  label: 'Password',
                  type: 'password',
                  maxLength: 256,
                },
              ]}
              action={async (values) => {
                const session = await request<Session>('/auth/join-company', {
                  body: { ...values, token },
                });
                done(session);
                return '';
              }}
            />
          </>
        ) : (
          <Loading error={error} />
        )}
        <button className="text-button" onClick={cancel}>
          Back to sign in
        </button>
      </section>
    </main>
  );
}

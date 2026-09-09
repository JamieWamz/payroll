import { Brand } from './Brand';
import { useEffect, useState } from 'react';
import { message, request, type Session } from './api';
import { EntryForm, Loading } from './components';

interface WorkspaceInvitation {
  email: string;
  companyCode: string;
  companyName: string;
}

export function ActivateWorkspace({
  token,
  done,
  cancel,
}: {
  token: string;
  done: (session: Session) => void;
  cancel: () => void;
}) {
  const [invitation, setInvitation] = useState<WorkspaceInvitation>();
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void request<WorkspaceInvitation>('/auth/workspace-invitation', {
      body: { token },
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) setInvitation(value);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(message(failure));
      });
    return () => controller.abort();
  }, [token]);
  return (
    <main className="join-shell">
      <Brand />
      <section className="join-panel">
        <p className="eyebrow">YOUR WORKSPACE INVITATION</p>
        <h1>Welcome to your workspace.</h1>
        {invitation ? (
          <>
            <p>
              Activate <strong>{invitation.companyName}</strong> (
              {invitation.companyCode}) and set up your payroll.
            </p>
            <p className="notice">
              This invitation is for {invitation.email}. If you already use
              ZamPayroll, enter your existing password. Otherwise choose a
              passphrase of at least 15 characters.
            </p>
            <EntryForm
              title="Your account"
              submit="Accept invitation & set up payroll"
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
                const session = await request<Session>('/auth/register', {
                  body: { ...values, ...invitation, inviteToken: token },
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

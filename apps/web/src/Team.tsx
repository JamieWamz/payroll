import { useState } from 'react';
import { request } from './api';
import { ActionButton, DataTable, EntryForm, Loading } from './components';
import { useRemote } from './useRemote';
import { date } from './payroll-types';
import type { CompanyProps } from './Workspace';
const roles: Record<string, string> = {
  owner: 'Owner',
  'payroll-operator': 'Payroll operator',
  'payroll-reviewer': 'Payroll reviewer',
  'report-reader': 'Report reader',
};
interface TeamData {
  currentMembershipId: string;
  members: {
    id: string;
    displayName: string;
    email: string;
    status: string;
    version: number;
    roles: string[];
  }[];
  invitations: {
    id: string;
    email: string;
    role: string;
    status: string;
    expiresAt: string;
    version: number;
  }[];
}
export function Team({ base, csrf }: CompanyProps) {
  const [revision, setRevision] = useState(0);
  const [inviting, setInviting] = useState(false);
  const [link, setLink] = useState('');
  const { data, error } = useRemote<TeamData>(`${base}/team`, revision);
  return (
    <>
      <div className="page-intro">
        <p>
          Give your payroll team the access they need. Owners manage invitations
          and company membership.
        </p>
        <button onClick={() => setInviting(!inviting)}>
          {inviting ? 'Close invitation form' : 'Invite team member'}
        </button>
      </div>
      {inviting && (
        <EntryForm
          title="Invite someone to your company"
          submit="Create invitation link"
          fields={[
            { name: 'email', label: 'Team member email', type: 'email' },
            {
              name: 'role',
              label: 'Access role',
              options: Object.entries(roles)
                .filter(([key]) => key !== 'owner')
                .map(([value, label]) => ({ value, label })),
            },
          ]}
          action={async (values) => {
            const result = await request<{ token: string }>(
              `${base}/team/invitations`,
              { csrf, body: values },
            );
            setLink(`${window.location.origin}/#invite=${result.token}`);
            setRevision((v) => v + 1);
            setInviting(false);
            return '';
          }}
        >
          <div className="role-descriptions">
            <p>
              <strong>Payroll operator</strong> maintains employees and
              compensation and calculates payroll.
            </p>
            <p>
              <strong>Payroll reviewer</strong> reads employee/payroll records
              and finalizes reviewed payroll.
            </p>
            <p>
              <strong>Report reader</strong> reads payroll and downloads
              reports. No record changes.
            </p>
          </div>
        </EntryForm>
      )}
      {link && (
        <section className="card invitation-result">
          <h2>Invitation link created</h2>
          <p>
            Share this link directly with the intended team member. It expires
            in 7 days and can be used once. No email has been sent.
          </p>
          <label>
            Invitation link
            <input
              readOnly
              value={link}
              onFocus={(e) => e.currentTarget.select()}
            />
          </label>
          <div className="import-actions">
            <ActionButton
              action={async () => {
                await navigator.clipboard.writeText(link);
              }}
            >
              Copy invitation link
            </ActionButton>
            <button className="text-button" onClick={() => setLink('')}>
              Dismiss link
            </button>
          </div>
        </section>
      )}
      {data ? (
        <>
          <section className="card">
            <h2>Company members</h2>
            <DataTable
              columns={['Person', 'Email', 'Role', 'Access', '']}
              rows={data.members.map((m) => [
                <strong>{m.displayName}</strong>,
                m.email,
                m.roles.map((r) => roles[r] ?? r).join(', '),
                <span className={`badge ${m.status}`}>{m.status}</span>,
                m.roles.includes('owner') ? (
                  <small>Owner access protected</small>
                ) : m.id === data.currentMembershipId ? (
                  <small>Your membership</small>
                ) : (
                  <ActionButton
                    action={async () => {
                      await request(`${base}/team/members/${m.id}`, {
                        csrf,
                        method: 'PATCH',
                        body: {
                          expectedVersion: m.version,
                          status:
                            m.status === 'active' ? 'suspended' : 'active',
                        },
                      });
                      setRevision((v) => v + 1);
                    }}
                  >
                    {m.status === 'active'
                      ? 'Suspend access'
                      : 'Restore access'}
                  </ActionButton>
                ),
              ])}
            />
          </section>
          <section className="card">
            <h2>Invitation history</h2>
            <p className="muted">
              Latest 100 invitations. Revoking a pending link prevents it from
              being accepted.
            </p>
            <DataTable
              columns={['Email', 'Role', 'Status', 'Expires', '']}
              empty="No invitations yet. Invite a team member when you are ready to share payroll work."
              rows={data.invitations.map((i) => [
                i.email,
                roles[i.role],
                <span className={`badge ${i.status}`}>{i.status}</span>,
                date(i.expiresAt),
                i.status === 'pending' ? (
                  <ActionButton
                    action={async () => {
                      await request(`${base}/team/invitations/${i.id}/revoke`, {
                        csrf,
                        body: { expectedVersion: i.version },
                      });
                      setRevision((v) => v + 1);
                      setLink('');
                    }}
                  >
                    Revoke invitation
                  </ActionButton>
                ) : null,
              ])}
            />
          </section>
        </>
      ) : (
        <Loading error={error} />
      )}
    </>
  );
}

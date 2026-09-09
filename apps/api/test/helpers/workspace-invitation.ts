import { Pool } from 'pg';
import { afterAll } from 'vitest';
import { issueWorkspaceInvitation } from '../../src/modules/identity-access/application/workspace-invitations.js';

const invitations = new Map<string, { id: string; token: string }>();
export async function withWorkspaceInvitation<
  T extends { email: string; companyCode: string; companyName: string },
>(payload: T) {
  let invitation = invitations.get(payload.companyCode);
  if (!invitation) {
    if (!process.env.TEST_DATABASE_MIGRATION_URL)
      throw new Error(
        'Test migration URL is required to issue fixture invitations.',
      );
    const pool = new Pool({
      connectionString: process.env.TEST_DATABASE_MIGRATION_URL,
      max: 1,
    });
    try {
      await pool.query(
        "DELETE FROM app.workspace_invitations WHERE company_code=$1 AND issued_by='automated-test'",
        [payload.companyCode],
      );
      invitation = await issueWorkspaceInvitation(pool, {
        ...payload,
        operator: 'automated-test',
      });
      invitations.set(payload.companyCode, invitation);
    } finally {
      await pool.end();
    }
  }
  return { ...payload, inviteToken: invitation.token };
}
afterAll(async () => {
  if (!invitations.size) return;
  const pool = new Pool({
    connectionString: process.env.TEST_DATABASE_MIGRATION_URL,
    max: 1,
  });
  try {
    await pool.query(
      'DELETE FROM app.workspace_invitations WHERE id=ANY($1::uuid[])',
      [[...invitations.values()].map((invitation) => invitation.id)],
    );
  } finally {
    await pool.end();
    invitations.clear();
  }
});

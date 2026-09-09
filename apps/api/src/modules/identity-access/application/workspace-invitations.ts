import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { createCompany } from '../../companies/domain/index.js';
import { createUserAccount } from '../domain/index.js';
import {
  createOpaqueSecurityToken,
  digestSecurityToken,
} from '../security/index.js';

/** Deployment-operator capability. Never expose this through tenant HTTP routes. */
export async function issueWorkspaceInvitation(
  pool: Pool,
  input: {
    email: string;
    companyCode: string;
    companyName: string;
    operator: string;
  },
) {
  const company = createCompany({
    id: randomUUID(),
    code: input.companyCode,
    name: input.companyName,
  });
  const account = createUserAccount({
    id: randomUUID(),
    email: input.email,
    displayName: 'Invited company owner',
  });
  if (!input.operator.trim() || input.operator.length > 120)
    throw new Error('Provide the operator name (1–120 characters).');
  const token = createOpaqueSecurityToken();
  const id = randomUUID();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const role = (await client.query('SELECT current_user AS role')).rows[0]
      ?.role;
    if (role !== 'zampayroll_migrator')
      throw new Error(
        'Workspace invitations require the deployment operator database role.',
      );
    if (
      (
        await client.query('SELECT 1 FROM app.companies WHERE code=$1', [
          company.code,
        ])
      ).rowCount
    ) {
      throw new Error(
        'This company already exists. Use its Team invitations to add people.',
      );
    }
    const invitation = (
      await client.query(
        `INSERT INTO app.workspace_invitations(id,email,company_code,company_name,token_digest,issued_by,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,statement_timestamp()+interval '7 days') RETURNING expires_at AS "expiresAt"`,
        [
          id,
          account.email,
          company.code,
          company.name,
          digestSecurityToken(token),
          input.operator.trim(),
        ],
      )
    ).rows[0]!;
    await client.query(
      'INSERT INTO app.workspace_invitation_events(id,invitation_id,action,actor) VALUES($1,$2,$3,$4)',
      [randomUUID(), id, 'issued', input.operator.trim()],
    );
    await client.query('COMMIT');
    return { id, token, expiresAt: invitation.expiresAt as Date };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeWorkspaceInvitation(
  pool: Pool,
  id: string,
  operator: string,
) {
  if (!operator.trim() || operator.length > 120)
    throw new Error('Provide the operator name (1–120 characters).');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      "UPDATE app.workspace_invitations SET status='revoked' WHERE id=$1 AND status='pending' RETURNING id",
      [id],
    );
    if (result.rowCount !== 1)
      throw new Error(
        'No pending invitation with that ID. Accepted invitations cannot be revoked.',
      );
    await client.query(
      'INSERT INTO app.workspace_invitation_events(id,invitation_id,action,actor) VALUES($1,$2,$3,$4)',
      [randomUUID(), id, 'revoked', operator.trim()],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

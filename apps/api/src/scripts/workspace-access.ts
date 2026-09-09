import { open, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Pool } from 'pg';
import {
  issueWorkspaceInvitation,
  revokeWorkspaceInvitation,
} from '../modules/identity-access/application/workspace-invitations.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    email: { type: 'string' },
    'company-code': { type: 'string' },
    'company-name': { type: 'string' },
    operator: { type: 'string' },
    out: { type: 'string' },
    id: { type: 'string' },
  },
});
const required = (name: keyof typeof values) => {
  const value = values[name];
  if (!value) throw new Error(`Missing --${name}`);
  return value;
};
async function main() {
  if (!process.env.DATABASE_MIGRATION_URL)
    throw new Error(
      'DATABASE_MIGRATION_URL is required. Use the deployment operator connection.',
    );
  const pool = new Pool({
    connectionString: process.env.DATABASE_MIGRATION_URL,
    max: 1,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  });
  try {
    if (positionals.length !== 1)
      throw new Error(
        'Use create, list or revoke. See docs/invite-only-access.md.',
      );
    if (positionals[0] === 'create') {
      const origin = process.env.WEB_ORIGIN;
      if (
        !origin ||
        !['http:', 'https:'].includes(new URL(origin).protocol) ||
        new URL(origin).origin !== origin ||
        (process.env.NODE_ENV === 'production' &&
          !origin.startsWith('https://'))
      )
        throw new Error(
          'Set WEB_ORIGIN to the exact application origin (HTTPS in production).',
        );
      const input = {
        email: required('email'),
        companyCode: required('company-code'),
        companyName: required('company-name'),
        operator: required('operator'),
      };
      const path = resolve(required('out'));
      // Reserve a private new file before issuing a token; never overwrite a link.
      const file = await open(path, 'wx', 0o600);
      let invitation;
      try {
        invitation = await issueWorkspaceInvitation(pool, input);
        await file.writeFile(
          `${origin}/#workspace-invite=${invitation.token}\n`,
        );
        await file.sync();
      } catch (error) {
        if (invitation)
          await revokeWorkspaceInvitation(pool, invitation.id, input.operator);
        await unlink(path);
        throw error;
      } finally {
        await file.close();
      }
      console.info(
        `Invitation ${invitation.id} expires ${invitation.expiresAt.toISOString()}. Private link saved to ${path}.`,
      );
    } else if (positionals[0] === 'revoke') {
      await revokeWorkspaceInvitation(
        pool,
        required('id'),
        required('operator'),
      );
      console.info('Invitation revoked.');
    } else if (positionals[0] === 'list') {
      const result =
        await pool.query(`SELECT id,email,company_code,company_name,
        CASE WHEN status='pending' AND expires_at<=statement_timestamp() THEN 'expired' ELSE status END AS status,
        expires_at,issued_by FROM app.workspace_invitations ORDER BY created_at DESC LIMIT 100`);
      console.table(result.rows);
    } else
      throw new Error(
        'Use create, list or revoke. See docs/invite-only-access.md.',
      );
  } finally {
    await pool.end();
  }
}
void main().catch((error: unknown) => {
  // Database errors can embed customer data; never print SQL details or credentials.
  console.error(
    error instanceof Error && !('code' in error)
      ? error.message
      : 'Workspace access command failed. Check operator access, company code and pending invitations.',
  );
  process.exitCode = 1;
});

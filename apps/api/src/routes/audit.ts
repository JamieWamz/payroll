import { randomUUID } from 'node:crypto';

import type { TenantTransaction } from '../infrastructure/database.js';
import type { AuthorizationPrincipal } from '../modules/identity-access/security/index.js';

export async function appendSuccessfulAuditEvent(
  transaction: TenantTransaction,
  principal: Readonly<AuthorizationPrincipal>,
  requestId: string,
  event: { eventType: string; targetId: string; targetType: string },
): Promise<void> {
  await transaction.query(
    `SELECT app.append_audit_event(
       $1, $2, $3, $4, 'succeeded', $5, $6, $7, NULL, '{}'::jsonb
     )`,
    [
      randomUUID(),
      principal.companyId,
      principal.userAccountId,
      event.eventType,
      event.targetType,
      event.targetId,
      requestId,
    ],
  );
}

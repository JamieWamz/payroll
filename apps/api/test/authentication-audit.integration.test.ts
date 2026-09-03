import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const testDatabaseMigrationUrl = process.env.TEST_DATABASE_MIGRATION_URL;

const fixture = {
  auditEvents: {
    global: '63000000-0000-4000-8000-000000000001',
    tenant: '63000000-0000-4000-8000-000000000002',
    rejected: '63000000-0000-4000-8000-000000000003',
  },
  company: '61000000-0000-4000-8000-000000000001',
  foreignCompany: '61000000-0000-4000-8000-000000000002',
  session: '64000000-0000-4000-8000-000000000001',
  userAccount: '62000000-0000-4000-8000-000000000001',
} as const;

const protectedTables = [
  'audit_events',
  'password_credentials',
  'sessions',
] as const;

describe.runIf(
  testDatabaseUrl !== undefined && testDatabaseMigrationUrl !== undefined,
)('authentication and append-only audit PostgreSQL foundation', () => {
  let migrationPool: Pool | undefined;
  let runtimePool: Pool | undefined;

  beforeAll(async () => {
    if (
      testDatabaseUrl === undefined ||
      testDatabaseMigrationUrl === undefined
    ) {
      throw new Error(
        'TEST_DATABASE_URL and TEST_DATABASE_MIGRATION_URL are required',
      );
    }

    migrationPool = createPool(testDatabaseMigrationUrl, 'security-migration');
    runtimePool = createPool(testDatabaseUrl, 'security-runtime');
    await cleanFixtures(requireMigrationPool());
    await seedFixtures(requireMigrationPool());
  });

  afterAll(async () => {
    if (migrationPool !== undefined) {
      await cleanFixtures(migrationPool);
    }
    if (runtimePool !== undefined) {
      await runtimePool.end();
    }
    if (migrationPool !== undefined) {
      await migrationPool.end();
    }
  });

  it('forces RLS and removes direct runtime table privileges', async () => {
    const security = await requireMigrationPool().query<{
      canDelete: boolean;
      canInsert: boolean;
      canSelect: boolean;
      canUpdate: boolean;
      rlsEnabled: boolean;
      rlsForced: boolean;
      tableName: string;
    }>(
      `
        SELECT
          requested_table.table_name AS "tableName",
          table_record.relrowsecurity AS "rlsEnabled",
          table_record.relforcerowsecurity AS "rlsForced",
          has_table_privilege(
            'zampayroll_app',
            format('app.%I', requested_table.table_name),
            'SELECT'
          ) AS "canSelect",
          has_table_privilege(
            'zampayroll_app',
            format('app.%I', requested_table.table_name),
            'INSERT'
          ) AS "canInsert",
          has_table_privilege(
            'zampayroll_app',
            format('app.%I', requested_table.table_name),
            'UPDATE'
          ) AS "canUpdate",
          has_table_privilege(
            'zampayroll_app',
            format('app.%I', requested_table.table_name),
            'DELETE'
          ) AS "canDelete"
        FROM unnest($1::text[]) AS requested_table(table_name)
        JOIN pg_catalog.pg_class AS table_record
          ON table_record.relname = requested_table.table_name
        JOIN pg_catalog.pg_namespace AS table_schema
          ON table_schema.oid = table_record.relnamespace
          AND table_schema.nspname = 'app'
        ORDER BY requested_table.table_name
      `,
      [protectedTables],
    );

    expect(security.rows).toEqual(
      protectedTables.map((tableName) => ({
        canDelete: false,
        canInsert: false,
        canSelect: false,
        canUpdate: false,
        rlsEnabled: true,
        rlsForced: true,
        tableName,
      })),
    );
  });

  it('exposes only the narrow audit append function to runtime', async () => {
    const privileges = await requireMigrationPool().query<{
      appCanExecute: boolean;
      publicCanExecute: boolean;
      securityDefiner: boolean;
    }>(`
      SELECT
        has_function_privilege(
          'zampayroll_app',
          'app.append_audit_event(uuid,uuid,uuid,text,text,text,uuid,text,text,jsonb)',
          'EXECUTE'
        ) AS "appCanExecute",
        EXISTS (
          SELECT 1
          FROM aclexplode(
            COALESCE(
              function_record.proacl,
              acldefault('f', function_record.proowner)
            )
          ) AS function_privilege
          WHERE function_privilege.grantee = 0
            AND function_privilege.privilege_type = 'EXECUTE'
        ) AS "publicCanExecute",
        function_record.prosecdef AS "securityDefiner"
      FROM pg_catalog.pg_proc AS function_record
      JOIN pg_catalog.pg_namespace AS function_schema
        ON function_schema.oid = function_record.pronamespace
      WHERE function_schema.nspname = 'app'
        AND function_record.proname = 'append_audit_event'
    `);

    expect(privileges.rows).toEqual([
      {
        appCanExecute: true,
        publicCanExecute: false,
        securityDefiner: true,
      },
    ]);
  });

  it('denies direct credential, session, and audit reads to runtime', async () => {
    for (const tableName of protectedTables) {
      await expect(
        requireRuntimePool().query(`SELECT * FROM app.${tableName} LIMIT 1`),
      ).rejects.toMatchObject({ code: '42501' });
    }
  });

  it('appends a global authentication event without exposing its table', async () => {
    await appendAuditEvent(requireRuntimePool(), {
      actorId: fixture.userAccount,
      companyId: null,
      eventId: fixture.auditEvents.global,
      eventName: 'auth.login.succeeded',
      outcome: 'succeeded',
      targetId: fixture.userAccount,
      targetName: 'user-account',
    });

    const stored = await requireMigrationPool().query<{
      actorId: string;
      companyId: string | null;
      eventType: string;
      metadata: Record<string, unknown>;
      outcome: string;
      targetId: string;
      targetType: string;
    }>(
      `
        SELECT
          company_id AS "companyId",
          actor_user_account_id AS "actorId",
          event_type AS "eventType",
          outcome,
          target_type AS "targetType",
          target_id AS "targetId",
          metadata
        FROM app.audit_events
        WHERE id = $1
      `,
      [fixture.auditEvents.global],
    );

    expect(stored.rows).toEqual([
      {
        actorId: fixture.userAccount,
        companyId: null,
        eventType: 'auth.login.succeeded',
        metadata: { authentication_method: 'password' },
        outcome: 'succeeded',
        targetId: fixture.userAccount,
        targetType: 'user-account',
      },
    ]);
  });

  it('accepts matching tenant audit context and rejects a mismatch', async () => {
    const client = await requireRuntimePool().connect();

    try {
      await client.query('BEGIN');
      await setLocalCompany(client, fixture.company);
      await appendAuditEvent(client, {
        actorId: fixture.userAccount,
        companyId: fixture.company,
        eventId: fixture.auditEvents.tenant,
        eventName: 'company.settings.updated',
        outcome: 'succeeded',
        targetId: fixture.company,
        targetName: 'company',
      });
      await client.query('COMMIT');

      await client.query('BEGIN');
      await setLocalCompany(client, fixture.company);
      await expect(
        appendAuditEvent(client, {
          actorId: fixture.userAccount,
          companyId: fixture.foreignCompany,
          eventId: fixture.auditEvents.rejected,
          eventName: 'company.settings.updated',
          outcome: 'denied',
          targetId: fixture.foreignCompany,
          targetName: 'company',
        }),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }

    const storedIds = await requireMigrationPool().query<{ id: string }>(
      `
        SELECT id
        FROM app.audit_events
        WHERE id = ANY($1::uuid[])
        ORDER BY id
      `,
      [[fixture.auditEvents.tenant, fixture.auditEvents.rejected]],
    );
    expect(storedIds.rows).toEqual([{ id: fixture.auditEvents.tenant }]);
  });

  it('enforces credential, session, and audit value boundaries', async () => {
    await expectDatabaseViolation(
      requireMigrationPool(),
      `
        UPDATE app.password_credentials
        SET password_hash = 'plain-text-password'
        WHERE user_account_id = '${fixture.userAccount}'
      `,
      '23514',
      'password_credentials_hash_check',
    );
    await expectDatabaseViolation(
      requireMigrationPool(),
      `
        UPDATE app.sessions
        SET idle_expires_at = created_at
        WHERE id = '${fixture.session}'
      `,
      '23514',
      'sessions_expiry_check',
    );
    await expectDatabaseViolation(
      requireMigrationPool(),
      `
        INSERT INTO app.audit_events (
          id,
          event_type,
          outcome,
          request_id,
          metadata
        )
        VALUES (
          '${fixture.auditEvents.rejected}',
          'invalid_event',
          'succeeded',
          'request-invalid',
          '{}'::jsonb
        )
      `,
      '23514',
      'audit_events_type_check',
    );
  });

  function requireMigrationPool(): Pool {
    if (migrationPool === undefined) {
      throw new Error('Migration test pool is not initialized');
    }
    return migrationPool;
  }

  function requireRuntimePool(): Pool {
    if (runtimePool === undefined) {
      throw new Error('Runtime test pool is not initialized');
    }
    return runtimePool;
  }
});

interface AppendAuditEventInput {
  readonly actorId: string | null;
  readonly companyId: string | null;
  readonly eventId: string;
  readonly eventName: string;
  readonly outcome: string;
  readonly targetId: string | null;
  readonly targetName: string | null;
}

interface QueryExecutor {
  query(text: string, values?: readonly unknown[]): Promise<unknown>;
}

async function appendAuditEvent(
  executor: QueryExecutor,
  input: AppendAuditEventInput,
): Promise<void> {
  await executor.query(
    `
      SELECT app.append_audit_event(
        $1::uuid,
        $2::uuid,
        $3::uuid,
        $4::text,
        $5::text,
        $6::text,
        $7::uuid,
        $8::text,
        $9::text,
        $10::jsonb
      )
    `,
    [
      input.eventId,
      input.companyId,
      input.actorId,
      input.eventName,
      input.outcome,
      input.targetName,
      input.targetId,
      'security-integration-request',
      'a'.repeat(64),
      JSON.stringify({ authentication_method: 'password' }),
    ],
  );
}

async function setLocalCompany(
  client: PoolClient,
  companyId: string,
): Promise<void> {
  await client.query(
    `SELECT pg_catalog.set_config('app.current_company_id', $1, true)`,
    [companyId],
  );
}

function createPool(connectionString: string, applicationName: string): Pool {
  return new Pool({
    application_name: `zampayroll-${applicationName}`,
    connectionString,
    connectionTimeoutMillis: 5_000,
    max: 2,
    statement_timeout: 5_000,
  });
}

async function expectDatabaseViolation(
  pool: Pool,
  statement: string,
  code: string,
  constraint: string,
): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await expect(client.query(statement)).rejects.toMatchObject({
      code,
      constraint,
    });
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

async function cleanFixtures(pool: Pool): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(
      'DELETE FROM app.audit_events WHERE id = ANY($1::uuid[])',
      [Object.values(fixture.auditEvents)],
    );
    await client.query('DELETE FROM app.sessions WHERE id = $1', [
      fixture.session,
    ]);
    await client.query(
      'DELETE FROM app.password_credentials WHERE user_account_id = $1',
      [fixture.userAccount],
    );
    await client.query('DELETE FROM app.user_accounts WHERE id = $1', [
      fixture.userAccount,
    ]);
    await client.query('DELETE FROM app.companies WHERE id = ANY($1::uuid[])', [
      [fixture.company, fixture.foreignCompany],
    ]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function seedFixtures(pool: Pool): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(
      `
        INSERT INTO app.companies (id, code, name)
        VALUES
          ($1, 'security-integration', 'Security Integration'),
          ($2, 'security-foreign', 'Security Foreign')
      `,
      [fixture.company, fixture.foreignCompany],
    );
    await client.query(
      `
        INSERT INTO app.user_accounts (id, email, display_name)
        VALUES ($1, 'security-integration@example.invalid', 'Security User')
      `,
      [fixture.userAccount],
    );
    await client.query(
      `
        INSERT INTO app.password_credentials (user_account_id, password_hash)
        VALUES (
          $1,
          '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g'
        )
      `,
      [fixture.userAccount],
    );
    await client.query(
      `
        INSERT INTO app.sessions (
          id,
          user_account_id,
          token_digest,
          csrf_token_digest,
          idle_expires_at,
          absolute_expires_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          statement_timestamp() + INTERVAL '30 minutes',
          statement_timestamp() + INTERVAL '8 hours'
        )
      `,
      [fixture.session, fixture.userAccount, 'b'.repeat(64), 'c'.repeat(64)],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

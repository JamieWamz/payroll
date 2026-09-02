import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadEnvironment } from '../src/config/environment.js';
import { createPostgresDatabase } from '../src/infrastructure/database.js';
import { parseEntityId } from '../src/shared/domain/entity-id.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const testDatabaseMigrationUrl = process.env.TEST_DATABASE_MIGRATION_URL;

const fixture = {
  companies: {
    alpha: '10000000-0000-4000-8000-000000000001',
    beta: '10000000-0000-4000-8000-000000000002',
  },
  memberships: {
    alpha: '30000000-0000-4000-8000-000000000001',
    beta: '30000000-0000-4000-8000-000000000002',
  },
  roles: {
    alpha: '40000000-0000-4000-8000-000000000001',
    beta: '40000000-0000-4000-8000-000000000002',
    transient: '40000000-0000-4000-8000-000000000003',
  },
  userAccount: '20000000-0000-4000-8000-000000000001',
} as const;

const tenantTableNames = [
  'companies',
  'company_memberships',
  'membership_roles',
  'role_permissions',
  'roles',
] as const;

const allTableNames = [...tenantTableNames, 'user_accounts'].toSorted();

describe.runIf(
  testDatabaseUrl !== undefined && testDatabaseMigrationUrl !== undefined,
)('tenant and identity PostgreSQL foundation', () => {
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

    migrationPool = createPool(testDatabaseMigrationUrl, 'migration-tests');
    runtimePool = createPool(testDatabaseUrl, 'runtime-tests');

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

  it('creates the bounded tenant and identity schema with forced RLS', async () => {
    const pool = requireMigrationPool();
    const tables = await pool.query<{
      rlsEnabled: boolean;
      rlsForced: boolean;
      tableName: string;
    }>(
      `
      SELECT
        table_record.relname AS "tableName",
        table_record.relrowsecurity AS "rlsEnabled",
        table_record.relforcerowsecurity AS "rlsForced"
      FROM pg_catalog.pg_class AS table_record
      JOIN pg_catalog.pg_namespace AS table_schema
        ON table_schema.oid = table_record.relnamespace
      WHERE table_schema.nspname = 'app'
        AND table_record.relkind IN ('r', 'p')
        AND table_record.relname = ANY($1::text[])
      ORDER BY table_record.relname
    `,
      [allTableNames],
    );

    expect(tables.rows).toEqual(
      allTableNames.map((tableName) => ({
        rlsEnabled: true,
        rlsForced: true,
        tableName,
      })),
    );

    const tenantFunction = await pool.query<{
      isSecurityInvoker: boolean;
      isStable: boolean;
      returnType: string;
    }>(`
      SELECT
        function_record.prorettype::regtype::text AS "returnType",
        function_record.provolatile = 's' AS "isStable",
        NOT function_record.prosecdef AS "isSecurityInvoker"
      FROM pg_catalog.pg_proc AS function_record
      JOIN pg_catalog.pg_namespace AS function_schema
        ON function_schema.oid = function_record.pronamespace
      WHERE function_schema.nspname = 'app'
        AND function_record.proname = 'current_company_id'
        AND function_record.pronargs = 0
    `);

    expect(tenantFunction.rows).toEqual([
      {
        isSecurityInvoker: true,
        isStable: true,
        returnType: 'uuid',
      },
    ]);

    const columnShape = await pool.query<{
      dateColumns: number;
      timestampColumns: number;
      unboundedCharacterColumns: number;
      uuidIdentifierColumns: number;
      versionColumns: number;
    }>(
      `
      SELECT
        count(*) FILTER (
          WHERE column_name IN (
            'id',
            'company_id',
            'user_account_id',
            'membership_id',
            'role_id'
          )
            AND data_type = 'uuid'
        )::integer AS "uuidIdentifierColumns",
        count(*) FILTER (
          WHERE column_name = 'version'
            AND data_type = 'bigint'
            AND is_nullable = 'NO'
        )::integer AS "versionColumns",
        count(*) FILTER (
          WHERE column_name IN ('created_at', 'updated_at')
            AND data_type = 'timestamp with time zone'
            AND is_nullable = 'NO'
        )::integer AS "timestampColumns",
        count(*) FILTER (
          WHERE column_name = 'assigned_on'
            AND data_type = 'date'
            AND is_nullable = 'NO'
        )::integer AS "dateColumns",
        count(*) FILTER (
          WHERE data_type = 'character varying'
            AND character_maximum_length IS NULL
        )::integer AS "unboundedCharacterColumns"
      FROM information_schema.columns
      WHERE table_schema = 'app'
        AND table_name = ANY($1::text[])
    `,
      [allTableNames],
    );

    expect(columnShape.rows).toEqual([
      {
        dateColumns: 1,
        timestampColumns: 12,
        unboundedCharacterColumns: 0,
        uuidIdentifierColumns: 12,
        versionColumns: 6,
      },
    ]);

    const foreignKeys = await pool.query<{
      compositeCount: number;
      restrictCount: number;
      totalCount: number;
    }>(
      `
      SELECT
        count(*)::integer AS "totalCount",
        count(*) FILTER (WHERE constraint_record.confdeltype = 'r')::integer
          AS "restrictCount",
        count(*) FILTER (
          WHERE cardinality(constraint_record.conkey) > 1
        )::integer AS "compositeCount"
      FROM pg_catalog.pg_constraint AS constraint_record
      JOIN pg_catalog.pg_class AS constrained_table
        ON constrained_table.oid = constraint_record.conrelid
      JOIN pg_catalog.pg_namespace AS table_schema
        ON table_schema.oid = constrained_table.relnamespace
      WHERE table_schema.nspname = 'app'
        AND constrained_table.relname = ANY($1::text[])
        AND constraint_record.contype = 'f'
    `,
      [allTableNames],
    );

    expect(foreignKeys.rows).toEqual([
      {
        compositeCount: 3,
        restrictCount: 6,
        totalCount: 6,
      },
    ]);

    const indexes = await pool.query<{ indexName: string }>(
      `
      SELECT indexname AS "indexName"
      FROM pg_catalog.pg_indexes
      WHERE schemaname = 'app'
        AND indexname = ANY($1::text[])
      ORDER BY indexname
    `,
      [
        [
          'companies_code_unique',
          'company_memberships_company_status_idx',
          'company_memberships_user_account_idx',
          'membership_roles_role_idx',
          'role_permissions_permission_idx',
          'roles_company_code_unique',
          'roles_company_status_idx',
          'user_accounts_email_unique',
        ],
      ],
    );

    expect(indexes.rows.map(({ indexName }) => indexName)).toEqual([
      'companies_code_unique',
      'company_memberships_company_status_idx',
      'company_memberships_user_account_idx',
      'membership_roles_role_idx',
      'role_permissions_permission_idx',
      'roles_company_code_unique',
      'roles_company_status_idx',
      'user_accounts_email_unique',
    ]);
  });

  it('defines an unrestricted migrator policy and scoped runtime policies', async () => {
    const policies = await requireMigrationPool().query<{
      migratorAllPolicies: number;
      runtimeCommands: string[];
      tableName: string;
    }>(
      `
      SELECT
        requested_table.table_name AS "tableName",
        count(policy_record.policyname) FILTER (
          WHERE policy_record.cmd = 'ALL'
            AND policy_record.roles @> ARRAY['zampayroll_migrator']::name[]
            AND policy_record.qual = 'true'
            AND policy_record.with_check = 'true'
        )::integer AS "migratorAllPolicies",
        COALESCE(
          array_agg(policy_record.cmd ORDER BY policy_record.cmd) FILTER (
            WHERE policy_record.roles @> ARRAY['zampayroll_app']::name[]
          ),
          ARRAY[]::text[]
        ) AS "runtimeCommands"
      FROM unnest($1::text[]) AS requested_table(table_name)
      LEFT JOIN pg_catalog.pg_policies AS policy_record
        ON policy_record.schemaname = 'app'
        AND policy_record.tablename = requested_table.table_name
      GROUP BY requested_table.table_name
      ORDER BY requested_table.table_name
    `,
      [allTableNames],
    );

    expect(policies.rows).toEqual(
      allTableNames.map((tableName) => ({
        migratorAllPolicies: 1,
        runtimeCommands:
          tableName === 'user_accounts' ? [] : ['INSERT', 'SELECT', 'UPDATE'],
        tableName,
      })),
    );

    const deletePrivileges = await requireMigrationPool().query<{
      canDelete: boolean;
      tableName: string;
    }>(
      `
      SELECT
        requested_table.table_name AS "tableName",
        has_table_privilege(
          'zampayroll_app',
          format('app.%I', requested_table.table_name),
          'DELETE'
        ) AS "canDelete"
      FROM unnest($1::text[]) AS requested_table(table_name)
      ORDER BY requested_table.table_name
    `,
      [allTableNames],
    );

    expect(deletePrivileges.rows).toEqual(
      allTableNames.map((tableName) => ({ canDelete: false, tableName })),
    );
  });

  it('keeps both database identities non-superuser and NOBYPASSRLS', async () => {
    const identities = await requireMigrationPool().query<{
      bypassesRls: boolean;
      isSuperuser: boolean;
      roleName: string;
    }>(`
      SELECT
        rolname AS "roleName",
        rolsuper AS "isSuperuser",
        rolbypassrls AS "bypassesRls"
      FROM pg_catalog.pg_roles
      WHERE rolname IN ('zampayroll_app', 'zampayroll_migrator')
      ORDER BY rolname
    `);

    expect(identities.rows).toEqual([
      {
        bypassesRls: false,
        isSuperuser: false,
        roleName: 'zampayroll_app',
      },
      {
        bypassesRls: false,
        isSuperuser: false,
        roleName: 'zampayroll_migrator',
      },
    ]);

    const migratorVisibility = await requireMigrationPool().query<{
      companyCount: number;
      currentUser: string;
      userCount: number;
    }>(`
      SELECT
        current_user AS "currentUser",
        (SELECT count(*)::integer FROM app.companies) AS "companyCount",
        (SELECT count(*)::integer FROM app.user_accounts) AS "userCount"
    `);

    expect(migratorVisibility.rows).toEqual([
      {
        companyCount: 2,
        currentUser: 'zampayroll_migrator',
        userCount: 1,
      },
    ]);
  });

  it('denies tenant rows and global users when runtime context is missing', async () => {
    const visibility = await requireRuntimePool().query<{
      companies: number;
      memberships: number;
      permissions: number;
      roles: number;
      users: number;
    }>(`
      SELECT
        (SELECT count(*)::integer FROM app.companies) AS companies,
        (SELECT count(*)::integer FROM app.roles) AS roles,
        (SELECT count(*)::integer FROM app.company_memberships) AS memberships,
        (SELECT count(*)::integer FROM app.role_permissions) AS permissions,
        (SELECT count(*)::integer FROM app.user_accounts) AS users
    `);

    expect(visibility.rows).toEqual([
      {
        companies: 0,
        memberships: 0,
        permissions: 0,
        roles: 0,
        users: 0,
      },
    ]);

    await expect(
      requireRuntimePool().query(
        `
          INSERT INTO app.roles (id, company_id, code, name)
          VALUES ($1, $2, 'missing-context', 'Missing Context')
        `,
        [fixture.roles.transient, fixture.companies.alpha],
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('exposes and mutates only rows for the correct transaction tenant', async () => {
    const client = await requireRuntimePool().connect();

    try {
      await client.query('BEGIN');
      await setLocalCompany(client, fixture.companies.alpha);

      const visibleRows = await client.query<{
        recordId: string;
        recordType: string;
      }>(`
        SELECT 'company' AS "recordType", id::text AS "recordId"
        FROM app.companies
        UNION ALL
        SELECT 'role', id::text FROM app.roles
        UNION ALL
        SELECT 'membership', id::text FROM app.company_memberships
        UNION ALL
        SELECT 'assignment', membership_id::text FROM app.membership_roles
        UNION ALL
        SELECT 'permission', role_id::text FROM app.role_permissions
        ORDER BY "recordType"
      `);

      expect(visibleRows.rows).toEqual([
        { recordId: fixture.memberships.alpha, recordType: 'assignment' },
        { recordId: fixture.companies.alpha, recordType: 'company' },
        { recordId: fixture.memberships.alpha, recordType: 'membership' },
        { recordId: fixture.roles.alpha, recordType: 'permission' },
        { recordId: fixture.roles.alpha, recordType: 'role' },
      ]);

      const hiddenUsers = await client.query(
        'SELECT id FROM app.user_accounts',
      );
      expect(hiddenUsers.rows).toEqual([]);

      await client.query(
        `
          INSERT INTO app.roles (id, company_id, code, name)
          VALUES ($1, $2, 'transient-role', 'Transient Role')
        `,
        [fixture.roles.transient, fixture.companies.alpha],
      );
      const updated = await client.query<{
        name: string;
        version: string;
      }>(
        `
          UPDATE app.roles
          SET name = 'Updated Transient Role',
              version = version + 1,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
          RETURNING name, version
        `,
        [fixture.roles.transient],
      );

      expect(updated.rows).toEqual([
        { name: 'Updated Transient Role', version: '2' },
      ]);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('applies tenant isolation through the production database adapter', async () => {
    const database = createPostgresDatabase(
      loadEnvironment({
        DATABASE_URL: testDatabaseUrl,
        NODE_ENV: 'test',
      }),
    );

    try {
      const alphaRoles = await database.withTenantTransaction(
        parseEntityId(fixture.companies.alpha, 'Company'),
        async (transaction) =>
          (
            await transaction.query<{ id: string }>(
              'SELECT id FROM app.roles ORDER BY id',
            )
          ).rows,
      );
      const betaRoles = await database.withTenantTransaction(
        parseEntityId(fixture.companies.beta, 'Company'),
        async (transaction) =>
          (
            await transaction.query<{ id: string }>(
              'SELECT id FROM app.roles ORDER BY id',
            )
          ).rows,
      );

      expect(alphaRoles).toEqual([{ id: fixture.roles.alpha }]);
      expect(betaRoles).toEqual([{ id: fixture.roles.beta }]);
    } finally {
      await database.close();
    }
  });

  it('hides another tenant and rejects writes carrying the wrong company', async () => {
    const client = await requireRuntimePool().connect();

    try {
      await client.query('BEGIN');
      await setLocalCompany(client, fixture.companies.beta);

      const visibleCompanies = await client.query<{ id: string }>(
        'SELECT id FROM app.companies ORDER BY id',
      );
      expect(visibleCompanies.rows).toEqual([{ id: fixture.companies.beta }]);

      const hiddenAlpha = await client.query(
        'SELECT id FROM app.roles WHERE id = $1',
        [fixture.roles.alpha],
      );
      expect(hiddenAlpha.rows).toEqual([]);

      await expect(
        client.query(
          `
            INSERT INTO app.roles (id, company_id, code, name)
            VALUES ($1, $2, 'wrong-company', 'Wrong Company')
          `,
          [fixture.roles.transient, fixture.companies.alpha],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('clears transaction-local company context after commit and rollback', async () => {
    const client = await requireRuntimePool().connect();

    try {
      await client.query('BEGIN');
      await setLocalCompany(client, fixture.companies.alpha);
      await expectCurrentCompany(client, fixture.companies.alpha);
      await client.query('COMMIT');
      await expectCurrentCompany(client, null);
      await expectNoVisibleCompanies(client);

      await client.query('BEGIN');
      await setLocalCompany(client, fixture.companies.beta);
      await expectCurrentCompany(client, fixture.companies.beta);
      await client.query('ROLLBACK');
      await expectCurrentCompany(client, null);
      await expectNoVisibleCompanies(client);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('enforces normalized values, lifecycle values, ranges, and dates', async () => {
    const pool = requireMigrationPool();

    await expectCheckViolation(
      pool,
      `
        INSERT INTO app.companies (id, code, name)
        VALUES ('50000000-0000-4000-8000-000000000001', '1-invalid', 'Invalid')
      `,
      'companies_code_check',
    );
    await expectCheckViolation(
      pool,
      `
        UPDATE app.companies
        SET status = 'deleted'
        WHERE id = '${fixture.companies.alpha}'
      `,
      'companies_status_check',
    );
    await expectDatabaseViolation(
      pool,
      `
        UPDATE app.user_accounts
        SET display_name = repeat('x', 121)
        WHERE id = '${fixture.userAccount}'
      `,
      '22001',
    );
    await expectCheckViolation(
      pool,
      `
        UPDATE app.user_accounts
        SET display_name = E'Invalid\\nName'
        WHERE id = '${fixture.userAccount}'
      `,
      'user_accounts_display_name_check',
    );
    await expectCheckViolation(
      pool,
      `
        UPDATE app.user_accounts
        SET email = 'invalid@-example.com'
        WHERE id = '${fixture.userAccount}'
      `,
      'user_accounts_email_check',
    );
    await expectCheckViolation(
      pool,
      `
        UPDATE app.roles
        SET code = 'Invalid-Code'
        WHERE id = '${fixture.roles.alpha}'
      `,
      'roles_code_check',
    );
    await expectCheckViolation(
      pool,
      `
        UPDATE app.role_permissions
        SET permission_key = 'not_namespaced'
        WHERE company_id = '${fixture.companies.alpha}'
          AND role_id = '${fixture.roles.alpha}'
      `,
      'role_permissions_key_check',
    );
    await expectCheckViolation(
      pool,
      `
        UPDATE app.membership_roles
        SET assigned_on = DATE '10000-01-01'
        WHERE company_id = '${fixture.companies.alpha}'
          AND membership_id = '${fixture.memberships.alpha}'
          AND role_id = '${fixture.roles.alpha}'
      `,
      'membership_roles_assigned_on_check',
    );
    await expectCheckViolation(
      pool,
      `
        UPDATE app.companies
        SET version = 0
        WHERE id = '${fixture.companies.alpha}'
      `,
      'companies_version_check',
    );
  });

  it('rejects cross-tenant composite assignments', async () => {
    const client = await requireRuntimePool().connect();

    try {
      await client.query('BEGIN');
      await setLocalCompany(client, fixture.companies.alpha);

      await expect(
        client.query(
          `
            INSERT INTO app.membership_roles (
              company_id,
              membership_id,
              role_id,
              assigned_on
            )
            VALUES ($1, $2, $3, DATE '2026-09-02')
          `,
          [
            fixture.companies.alpha,
            fixture.memberships.alpha,
            fixture.roles.beta,
          ],
        ),
      ).rejects.toMatchObject({
        code: '23503',
        constraint: 'membership_roles_role_fk',
      });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('denies hard deletes to runtime and restricts referenced migrator deletes', async () => {
    const client = await requireRuntimePool().connect();

    try {
      await client.query('BEGIN');
      await setLocalCompany(client, fixture.companies.alpha);
      await expect(
        client.query('DELETE FROM app.roles WHERE id = $1', [
          fixture.roles.alpha,
        ]),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }

    await expectRestrictViolation(
      requireMigrationPool(),
      `DELETE FROM app.user_accounts WHERE id = '${fixture.userAccount}'`,
      'company_memberships_user_account_fk',
    );
  });

  it('leaves global user accounts deny-by-default even with tenant context', async () => {
    const client = await requireRuntimePool().connect();

    try {
      await client.query('BEGIN');
      await setLocalCompany(client, fixture.companies.alpha);
      await expect(
        client.query(
          `
            INSERT INTO app.user_accounts (id, email, display_name)
            VALUES (
              '60000000-0000-4000-8000-000000000001',
              'blocked@example.invalid',
              'Blocked User'
            )
          `,
        ),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
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

function createPool(connectionString: string, applicationName: string): Pool {
  return new Pool({
    application_name: `zampayroll-${applicationName}`,
    connectionString,
    connectionTimeoutMillis: 5_000,
    max: 2,
    statement_timeout: 5_000,
  });
}

async function setLocalCompany(
  client: PoolClient,
  companyId: string,
): Promise<void> {
  await client.query(`SELECT set_config('app.current_company_id', $1, true)`, [
    companyId,
  ]);
}

async function expectCurrentCompany(
  client: PoolClient,
  expectedCompanyId: string | null,
): Promise<void> {
  const result = await client.query<{ companyId: string | null }>(
    'SELECT app.current_company_id() AS "companyId"',
  );
  expect(result.rows).toEqual([{ companyId: expectedCompanyId }]);
}

async function expectNoVisibleCompanies(client: PoolClient): Promise<void> {
  const result = await client.query<{ count: number }>(
    'SELECT count(*)::integer AS count FROM app.companies',
  );
  expect(result.rows).toEqual([{ count: 0 }]);
}

async function expectCheckViolation(
  pool: Pool,
  statement: string,
  constraint: string,
): Promise<void> {
  await expectDatabaseViolation(pool, statement, '23514', constraint);
}

async function expectRestrictViolation(
  pool: Pool,
  statement: string,
  constraint: string,
): Promise<void> {
  await expectDatabaseViolation(pool, statement, '23001', constraint);
}

async function expectDatabaseViolation(
  pool: Pool,
  statement: string,
  code: string,
  constraint?: string,
): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await expect(client.query(statement)).rejects.toMatchObject(
      constraint === undefined ? { code } : { code, constraint },
    );
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

async function cleanFixtures(pool: Pool): Promise<void> {
  const client = await pool.connect();
  const companyIds = [fixture.companies.alpha, fixture.companies.beta];

  try {
    await client.query('BEGIN');
    await client.query(
      'DELETE FROM app.role_permissions WHERE company_id = ANY($1::uuid[])',
      [companyIds],
    );
    await client.query(
      'DELETE FROM app.membership_roles WHERE company_id = ANY($1::uuid[])',
      [companyIds],
    );
    await client.query(
      'DELETE FROM app.company_memberships WHERE company_id = ANY($1::uuid[])',
      [companyIds],
    );
    await client.query(
      'DELETE FROM app.roles WHERE company_id = ANY($1::uuid[])',
      [companyIds],
    );
    await client.query('DELETE FROM app.user_accounts WHERE id = $1', [
      fixture.userAccount,
    ]);
    await client.query('DELETE FROM app.companies WHERE id = ANY($1::uuid[])', [
      companyIds,
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
        INSERT INTO app.companies (id, code, name, status)
        VALUES
          ($1, 'integration-alpha', 'Integration Alpha', 'active'),
          ($2, 'integration-beta', 'Integration Beta', 'suspended')
      `,
      [fixture.companies.alpha, fixture.companies.beta],
    );
    await client.query(
      `
        INSERT INTO app.user_accounts (id, email, display_name, status)
        VALUES ($1, 'integration@example.invalid', 'Integration User', 'active')
      `,
      [fixture.userAccount],
    );
    await client.query(
      `
        INSERT INTO app.roles (id, company_id, code, name, status)
        VALUES
          ($1, $2, 'payroll-admin', 'Payroll Administrator', 'active'),
          ($3, $4, 'payroll-reviewer', 'Payroll Reviewer', 'inactive')
      `,
      [
        fixture.roles.alpha,
        fixture.companies.alpha,
        fixture.roles.beta,
        fixture.companies.beta,
      ],
    );
    await client.query(
      `
        INSERT INTO app.company_memberships (
          id,
          company_id,
          user_account_id,
          status
        )
        VALUES
          ($1, $2, $3, 'active'),
          ($4, $5, $3, 'suspended')
      `,
      [
        fixture.memberships.alpha,
        fixture.companies.alpha,
        fixture.userAccount,
        fixture.memberships.beta,
        fixture.companies.beta,
      ],
    );
    await client.query(
      `
        INSERT INTO app.membership_roles (
          company_id,
          membership_id,
          role_id,
          assigned_on
        )
        VALUES
          ($1, $2, $3, DATE '2026-09-01'),
          ($4, $5, $6, DATE '2026-09-02')
      `,
      [
        fixture.companies.alpha,
        fixture.memberships.alpha,
        fixture.roles.alpha,
        fixture.companies.beta,
        fixture.memberships.beta,
        fixture.roles.beta,
      ],
    );
    await client.query(
      `
        INSERT INTO app.role_permissions (company_id, role_id, permission_key)
        VALUES
          ($1, $2, 'test.identity-read'),
          ($3, $4, 'test.identity-review')
      `,
      [
        fixture.companies.alpha,
        fixture.roles.alpha,
        fixture.companies.beta,
        fixture.roles.beta,
      ],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const testDatabaseMigrationUrl = process.env.TEST_DATABASE_MIGRATION_URL;

const fixture = {
  companies: {
    alpha: 'c1000000-0000-4000-8000-000000000001',
    beta: 'c1000000-0000-4000-8000-000000000002',
  },
  components: {
    alpha: 'c9000000-0000-4000-8000-000000000001',
  },
  configurations: {
    alpha: 'c6000000-0000-4000-8000-000000000001',
    beta: 'c6000000-0000-4000-8000-000000000002',
    draft: 'c6000000-0000-4000-8000-000000000003',
  },
  employees: {
    alpha: 'c3000000-0000-4000-8000-000000000001',
    beta: 'c3000000-0000-4000-8000-000000000002',
  },
  employments: {
    alpha: 'c4000000-0000-4000-8000-000000000001',
    beta: 'c4000000-0000-4000-8000-000000000002',
  },
  memberships: {
    alpha: 'c2000000-0000-4000-8000-000000000001',
    beta: 'c2000000-0000-4000-8000-000000000002',
  },
  periods: {
    alpha: 'c5000000-0000-4000-8000-000000000001',
    beta: 'c5000000-0000-4000-8000-000000000002',
  },
  runEmployees: {
    alpha: 'c8000000-0000-4000-8000-000000000001',
    beta: 'c8000000-0000-4000-8000-000000000002',
    transient: 'c8000000-0000-4000-8000-000000000003',
  },
  runs: {
    alpha: 'c7000000-0000-4000-8000-000000000001',
    beta: 'c7000000-0000-4000-8000-000000000002',
    transient: 'c7000000-0000-4000-8000-000000000003',
  },
  sources: [
    'ca000000-0000-4000-8000-000000000001',
    'ca000000-0000-4000-8000-000000000002',
    'ca000000-0000-4000-8000-000000000003',
    'ca000000-0000-4000-8000-000000000004',
    'ca000000-0000-4000-8000-000000000005',
    'ca000000-0000-4000-8000-000000000006',
  ],
  users: {
    alpha: 'cb000000-0000-4000-8000-000000000001',
    beta: 'cb000000-0000-4000-8000-000000000002',
  },
} as const;

const payrollRunTables = [
  'payroll_run_components',
  'payroll_run_employees',
  'payroll_runs',
] as const;

describe.runIf(
  testDatabaseUrl !== undefined && testDatabaseMigrationUrl !== undefined,
)('tenant-isolated payroll run PostgreSQL foundation', () => {
  let migrationPool: Pool | undefined;
  let runtimePool: Pool | undefined;

  beforeAll(async () => {
    if (
      testDatabaseUrl === undefined ||
      testDatabaseMigrationUrl === undefined
    ) {
      throw new Error('Test database URLs are required');
    }
    migrationPool = createPool(testDatabaseMigrationUrl, 'payroll-run-ddl');
    runtimePool = createPool(testDatabaseUrl, 'payroll-run-runtime');
    await cleanFixtures(requireMigrationPool());
    await seedFixtures(requireMigrationPool());
  });

  afterAll(async () => {
    if (migrationPool !== undefined) {
      await cleanFixtures(migrationPool);
    }
    await runtimePool?.end();
    await migrationPool?.end();
  });

  it('forces RLS and grants runtime no hard-delete access', async () => {
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
            requested.table_name AS "tableName",
            record.relrowsecurity AS "rlsEnabled",
            record.relforcerowsecurity AS "rlsForced",
            has_table_privilege('zampayroll_app',
              format('app.%I', requested.table_name), 'SELECT') AS "canSelect",
            has_table_privilege('zampayroll_app',
              format('app.%I', requested.table_name), 'INSERT') AS "canInsert",
            has_table_privilege('zampayroll_app',
              format('app.%I', requested.table_name), 'UPDATE') AS "canUpdate",
            has_table_privilege('zampayroll_app',
              format('app.%I', requested.table_name), 'DELETE') AS "canDelete"
          FROM unnest($1::text[]) AS requested(table_name)
          JOIN pg_catalog.pg_class AS record
            ON record.relname = requested.table_name
          JOIN pg_catalog.pg_namespace AS namespace
            ON namespace.oid = record.relnamespace
            AND namespace.nspname = 'app'
          ORDER BY requested.table_name
        `,
      [payrollRunTables],
    );

    expect(security.rows).toEqual(
      payrollRunTables.map((tableName) => ({
        canDelete: false,
        canInsert: true,
        canSelect: true,
        canUpdate: true,
        rlsEnabled: true,
        rlsForced: true,
        tableName,
      })),
    );
  });

  it('denies visibility without context and isolates company runs', async () => {
    await expect(
      requireRuntimePool().query('SELECT id FROM app.payroll_runs'),
    ).resolves.toMatchObject({ rows: [] });

    const client = await requireRuntimePool().connect();
    try {
      await client.query('BEGIN');
      await setLocalCompany(client, fixture.companies.alpha);
      const visible = await client.query<{
        employeeId: string;
        runId: string;
      }>(`
          SELECT payroll_run.id AS "runId", run_employee.employee_id AS "employeeId"
          FROM app.payroll_runs AS payroll_run
          JOIN app.payroll_run_employees AS run_employee
            ON run_employee.company_id = payroll_run.company_id
            AND run_employee.payroll_run_id = payroll_run.id
        `);
      expect(visible.rows).toEqual([
        { employeeId: fixture.employees.alpha, runId: fixture.runs.alpha },
      ]);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('requires a verified configuration that covers the payroll period', async () => {
    const client = await requireMigrationPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO app.statutory_configurations (
             id, company_id, configuration_version,
             effective_from, effective_to, parameters
           ) VALUES ($1, $2, 'DRAFT-ONLY', DATE '2026-01-01',
             DATE '2026-12-31', '{}'::jsonb)`,
        [fixture.configurations.draft, fixture.companies.alpha],
      );
      await expect(
        client.query(
          `INSERT INTO app.payroll_runs (
               id, company_id, payroll_period_id,
               statutory_configuration_id, created_by_membership_id
             ) VALUES ($1, $2, $3, $4, $5)`,
          [
            fixture.runs.transient,
            fixture.companies.alpha,
            fixture.periods.alpha,
            fixture.configurations.draft,
            fixture.memberships.alpha,
          ],
        ),
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'payroll_runs_verified_configuration',
      });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('rejects cross-company employee and employment snapshots', async () => {
    await expectDatabaseViolation(
      `
          INSERT INTO app.payroll_run_employees (
            id, company_id, payroll_run_id, employee_id,
            employment_id, input_snapshot
          ) VALUES (
            '${fixture.runEmployees.transient}',
            '${fixture.companies.alpha}',
            '${fixture.runs.alpha}',
            '${fixture.employees.beta}',
            '${fixture.employments.beta}',
            '{}'::jsonb
          )
        `,
      '23503',
      'payroll_run_employees_employee_fk',
    );
  });

  it('requires every selected employee result before marking a run calculated', async () => {
    await expectDatabaseViolation(
      calculatedRunUpdate(fixture.runs.alpha),
      '23514',
      'payroll_runs_calculation_complete',
    );
  });

  it('supports calculate, review, finalize, and immutable finalized snapshots', async () => {
    const client = await requireMigrationPool().connect();
    try {
      await client.query('BEGIN');
      await calculateAlphaRun(client);
      await client.query(
        `UPDATE app.payroll_runs
           SET status = 'finalized',
               finalized_by_membership_id = $2,
               finalized_at = statement_timestamp(),
               row_version = row_version + 1
           WHERE id = $1`,
        [fixture.runs.alpha, fixture.memberships.alpha],
      );

      const finalized = await client.query<{ status: string }>(
        'SELECT status FROM app.payroll_runs WHERE id = $1',
        [fixture.runs.alpha],
      );
      expect(finalized.rows).toEqual([{ status: 'finalized' }]);

      await expectViolationAtSavepoint(
        client,
        `UPDATE app.payroll_runs SET updated_at = statement_timestamp()
           WHERE id = '${fixture.runs.alpha}'`,
        'payroll_runs_finalized_immutable',
      );
      await expectViolationAtSavepoint(
        client,
        `UPDATE app.payroll_run_employees
           SET result_snapshot = '{"changed":true}'::jsonb
           WHERE id = '${fixture.runEmployees.alpha}'`,
        'payroll_run_employees_finalized_immutable',
      );
      await expectViolationAtSavepoint(
        client,
        `UPDATE app.payroll_run_components SET amount_minor_units = 1
           WHERE id = '${fixture.components.alpha}'`,
        'payroll_run_components_finalized_immutable',
      );
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('can return a calculated run to draft only after clearing results', async () => {
    const client = await requireMigrationPool().connect();
    try {
      await client.query('BEGIN');
      await calculateAlphaRun(client);
      await expect(
        client.query(
          `UPDATE app.payroll_run_employees
             SET status = 'selected', result_snapshot = NULL
             WHERE id = $1`,
          [fixture.runEmployees.alpha],
        ),
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'payroll_run_employees_components_cleared',
      });

      await client.query('ROLLBACK');
      await client.query('BEGIN');
      await calculateAlphaRun(client);
      await client.query(
        'DELETE FROM app.payroll_run_components WHERE id = $1',
        [fixture.components.alpha],
      );
      await client.query(
        `UPDATE app.payroll_run_employees
           SET status = 'selected', result_snapshot = NULL,
               row_version = row_version + 1
           WHERE id = $1`,
        [fixture.runEmployees.alpha],
      );
      await expect(
        client.query(
          `UPDATE app.payroll_runs
             SET status = 'draft', calculation_version = NULL,
                 rounding_policy = NULL,
                 calculated_by_membership_id = NULL, calculated_at = NULL,
                 row_version = row_version + 1
             WHERE id = $1`,
          [fixture.runs.alpha],
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('denies runtime hard deletes', async () => {
    const client = await requireRuntimePool().connect();
    try {
      await client.query('BEGIN');
      await setLocalCompany(client, fixture.companies.alpha);
      await expect(
        client.query('DELETE FROM app.payroll_runs WHERE id = $1', [
          fixture.runs.alpha,
        ]),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  function requireMigrationPool(): Pool {
    if (migrationPool === undefined) {
      throw new Error('Migration pool is not initialized');
    }
    return migrationPool;
  }

  function requireRuntimePool(): Pool {
    if (runtimePool === undefined) {
      throw new Error('Runtime pool is not initialized');
    }
    return runtimePool;
  }

  async function expectDatabaseViolation(
    statement: string,
    code: string,
    constraint: string,
  ): Promise<void> {
    const client = await requireMigrationPool().connect();
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
  await client.query(
    `SELECT pg_catalog.set_config('app.current_company_id', $1, true)`,
    [companyId],
  );
}

function calculatedRunUpdate(runId: string): string {
  return `
    UPDATE app.payroll_runs
    SET status = 'calculated',
        calculation_version = 'ENGINE-0.1.0',
        rounding_policy = 'ZMW-2DP-HALF-UP',
        calculated_by_membership_id = '${fixture.memberships.alpha}',
        calculated_at = statement_timestamp(),
        row_version = row_version + 1
    WHERE id = '${runId}'
  `;
}

async function calculateAlphaRun(client: PoolClient): Promise<void> {
  await client.query(
    `UPDATE app.payroll_run_employees
     SET status = 'calculated',
         result_snapshot = '{"grossPay":"1000.00","netPay":"820.00"}'::jsonb,
         row_version = row_version + 1
     WHERE id = $1`,
    [fixture.runEmployees.alpha],
  );
  await client.query(
    `INSERT INTO app.payroll_run_components (
       id, company_id, payroll_run_employee_id, payroll_run_id,
       code, kind, amount_minor_units, currency, currency_scale
     ) VALUES ($1, $2, $3, $4, 'BASE', 'earning', 100000, 'ZMW', 2)`,
    [
      fixture.components.alpha,
      fixture.companies.alpha,
      fixture.runEmployees.alpha,
      fixture.runs.alpha,
    ],
  );
  await client.query(calculatedRunUpdate(fixture.runs.alpha));
}

async function expectViolationAtSavepoint(
  client: PoolClient,
  statement: string,
  constraint: string,
): Promise<void> {
  await client.query('SAVEPOINT expected_violation');
  await expect(client.query(statement)).rejects.toMatchObject({
    code: '23514',
    constraint,
  });
  await client.query('ROLLBACK TO SAVEPOINT expected_violation');
}

async function cleanFixtures(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'DELETE FROM app.payroll_run_components WHERE company_id = ANY($1::uuid[])',
      [Object.values(fixture.companies)],
    );
    await client.query(
      'DELETE FROM app.payroll_run_employees WHERE company_id = ANY($1::uuid[])',
      [Object.values(fixture.companies)],
    );
    await client.query(
      'DELETE FROM app.payroll_runs WHERE company_id = ANY($1::uuid[])',
      [Object.values(fixture.companies)],
    );
    await client.query(
      'DELETE FROM app.statutory_sources WHERE company_id = ANY($1::uuid[])',
      [Object.values(fixture.companies)],
    );
    await client.query(
      'DELETE FROM app.statutory_configurations WHERE company_id = ANY($1::uuid[])',
      [Object.values(fixture.companies)],
    );
    await client.query(
      'DELETE FROM app.payroll_periods WHERE company_id = ANY($1::uuid[])',
      [Object.values(fixture.companies)],
    );
    await client.query(
      'DELETE FROM app.employments WHERE company_id = ANY($1::uuid[])',
      [Object.values(fixture.companies)],
    );
    await client.query(
      'DELETE FROM app.employees WHERE company_id = ANY($1::uuid[])',
      [Object.values(fixture.companies)],
    );
    await client.query(
      'DELETE FROM app.company_memberships WHERE company_id = ANY($1::uuid[])',
      [Object.values(fixture.companies)],
    );
    await client.query(
      'DELETE FROM app.user_accounts WHERE id = ANY($1::uuid[])',
      [Object.values(fixture.users)],
    );
    await client.query('DELETE FROM app.companies WHERE id = ANY($1::uuid[])', [
      Object.values(fixture.companies),
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
      `INSERT INTO app.companies (id, code, name)
       VALUES ($1, 'run-alpha', 'Payroll Run Alpha'),
              ($2, 'run-beta', 'Payroll Run Beta')`,
      [fixture.companies.alpha, fixture.companies.beta],
    );
    await client.query(
      `INSERT INTO app.user_accounts (id, email, display_name)
       VALUES ($1, 'run-alpha@example.com', 'Alpha Payroll User'),
              ($2, 'run-beta@example.com', 'Beta Payroll User')`,
      [fixture.users.alpha, fixture.users.beta],
    );
    await client.query(
      `INSERT INTO app.company_memberships (id, company_id, user_account_id)
       VALUES ($1, $2, $3), ($4, $5, $6)`,
      [
        fixture.memberships.alpha,
        fixture.companies.alpha,
        fixture.users.alpha,
        fixture.memberships.beta,
        fixture.companies.beta,
        fixture.users.beta,
      ],
    );
    await client.query(
      `INSERT INTO app.employees (
         id, company_id, employee_number, given_name, family_name
       ) VALUES ($1, $2, 'RUN/001', 'Chanda', 'Banda'),
                ($3, $4, 'RUN/001', 'Mutinta', 'Zulu')`,
      [
        fixture.employees.alpha,
        fixture.companies.alpha,
        fixture.employees.beta,
        fixture.companies.beta,
      ],
    );
    await client.query(
      `INSERT INTO app.employments (
         id, company_id, employee_id, position_title, starts_on
       ) VALUES ($1, $2, $3, 'Payroll Officer', DATE '2025-01-01'),
                ($4, $5, $6, 'Payroll Officer', DATE '2025-01-01')`,
      [
        fixture.employments.alpha,
        fixture.companies.alpha,
        fixture.employees.alpha,
        fixture.employments.beta,
        fixture.companies.beta,
        fixture.employees.beta,
      ],
    );
    await client.query(
      `INSERT INTO app.payroll_periods (
         id, company_id, code, starts_on, ends_on, payment_date
       ) VALUES ($1, $2, 'SEP-2026', DATE '2026-09-01',
                   DATE '2026-09-30', DATE '2026-09-25'),
                ($3, $4, 'SEP-2026', DATE '2026-09-01',
                   DATE '2026-09-30', DATE '2026-09-25')`,
      [
        fixture.periods.alpha,
        fixture.companies.alpha,
        fixture.periods.beta,
        fixture.companies.beta,
      ],
    );
    await seedVerifiedConfiguration(
      client,
      fixture.companies.alpha,
      fixture.configurations.alpha,
      fixture.memberships.alpha,
      fixture.sources.slice(0, 3),
    );
    await seedVerifiedConfiguration(
      client,
      fixture.companies.beta,
      fixture.configurations.beta,
      fixture.memberships.beta,
      fixture.sources.slice(3, 6),
    );
    await client.query(
      `INSERT INTO app.payroll_runs (
         id, company_id, payroll_period_id,
         statutory_configuration_id, created_by_membership_id
       ) VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)`,
      [
        fixture.runs.alpha,
        fixture.companies.alpha,
        fixture.periods.alpha,
        fixture.configurations.alpha,
        fixture.memberships.alpha,
        fixture.runs.beta,
        fixture.companies.beta,
        fixture.periods.beta,
        fixture.configurations.beta,
        fixture.memberships.beta,
      ],
    );
    await client.query(
      `INSERT INTO app.payroll_run_employees (
         id, company_id, payroll_run_id, employee_id,
         employment_id, input_snapshot
       ) VALUES ($1, $2, $3, $4, $5, '{"version":1}'::jsonb),
                ($6, $7, $8, $9, $10, '{"version":1}'::jsonb)`,
      [
        fixture.runEmployees.alpha,
        fixture.companies.alpha,
        fixture.runs.alpha,
        fixture.employees.alpha,
        fixture.employments.alpha,
        fixture.runEmployees.beta,
        fixture.companies.beta,
        fixture.runs.beta,
        fixture.employees.beta,
        fixture.employments.beta,
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

async function seedVerifiedConfiguration(
  client: PoolClient,
  companyId: string,
  configurationId: string,
  membershipId: string,
  sourceIds: readonly string[],
): Promise<void> {
  await client.query(
    `INSERT INTO app.statutory_configurations (
       id, company_id, configuration_version,
       effective_from, effective_to, parameters
     ) VALUES ($1, $2, 'ZM-2026.1', DATE '2026-01-01',
       DATE '2026-12-31',
       '{"paye":{},"napsa":{},"nhima":{}}'::jsonb)`,
    [configurationId, companyId],
  );
  const authorities = ['zra', 'napsa', 'nhima'];
  for (const [index, sourceId] of sourceIds.entries()) {
    const authority = authorities[index];
    await client.query(
      `INSERT INTO app.statutory_sources (
         id, company_id, statutory_configuration_id,
         authority, title, uri, accessed_on
       ) VALUES ($1, $2, $3, $4, $5, $6, DATE '2026-09-04')`,
      [
        sourceId,
        companyId,
        configurationId,
        authority,
        `${authority?.toUpperCase()} source`,
        `https://${authority}.example.test/${sourceId}`,
      ],
    );
  }
  await client.query(
    `UPDATE app.statutory_configurations
     SET status = 'verified', verified_by_membership_id = $2,
         verified_at = statement_timestamp(), row_version = row_version + 1
     WHERE id = $1`,
    [configurationId, membershipId],
  );
}

import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const testDatabaseMigrationUrl = process.env.TEST_DATABASE_MIGRATION_URL;

const fixture = {
  companies: {
    alpha: '71000000-0000-4000-8000-000000000001',
    beta: '71000000-0000-4000-8000-000000000002',
  },
  employees: {
    alpha: '72000000-0000-4000-8000-000000000001',
    beta: '72000000-0000-4000-8000-000000000002',
    transient: '72000000-0000-4000-8000-000000000003',
  },
  employments: {
    alpha: '73000000-0000-4000-8000-000000000001',
    beta: '73000000-0000-4000-8000-000000000002',
    transient: '73000000-0000-4000-8000-000000000003',
  },
} as const;

const workforceTables = ['employees', 'employments'] as const;

describe.runIf(
  testDatabaseUrl !== undefined && testDatabaseMigrationUrl !== undefined,
)('tenant-isolated workforce PostgreSQL foundation', () => {
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

    migrationPool = createPool(testDatabaseMigrationUrl, 'workforce-migration');
    runtimePool = createPool(testDatabaseUrl, 'workforce-runtime');
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

  it('forces RLS and grants runtime no destructive delete access', async () => {
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
      [workforceTables],
    );

    expect(security.rows).toEqual(
      workforceTables.map((tableName) => ({
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

  it('denies all workforce visibility without transaction tenant context', async () => {
    const pool = requireRuntimePool();

    await expect(
      pool.query('SELECT id FROM app.employees'),
    ).resolves.toMatchObject({ rows: [] });
    await expect(
      pool.query(
        `
          INSERT INTO app.employees (
            id,
            company_id,
            employee_number,
            given_name,
            family_name
          )
          VALUES ($1, $2, 'TRANSIENT', 'Test', 'Employee')
        `,
        [fixture.employees.transient, fixture.companies.alpha],
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('shows only the selected company and accepts same-tenant updates', async () => {
    const client = await requireRuntimePool().connect();

    try {
      await client.query('BEGIN');
      await setLocalCompany(client, fixture.companies.alpha);

      const visible = await client.query<{
        employeeId: string;
        employmentId: string;
      }>(`
        SELECT
          employee.id AS "employeeId",
          employment.id AS "employmentId"
        FROM app.employees AS employee
        JOIN app.employments AS employment
          ON employment.company_id = employee.company_id
          AND employment.employee_id = employee.id
      `);
      expect(visible.rows).toEqual([
        {
          employeeId: fixture.employees.alpha,
          employmentId: fixture.employments.alpha,
        },
      ]);

      const updated = await client.query<{ positionTitle: string }>(
        `
          UPDATE app.employments
          SET position_title = 'Senior Officer',
              version = version + 1,
              updated_at = statement_timestamp()
          WHERE id = $1
          RETURNING position_title AS "positionTitle"
        `,
        [fixture.employments.alpha],
      );
      expect(updated.rows).toEqual([{ positionTitle: 'Senior Officer' }]);

      await expect(
        client.query(
          `
            INSERT INTO app.employees (
              id,
              company_id,
              employee_number,
              given_name,
              family_name
            )
            VALUES ($1, $2, 'WRONG-TENANT', 'Wrong', 'Tenant')
          `,
          [fixture.employees.transient, fixture.companies.beta],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('prevents cross-company employment references', async () => {
    await expectDatabaseViolation(
      requireMigrationPool(),
      `
        INSERT INTO app.employments (
          id,
          company_id,
          employee_id,
          position_title,
          starts_on
        )
        VALUES (
          '${fixture.employments.transient}',
          '${fixture.companies.beta}',
          '${fixture.employees.alpha}',
          'Cross-tenant Officer',
          DATE '2026-09-01'
        )
      `,
      '23503',
      'employments_employee_fk',
    );
  });

  it('enforces identifiers, dates, names, and one open period', async () => {
    await expectDatabaseViolation(
      requireMigrationPool(),
      `
        UPDATE app.employees
        SET employee_number = 'invalid number'
        WHERE id = '${fixture.employees.alpha}'
      `,
      '23514',
      'employees_number_check',
    );
    await expectDatabaseViolation(
      requireMigrationPool(),
      `
        UPDATE app.employees
        SET given_name = E'Invalid\\nName'
        WHERE id = '${fixture.employees.alpha}'
      `,
      '23514',
      'employees_given_name_check',
    );
    await expectDatabaseViolation(
      requireMigrationPool(),
      `
        UPDATE app.employments
        SET ends_on = starts_on - 1
        WHERE id = '${fixture.employments.alpha}'
      `,
      '23514',
      'employments_dates_check',
    );
    await expectDatabaseViolation(
      requireMigrationPool(),
      `
        INSERT INTO app.employments (
          id,
          company_id,
          employee_id,
          position_title,
          starts_on
        )
        VALUES (
          '${fixture.employments.transient}',
          '${fixture.companies.alpha}',
          '${fixture.employees.alpha}',
          'Second Open Employment',
          DATE '2026-09-01'
        )
      `,
      '23505',
      'employments_one_open_period_idx',
    );
  });

  it('denies runtime deletes even with matching tenant context', async () => {
    const client = await requireRuntimePool().connect();

    try {
      await client.query('BEGIN');
      await setLocalCompany(client, fixture.companies.alpha);
      await expect(
        client.query('DELETE FROM app.employments WHERE id = $1', [
          fixture.employments.alpha,
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
});

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
      'DELETE FROM app.employments WHERE id = ANY($1::uuid[])',
      [Object.values(fixture.employments)],
    );
    await client.query('DELETE FROM app.employees WHERE id = ANY($1::uuid[])', [
      Object.values(fixture.employees),
    ]);
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
      `
        INSERT INTO app.companies (id, code, name)
        VALUES
          ($1, 'workforce-alpha', 'Workforce Alpha'),
          ($2, 'workforce-beta', 'Workforce Beta')
      `,
      [fixture.companies.alpha, fixture.companies.beta],
    );
    await client.query(
      `
        INSERT INTO app.employees (
          id,
          company_id,
          employee_number,
          given_name,
          middle_name,
          family_name
        )
        VALUES
          ($1, $2, 'EMP/0001', 'Chanda', 'Bwalya', 'Mwansa'),
          ($3, $4, 'EMP/0001', 'Mutinta', NULL, 'Phiri')
      `,
      [
        fixture.employees.alpha,
        fixture.companies.alpha,
        fixture.employees.beta,
        fixture.companies.beta,
      ],
    );
    await client.query(
      `
        INSERT INTO app.employments (
          id,
          company_id,
          employee_id,
          position_title,
          starts_on
        )
        VALUES
          ($1, $2, $3, 'Payroll Officer', DATE '2025-01-01'),
          ($4, $5, $6, 'Accountant', DATE '2025-02-01')
      `,
      [
        fixture.employments.alpha,
        fixture.companies.alpha,
        fixture.employees.alpha,
        fixture.employments.beta,
        fixture.companies.beta,
        fixture.employees.beta,
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

import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const testDatabaseMigrationUrl = process.env.TEST_DATABASE_MIGRATION_URL;

const fixture = {
  companies: {
    alpha: '81000000-0000-4000-8000-000000000001',
    beta: '81000000-0000-4000-8000-000000000002',
  },
  components: {
    alpha: '85000000-0000-4000-8000-000000000001',
    beta: '85000000-0000-4000-8000-000000000002',
    transient: '85000000-0000-4000-8000-000000000003',
  },
  employees: {
    alpha: '82000000-0000-4000-8000-000000000001',
    beta: '82000000-0000-4000-8000-000000000002',
  },
  employments: {
    alpha: '83000000-0000-4000-8000-000000000001',
    beta: '83000000-0000-4000-8000-000000000002',
  },
  periods: {
    alpha: '86000000-0000-4000-8000-000000000001',
    beta: '86000000-0000-4000-8000-000000000002',
    transient: '86000000-0000-4000-8000-000000000003',
  },
  salaries: {
    alpha: '84000000-0000-4000-8000-000000000001',
    beta: '84000000-0000-4000-8000-000000000002',
    transient: '84000000-0000-4000-8000-000000000003',
  },
} as const;

const compensationTables = [
  'compensation_components',
  'payroll_periods',
  'salaries',
] as const;

describe.runIf(
  testDatabaseUrl !== undefined && testDatabaseMigrationUrl !== undefined,
)(
  'tenant-isolated compensation and payroll-period PostgreSQL foundation',
  () => {
    let migrationPool: Pool | undefined;
    let runtimePool: Pool | undefined;

    beforeAll(async () => {
      if (
        testDatabaseUrl === undefined ||
        testDatabaseMigrationUrl === undefined
      ) {
        throw new Error('Test database URLs are required');
      }

      migrationPool = createPool(testDatabaseMigrationUrl, 'compensation-ddl');
      runtimePool = createPool(testDatabaseUrl, 'compensation-runtime');
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
          requested.table_name AS "tableName",
          record.relrowsecurity AS "rlsEnabled",
          record.relforcerowsecurity AS "rlsForced",
          has_table_privilege(
            'zampayroll_app',
            format('app.%I', requested.table_name),
            'SELECT'
          ) AS "canSelect",
          has_table_privilege(
            'zampayroll_app',
            format('app.%I', requested.table_name),
            'INSERT'
          ) AS "canInsert",
          has_table_privilege(
            'zampayroll_app',
            format('app.%I', requested.table_name),
            'UPDATE'
          ) AS "canUpdate",
          has_table_privilege(
            'zampayroll_app',
            format('app.%I', requested.table_name),
            'DELETE'
          ) AS "canDelete"
        FROM unnest($1::text[]) AS requested(table_name)
        JOIN pg_catalog.pg_class AS record
          ON record.relname = requested.table_name
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = record.relnamespace
          AND namespace.nspname = 'app'
        ORDER BY requested.table_name
      `,
        [compensationTables],
      );

      expect(security.rows).toEqual(
        compensationTables.map((tableName) => ({
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

    it('denies visibility without context and isolates company records', async () => {
      const runtime = requireRuntimePool();

      await expect(
        runtime.query('SELECT id FROM app.salaries'),
      ).resolves.toMatchObject({ rows: [] });

      const client = await runtime.connect();
      try {
        await client.query('BEGIN');
        await setLocalCompany(client, fixture.companies.alpha);
        const visible = await client.query<{
          componentId: string;
          periodId: string;
          salaryId: string;
        }>(`
        SELECT
          salary.id AS "salaryId",
          component.id AS "componentId",
          payroll_period.id AS "periodId"
        FROM app.salaries AS salary
        JOIN app.compensation_components AS component
          ON component.company_id = salary.company_id
          AND component.employment_id = salary.employment_id
        JOIN app.payroll_periods AS payroll_period
          ON payroll_period.company_id = salary.company_id
      `);

        expect(visible.rows).toEqual([
          {
            componentId: fixture.components.alpha,
            periodId: fixture.periods.alpha,
            salaryId: fixture.salaries.alpha,
          },
        ]);
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });

    it('rejects cross-company employment references and invalid values', async () => {
      await expectDatabaseViolation(
        `
        INSERT INTO app.salaries (
          id, company_id, employment_id, amount_minor_units,
          currency, currency_scale, starts_on
        )
        VALUES (
          '${fixture.salaries.transient}',
          '${fixture.companies.beta}',
          '${fixture.employments.alpha}',
          100000,
          'ZMW',
          2,
          DATE '2026-01-01'
        )
      `,
        '23503',
        'salaries_employment_fk',
      );
      await expectDatabaseViolation(
        `
        UPDATE app.compensation_components
        SET amount_minor_units = 0
        WHERE id = '${fixture.components.alpha}'
      `,
        '23514',
        'compensation_components_amount_check',
      );
      await expectDatabaseViolation(
        `
        UPDATE app.payroll_periods
        SET code = 'invalid code'
        WHERE id = '${fixture.periods.alpha}'
      `,
        '23514',
        'payroll_periods_code_check',
      );
    });

    it('enforces compensation within employment and prevents overlap', async () => {
      await expectDatabaseViolation(
        `
        INSERT INTO app.salaries (
          id, company_id, employment_id, amount_minor_units,
          currency, currency_scale, starts_on, ends_on
        )
        VALUES (
          '${fixture.salaries.transient}',
          '${fixture.companies.alpha}',
          '${fixture.employments.alpha}',
          1200000,
          'ZMW',
          2,
          DATE '2026-06-30',
          DATE '2026-12-31'
        )
      `,
        '23P01',
        'salaries_no_overlap',
      );
      await expectDatabaseViolation(
        `
        INSERT INTO app.compensation_components (
          id, company_id, employment_id, code, name, kind,
          amount_minor_units, currency, currency_scale, starts_on
        )
        VALUES (
          '${fixture.components.transient}',
          '${fixture.companies.alpha}',
          '${fixture.employments.alpha}',
          'TRANSPORT',
          'Transport allowance',
          'allowance',
          80000,
          'ZMW',
          2,
          DATE '2026-06-01'
        )
      `,
        '23P01',
        'compensation_components_no_overlap',
      );

      const client = await requireMigrationPool().connect();
      try {
        await client.query('BEGIN');
        await expect(
          client.query(
            `UPDATE app.employments SET ends_on = DATE '2026-12-31'
           WHERE id = $1`,
            [fixture.employments.alpha],
          ),
        ).rejects.toMatchObject({
          code: '23514',
          constraint: 'employments_cover_compensation',
        });
        await client.query('ROLLBACK');
        await client.query('BEGIN');
        await client.query(
          `UPDATE app.salaries SET ends_on = DATE '2026-12-31'
         WHERE id = $1`,
          [fixture.salaries.alpha],
        );
        await client.query(
          `UPDATE app.compensation_components
         SET ends_on = DATE '2026-12-31'
         WHERE id = $1`,
          [fixture.components.alpha],
        );
        await client.query(
          `UPDATE app.employments SET ends_on = DATE '2026-12-31'
         WHERE id = $1`,
          [fixture.employments.alpha],
        );
        await expect(
          client.query(
            `
            INSERT INTO app.compensation_components (
              id, company_id, employment_id, code, name, kind,
              amount_minor_units, currency, currency_scale, starts_on
            )
            VALUES ($1, $2, $3, 'MEAL', 'Meal allowance', 'allowance',
              50000, 'ZMW', 2, DATE '2027-01-01')
          `,
            [
              fixture.components.transient,
              fixture.companies.alpha,
              fixture.employments.alpha,
            ],
          ),
        ).rejects.toMatchObject({
          code: '23514',
          constraint: 'compensation_components_within_employment',
        });
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });

    it('rejects overlapping regular periods and permits off-cycle periods', async () => {
      await expectDatabaseViolation(
        `
        INSERT INTO app.payroll_periods (
          id, company_id, code, starts_on, ends_on, payment_date
        )
        VALUES (
          '${fixture.periods.transient}',
          '${fixture.companies.alpha}',
          'SEP-OCT-2026',
          DATE '2026-09-30',
          DATE '2026-10-31',
          DATE '2026-10-25'
        )
      `,
        '23P01',
        'payroll_periods_regular_no_overlap',
      );

      const client = await requireMigrationPool().connect();
      try {
        await client.query('BEGIN');
        await expect(
          client.query(
            `
            INSERT INTO app.payroll_periods (
              id, company_id, code, kind, starts_on, ends_on, payment_date
            )
            VALUES ($1, $2, 'BONUS-SEP-2026', 'off_cycle',
              DATE '2026-09-01', DATE '2026-09-30', DATE '2026-09-30')
          `,
            [fixture.periods.transient, fixture.companies.alpha],
          ),
        ).resolves.toMatchObject({ rowCount: 1 });
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });

    it('denies runtime deletes with matching tenant context', async () => {
      const client = await requireRuntimePool().connect();
      try {
        await client.query('BEGIN');
        await setLocalCompany(client, fixture.companies.alpha);
        await expect(
          client.query('DELETE FROM app.salaries WHERE id = $1', [
            fixture.salaries.alpha,
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
  },
);

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

async function cleanFixtures(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'DELETE FROM app.payroll_periods WHERE id = ANY($1::uuid[])',
      [Object.values(fixture.periods)],
    );
    await client.query(
      'DELETE FROM app.compensation_components WHERE id = ANY($1::uuid[])',
      [Object.values(fixture.components)],
    );
    await client.query('DELETE FROM app.salaries WHERE id = ANY($1::uuid[])', [
      Object.values(fixture.salaries),
    ]);
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
      `INSERT INTO app.companies (id, code, name)
       VALUES ($1, 'comp-alpha', 'Compensation Alpha'),
              ($2, 'comp-beta', 'Compensation Beta')`,
      [fixture.companies.alpha, fixture.companies.beta],
    );
    await client.query(
      `INSERT INTO app.employees
         (id, company_id, employee_number, given_name, family_name)
       VALUES ($1, $2, 'EMP/001', 'Chanda', 'Mwansa'),
              ($3, $4, 'EMP/001', 'Mutinta', 'Phiri')`,
      [
        fixture.employees.alpha,
        fixture.companies.alpha,
        fixture.employees.beta,
        fixture.companies.beta,
      ],
    );
    await client.query(
      `INSERT INTO app.employments
         (id, company_id, employee_id, position_title, starts_on)
       VALUES ($1, $2, $3, 'Officer', DATE '2025-01-01'),
              ($4, $5, $6, 'Accountant', DATE '2025-01-01')`,
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
      `INSERT INTO app.salaries
         (id, company_id, employment_id, amount_minor_units,
          currency, currency_scale, starts_on)
       VALUES ($1, $2, $3, 2500000, 'ZMW', 2, DATE '2026-01-01'),
              ($4, $5, $6, 1800000, 'ZMW', 2, DATE '2026-01-01')`,
      [
        fixture.salaries.alpha,
        fixture.companies.alpha,
        fixture.employments.alpha,
        fixture.salaries.beta,
        fixture.companies.beta,
        fixture.employments.beta,
      ],
    );
    await client.query(
      `INSERT INTO app.compensation_components
         (id, company_id, employment_id, code, name, kind,
          amount_minor_units, currency, currency_scale, starts_on)
       VALUES ($1, $2, $3, 'TRANSPORT', 'Transport allowance', 'allowance',
                 75000, 'ZMW', 2, DATE '2026-01-01'),
              ($4, $5, $6, 'LOAN', 'Loan repayment', 'deduction',
                 25000, 'ZMW', 2, DATE '2026-01-01')`,
      [
        fixture.components.alpha,
        fixture.companies.alpha,
        fixture.employments.alpha,
        fixture.components.beta,
        fixture.companies.beta,
        fixture.employments.beta,
      ],
    );
    await client.query(
      `INSERT INTO app.payroll_periods
         (id, company_id, code, starts_on, ends_on, payment_date)
       VALUES ($1, $2, 'SEP-2026', DATE '2026-09-01',
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
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const testDatabaseMigrationUrl = process.env.TEST_DATABASE_MIGRATION_URL;

const fixture = {
  companies: {
    alpha: 'a1000000-0000-4000-8000-000000000001',
    beta: 'a1000000-0000-4000-8000-000000000002',
  },
  configurations: {
    alpha: 'a4000000-0000-4000-8000-000000000001',
    beta: 'a4000000-0000-4000-8000-000000000002',
    incomplete: 'a4000000-0000-4000-8000-000000000003',
    overlapping: 'a4000000-0000-4000-8000-000000000004',
  },
  memberships: {
    alpha: 'a3000000-0000-4000-8000-000000000001',
    beta: 'a3000000-0000-4000-8000-000000000002',
  },
  sources: {
    alphaNhima: 'a5000000-0000-4000-8000-000000000001',
    alphaNapsa: 'a5000000-0000-4000-8000-000000000002',
    alphaZra: 'a5000000-0000-4000-8000-000000000003',
    betaNhima: 'a5000000-0000-4000-8000-000000000004',
    betaNapsa: 'a5000000-0000-4000-8000-000000000005',
    betaZra: 'a5000000-0000-4000-8000-000000000006',
    transient: 'a5000000-0000-4000-8000-000000000007',
  },
  users: {
    alpha: 'a2000000-0000-4000-8000-000000000001',
    beta: 'a2000000-0000-4000-8000-000000000002',
  },
} as const;

const statutoryTables = [
  'statutory_configurations',
  'statutory_sources',
] as const;

describe.runIf(
  testDatabaseUrl !== undefined && testDatabaseMigrationUrl !== undefined,
)('tenant-isolated statutory configuration PostgreSQL foundation', () => {
  let migrationPool: Pool | undefined;
  let runtimePool: Pool | undefined;

  beforeAll(async () => {
    if (
      testDatabaseUrl === undefined ||
      testDatabaseMigrationUrl === undefined
    ) {
      throw new Error('Test database URLs are required');
    }

    migrationPool = createPool(testDatabaseMigrationUrl, 'statutory-ddl');
    runtimePool = createPool(testDatabaseUrl, 'statutory-runtime');
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
      [statutoryTables],
    );

    expect(security.rows).toEqual(
      statutoryTables.map((tableName) => ({
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

  it('denies visibility without context and isolates company evidence', async () => {
    await expect(
      requireRuntimePool().query('SELECT id FROM app.statutory_configurations'),
    ).resolves.toMatchObject({ rows: [] });

    const client = await requireRuntimePool().connect();
    try {
      await client.query('BEGIN');
      await setLocalCompany(client, fixture.companies.alpha);
      const visible = await client.query<{
        configurationId: string;
        sourceCount: string;
      }>(`
          SELECT
            configuration.id AS "configurationId",
            count(source.id)::text AS "sourceCount"
          FROM app.statutory_configurations AS configuration
          JOIN app.statutory_sources AS source
            ON source.company_id = configuration.company_id
            AND source.statutory_configuration_id = configuration.id
          GROUP BY configuration.id
        `);

      expect(visible.rows).toEqual([
        {
          configurationId: fixture.configurations.alpha,
          sourceCount: '3',
        },
      ]);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('requires complete primary-authority evidence before verification', async () => {
    const client = await requireMigrationPool().connect();
    try {
      await client.query('BEGIN');
      await insertConfiguration(
        client,
        fixture.configurations.incomplete,
        fixture.companies.alpha,
        'ZM-2027.1',
        '2027-01-01',
        '2027-12-31',
      );
      await insertSource(
        client,
        fixture.sources.transient,
        fixture.companies.alpha,
        fixture.configurations.incomplete,
        'zra',
      );

      await expect(
        verifyConfiguration(
          client,
          fixture.configurations.incomplete,
          fixture.memberships.alpha,
        ),
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'statutory_configurations_complete_sources',
      });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('locks verified rules and sources while allowing an explicit retirement', async () => {
    const client = await requireMigrationPool().connect();
    try {
      await client.query('BEGIN');
      await verifyConfiguration(
        client,
        fixture.configurations.alpha,
        fixture.memberships.alpha,
      );

      await expect(
        client.query(
          `UPDATE app.statutory_configurations
             SET parameters = jsonb_set(parameters, '{paye,state}', '"changed"')
             WHERE id = $1`,
          [fixture.configurations.alpha],
        ),
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'statutory_configurations_status_transition',
      });

      await client.query('ROLLBACK');
      await client.query('BEGIN');
      await verifyConfiguration(
        client,
        fixture.configurations.alpha,
        fixture.memberships.alpha,
      );
      await expect(
        client.query(
          `UPDATE app.statutory_sources SET title = 'Changed evidence'
             WHERE id = $1`,
          [fixture.sources.alphaZra],
        ),
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'statutory_sources_immutable',
      });

      await client.query('ROLLBACK');
      await client.query('BEGIN');
      await verifyConfiguration(
        client,
        fixture.configurations.alpha,
        fixture.memberships.alpha,
      );
      await expect(
        client.query(
          `UPDATE app.statutory_configurations
             SET status = 'retired', row_version = row_version + 1
             WHERE id = $1`,
          [fixture.configurations.alpha],
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('serializes and rejects overlapping applicable configurations', async () => {
    const client = await requireMigrationPool().connect();
    try {
      await client.query('BEGIN');
      await verifyConfiguration(
        client,
        fixture.configurations.alpha,
        fixture.memberships.alpha,
      );
      await insertConfiguration(
        client,
        fixture.configurations.overlapping,
        fixture.companies.alpha,
        'ZM-2026.2',
        '2026-12-31',
        '2027-12-31',
      );
      for (const [index, authority] of ['zra', 'napsa', 'nhima'].entries()) {
        await insertSource(
          client,
          `a6000000-0000-4000-8000-00000000000${index + 1}`,
          fixture.companies.alpha,
          fixture.configurations.overlapping,
          authority,
        );
      }

      await expect(
        verifyConfiguration(
          client,
          fixture.configurations.overlapping,
          fixture.memberships.alpha,
        ),
      ).rejects.toMatchObject({
        code: '23P01',
        constraint: 'statutory_configurations_no_overlap',
      });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('rejects cross-company evidence and runtime deletes', async () => {
    await expectDatabaseViolation(
      `
          INSERT INTO app.statutory_sources (
            id, company_id, statutory_configuration_id,
            authority, title, uri, accessed_on
          ) VALUES (
            '${fixture.sources.transient}',
            '${fixture.companies.beta}',
            '${fixture.configurations.alpha}',
            'zra',
            'Cross-company evidence',
            'https://www.zra.org.zm/tax-information/',
            DATE '2026-09-04'
          )
        `,
      '23503',
      'statutory_sources_configuration_fk',
    );

    const client = await requireRuntimePool().connect();
    try {
      await client.query('BEGIN');
      await setLocalCompany(client, fixture.companies.alpha);
      await expect(
        client.query('DELETE FROM app.statutory_sources WHERE id = $1', [
          fixture.sources.alphaZra,
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
      'DELETE FROM app.statutory_sources WHERE company_id = ANY($1::uuid[])',
      [Object.values(fixture.companies)],
    );
    await client.query(
      'DELETE FROM app.statutory_configurations WHERE company_id = ANY($1::uuid[])',
      [Object.values(fixture.companies)],
    );
    await client.query(
      'DELETE FROM app.company_memberships WHERE id = ANY($1::uuid[])',
      [Object.values(fixture.memberships)],
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
       VALUES ($1, 'stat-alpha', 'Statutory Alpha'),
              ($2, 'stat-beta', 'Statutory Beta')`,
      [fixture.companies.alpha, fixture.companies.beta],
    );
    await client.query(
      `INSERT INTO app.user_accounts (id, email, display_name)
       VALUES ($1, 'stat-alpha@example.com', 'Alpha Verifier'),
              ($2, 'stat-beta@example.com', 'Beta Verifier')`,
      [fixture.users.alpha, fixture.users.beta],
    );
    await client.query(
      `INSERT INTO app.company_memberships
         (id, company_id, user_account_id)
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
    await insertConfiguration(
      client,
      fixture.configurations.alpha,
      fixture.companies.alpha,
      'ZM-2026.1',
      '2026-01-01',
      '2026-12-31',
    );
    await insertConfiguration(
      client,
      fixture.configurations.beta,
      fixture.companies.beta,
      'ZM-2026.1',
      '2026-01-01',
      '2026-12-31',
    );

    const sources = [
      [
        fixture.sources.alphaZra,
        fixture.companies.alpha,
        fixture.configurations.alpha,
        'zra',
      ],
      [
        fixture.sources.alphaNapsa,
        fixture.companies.alpha,
        fixture.configurations.alpha,
        'napsa',
      ],
      [
        fixture.sources.alphaNhima,
        fixture.companies.alpha,
        fixture.configurations.alpha,
        'nhima',
      ],
      [
        fixture.sources.betaZra,
        fixture.companies.beta,
        fixture.configurations.beta,
        'zra',
      ],
      [
        fixture.sources.betaNapsa,
        fixture.companies.beta,
        fixture.configurations.beta,
        'napsa',
      ],
      [
        fixture.sources.betaNhima,
        fixture.companies.beta,
        fixture.configurations.beta,
        'nhima',
      ],
    ] as const;
    for (const [id, companyId, configurationId, authority] of sources) {
      await insertSource(client, id, companyId, configurationId, authority);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function insertConfiguration(
  client: PoolClient,
  id: string,
  companyId: string,
  configurationVersion: string,
  effectiveFrom: string,
  effectiveTo: string,
): Promise<void> {
  await client.query(
    `INSERT INTO app.statutory_configurations (
       id, company_id, configuration_version,
       effective_from, effective_to, parameters
     ) VALUES ($1, $2, $3, $4::date, $5::date, $6::jsonb)`,
    [
      id,
      companyId,
      configurationVersion,
      effectiveFrom,
      effectiveTo,
      JSON.stringify({
        nhima: { state: 'evidence-only' },
        napsa: { state: 'evidence-only' },
        paye: { state: 'evidence-only' },
      }),
    ],
  );
}

async function insertSource(
  client: PoolClient,
  id: string,
  companyId: string,
  configurationId: string,
  authority: string,
): Promise<void> {
  const hosts = {
    nhima: 'www.nhima.co.zm',
    napsa: 'www.napsa.co.zm',
    zra: 'www.zra.org.zm',
  } as const;
  const host = hosts[authority as keyof typeof hosts] ?? 'example.invalid';
  await client.query(
    `INSERT INTO app.statutory_sources (
       id, company_id, statutory_configuration_id,
       authority, title, uri, accessed_on
     ) VALUES ($1, $2, $3, $4, $5, $6, DATE '2026-09-04')`,
    [
      id,
      companyId,
      configurationId,
      authority,
      `${authority.toUpperCase()} official evidence`,
      `https://${host}/evidence/${id}`,
    ],
  );
}

async function verifyConfiguration(
  client: PoolClient,
  configurationId: string,
  membershipId: string,
): Promise<void> {
  await client.query(
    `UPDATE app.statutory_configurations
     SET status = 'verified',
         verified_by_membership_id = $2,
         verified_at = TIMESTAMPTZ '2026-09-04 10:30:00+00',
         row_version = row_version + 1
     WHERE id = $1`,
    [configurationId, membershipId],
  );
}

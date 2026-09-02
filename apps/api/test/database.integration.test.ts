import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadEnvironment } from '../src/config/environment.js';
import { createPostgresDatabase } from '../src/infrastructure/database.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.runIf(testDatabaseUrl !== undefined)('PostgreSQL adapter', () => {
  let pool: Pool;

  beforeAll(() => {
    if (testDatabaseUrl === undefined) {
      throw new Error(
        'TEST_DATABASE_URL is required for database integration tests',
      );
    }

    const environment = loadEnvironment({
      DATABASE_URL: testDatabaseUrl,
      NODE_ENV: 'test',
    });

    pool = new Pool({
      connectionString: environment.DATABASE_URL,
      connectionTimeoutMillis: environment.DATABASE_CONNECTION_TIMEOUT_MS,
      idleTimeoutMillis: environment.DATABASE_IDLE_TIMEOUT_MS,
      max: environment.DATABASE_POOL_MAX,
      statement_timeout: environment.DATABASE_STATEMENT_TIMEOUT_MS,
      ssl: environment.DATABASE_SSL ? { rejectUnauthorized: true } : false,
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('connects with the runtime role and completes a health query', async () => {
    const database = createPostgresDatabase(
      loadEnvironment({
        DATABASE_URL: testDatabaseUrl,
        NODE_ENV: 'test',
      }),
    );

    try {
      await expect(database.checkHealth()).resolves.toBeUndefined();
    } finally {
      await database.close();
    }
  });

  it('uses the restricted runtime identity', async () => {
    const result = await pool.query<{
      currentUser: string;
      rolBypassRls: boolean;
      rolCanLogin: boolean;
      rolCreateDb: boolean;
      rolCreateRole: boolean;
      rolInherit: boolean;
      rolReplication: boolean;
      rolSuper: boolean;
      sessionUser: string;
    }>(`
      SELECT
        current_user AS "currentUser",
        session_user AS "sessionUser",
        rolcanlogin AS "rolCanLogin",
        rolsuper AS "rolSuper",
        rolcreatedb AS "rolCreateDb",
        rolcreaterole AS "rolCreateRole",
        rolinherit AS "rolInherit",
        rolreplication AS "rolReplication",
        rolbypassrls AS "rolBypassRls"
      FROM pg_roles
      WHERE rolname = current_user
    `);

    expect(result.rows).toEqual([
      {
        currentUser: 'zampayroll_app',
        rolBypassRls: false,
        rolCanLogin: true,
        rolCreateDb: false,
        rolCreateRole: false,
        rolInherit: false,
        rolReplication: false,
        rolSuper: false,
        sessionUser: 'zampayroll_app',
      },
    ]);
  });

  it('has a ready application schema with no schema DDL privilege', async () => {
    const result = await pool.query<{
      canCreate: boolean;
      canUse: boolean;
      migrationsReady: boolean;
      schemaReady: boolean;
    }>(`
      SELECT
        to_regnamespace('app') IS NOT NULL AS "schemaReady",
        EXISTS (
          SELECT 1
          FROM pg_class AS migration_table
          JOIN pg_namespace AS migration_schema
            ON migration_schema.oid = migration_table.relnamespace
          WHERE migration_schema.nspname = 'zampayroll_internal'
            AND migration_table.relname = 'schema_migrations'
            AND migration_table.relkind IN ('r', 'p')
        ) AS "migrationsReady",
        has_schema_privilege(current_user, 'app', 'USAGE') AS "canUse",
        has_schema_privilege(current_user, 'app', 'CREATE') AS "canCreate"
    `);

    expect(result.rows[0]).toEqual({
      canCreate: false,
      canUse: true,
      migrationsReady: true,
      schemaReady: true,
    });
  });

  it('grants only the intended default application privileges', async () => {
    const result = await pool.query<{
      grantee: string;
      isGrantable: boolean;
      objectType: string;
      privilegeType: string;
    }>(`
      SELECT
        CASE
          WHEN privilege.grantee = 0 THEN 'PUBLIC'
          ELSE grantee.rolname
        END AS grantee,
        defaults.defaclobjtype AS "objectType",
        privilege.privilege_type AS "privilegeType",
        privilege.is_grantable AS "isGrantable"
      FROM pg_default_acl AS defaults
      JOIN pg_roles AS owner ON owner.oid = defaults.defaclrole
      CROSS JOIN LATERAL aclexplode(defaults.defaclacl) AS privilege
      LEFT JOIN pg_roles AS grantee ON grantee.oid = privilege.grantee
      WHERE owner.rolname = 'zampayroll_migrator'
        AND defaults.defaclnamespace = 'app'::regnamespace
        AND privilege.grantee <> owner.oid
      ORDER BY defaults.defaclobjtype, privilege.privilege_type
    `);

    expect(result.rows).toEqual([
      {
        grantee: 'zampayroll_app',
        isGrantable: false,
        objectType: 'S',
        privilegeType: 'SELECT',
      },
      {
        grantee: 'zampayroll_app',
        isGrantable: false,
        objectType: 'S',
        privilegeType: 'USAGE',
      },
      {
        grantee: 'zampayroll_app',
        isGrantable: false,
        objectType: 'f',
        privilegeType: 'EXECUTE',
      },
      {
        grantee: 'zampayroll_app',
        isGrantable: false,
        objectType: 'r',
        privilegeType: 'INSERT',
      },
      {
        grantee: 'zampayroll_app',
        isGrantable: false,
        objectType: 'r',
        privilegeType: 'SELECT',
      },
      {
        grantee: 'zampayroll_app',
        isGrantable: false,
        objectType: 'r',
        privilegeType: 'UPDATE',
      },
    ]);
  });

  it('cannot create application or temporary objects', async () => {
    await expectInsufficientPrivilege(
      pool,
      'CREATE TABLE app.runtime_ddl_probe (id integer)',
    );
    await expectInsufficientPrivilege(
      pool,
      'CREATE TEMPORARY TABLE runtime_temp_probe (id integer)',
    );
  });

  it('cannot access migration internals', async () => {
    await expectInsufficientPrivilege(
      pool,
      'SELECT 1 FROM zampayroll_internal.schema_migrations LIMIT 1',
    );
  });
});

async function expectInsufficientPrivilege(
  pool: Pool,
  statement: string,
): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await expect(client.query(statement)).rejects.toMatchObject({
      code: '42501',
    });
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

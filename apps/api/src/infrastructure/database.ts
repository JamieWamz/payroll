import { Pool } from 'pg';
import type { QueryResult, QueryResultRow } from 'pg';

import type { Environment } from '../config/environment.js';
import type { EntityId } from '../shared/domain/entity-id.js';

export interface TenantTransaction {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
}

export interface Database {
  checkHealth(): Promise<void>;
  close(): Promise<void>;
  withTenantTransaction<Result>(
    companyId: EntityId<'Company'>,
    operation: (transaction: TenantTransaction) => Promise<Result>,
  ): Promise<Result>;
}

export interface DatabaseOperationalEvent {
  readonly code: 'postgres_pool_idle_client_error';
  readonly message: 'PostgreSQL pool reported an idle client error';
}

export interface CreatePostgresDatabaseOptions {
  onOperationalEvent?: (event: DatabaseOperationalEvent) => void;
}

const idleClientErrorEvent: Readonly<DatabaseOperationalEvent> = Object.freeze({
  code: 'postgres_pool_idle_client_error',
  message: 'PostgreSQL pool reported an idle client error',
});

const readinessQuery = `
  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_namespace AS namespace
    WHERE CURRENT_USER = 'zampayroll_app'
      AND namespace.nspname = 'app'
      AND pg_catalog.has_schema_privilege(
        CURRENT_USER,
        namespace.oid,
        'USAGE'
      )
  ) AS ready
`;

const setTenantContextQuery = `
  SELECT pg_catalog.set_config('app.current_company_id', $1, true)
`;

export function createPostgresDatabase(
  environment: Environment,
  { onOperationalEvent }: CreatePostgresDatabaseOptions = {},
): Database {
  const pool = new Pool({
    application_name: 'zampayroll-api',
    connectionString: environment.DATABASE_URL,
    connectionTimeoutMillis: environment.DATABASE_CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: environment.DATABASE_IDLE_TIMEOUT_MS,
    max: environment.DATABASE_POOL_MAX,
    statement_timeout: environment.DATABASE_STATEMENT_TIMEOUT_MS,
    ...(environment.DATABASE_SSL
      ? { ssl: { rejectUnauthorized: true } }
      : { ssl: false }),
  });

  pool.on('error', () => {
    try {
      onOperationalEvent?.(idleClientErrorEvent);
    } catch {
      // An observer must not turn a recoverable idle-client error into a crash.
    }
  });

  let closePromise: Promise<void> | undefined;

  return {
    async checkHealth(): Promise<void> {
      const client = await pool.connect();

      try {
        const result = await client.query<{ ready: boolean }>(readinessQuery);

        if (result.rows[0]?.ready !== true) {
          throw new Error('Database schema is not ready');
        }
      } finally {
        client.release();
      }
    },
    async close(): Promise<void> {
      closePromise ??= pool.end();
      await closePromise;
    },
    async withTenantTransaction<Result>(
      companyId: EntityId<'Company'>,
      operation: (transaction: TenantTransaction) => Promise<Result>,
    ): Promise<Result> {
      const client = await pool.connect();
      let active = true;
      let transactionStarted = false;

      const transaction: TenantTransaction = {
        async query<Row extends QueryResultRow = QueryResultRow>(
          text: string,
          values?: readonly unknown[],
        ): Promise<QueryResult<Row>> {
          if (!active) {
            throw new Error('Tenant transaction is no longer active');
          }

          return client.query<Row>(
            text,
            values === undefined ? undefined : [...values],
          );
        },
      };

      try {
        await client.query('BEGIN');
        transactionStarted = true;
        await client.query(setTenantContextQuery, [companyId]);

        const result = await operation(transaction);
        active = false;
        await client.query('COMMIT');

        return result;
      } catch (error) {
        active = false;

        if (transactionStarted) {
          try {
            await client.query('ROLLBACK');
          } catch {
            // Preserve the operation or commit error as the actionable failure.
          }
        }

        throw error;
      } finally {
        active = false;
        client.release();
      }
    },
  };
}

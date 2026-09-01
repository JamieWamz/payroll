import { Pool } from 'pg';

import type { Environment } from '../config/environment.js';

export interface Database {
  checkHealth(): Promise<void>;
  close(): Promise<void>;
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
  };
}

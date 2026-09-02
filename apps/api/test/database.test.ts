import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadEnvironment } from '../src/config/environment.js';
import { createPostgresDatabase } from '../src/infrastructure/database.js';
import { parseEntityId } from '../src/shared/domain/entity-id.js';

const poolMocks = vi.hoisted(() => ({
  configurations: [] as unknown[],
  connect: vi.fn(),
  end: vi.fn(),
  errorListener: undefined as
    ((error: Error, client: unknown) => void) | undefined,
}));

vi.mock('pg', () => ({
  Pool: class {
    constructor(configuration: unknown) {
      poolMocks.configurations.push(configuration);
    }

    connect() {
      return poolMocks.connect();
    }

    end() {
      return poolMocks.end();
    }

    on(event: string, listener: (error: Error, client: unknown) => void): this {
      if (event === 'error') {
        poolMocks.errorListener = listener;
      }

      return this;
    }
  },
}));

const environment = loadEnvironment({
  DATABASE_URL: 'postgresql://app:test@localhost:5432/zampayroll',
  NODE_ENV: 'test',
});

const companyId = parseEntityId(
  '7F3D33F7-3B84-4BB6-929C-7BA701D17891',
  'Company',
);

beforeEach(() => {
  poolMocks.configurations.length = 0;
  poolMocks.connect.mockReset();
  poolMocks.end.mockReset().mockResolvedValue(undefined);
  poolMocks.errorListener = undefined;
});

describe('PostgreSQL database adapter', () => {
  it('handles idle-client errors with a fixed sanitized operational event', () => {
    const onOperationalEvent = vi.fn(() => {
      throw new Error('logging unavailable');
    });

    createPostgresDatabase(environment, { onOperationalEvent });

    expect(poolMocks.errorListener).toBeTypeOf('function');

    const error = new Error('password=super-secret host=private.internal');
    const client = { connectionParameters: { password: 'super-secret' } };

    expect(() => poolMocks.errorListener?.(error, client)).not.toThrow();
    expect(onOperationalEvent).toHaveBeenCalledTimes(1);
    expect(onOperationalEvent).toHaveBeenCalledWith({
      code: 'postgres_pool_idle_client_error',
      message: 'PostgreSQL pool reported an idle client error',
    });
    expect(JSON.stringify(onOperationalEvent.mock.calls)).not.toContain(
      'super-secret',
    );
    expect(JSON.stringify(onOperationalEvent.mock.calls)).not.toContain(
      'private.internal',
    );
  });

  it('requires the runtime role, versioned app schema, and USAGE privilege for readiness', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ ready: true }] });
    const release = vi.fn();
    poolMocks.connect.mockResolvedValue({ query, release });
    const database = createPostgresDatabase(environment);

    await expect(database.checkHealth()).resolves.toBeUndefined();

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("namespace.nspname = 'app'"),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("CURRENT_USER = 'zampayroll_app'"),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('has_schema_privilege'),
    );
    expect(query).toHaveBeenCalledWith(expect.stringContaining('CURRENT_USER'));
    expect(query).not.toHaveBeenCalledWith('SELECT 1');
    expect(release).toHaveBeenCalledOnce();
  });

  it('fails readiness and still releases the client when the role or schema is unavailable', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ ready: false }] });
    const release = vi.fn();
    poolMocks.connect.mockResolvedValue({ query, release });
    const database = createPostgresDatabase(environment);

    await expect(database.checkHealth()).rejects.toThrow(
      'Database schema is not ready',
    );
    expect(release).toHaveBeenCalledOnce();
  });

  it('releases the client when the readiness query fails', async () => {
    const query = vi.fn().mockRejectedValue(new Error('connection reset'));
    const release = vi.fn();
    poolMocks.connect.mockResolvedValue({ query, release });
    const database = createPostgresDatabase(environment);

    await expect(database.checkHealth()).rejects.toThrow('connection reset');
    expect(release).toHaveBeenCalledOnce();
  });

  it('closes the pool only once across repeated close calls', async () => {
    const database = createPostgresDatabase(environment);

    await Promise.all([database.close(), database.close()]);
    await database.close();

    expect(poolMocks.end).toHaveBeenCalledOnce();
  });

  it('runs tenant work on one client with transaction-local parameterized context', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const release = vi.fn();
    poolMocks.connect.mockResolvedValue({ query, release });
    const database = createPostgresDatabase(environment);
    const employeeId = 'd14f42c4-b9eb-43da-bb2a-d77e26c55916';

    const result = await database.withTenantTransaction(
      companyId,
      async (transaction) => {
        await transaction.query(
          'SELECT employee_id FROM app.employee WHERE employee_id = $1',
          [employeeId],
        );
        return { employeeId };
      },
    );

    expect(result).toEqual({ employeeId });
    expect(poolMocks.connect).toHaveBeenCalledOnce();
    expect(query.mock.calls).toEqual([
      ['BEGIN'],
      [
        expect.stringContaining(
          "pg_catalog.set_config('app.current_company_id', $1, true)",
        ),
        [companyId],
      ],
      [
        'SELECT employee_id FROM app.employee WHERE employee_id = $1',
        [employeeId],
      ],
      ['COMMIT'],
    ]);
    expect(query.mock.calls.flat().join(' ')).not.toContain(
      `SET app.current_company_id = '${companyId}'`,
    );
    expect(release).toHaveBeenCalledOnce();
  });

  it('rolls back callback failures and always releases the client', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: null, rows: [] });
    const release = vi.fn();
    poolMocks.connect.mockResolvedValue({ query, release });
    const database = createPostgresDatabase(environment);
    const operationError = new Error('employee write failed');

    await expect(
      database.withTenantTransaction(companyId, async () => {
        throw operationError;
      }),
    ).rejects.toBe(operationError);

    expect(query.mock.calls).toEqual([
      ['BEGIN'],
      [
        expect.stringContaining(
          "pg_catalog.set_config('app.current_company_id', $1, true)",
        ),
        [companyId],
      ],
      ['ROLLBACK'],
    ]);
    expect(release).toHaveBeenCalledOnce();
  });

  it('preserves the original failure when rollback also fails', async () => {
    const operationError = new Error('domain operation failed');
    const rollbackError = new Error('connection lost during rollback');
    const query = vi.fn(async (text: string) => {
      if (text === 'ROLLBACK') {
        throw rollbackError;
      }

      return { rowCount: null, rows: [] };
    });
    const release = vi.fn();
    poolMocks.connect.mockResolvedValue({ query, release });
    const database = createPostgresDatabase(environment);

    await expect(
      database.withTenantTransaction(companyId, async () => {
        throw operationError;
      }),
    ).rejects.toBe(operationError);

    expect(query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
  });

  it('rolls back a failed commit before releasing the client', async () => {
    const commitError = new Error('commit failed');
    const query = vi.fn(async (text: string) => {
      if (text === 'COMMIT') {
        throw commitError;
      }

      return { rowCount: null, rows: [] };
    });
    const release = vi.fn();
    poolMocks.connect.mockResolvedValue({ query, release });
    const database = createPostgresDatabase(environment);

    await expect(
      database.withTenantTransaction(companyId, async () => 'completed'),
    ).rejects.toBe(commitError);

    expect(query.mock.calls.at(-2)).toEqual(['COMMIT']);
    expect(query.mock.calls.at(-1)).toEqual(['ROLLBACK']);
    expect(release).toHaveBeenCalledOnce();
  });

  it('does not allow retained transaction handles to query after completion', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: null, rows: [] });
    const release = vi.fn();
    poolMocks.connect.mockResolvedValue({ query, release });
    const database = createPostgresDatabase(environment);
    let retainedTransaction:
      | Parameters<Parameters<typeof database.withTenantTransaction>[1]>[0]
      | undefined;

    await database.withTenantTransaction(companyId, async (transaction) => {
      retainedTransaction = transaction;
    });

    const callsAfterCompletion = query.mock.calls.length;
    await expect(retainedTransaction?.query('SELECT 1')).rejects.toThrow(
      'Tenant transaction is no longer active',
    );
    expect(query).toHaveBeenCalledTimes(callsAfterCompletion);
    expect(release).toHaveBeenCalledOnce();
  });
});

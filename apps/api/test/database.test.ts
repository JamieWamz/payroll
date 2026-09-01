import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadEnvironment } from '../src/config/environment.js';
import { createPostgresDatabase } from '../src/infrastructure/database.js';

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
});
